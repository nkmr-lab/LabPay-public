<?php
// /api/rankings — 全メンバー横断 の 各種 ランキング。
//   ホーム "🏆 Ranking" ページ (#/rankings) が 1 shot で 全カード分 の top N を 取る。
//   意味論 は Achievements.php の tallyForUser と 揃える (泊まり除外 の 判定 等)。
//   誰でも 閲覧可 (要ログイン)、 admin 限定 は なし。

declare(strict_types=1);

const RANK_TOP_N = 10;

// presence_sessions と 進行中 presence_seen を UNION した 「全ての 在室 window」の 元。
// 単体 SQL で 何度も 参照 する ので CTE 化 して 各所 で 使う。
// user_id は presence_devices 経由 の 逆引き (session/seen とも)。
function rank_all_sessions_cte(): string {
    return "WITH all_sessions AS (
        SELECT user_id, started_at AS s, ended_at AS e
          FROM presence_sessions WHERE user_id IS NOT NULL
        UNION ALL
        SELECT pd.user_id, ps.session_start_at AS s, ps.last_seen_at AS e
          FROM presence_seen ps JOIN presence_devices pd ON pd.mac = ps.mac
         WHERE ps.session_start_at IS NOT NULL
    )";
}

function route_rankings(PDO $pdo, array $cfg, string $method, array $seg): void {
    Auth::requireUser($pdo, $cfg);
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET') { rankings_all($pdo); return; }
    json_error('not_found', "no rankings route for $method $sub", 404);
}

function rankings_all(PDO $pdo): void {
    json_response([
        'rankings' => [
            'streak'                 => rank_streak_longest($pdo, RANK_TOP_N),
            'checkins'               => rank_checkins_total($pdo, RANK_TOP_N),
            'opener'                 => rank_opener($pdo, RANK_TOP_N),
            'closer'                 => rank_closer($pdo, RANK_TOP_N),
            'early_bird'             => rank_time_window_morning($pdo, RANK_TOP_N),
            'night_use'              => rank_night_use($pdo, RANK_TOP_N),
            'all_nighter'            => rank_all_nighter($pdo, RANK_TOP_N),
            // v1301 販売/購入/リアクション (Achievements.tallyForUser 同型)
            'sns_reactions_received' => rank_sns_reactions_received($pdo, RANK_TOP_N),
            'sns_reactions_given'    => rank_sns_reactions_given($pdo, RANK_TOP_N),
            'sales_count'            => rank_purchases_agg($pdo, 'seller_user_id', 'qty',              RANK_TOP_N),
            'sales_amount'           => rank_purchases_agg($pdo, 'seller_user_id', 'unit_price * qty', RANK_TOP_N),
            'purchases_count'        => rank_purchases_agg($pdo, 'buyer_user_id',  'qty',              RANK_TOP_N),
            'purchases_amount'       => rank_purchases_agg($pdo, 'buyer_user_id',  'unit_price * qty', RANK_TOP_N),
        ],
    ]);
}

// user_id / display_name / avatar_url / count を 埋める 共通ヘルパ (users JOIN)。
// user 情報 は id をキー に O(1) 参照 に。
function rank_attach_users(PDO $pdo, array $rows): array {
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int)$r['user_id'], $rows);
    $place = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
    $st->execute($ids);
    $byId = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $u) $byId[(int)$u['id']] = $u;
    $out = [];
    foreach ($rows as $r) {
        $u = $byId[(int)$r['user_id']] ?? null;
        if (!$u) continue; // 削除ユーザ は 除外
        $out[] = [
            'user_id'      => (int)$r['user_id'],
            'display_name' => (string)$u['display_name'],
            'avatar_url'   => $u['avatar_url'],
            'count'        => (int)$r['count'],
        ];
    }
    return $out;
}

