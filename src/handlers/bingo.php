<?php
// v588 ビンゴ。 日曜 0:00 (JST) 〜 土曜 23:59 (JST) の 週次 サイクル。
//   GET  /api/bingo/me            今週の自分のカード (なければ生成 + 自動判定)
//   GET  /api/bingo/leaderboard   今週のリーダーボード (達成順 / ライン数)
//   GET  /api/bingo/history?week=YYYY-MM-DD  過去のカード閲覧
declare(strict_types=1);

// タスク定義 (id, label, icon, type, threshold)。 type ごとに 判定SQL が違う。
// 平日 限定 = 月-金 (JST) のデータだけ カウント (オープナーは その日の最初の ラボイン)
const BINGO_TASK_POOL = [
    ['id' => 'checkin1',  'label' => 'ラボイン 1 回',       'icon' => '🏠', 'type' => 'checkin', 'threshold' => 1],
    ['id' => 'checkin3',  'label' => 'ラボイン 3 回',       'icon' => '🏠', 'type' => 'checkin', 'threshold' => 3],
    ['id' => 'checkin5',  'label' => 'ラボイン 5 日 連続',  'icon' => '🔥', 'type' => 'checkin_streak', 'threshold' => 5],
    ['id' => 'opener1',   'label' => 'オープナー 1 回',     'icon' => '🌅', 'type' => 'opener', 'threshold' => 1],
    ['id' => 'opener2',   'label' => 'オープナー 2 回',     'icon' => '🌅', 'type' => 'opener', 'threshold' => 2],
    ['id' => 'sns1',      'label' => 'らぼったー 1 投稿',   'icon' => '💬', 'type' => 'sns_post', 'threshold' => 1],
    ['id' => 'sns3',      'label' => 'らぼったー 3 投稿',   'icon' => '💬', 'type' => 'sns_post', 'threshold' => 3],
    ['id' => 'sns_react', 'label' => 'リアクション 5 個',    'icon' => '❤️', 'type' => 'sns_reaction', 'threshold' => 5],
    ['id' => 'buy1',      'label' => '購入 1 件',           'icon' => '🛒', 'type' => 'purchase', 'threshold' => 1],
    ['id' => 'sell1',     'label' => '販売 1 件',           'icon' => '🏷', 'type' => 'sell', 'threshold' => 1],
    ['id' => 'task1',     'label' => 'タスク完了 1 件',     'icon' => '📋', 'type' => 'task_complete', 'threshold' => 1],
    ['id' => 'mahjong1',  'label' => '麻雀 1 局',           'icon' => '🀄', 'type' => 'mahjong', 'threshold' => 1],
    ['id' => 'othello1',  'label' => '地雷オセロ 1 局',     'icon' => '💣', 'type' => 'othello', 'threshold' => 1],
    ['id' => 'place1',    'label' => '食べある記 1 件 投稿', 'icon' => '🍴', 'type' => 'place_add', 'threshold' => 1],
    ['id' => 'walk1',     'label' => '散歩 1 回',           'icon' => '🚶', 'type' => 'walk', 'threshold' => 1],
    ['id' => 'workout1',  'label' => '筋トレ 1 回',         'icon' => '💪', 'type' => 'workout', 'threshold' => 1],
    ['id' => 'health1',   'label' => '体重 記録 1 回',      'icon' => '⚖️', 'type' => 'health', 'threshold' => 1],
    ['id' => 'poll1',     'label' => '投票 1 回 回答',       'icon' => '📊', 'type' => 'poll_vote', 'threshold' => 1],
    ['id' => 'roll1',     'label' => '点呼 1 回 応答',       'icon' => '📣', 'type' => 'rollcall_resp', 'threshold' => 1],
    ['id' => 'todo1',     'label' => 'TODO 1 件 完了',      'icon' => '📝', 'type' => 'todo_done', 'threshold' => 1],
    ['id' => 'fortune',   'label' => '占い 大吉 or 中吉',   'icon' => '🔮', 'type' => 'fortune_good', 'threshold' => 1],
    ['id' => 'tier1',     'label' => 'ティア表 1 件 回答',   'icon' => '🎯', 'type' => 'tier_answer', 'threshold' => 1],
    ['id' => 'pred1',     'label' => '優勝予想 1 件 参加',   'icon' => '🏆', 'type' => 'prediction_join', 'threshold' => 1],
    ['id' => 'send1',     'label' => '送金 1 回',           'icon' => '💸', 'type' => 'transfer', 'threshold' => 1],
    ['id' => 'shiri1',    'label' => '絵しりとり 1 局',      'icon' => '🎨', 'type' => 'shiritori', 'threshold' => 1],
    ['id' => 'paper1',    'label' => '論文査読 or 原稿チェック 1 件', 'icon' => '📄', 'type' => 'ai_review', 'threshold' => 1],
    ['id' => 'jinrou1',   'label' => '人狼 1 局',           'icon' => '🐺', 'type' => 'jinrou', 'threshold' => 1],
    ['id' => 'ito1',      'label' => 'ito 1 局',           'icon' => '🎲', 'type' => 'ito_game', 'threshold' => 1],
    ['id' => 'meet1',     'label' => '待ち合わせ 1 件 応答', 'icon' => '🤝', 'type' => 'meetup_resp', 'threshold' => 1],
    ['id' => 'notice1',   'label' => '重要連絡 1 件 投稿',   'icon' => '📢', 'type' => 'notice_post', 'threshold' => 1],
];

