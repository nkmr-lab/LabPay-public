<?php
// v588 ビンゴ。 日曜 0:00 (JST) 〜 土曜 23:59 (JST) の週次サイクル。
//   GET  /api/bingo/me            今週の自分のカード (なければ生成 + 自動判定)
//   GET  /api/bingo/leaderboard   今週のリーダーボード (達成順 / ライン数)
//   GET  /api/bingo/history?week=YYYY-MM-DD  過去のカード閲覧
declare(strict_types=1);

// タスク定義 (id, label, icon, type, threshold)。 type ごとに判定SQL が違う。
// 平日限定 = 月-金 (JST) のデータだけカウント (オープナーはその日の最初のラボイン)
const BINGO_TASK_POOL = [
    ['id' => 'checkin1',  'label' => 'ラボイン 1 回',       'icon' => '🏠', 'type' => 'checkin', 'threshold' => 1],
    ['id' => 'checkin3',  'label' => 'ラボイン 3 回',       'icon' => '🏠', 'type' => 'checkin', 'threshold' => 3],
    ['id' => 'checkin5',  'label' => 'ラボイン 5 日連続',  'icon' => '🔥', 'type' => 'checkin_streak', 'threshold' => 5],
    ['id' => 'opener1',   'label' => 'オープナー 1 回',     'icon' => '🌅', 'type' => 'opener', 'threshold' => 1],
    // v746 #357 opener2 (2 回) はハードル高すぎで削除。 代わりに sns5 を追加して
    //   らぼったー 5 投稿を優先で入れるように。
    ['id' => 'sns1',      'label' => 'らぼったー 1 投稿',   'icon' => '💬', 'type' => 'sns_post', 'threshold' => 1],
    ['id' => 'sns3',      'label' => 'らぼったー 3 投稿',   'icon' => '💬', 'type' => 'sns_post', 'threshold' => 3],
    ['id' => 'sns5',      'label' => 'らぼったー 5 投稿',   'icon' => '💬', 'type' => 'sns_post', 'threshold' => 5],
    ['id' => 'sns_react', 'label' => 'リアクション 5 個',    'icon' => '❤️', 'type' => 'sns_reaction', 'threshold' => 5],
    ['id' => 'buy1',      'label' => '購入 1 件',           'icon' => '🛒', 'type' => 'purchase', 'threshold' => 1],
    ['id' => 'sell1',     'label' => '販売 1 件',           'icon' => '🏷', 'type' => 'sell', 'threshold' => 1],
    ['id' => 'task1',     'label' => 'タスク完了 1 件',     'icon' => '📋', 'type' => 'task_complete', 'threshold' => 1],
    ['id' => 'mahjong1',  'label' => '麻雀 1 局',           'icon' => '🀄', 'type' => 'mahjong', 'threshold' => 1],
    ['id' => 'othello1',  'label' => '地雷オセロ 1 局',     'icon' => '💣', 'type' => 'othello', 'threshold' => 1],
    ['id' => 'place1',    'label' => '食べある記 1 件投稿', 'icon' => '🍴', 'type' => 'place_add', 'threshold' => 1],
    ['id' => 'walk1',     'label' => '散歩 1 回',           'icon' => '🚶', 'type' => 'walk', 'threshold' => 1],
    ['id' => 'workout1',  'label' => '筋トレ 1 回',         'icon' => '💪', 'type' => 'workout', 'threshold' => 1],
    ['id' => 'health1',   'label' => '体重記録 1 回',      'icon' => '⚖️', 'type' => 'health', 'threshold' => 1],
    ['id' => 'poll1',     'label' => '投票 1 回回答',       'icon' => '📊', 'type' => 'poll_vote', 'threshold' => 1],
    ['id' => 'roll1',     'label' => '点呼 1 回応答',       'icon' => '📣', 'type' => 'rollcall_resp', 'threshold' => 1],
    ['id' => 'fortune',   'label' => '占い大吉 or 中吉',   'icon' => '🔮', 'type' => 'fortune_good', 'threshold' => 1],
    ['id' => 'tier1',     'label' => 'ティア表 1 件回答',   'icon' => '🎯', 'type' => 'tier_answer', 'threshold' => 1],
    ['id' => 'pred1',     'label' => '優勝予想 1 件参加',   'icon' => '🏆', 'type' => 'prediction_join', 'threshold' => 1],
    ['id' => 'send1',     'label' => '送金 1 回',           'icon' => '💸', 'type' => 'transfer', 'threshold' => 1],
    ['id' => 'shiri1',    'label' => '絵しりとり 1 局',      'icon' => '🎨', 'type' => 'shiritori', 'threshold' => 1],
    ['id' => 'paper1',    'label' => '論文査読 or 原稿チェック 1 件', 'icon' => '📄', 'type' => 'ai_review', 'threshold' => 1],
    ['id' => 'jinrou1',   'label' => '人狼 1 局',           'icon' => '🐺', 'type' => 'jinrou', 'threshold' => 1],
    ['id' => 'ito1',      'label' => 'ito 1 局',           'icon' => '🎲', 'type' => 'ito_game', 'threshold' => 1],
    ['id' => 'meet1',     'label' => '待ち合わせ 1 件応答', 'icon' => '🤝', 'type' => 'meetup_resp', 'threshold' => 1],
];