// 1) 最長連続ラボイン。 streaks.longest_streak 降順 の top N。
function rank_streak_longest(PDO $pdo, int $n): array {
    $st = $pdo->prepare("SELECT s.user_id, s.longest_streak AS count
                            FROM streaks s WHERE s.longest_streak > 0
                           ORDER BY s.longest_streak DESC, s.user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 2) 累計 ラボイン (checkins) 日数 top N。
function rank_checkins_total(PDO $pdo, int $n): array {
    $st = $pdo->prepare("SELECT user_id, COUNT(*) AS count
                            FROM checkins GROUP BY user_id
                           ORDER BY count DESC, user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 3) オープナー: その日 最初 に ラボ に 入った 日数 (前夜 泊まり 除外)。
//    Achievements.tallyForUser の opener と 同じ 意味論 を 全 user 分 GROUP BY で 集計。
function rank_opener(PDO $pdo, int $n): array {
    $cte = rank_all_sessions_cte();
    $sql = "$cte
        SELECT me.user_id, COUNT(DISTINCT days.d) AS count
          FROM (SELECT DATE(s) AS d, MIN(s) AS m FROM all_sessions GROUP BY DATE(s)) days
          JOIN all_sessions me ON DATE(me.s) = days.d AND me.s = days.m
         WHERE NOT EXISTS (
                 SELECT 1 FROM all_sessions own
                  WHERE own.user_id = me.user_id AND own.s < days.d AND own.e > days.d)
         GROUP BY me.user_id
         ORDER BY count DESC, me.user_id ASC LIMIT ?";
    $st = $pdo->prepare($sql);
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 4) クローザー: その日 最後 に ラボ を 出た 日数 (その夜 泊まり 除外)。
function rank_closer(PDO $pdo, int $n): array {
    $cte = rank_all_sessions_cte();
    $sql = "$cte
        SELECT me.user_id, COUNT(DISTINCT days.d) AS count
          FROM (SELECT DATE(e) AS d, MAX(e) AS m FROM all_sessions GROUP BY DATE(e)) days
          JOIN all_sessions me ON DATE(me.e) = days.d AND me.e = days.m
         WHERE NOT EXISTS (
                 SELECT 1 FROM all_sessions own
                  WHERE own.user_id = me.user_id
                    AND own.s < DATE_ADD(days.d, INTERVAL 1 DAY)
                    AND own.e > DATE_ADD(days.d, INTERVAL 1 DAY))
         GROUP BY me.user_id
         ORDER BY count DESC, me.user_id ASC LIMIT ?";
    $st = $pdo->prepare($sql);
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 5) 早起き: D 07:00〜08:30 に 在室 AND D 02:00〜05:00 に 在室なし (= 泊まりじゃなく朝来た)。
//    Achievements.tallyForUser の early_bird と 同じ SQL 構造 を 全 user 分 に 展開。
//    分単位 定数 は そちら と 同じ: 07:00=420, 08:30=510, 02:00=120, 05:00=300。
function rank_time_window_morning(PDO $pdo, int $n): array {
    $st = $pdo->prepare("
        SELECT ps.user_id, COUNT(DISTINCT DATE(ps.started_at)) AS count
          FROM presence_sessions ps
         WHERE ps.user_id IS NOT NULL
           AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 510 MINUTE)
           AND ps.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 420 MINUTE)
           AND NOT EXISTS (
                 SELECT 1 FROM presence_sessions ps2
                  WHERE ps2.user_id = ps.user_id
                    AND DATE(ps2.started_at) = DATE(ps.started_at)
                    AND ps2.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 300 MINUTE)
                    AND ps2.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 120 MINUTE))
         GROUP BY ps.user_id
         ORDER BY count DESC, ps.user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 6) 夜間ラボ族: 夜 N (D の 23:00 〜 D+1 の 01:00) に session overlap した 夜 の 数。
