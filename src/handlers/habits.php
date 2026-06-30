<?php
// v870 #452 Habit Tracker。個人ごとに習慣を登録、日毎達成を ✓ で入力。
//   GET    /api/habits                      一覧 (公開 + 自分の private)、各件に今日達成と
//                                           直近 7 日 streak、月達成数を同梱
//   POST   /api/habits                      作成 { title, description?, emoji?, target_per_week?, visibility? }
//   GET    /api/habits/<id>                 詳細 + 直近 60 日のカレンダー、 streak、自分 + 他人の
//                                           月達成数 (公開リストのとき)
//   PATCH  /api/habits/<id>                 編集 (owner)
//   DELETE /api/habits/<id>                 削除 (owner)
//   POST   /api/habits/<id>/checkin         { date?='YYYY-MM-DD' default today, note? } 達成入力
//   DELETE /api/habits/<id>/checkin?date=Y-M-D 取消

declare(strict_types=1);

function route_habits(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    if (!isset($seg[1])) {
        if ($method === 'GET')  { habits_index($pdo, $uid); return; }
        if ($method === 'POST') { habits_create($pdo, $uid); return; }
        json_error('method_not_allowed', "no /habits for $method", 405);
        return;
    }

    $habitId = (int)$seg[1];
    if ($habitId <= 0) { json_error('bad_request', 'invalid habit id', 400); return; }

    $sub = $seg[2] ?? '';
    if ($sub === '') {
        if ($method === 'GET')    { habits_detail($pdo, $uid, $habitId); return; }
        if ($method === 'PATCH')  { habits_update($pdo, $uid, $habitId); return; }
        if ($method === 'DELETE') { habits_delete($pdo, $uid, $habitId); return; }
        json_error('method_not_allowed', "no method", 405);
        return;
    }
    if ($sub === 'checkin') {
        if ($method === 'POST')   { habits_checkin($pdo, $uid, $habitId); return; }
        if ($method === 'DELETE') { habits_checkin_remove($pdo, $uid, $habitId); return; }
        json_error('method_not_allowed', "no method", 405);
        return;
    }
    json_error('not_found', 'no habits route', 404);
}

