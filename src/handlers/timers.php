<?php
// /api/timers — 共有タイマー。 参加者全員で 同じカウントダウンを見る。
// サーバが started_at / ends_at の真実を持つ。 detail は server_now を返し、
// client が ローカル時計とのオフセットを取って カウントダウン表示する。

declare(strict_types=1);

function route_timers(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { timers_list($pdo, $cfg);  return; }
    if ($sub === '' && $method === 'POST') { timers_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { timers_detail($pdo, $cfg, $id); return; }
        if ($next === ''       && $method === 'DELETE') { timers_delete($pdo, $cfg, $id); return; }
        if ($next === 'cancel' && $method === 'PATCH')  { timers_cancel($pdo, $cfg, $id); return; }
        // v446 paused-default model: ▶ 開始 / ⏸ 一時停止 / ↻ リセット を 追加。
        // 参加者 (含 起案者) なら 押せる。 共有 タイマー だから 全員が 操作可。
        if ($next === 'start'  && $method === 'PATCH')  { timers_start($pdo, $cfg, $id); return; }
        if ($next === 'pause'  && $method === 'PATCH')  { timers_pause($pdo, $cfg, $id); return; }
        if ($next === 'reset'  && $method === 'PATCH')  { timers_reset($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no timers route for $method $sub", 404);
}

// v446 参加者 (含 起案者) 判定 ヘルパ。 start/pause/reset は 全員 押せる。
function timers_assert_member(PDO $pdo, array $u, int $id, array $row): void {
    if ((int)$row['creator_user_id'] === (int)$u['id']) return;
    $st = $pdo->prepare("SELECT 1 FROM timer_participants WHERE timer_id=? AND user_id=?");
    $st->execute([$id, (int)$u['id']]);
    if (!$st->fetchColumn()) {
        throw new ApiException('forbidden', '参加者または起案者のみ操作可', 403);
    }
}

function timers_autoclose(PDO $pdo): void {
    // 1) 終了時刻 過ぎ かつ repeat 残あり → 次サイクルへスライド (started/ends + dur)
    $pdo->exec("UPDATE timers
                   SET started_at = ends_at,
                       ends_at    = DATE_ADD(ends_at, INTERVAL duration_seconds SECOND),
                       repeat_idx = repeat_idx + 1
                 WHERE status='running' AND ends_at <= NOW()
                   AND repeat_max > 0 AND repeat_idx < repeat_max");
    // 2) 終了時刻 過ぎ かつ repeat 切れ / 無 → 完了に。
    $pdo->exec("UPDATE timers SET status='done', closed_at=NOW()
                 WHERE status='running' AND ends_at <= NOW()");
}

function timers_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    timers_autoclose($pdo);
    $uid = (int)$u['id'];
    // v446 remaining_seconds (paused 用) を 含めて 返す。 並び順は
    // running → paused → done → cancelled で、 同 status 内は created_at 新しい順。
    $st = $pdo->prepare("
        SELECT t.id, t.title, t.duration_seconds, t.remaining_seconds,
               t.started_at, t.ends_at, t.status,
               t.creator_user_id, u.display_name AS creator_name,
               EXISTS(SELECT 1 FROM timer_participants tp WHERE tp.timer_id=t.id AND tp.user_id=?) AS is_participant
          FROM timers t
          JOIN users u ON u.id = t.creator_user_id
         WHERE t.creator_user_id = ?
            OR EXISTS(SELECT 1 FROM timer_participants tp2 WHERE tp2.timer_id=t.id AND tp2.user_id=?)
         ORDER BY FIELD(t.status,'running','paused','done','cancelled'),
                  t.created_at DESC, t.id DESC
         LIMIT 100");
    $st->execute([$uid, $uid, $uid]);
    $items = $st->fetchAll(PDO::FETCH_ASSOC);
    json_response([
        'items' => $items,
        'server_now' => date('Y-m-d H:i:s'),
    ]);
}

function timers_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 1..200', 400);
    }
    // v449 ベル (1/2/3) — 各 1..86400 秒、 順不同。 端数 NULL OK。
    $bells = [];
    foreach (['bell1','bell2','bell3'] as $k) {
        $v = $body[$k . '_seconds'] ?? null;
        if ($v === null || $v === '') { $bells[] = null; continue; }
        $iv = (int)$v;
        if ($iv < 1 || $iv > 86400) {
            throw new ApiException('bad_request', "{$k}_seconds 1..86400", 400);
        }
        $bells[] = $iv;
    }
    // v449 end_bell_index = 1/2/3 で 「発表終了 タイミング」 を 指定。
    // 採用 されると duration_seconds は その ベル 値 になり、 他の ベル は
    // 前 (= 中間警告) でも 後 (= 質疑時間 通知) でも OK。
    // 旧 client (end_bell_index 無し) は duration_seconds を 自分で 送る legacy 経路。
    $endBellIdx = null;
    if (isset($body['end_bell_index']) && $body['end_bell_index'] !== '' && $body['end_bell_index'] !== null) {
        $endBellIdx = (int)$body['end_bell_index'];
        if (!in_array($endBellIdx, [1, 2, 3], true)) {
            throw new ApiException('bad_request', 'end_bell_index は 1/2/3', 400);
        }
        $endVal = $bells[$endBellIdx - 1];
        if ($endVal === null || $endVal < 5) {
            throw new ApiException('bad_request', "{$endBellIdx}鈴 を 5 秒 以上 で 設定して ください (発表終了 として 選択中)", 400);
        }
        $dur = $endVal;
    } else {
        $dur = (int)($body['duration_seconds'] ?? 0);
        if ($dur < 5 || $dur > 86400) {
            throw new ApiException('bad_request', 'duration_seconds 5..86400', 400);
        }
        // legacy: ベル は duration 未満 のみ
        foreach (['bell1','bell2','bell3'] as $idx => $k) {
            $iv = $bells[$idx];
            if ($iv !== null && $iv >= $dur) {
                throw new ApiException('bad_request', "{$k}_seconds は duration 未満 (end_bell_index で 終了ベル を 選ぶと 制限なし)", 400);
            }
        }
    }
    $repeatMax = max(0, min(100, (int)($body['repeat_max'] ?? 0)));
    $participantIds = $body['participant_ids'] ?? [];
    if (!is_array($participantIds)) {
        throw new ApiException('bad_request', 'participant_ids 配列', 400);
    }
    $participantIds = array_values(array_unique(array_filter(array_map('intval', $participantIds))));
    // 起案者も自動で参加者に。
    if (!in_array((int)$u['id'], $participantIds, true)) $participantIds[] = (int)$u['id'];
    if (count($participantIds) > 200) {
        throw new ApiException('bad_request', '参加者数 200 まで', 400);
    }
    $in = implode(',', array_fill(0, count($participantIds), '?'));
    $stU = $pdo->prepare("SELECT COUNT(*) FROM users WHERE id IN ($in)");
    $stU->execute($participantIds);
    if ((int)$stU->fetchColumn() !== count($participantIds)) {
        throw new ApiException('bad_request', '存在しない user_id が含まれます', 400);
    }
    // v446 paused-default model: 作成時は paused から 始まる。 started_at / ends_at
    // は NULL、 remaining_seconds = duration_seconds。 ▶ 開始 で running に。
    $tid = 0;
    db_tx($pdo, function () use ($pdo, $u, $title, $dur, $participantIds, $bells, $endBellIdx, $repeatMax, &$tid) {
        $ins = $pdo->prepare("INSERT INTO timers
            (title, creator_user_id, duration_seconds, remaining_seconds,
             bell1_seconds, bell2_seconds, bell3_seconds, end_bell_index,
             repeat_max, repeat_idx,
             started_at, ends_at, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 'paused', NOW())");
        $ins->execute([$title, (int)$u['id'], $dur, $dur,
            $bells[0], $bells[1], $bells[2], $endBellIdx, $repeatMax]);
        $tid = (int)$pdo->lastInsertId();
        $stP = $pdo->prepare("INSERT INTO timer_participants (timer_id, user_id) VALUES (?, ?)");
        foreach ($participantIds as $uid) $stP->execute([$tid, $uid]);
    });
    // 通知 (自分以外の参加者へ)。 paused で 作成 した と 伝わる ように 文言調整。
    foreach ($participantIds as $uid) {
        if ((int)$uid === (int)$u['id']) continue;
        try {
            Notifier::notify($pdo, $cfg, (int)$uid, 'timer',
                "⏱️ タイマー作成: 「{$title}」 (" . timer_fmt_short($dur) . ") — ▶ 開始 待ち",
                'timer', $tid);
        } catch (Throwable $_) { /* swallow */ }
    }
    json_response(['id' => $tid]);
}

// v446 ▶ 開始 — paused → running。 remaining_seconds から ends_at を 計算。
function timers_start(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status, duration_seconds, remaining_seconds FROM timers WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    timers_assert_member($pdo, $u, $id, $row);
    if ((string)$row['status'] === 'running') { json_response(['ok' => true, 'already' => 'running']); return; }
    if ((string)$row['status'] !== 'paused') {
        throw new ApiException('bad_state', "status={$row['status']} からは開始できません (リセット 後に 開始)", 400);
    }
    $remain = (int)($row['remaining_seconds'] ?? 0);
    if ($remain <= 0) $remain = (int)$row['duration_seconds'];
    $started = date('Y-m-d H:i:s');
    $ends    = date('Y-m-d H:i:s', time() + $remain);
    $pdo->prepare("UPDATE timers
                      SET status='running', started_at=?, ends_at=?, remaining_seconds=NULL
                    WHERE id=?")->execute([$started, $ends, $id]);
    json_response(['ok' => true]);
}

// v446 ⏸ 一時停止 — running → paused。 残り秒数 を 保存。
function timers_pause(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status, ends_at FROM timers WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    timers_assert_member($pdo, $u, $id, $row);
    if ((string)$row['status'] === 'paused') { json_response(['ok' => true, 'already' => 'paused']); return; }
    if ((string)$row['status'] !== 'running') {
        throw new ApiException('bad_state', "status={$row['status']} からは 一時停止 できません", 400);
    }
    $endsTs = $row['ends_at'] ? strtotime((string)$row['ends_at']) : time();
    $remain = max(0, $endsTs - time());
    $pdo->prepare("UPDATE timers
                      SET status='paused', started_at=NULL, ends_at=NULL, remaining_seconds=?
                    WHERE id=?")->execute([$remain, $id]);
    json_response(['ok' => true, 'remaining_seconds' => $remain]);
}

// v446 ↻ リセット — どの状態 (running / paused / done / cancelled) からでも
// remaining_seconds を duration_seconds に 戻して paused に。 repeat_idx も 0 に戻す。
function timers_reset(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, duration_seconds, status FROM timers WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    timers_assert_member($pdo, $u, $id, $row);
    $dur = (int)$row['duration_seconds'];
    $pdo->prepare("UPDATE timers
                      SET status='paused', started_at=NULL, ends_at=NULL, closed_at=NULL,
                          repeat_idx=0, remaining_seconds=?
                    WHERE id=?")->execute([$dur, $id]);
    json_response(['ok' => true, 'remaining_seconds' => $dur]);
}

function timer_fmt_short(int $sec): string {
    if ($sec >= 3600) return floor($sec / 3600) . "h" . str_pad((string)(floor(($sec % 3600) / 60)), 2, "0", STR_PAD_LEFT) . "m";
    if ($sec >= 60) return floor($sec / 60) . "分";
    return "{$sec}秒";
}

function timers_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    timers_autoclose($pdo);
    $st = $pdo->prepare("SELECT t.*, u.display_name AS creator_name
                           FROM timers t
                           JOIN users u ON u.id = t.creator_user_id
                          WHERE t.id = ?");
    $st->execute([$id]);
    $t = $st->fetch(PDO::FETCH_ASSOC);
    if (!$t) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isCreator = (int)$t['creator_user_id'] === (int)$u['id'];
    $stP = $pdo->prepare("SELECT tp.user_id, us.display_name, us.avatar_url, us.grade
                           FROM timer_participants tp
                           JOIN users us ON us.id = tp.user_id
                          WHERE tp.timer_id = ?
                          ORDER BY CASE us.grade
                                     WHEN 'B3' THEN 1 WHEN 'B4' THEN 2
                                     WHEN 'M1' THEN 3 WHEN 'M2' THEN 4
                                     WHEN 'D'  THEN 5 ELSE 99 END,
                                   us.display_name");
    $stP->execute([$id]);
    $participants = $stP->fetchAll(PDO::FETCH_ASSOC);
    $isParticipant = false;
    foreach ($participants as $p) if ((int)$p['user_id'] === (int)$u['id']) { $isParticipant = true; break; }
    if (!$isCreator && !$isParticipant) {
        throw new ApiException('forbidden', 'このタイマーの参加者または起案者のみ閲覧可', 403);
    }
    json_response([
        'timer' => [
            'id'                => (int)$t['id'],
            'title'             => $t['title'],
            'creator_user_id'   => (int)$t['creator_user_id'],
            'creator_name'      => $t['creator_name'],
            'duration_seconds'  => (int)$t['duration_seconds'],
            // v446 paused 時に 残り を 持ち越す。 running/done/cancelled では NULL のまま。
            'remaining_seconds' => isset($t['remaining_seconds']) ? (int)$t['remaining_seconds'] : null,
            'bell1_seconds'     => isset($t['bell1_seconds']) ? (int)$t['bell1_seconds'] : null,
            'bell2_seconds'     => isset($t['bell2_seconds']) ? (int)$t['bell2_seconds'] : null,
            'bell3_seconds'     => isset($t['bell3_seconds']) ? (int)$t['bell3_seconds'] : null,
            'end_bell_index'    => isset($t['end_bell_index']) ? (int)$t['end_bell_index'] : null,
            'repeat_max'        => (int)($t['repeat_max'] ?? 0),
            'repeat_idx'        => (int)($t['repeat_idx'] ?? 0),
            'started_at'        => $t['started_at'],
            'ends_at'           => $t['ends_at'],
            'status'            => $t['status'],
            'created_at'        => $t['created_at'],
            'closed_at'         => $t['closed_at'],
        ],
        'is_creator'     => $isCreator,
        'is_participant' => $isParticipant,
        'participants'   => array_map(fn($p) => [
            'user_id'      => (int)$p['user_id'],
            'display_name' => $p['display_name'],
            'avatar_url'   => $p['avatar_url'],
            'grade'        => $p['grade'] ?? '',
        ], $participants),
        'server_now'     => date('Y-m-d H:i:s'),
    ]);
}

function timers_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, status FROM timers WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ((int)$row['creator_user_id'] !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ停止可', 403);
    }
    // v413 done 状態 (自動 autoclose / 終了 跨いだ) でも 停止 を 受理。
    // 「超過カウントを ローカル表示で 止めたい」 場合に 起案者が 押して
    // cancelled に 倒せるように。 cancelled に 既になっている時のみ no-op。
    if ((string)$row['status'] === 'cancelled') {
        json_response(['ok' => true, 'already' => true]); return;
    }
    $pdo->prepare("UPDATE timers SET status='cancelled', closed_at=NOW() WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function timers_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id FROM timers WHERE id=?");
    $st->execute([$id]);
    $cid = (int)$st->fetchColumn();
    if (!$cid) throw new ApiException('not_found', 'タイマーが見つかりません', 404);
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    if ($cid !== (int)$u['id'] && !$isAdmin) {
        throw new ApiException('forbidden', '起案者または admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM timers WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}