function route_bingo(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';
    if ($sub === 'me' && $method === 'GET') { bingo_me($pdo, $uid); return; }
    if ($sub === 'leaderboard' && $method === 'GET') { bingo_leaderboard($pdo); return; }
    json_error('not_found', "no bingo route", 404);
}

function bingo_week_start_jst(): string {
    // JST の 今日 の 日曜 を返す (今日が日曜なら 今日、 他なら 直近の日曜)
    $d = new DateTime('now', new DateTimeZone('Asia/Tokyo'));
    $dow = (int)$d->format('w'); // 0=Sun
    $d->modify('-' . $dow . ' days');
    return $d->format('Y-m-d');
}

function bingo_generate_cells(int $userSeed, string $weekStart): array {
    // ユーザ + 週 の 安定seed で 25 タスクを 選ぶ
    $seed = crc32($userSeed . '_' . $weekStart);
    mt_srand($seed);
    $pool = BINGO_TASK_POOL;
    shuffle($pool);
    $cells = array_slice($pool, 0, 24);
    // 中央 (idx 12) は フリー
    array_splice($cells, 12, 0, [['id' => 'free', 'label' => 'FREE', 'icon' => '🌟', 'type' => 'free', 'threshold' => 0]]);
    mt_srand();
    return $cells;
}

// 各タスクが 達成済みか 判定
function bingo_judge_cells(PDO $pdo, int $uid, string $weekStart, array $cells): array {
    $completed = [];
    // 週の範囲 (Sun 00:00 JST 〜 Sat 23:59:59 JST)
    $weekEnd = (new DateTime($weekStart, new DateTimeZone('Asia/Tokyo')))->modify('+6 days')->format('Y-m-d') . ' 23:59:59';
    $weekStartTs = $weekStart . ' 00:00:00';
    foreach ($cells as $idx => $c) {
        if ($c['type'] === 'free') { $completed[] = $idx; continue; }
        $n = bingo_count_for($pdo, $uid, $c['type'], $weekStartTs, $weekEnd);
        if ($n >= ($c['threshold'] ?? 1)) $completed[] = $idx;
    }
    return $completed;
}