function route_bingo(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';
    if ($sub === 'me' && $method === 'GET') { bingo_me($pdo, $uid); return; }
    if ($sub === 'leaderboard' && $method === 'GET') { bingo_leaderboard($pdo); return; }
    // v593 過去週閲覧
    if ($sub === 'history' && $method === 'GET') { bingo_history($pdo, $uid); return; }
    if ($sub === 'week' && isset($seg[2]) && $method === 'GET') { bingo_week($pdo, $uid, (string)$seg[2]); return; }
    json_error('not_found', "no bingo route", 404);
}

// v593 過去 12 週の自分のカードメタ (week_start, 達成率, ライン数)
function bingo_history(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT week_start, cells_json, completed_idxs_json, bingo_lines, first_bingo_at
                           FROM bingo_cards WHERE user_id=? ORDER BY week_start DESC LIMIT 12");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) {
        $completed = json_decode($r['completed_idxs_json'] ?: '[]', true) ?: [];
        $out[] = [
            'week_start' => $r['week_start'],
            'completed_count' => count($completed),
            'bingo_lines' => (int)$r['bingo_lines'],
            'first_bingo_at' => $r['first_bingo_at'],
        ];
    }
    json_response(['items' => $out]);
}

// v593 指定週のカード + 完了状況 (= 過去カード再読み込み、 再判定はしない、 保存値を返す)
function bingo_week(PDO $pdo, int $uid, string $weekStart): void {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $weekStart)) throw new ApiException('bad_request', 'YYYY-MM-DD', 400);
    $st = $pdo->prepare("SELECT * FROM bingo_cards WHERE user_id=? AND week_start=?");
    $st->execute([$uid, $weekStart]);
    $card = $st->fetch(PDO::FETCH_ASSOC);
    if (!$card) throw new ApiException('not_found', '該当週のカードがありません', 404);
    $cells = json_decode($card['cells_json'], true) ?: [];
    $completed = json_decode($card['completed_idxs_json'] ?: '[]', true) ?: [];
    json_response([
        'week_start' => $card['week_start'],
        'cells' => $cells,
        'completed' => $completed,
        'bingo_lines' => (int)$card['bingo_lines'],
        'first_bingo_at' => $card['first_bingo_at'],
        'newly_completed' => [],
        'newly_bingoed' => false,
    ]);
}

function bingo_week_start_jst(): string {
    // JST の今日の日曜を返す (今日が日曜なら今日、 他なら直近の日曜)
    $d = new DateTime('now', new DateTimeZone('Asia/Tokyo'));
    $dow = (int)$d->format('w'); // 0=Sun
    $d->modify('-' . $dow . ' days');
    return $d->format('Y-m-d');
}

function bingo_generate_cells(int $userSeed, string $weekStart): array {
    // v597 FREE 廃止。 25 マスすべて通常タスク。 中央をどう開けるかも戦略の一部。
    $seed = crc32($userSeed . '_' . $weekStart);
    mt_srand($seed);
    $pool = BINGO_TASK_POOL;
    shuffle($pool);
    $cells = array_slice($pool, 0, 25);
    mt_srand();
    return $cells;
}

// 各タスクが達成済みか判定
function bingo_judge_cells(PDO $pdo, int $uid, string $weekStart, array $cells): array {
    $completed = [];
    // 週の範囲 (Sun 00:00 JST 〜 Sat 23:59:59 JST)
    $weekEnd = (new DateTime($weekStart, new DateTimeZone('Asia/Tokyo')))->modify('+6 days')->format('Y-m-d') . ' 23:59:59';
    $weekStartTs = $weekStart . ' 00:00:00';
    foreach ($cells as $idx => $c) {
        // v597 free 廃止。 既存カードの中央 (free) はそのまま完了扱いで残す
        if (($c['type'] ?? '') === 'free') { $completed[] = $idx; continue; }
        $n = bingo_count_for($pdo, $uid, $c['type'], $weekStartTs, $weekEnd);
        if ($n >= ($c['threshold'] ?? 1)) $completed[] = $idx;
    }
    return $completed;
}