function habits_index(PDO $pdo, int $uid): void {
    $today = date('Y-m-d');
    $weekStart = date('Y-m-d', strtotime('-6 days'));
    $st = $pdo->prepare(
        "SELECT h.id, h.title, h.description, h.emoji, h.target_per_week, h.visibility, h.owner_id,
                u.display_name AS owner_name, u.avatar_url AS owner_avatar,
                h.created_at, h.updated_at,
                EXISTS (SELECT 1 FROM habit_checkins c WHERE c.habit_id=h.id AND c.user_id=? AND c.date=?) AS done_today,
                (SELECT COUNT(*) FROM habit_checkins c2 WHERE c2.habit_id=h.id AND c2.user_id=? AND c2.date >= ?) AS done_this_week,
                (SELECT COUNT(*) FROM habit_checkins c3 WHERE c3.habit_id=h.id AND c3.user_id=?) AS done_total
           FROM habits h
           LEFT JOIN users u ON u.id=h.owner_id
          WHERE h.visibility='public' OR h.owner_id=?
          ORDER BY h.owner_id=? DESC, h.updated_at DESC"
    );
    $st->execute([$uid, $today, $uid, $weekStart, $uid, $uid, $uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($items as &$it) {
        $it['done_today']     = (bool)$it['done_today'];
        $it['done_this_week'] = (int)$it['done_this_week'];
        $it['done_total']     = (int)$it['done_total'];
        $it['target_per_week'] = (int)$it['target_per_week'];
        $it['is_mine'] = ((int)$it['owner_id'] === $uid);
    }
    unset($it);
    json_response(['items' => $items]);
}

function habits_create(PDO $pdo, int $uid): void {
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 160) { json_error('bad_request', 'title 1-160', 400); return; }
    $desc  = trim((string)($body['description'] ?? ''));
    $emoji = trim((string)($body['emoji'] ?? '✅'));
    if (mb_strlen($emoji) > 10) $emoji = mb_substr($emoji, 0, 4);
    $tpw   = max(1, min(7, (int)($body['target_per_week'] ?? 7)));
    $vis   = in_array($body['visibility'] ?? 'public', ['public', 'private'], true) ? $body['visibility'] : 'public';
    $pdo->prepare("INSERT INTO habits (owner_id, title, description, emoji, target_per_week, visibility) VALUES (?,?,?,?,?,?)")
        ->execute([$uid, $title, $desc ?: null, $emoji ?: null, $tpw, $vis]);
    json_response(['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
}

function habits_detail(PDO $pdo, int $uid, int $habitId): void {
    $st = $pdo->prepare(
        "SELECT h.*, u.display_name AS owner_name, u.avatar_url AS owner_avatar
           FROM habits h LEFT JOIN users u ON u.id=h.owner_id WHERE h.id=?"
    );
    $st->execute([$habitId]);
    $h = $st->fetch(PDO::FETCH_ASSOC);
    if (!$h) { json_error('not_found', 'habit 不在', 404); return; }
    if ($h['visibility'] === 'private' && (int)$h['owner_id'] !== $uid) { json_error('forbidden', '非公開', 403); return; }

    $from = date('Y-m-d', strtotime('-59 days'));
    $today = date('Y-m-d');
    $st = $pdo->prepare(
        "SELECT date, note FROM habit_checkins WHERE habit_id=? AND user_id=? AND date >= ? ORDER BY date ASC"
    );
    $st->execute([$habitId, $uid, $from]);
    $my = $st->fetchAll(PDO::FETCH_ASSOC);

    $myDates = [];
    foreach ($my as $r) $myDates[$r['date']] = $r['note'] ?? '';

    // streak: 今日から過去へ連続達成日数
    $streak = 0;
    for ($i = 0; ; $i++) {
        $d = date('Y-m-d', strtotime("-$i days"));
        if (!isset($myDates[$d])) {
            if ($i === 0) break; // 今日未達成なら連続ゼロ
            break;
        }
        $streak++;
    }

    // 公開リストなら全員の過去 60 日達成数を集計
    $others = [];
    if ($h['visibility'] === 'public') {
        $st = $pdo->prepare(
            "SELECT c.user_id, u.display_name, u.avatar_url, COUNT(*) AS done_count,
                    EXISTS(SELECT 1 FROM habit_checkins c2 WHERE c2.habit_id=? AND c2.user_id=c.user_id AND c2.date=?) AS done_today
               FROM habit_checkins c LEFT JOIN users u ON u.id=c.user_id
              WHERE c.habit_id=? AND c.date >= ?
              GROUP BY c.user_id, u.display_name, u.avatar_url
              ORDER BY done_count DESC LIMIT 50"
        );
        $st->execute([$habitId, $today, $habitId, $from]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $others[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'done_count'   => (int)$r['done_count'],
                'done_today'   => (bool)$r['done_today'],
            ];
        }
    }

    $h['target_per_week'] = (int)$h['target_per_week'];
    $h['is_mine'] = ((int)$h['owner_id'] === $uid);
    $h['my_checkins'] = array_keys($myDates);
    $h['my_streak']   = $streak;
    $h['my_done_60d'] = count($myDates);
    $h['others']      = $others;
    json_response($h);
}

function habits_update(PDO $pdo, int $uid, int $habitId): void {
    $own = (int)$pdo->query("SELECT owner_id FROM habits WHERE id=$habitId")->fetchColumn();
    if ($own !== $uid) { json_error('forbidden', '所有者のみ編集可', 403); return; }
    $body = read_json_body();
    $sets = []; $vals = [];
    if (isset($body['title'])) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 160) { json_error('bad_request', 'title 不正', 400); return; }
        $sets[] = "title=?"; $vals[] = $t;
    }
    if (array_key_exists('description', $body)) {
        $d = trim((string)$body['description']);
        $sets[] = "description=?"; $vals[] = $d === '' ? null : $d;
    }
    if (isset($body['emoji'])) {
        $e = trim((string)$body['emoji']);
        $sets[] = "emoji=?"; $vals[] = $e === '' ? null : mb_substr($e, 0, 4);
    }
    if (isset($body['target_per_week'])) {
        $tpw = max(1, min(7, (int)$body['target_per_week']));
        $sets[] = "target_per_week=?"; $vals[] = $tpw;
    }
    if (isset($body['visibility']) && in_array($body['visibility'], ['public', 'private'], true)) {
        $sets[] = "visibility=?"; $vals[] = $body['visibility'];
    }
    if (!$sets) { json_response(['ok' => true, 'unchanged' => true]); return; }
    $vals[] = $habitId;
    $pdo->prepare("UPDATE habits SET " . implode(',', $sets) . " WHERE id=?")->execute($vals);
    json_response(['ok' => true]);
}

function habits_delete(PDO $pdo, int $uid, int $habitId): void {
    $own = (int)$pdo->query("SELECT owner_id FROM habits WHERE id=$habitId")->fetchColumn();
    if ($own !== $uid) { json_error('forbidden', '所有者のみ削除可', 403); return; }
    $pdo->prepare("DELETE FROM habits WHERE id=?")->execute([$habitId]);
    json_response(['ok' => true]);
}

function habits_checkin(PDO $pdo, int $uid, int $habitId): void {
    // 公開 / 自分の習慣に check 入力 (= 公開なら誰でも自分の達成を入れられる)。
    $vis = $pdo->prepare("SELECT visibility, owner_id FROM habits WHERE id=?");
    $vis->execute([$habitId]);
    $row = $vis->fetch(PDO::FETCH_ASSOC);
    if (!$row) { json_error('not_found', 'habit 不在', 404); return; }
    if ($row['visibility'] !== 'public' && (int)$row['owner_id'] !== $uid) { json_error('forbidden', '非公開', 403); return; }

    $body = read_json_body();
    $date = trim((string)($body['date'] ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { json_error('bad_request', 'date 形式不正', 400); return; }
    $note = trim((string)($body['note'] ?? ''));
    $pdo->prepare("INSERT INTO habit_checkins (habit_id, user_id, date, note) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE note=VALUES(note)")
        ->execute([$habitId, $uid, $date, $note ?: null]);
    json_response(['ok' => true, 'date' => $date]);
}

function habits_checkin_remove(PDO $pdo, int $uid, int $habitId): void {
    $date = trim((string)($_GET['date'] ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { json_error('bad_request', 'date 形式不正', 400); return; }
    $pdo->prepare("DELETE FROM habit_checkins WHERE habit_id=? AND user_id=? AND date=?")
        ->execute([$habitId, $uid, $date]);
    json_response(['ok' => true]);
}