function bingo_count_for(PDO $pdo, int $uid, string $type, string $from, string $to): int {
    // 平日 (Mon-Fri) 限定 でカウントするタイプ
    $weekdayClause = " AND DAYOFWEEK(created_at) IN (2,3,4,5,6) "; // Sunday=1
    switch ($type) {
        case 'checkin':
            $sql = "SELECT COUNT(*) FROM ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id=?) AND type='checkin' AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'checkin_streak':
            // 連続日数: 該当週内の チェックイン日付の数 (5 = 平日全部)
            $sql = "SELECT COUNT(DISTINCT DATE(created_at)) FROM ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id=?) AND type='checkin' AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'opener':
            // その日の最初の checkin を opener とみなす (簡略化: 該当ユーザが その日の最早 checkin を持っているか)
            $sql = "SELECT COUNT(*) FROM (
                SELECT DATE(created_at) AS d, MIN(created_at) AS minc FROM ledger_entries
                WHERE type='checkin' AND created_at BETWEEN ? AND ? " . str_replace('created_at', 'created_at', $weekdayClause) . "
                GROUP BY DATE(created_at)
            ) day_first
            JOIN ledger_entries le ON le.created_at = day_first.minc AND le.type='checkin'
            JOIN accounts a ON a.id = le.account_id
            WHERE a.owner_user_id=?";
            $st = $pdo->prepare($sql);
            $st->execute([$from, $to, $uid]);
            return (int)$st->fetchColumn();
        case 'sns_post':
            $sql = "SELECT COUNT(*) FROM posts WHERE user_id=? AND parent_id IS NULL AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'sns_reaction':
            $sql = "SELECT COUNT(*) FROM post_reactions WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'purchase':
            $sql = "SELECT COUNT(*) FROM purchases WHERE buyer_user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'sell':
            $sql = "SELECT COUNT(*) FROM purchases p JOIN listings l ON l.id=p.listing_id WHERE l.seller_user_id=? AND p.created_at BETWEEN ? AND ?" . str_replace('created_at', 'p.created_at', $weekdayClause);
            break;
        case 'task_complete':
            $sql = "SELECT COUNT(*) FROM tasks WHERE claimer_user_id=? AND completed_at IS NOT NULL AND completed_at BETWEEN ? AND ?" . str_replace('created_at', 'completed_at', $weekdayClause);
            break;
        case 'mahjong':
            $sql = "SELECT COUNT(*) FROM mahjong_players mp JOIN mahjong_games mg ON mg.id=mp.game_id WHERE mp.user_id=? AND mg.finished_at IS NOT NULL AND mg.finished_at BETWEEN ? AND ?" . str_replace('created_at', 'mg.finished_at', $weekdayClause);
            break;
        case 'othello':
            $sql = "SELECT COUNT(*) FROM othello_games WHERE (creator_user_id=? OR opponent_user_id=?) AND status='finished' AND finished_at BETWEEN ? AND ?" . str_replace('created_at', 'finished_at', $weekdayClause);
            $st = $pdo->prepare($sql);
            $st->execute([$uid, $uid, $from, $to]);
            return (int)$st->fetchColumn();
        case 'place_add':
            $sql = "SELECT COUNT(*) FROM places WHERE created_by_user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'walk':
            // walk_suggestions テーブルが あるなら、 そこから抽出 (なければ 0)
            $sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='walk_sessions'";
            $st = $pdo->prepare($sql);
            $st->execute();
            if (!$st->fetchColumn()) return 0;
            $sql = "SELECT COUNT(*) FROM walk_sessions WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'workout':
            $sql = "SELECT COUNT(*) FROM workouts WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'health':
            $sql = "SELECT COUNT(*) FROM health_records WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'poll_vote':
            $sql = "SELECT COUNT(*) FROM poll_votes WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'rollcall_resp':
            $sql = "SELECT COUNT(*) FROM rollcall_responses WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'todo_done':
            $sql = "SELECT COUNT(*) FROM todos WHERE user_id=? AND done_at IS NOT NULL AND done_at BETWEEN ? AND ?" . str_replace('created_at', 'done_at', $weekdayClause);
            break;
        case 'fortune_good':
            $sql = "SELECT COUNT(*) FROM user_daily_fortunes WHERE user_id=? AND date_jst BETWEEN DATE(?) AND DATE(?) AND fortune_idx IN (0,1,2,3,4,5,6)";
            $st = $pdo->prepare($sql);
            $st->execute([$uid, $from, $to]);
            return (int)$st->fetchColumn();
        case 'tier_answer':
            $sql = "SELECT COUNT(*) FROM tierlist_answers WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'prediction_join':
            $sql = "SELECT COUNT(*) FROM predictions_entries WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'transfer':
            $sql = "SELECT COUNT(*) FROM ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE owner_user_id=?) AND type IN ('transfer','task_reward') AND amount < 0 AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'shiritori':
            $sql = "SELECT COUNT(*) FROM shiritori_players WHERE user_id=? AND game_id IN (SELECT id FROM shiritori_games WHERE created_at BETWEEN ? AND ?" . $weekdayClause . ")";
            break;
        case 'ai_review':
            $sql = "SELECT (
                (SELECT COUNT(*) FROM paper_reviews WHERE user_id=? AND created_at BETWEEN ? AND ?) +
                (SELECT COUNT(*) FROM resume_checks WHERE user_id=? AND created_at BETWEEN ? AND ?)
            )";
            $st = $pdo->prepare($sql);
            $st->execute([$uid, $from, $to, $uid, $from, $to]);
            return (int)$st->fetchColumn();
        case 'jinrou':
            $sql = "SELECT COUNT(*) FROM jinrou_players WHERE user_id=? AND game_id IN (SELECT id FROM jinrou_games WHERE created_at BETWEEN ? AND ?" . $weekdayClause . ")";
            break;
        case 'ito_game':
            $sql = "SELECT COUNT(*) FROM ito_players WHERE user_id=? AND game_id IN (SELECT id FROM ito_games WHERE created_at BETWEEN ? AND ?" . $weekdayClause . ")";
            break;
        case 'meetup_resp':
            $sql = "SELECT COUNT(*) FROM meetup_responses WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        case 'notice_post':
            $sql = "SELECT COUNT(*) FROM notices WHERE user_id=? AND created_at BETWEEN ? AND ?" . $weekdayClause;
            break;
        default:
            return 0;
    }
    try {
        $st = $pdo->prepare($sql);
        $st->execute([$uid, $from, $to]);
        return (int)$st->fetchColumn();
    } catch (Throwable $_) {
        return 0; // テーブルが存在しないとかでも 0 を返す
    }
}