function bingo_count_for(PDO $pdo, int $uid, string $type, string $from, string $to): int {
    // v616 #239 平日(Mon-Fri)限定の制約を撤廃。 土日に登録した行動もカウントされる。
    //   元々 「平日限定」 は出席頻度を想定した仕様だったが、 食べある記やSNS投稿などは
    //   土日にこそ発生しやすく 「登録したのにビンゴに反映されない」 という混乱が起きていた。
    //   weekdayClause を空文字にして、 期間 (Sun 0:00 〜 Sat 23:59 JST) 内のすべての行動をカウント。
    $weekdayClause = "";
    try {
    switch ($type) {
        // v618 #ビンゴ反映なし bug: テーブル名・カラム名が全部間違っていた。
        //   ledger_entries → ledger / created_by_user_id → creator_user_id /
        //   post_reactions → post_likes / rollcall_responses → roll_call_targets /
        //   todos → user_todos / workouts.created_at → recorded_at / health.created_at → recorded_at /
        //   meetup_responses → meetup_participants (timestamp なし → meetup created_at で代用)。
        //   全部 try/catch で包まれて 0 を返していたので 「クエリは通るが何も入らない」 状態だった。
        case 'checkin':
            $sql = "SELECT COUNT(*) FROM checkins WHERE user_id=? AND checkin_date BETWEEN DATE(?) AND DATE(?)";
            break;
        case 'checkin_streak':
            $sql = "SELECT COUNT(DISTINCT checkin_date) FROM checkins WHERE user_id=? AND checkin_date BETWEEN DATE(?) AND DATE(?)";
            break;
        case 'opener':
            // その日の最初の checkin を opener (該当週内、 自分がオープナーだった日数)
            $sql = "SELECT COUNT(*) FROM (
                SELECT checkin_date AS d, MIN(created_at) AS minc FROM checkins
                WHERE checkin_date BETWEEN DATE(?) AND DATE(?)
                GROUP BY checkin_date
            ) day_first
            JOIN checkins c ON c.checkin_date = day_first.d AND c.created_at = day_first.minc
            WHERE c.user_id=?";
            $st = $pdo->prepare($sql);
            $st->execute([$from, $to, $uid]);
            return (int)$st->fetchColumn();
        case 'sns_post':
            $sql = "SELECT COUNT(*) FROM posts WHERE user_id=? AND parent_id IS NULL AND created_at BETWEEN ? AND ?";
            break;
        case 'sns_reaction':
            $sql = "SELECT COUNT(*) FROM post_likes WHERE user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'purchase':
            $sql = "SELECT COUNT(*) FROM purchases WHERE buyer_user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'sell':
            $sql = "SELECT COUNT(*) FROM purchases p JOIN listings l ON l.id=p.listing_id WHERE l.seller_user_id=? AND p.created_at BETWEEN ? AND ?";
            break;
        case 'task_complete':
            $sql = "SELECT COUNT(*) FROM task_claims WHERE user_id=? AND status='approved' AND approved_at IS NOT NULL AND approved_at BETWEEN ? AND ?";
            break;
        case 'mahjong':
            $sql = "SELECT COUNT(*) FROM mahjong_players mp JOIN mahjong_games mg ON mg.id=mp.game_id WHERE mp.user_id=? AND mg.finished_at IS NOT NULL AND mg.finished_at BETWEEN ? AND ?";
            break;
        case 'othello':
            $sql = "SELECT COUNT(*) FROM othello_games WHERE (creator_user_id=? OR opponent_user_id=?) AND status='finished' AND finished_at BETWEEN ? AND ?";
            $st = $pdo->prepare($sql);
            $st->execute([$uid, $uid, $from, $to]);
            return (int)$st->fetchColumn();
        case 'place_add':
            $sql = "SELECT COUNT(*) FROM places WHERE creator_user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'walk':
            $sql = "SELECT COUNT(*) FROM walk_sessions WHERE user_id=? AND started_at BETWEEN ? AND ?";
            break;
        case 'workout':
            $sql = "SELECT COUNT(*) FROM workouts WHERE user_id=? AND recorded_at BETWEEN ? AND ?";
            break;
        case 'health':
            $sql = "SELECT COUNT(*) FROM health_records WHERE user_id=? AND recorded_at BETWEEN ? AND ?";
            break;
        case 'poll_vote':
            $sql = "SELECT COUNT(*) FROM poll_votes WHERE user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'rollcall_resp':
            $sql = "SELECT COUNT(*) FROM roll_call_targets WHERE user_id=? AND responded_at IS NOT NULL AND responded_at BETWEEN ? AND ?";
            break;
        case 'todo_done':
            $sql = "SELECT COUNT(*) FROM user_todos WHERE user_id=? AND done_at IS NOT NULL AND done_at BETWEEN ? AND ?";
            break;
        case 'fortune_good':
            $sql = "SELECT COUNT(*) FROM user_daily_fortunes WHERE user_id=? AND date_jst BETWEEN DATE(?) AND DATE(?) AND fortune_idx IN (0,1,2,3,4,5,6)";
            $st = $pdo->prepare($sql);
            $st->execute([$uid, $from, $to]);
            return (int)$st->fetchColumn();
        case 'tier_answer':
            $sql = "SELECT COUNT(*) FROM tierlist_answers WHERE user_id=? AND updated_at BETWEEN ? AND ?";
            break;
        case 'prediction_join':
            $sql = "SELECT COUNT(*) FROM predictions_entries WHERE user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'transfer':
            // 自分の口座から出ていく取引 (送金 / タスク報酬での支払など)
            $sql = "SELECT COUNT(*) FROM ledger WHERE from_account_id IN (SELECT id FROM accounts WHERE owner_user_id=?) AND type IN ('transfer','task_reward') AND created_at BETWEEN ? AND ?";
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
            $sql = "SELECT COUNT(*) FROM jinrou_players WHERE user_id=? AND game_id IN (SELECT id FROM jinrou_games WHERE created_at BETWEEN ? AND ?)";
            break;
        case 'ito_game':
            $sql = "SELECT COUNT(*) FROM ito_players WHERE user_id=? AND game_id IN (SELECT id FROM ito_games WHERE created_at BETWEEN ? AND ?)";
            break;
        case 'meetup_resp':
            // v619 #待ち合わせ false-positive bug fix。 meetup_participants はただの招待リスト
            // (応答状況を持たない) なので、 そこに居る = 「応答した」 にならない。
            // meetup_messages (待ち合わせ内チャット) を 「実際に engagement した」 シグナルとして使う。
            $sql = "SELECT COUNT(*) FROM meetup_messages WHERE user_id=? AND created_at BETWEEN ? AND ?";
            break;
        case 'notice_post':
            $sql = "SELECT COUNT(*) FROM notices WHERE user_id=? AND created_at BETWEEN ? AND ?";
            break;
        default:
            return 0;
    }
        $st = $pdo->prepare($sql);
        $st->execute([$uid, $from, $to]);
        return (int)$st->fetchColumn();
    } catch (Throwable $e) {
        error_log("[bingo_count_for] type=$type error=" . $e->getMessage());
        return 0;
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
            ->execute([$uid, $weekStart, json_encode($cells, JSON_UNESCAPED_UNICODE), '[]']);
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
    // 達成順トップ 3 (first_bingo_at 早い順)
    $st = $pdo->prepare("SELECT b.user_id, b.first_bingo_at, b.bingo_lines, u.display_name, u.avatar_url
                          FROM bingo_cards b JOIN users u ON u.id=b.user_id
                         WHERE b.week_start=? AND b.first_bingo_at IS NOT NULL
                         ORDER BY b.first_bingo_at ASC LIMIT 3");
    $st->execute([$weekStart]);
    $earliest = $st->fetchAll(PDO::FETCH_ASSOC);
    // ライン数トップ 3
    $st = $pdo->prepare("SELECT b.user_id, b.bingo_lines, u.display_name, u.avatar_url
                          FROM bingo_cards b JOIN users u ON u.id=b.user_id
                         WHERE b.week_start=? AND b.bingo_lines > 0
                         ORDER BY b.bingo_lines DESC, b.first_bingo_at ASC LIMIT 3");
    $st->execute([$weekStart]);
    $mostLines = $st->fetchAll(PDO::FETCH_ASSOC);
    json_response(['week_start' => $weekStart, 'earliest' => $earliest, 'most_lines' => $mostLines]);
}