//    Achievements.tallyForUser の night_use を 全 user 分 に。
//    分単位 定数: 23:00=1380, 25:00=1500。
function rank_night_use(PDO $pdo, int $n): array {
    $st = $pdo->prepare("
        SELECT user_id, COUNT(DISTINCT d) AS count FROM (
          SELECT ps.user_id, DATE(ps.started_at) AS d FROM presence_sessions ps
           WHERE ps.user_id IS NOT NULL
             AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 1500 MINUTE)
             AND ps.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 1380 MINUTE)
          UNION
          SELECT ps.user_id, DATE_SUB(DATE(ps.started_at), INTERVAL 1 DAY) AS d
            FROM presence_sessions ps
           WHERE ps.user_id IS NOT NULL
             AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 60 MINUTE)
             AND ps.ended_at   > DATE(ps.started_at)
        ) AS x
        GROUP BY user_id
        ORDER BY count DESC, user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// 7) 徹夜: session が 0:00 を またぐ 日数 (= 泊まり = 中村さん の 「徹夜」定義)。
//    presence_sessions の 一夜 単位 の 集計 で、 session.started_at.date != session.ended_at.date
//    or 「D 00:00 を またぐ」 で 抽出。
function rank_all_nighter(PDO $pdo, int $n): array {
    // 「D の 24:00 = D+1 の 00:00 を またぐ」 = session が 別 日 を またぐ、 の 日数 (跨がれた 日 は D)。
    $st = $pdo->prepare("
        SELECT user_id, COUNT(DISTINCT DATE(started_at)) AS count
          FROM presence_sessions
         WHERE user_id IS NOT NULL AND DATE(started_at) <> DATE(ended_at)
         GROUP BY user_id
         ORDER BY count DESC, user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// v1301 8) 受信リアクション数: 自分 の 投稿 に 付いた post_likes 数 (自分 は 除外)。
//    Achievements.tallyForUser sns_reactions_received と 同 SQL 構造。
function rank_sns_reactions_received(PDO $pdo, int $n): array {
    $st = $pdo->prepare("
        SELECT p.user_id, COUNT(*) AS count
          FROM post_likes l
          JOIN posts p ON p.id = l.post_id
         WHERE l.user_id <> p.user_id
         GROUP BY p.user_id
         ORDER BY count DESC, p.user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// v1302 8b) 送信リアクション数: 自分 が 他人 の 投稿 に 付けた post_likes 数 (自 post は 除外)。
function rank_sns_reactions_given(PDO $pdo, int $n): array {
    $st = $pdo->prepare("
        SELECT l.user_id, COUNT(*) AS count
          FROM post_likes l
          JOIN posts p ON p.id = l.post_id
         WHERE l.user_id <> p.user_id
         GROUP BY l.user_id
         ORDER BY count DESC, l.user_id ASC LIMIT ?");
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}

// v1301 9-12) 販売/購入 の 数量/金額 集計。 purchases テーブル を role × metric で 4 通り 集計。
//    $role: 'seller_user_id' or 'buyer_user_id'
//    $expr: 'qty' (数量) or 'unit_price * qty' (金額)
//    Achievements.tallyForUser sales_count / purchases_count / turnover_earned / turnover_spent と 同型。
function rank_purchases_agg(PDO $pdo, string $role, string $expr, int $n): array {
    if (!in_array($role, ['seller_user_id', 'buyer_user_id'], true)) {
        throw new ApiException('server_error', 'bad role', 500);
    }
    if (!in_array($expr, ['qty', 'unit_price * qty'], true)) {
        throw new ApiException('server_error', 'bad expr', 500);
    }
    $sql = "SELECT $role AS user_id, COALESCE(SUM($expr), 0) AS count
              FROM purchases
             WHERE $role IS NOT NULL
             GROUP BY $role
             HAVING count > 0
             ORDER BY count DESC, user_id ASC
             LIMIT ?";
    $st = $pdo->prepare($sql);
    $st->bindValue(1, $n, PDO::PARAM_INT);
    $st->execute();
    return rank_attach_users($pdo, $st->fetchAll(PDO::FETCH_ASSOC));
}