function bingo_count_lines(array $completedIdxs): int {
    $set = array_flip($completedIdxs);
    $lines = 0;
    // 横 5 ライン
    for ($r = 0; $r < 5; $r++) {
        $ok = true;
        for ($c = 0; $c < 5; $c++) if (!isset($set[$r * 5 + $c])) { $ok = false; break; }
        if ($ok) $lines++;
    }
    // 縦 5
    for ($c = 0; $c < 5; $c++) {
        $ok = true;
        for ($r = 0; $r < 5; $r++) if (!isset($set[$r * 5 + $c])) { $ok = false; break; }
        if ($ok) $lines++;
    }
    // 斜め 2
    $ok = true;
    for ($i = 0; $i < 5; $i++) if (!isset($set[$i * 5 + $i])) { $ok = false; break; }
    if ($ok) $lines++;
    $ok = true;
    for ($i = 0; $i < 5; $i++) if (!isset($set[$i * 5 + (4 - $i)])) { $ok = false; break; }
    if ($ok) $lines++;
    return $lines;
}

function bingo_me(PDO $pdo, int $uid): void {
    $weekStart = bingo_week_start_jst();
    // 既存カード or 生成
    $st = $pdo->prepare("SELECT * FROM bingo_cards WHERE user_id=? AND week_start=?");
    $st->execute([$uid, $weekStart]);
    $card = $st->fetch(PDO::FETCH_ASSOC);
    if (!$card) {
        $cells = bingo_generate_cells($uid, $weekStart);
        $pdo->prepare("INSERT INTO bingo_cards (user_id, week_start, cells_json, completed_idxs_json) VALUES (?,?,?,?)")
            ->execute([$uid, $weekStart, json_encode($cells, JSON_UNESCAPED_UNICODE), '[12]']);
        $st->execute([$uid, $weekStart]);
        $card = $st->fetch(PDO::FETCH_ASSOC);
    }
    $cells = json_decode($card['cells_json'], true) ?: [];
    // 再判定
    $completed = bingo_judge_cells($pdo, $uid, $weekStart, $cells);
    $lines = bingo_count_lines($completed);
    $prev = json_decode($card['completed_idxs_json'] ?: '[]', true) ?: [];
    $prevLines = (int)$card['bingo_lines'];
    $firstBingoAt = $card['first_bingo_at'];
    if ($lines >= 1 && $firstBingoAt === null) $firstBingoAt = date('Y-m-d H:i:s');
    if (count($completed) !== count($prev) || $lines !== $prevLines) {
        $pdo->prepare("UPDATE bingo_cards SET completed_idxs_json=?, bingo_lines=?, first_bingo_at=? WHERE id=?")
            ->execute([json_encode($completed), $lines, $firstBingoAt, $card['id']]);
    }
    json_response([
        'week_start' => $weekStart,
        'cells'      => $cells,
        'completed'  => $completed,
        'bingo_lines' => $lines,
        'first_bingo_at' => $firstBingoAt,
        'newly_completed' => array_values(array_diff($completed, $prev)),
        'newly_bingoed'   => $lines > $prevLines,
    ]);
}

function bingo_leaderboard(PDO $pdo): void {
    $weekStart = bingo_week_start_jst();
    // 達成順 トップ 3 (first_bingo_at 早い順)
    $st = $pdo->prepare("SELECT b.user_id, b.first_bingo_at, b.bingo_lines, u.display_name, u.avatar_url
                          FROM bingo_cards b JOIN users u ON u.id=b.user_id
                         WHERE b.week_start=? AND b.first_bingo_at IS NOT NULL
                         ORDER BY b.first_bingo_at ASC LIMIT 3");
    $st->execute([$weekStart]);
    $earliest = $st->fetchAll(PDO::FETCH_ASSOC);
    // ライン数 トップ 3
    $st = $pdo->prepare("SELECT b.user_id, b.bingo_lines, u.display_name, u.avatar_url
                          FROM bingo_cards b JOIN users u ON u.id=b.user_id
                         WHERE b.week_start=? AND b.bingo_lines > 0
                         ORDER BY b.bingo_lines DESC, b.first_bingo_at ASC LIMIT 3");
    $st->execute([$weekStart]);
    $mostLines = $st->fetchAll(PDO::FETCH_ASSOC);
    json_response(['week_start' => $weekStart, 'earliest' => $earliest, 'most_lines' => $mostLines]);
}
