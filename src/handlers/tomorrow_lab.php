<?php
// v1119 中村さん要望「明日、研究室に一緒に行こう機能を作って。明日研究室行きたいけど、
//   人が居なくて寂しいことがある。明日行くと最初から決めてる人が押すボタン。
//   最初の人が、ポイントを設定する。行くと言って行かなかったら、行くと言って
//   来た人にポイントを送付する」
//
// 挙動:
//   * 1 日 1 プラン (target_date UNIQUE)、最初の join 者が fee を設定
//   * 他の人は無料で「参加宣言」ボタン、日付が来る前なら取消可
//   * 翌日 (or 当日終了時点) settlement で checkins テーブル (在室検知) を根拠に
//     「宣言 vs 実際」を判定、行かなかった人 (no-show) が fee pt を pot に払い、
//     行った人 (show) で pot を山分け (端数は早く参加した人)
//   * settlement は creator or admin が /settle を叩く (手動)、あとで cron 化可
//
// API:
//   GET  /api/tomorrow-lab                       → 今日 + 明日 + 過去 7 日
//   POST /api/tomorrow-lab                       → 明日プラン作成 (target_date, fee)
//                                                  同 date が既にあれば代わりに join
//   GET  /api/tomorrow-lab/{id}                  → 詳細
//   POST /api/tomorrow-lab/{id}/join             → 参加宣言 (追加人)
//   DELETE /api/tomorrow-lab/{id}/join           → 取消 (自分)
//   POST /api/tomorrow-lab/{id}/settle           → 精算 (creator/admin)

declare(strict_types=1);

const TLA_MIN_FEE = 5;
const TLA_MAX_FEE = 500;

function route_tomorrow_lab(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { tla_list  ($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { tla_create($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''       && $method === 'GET')    { tla_detail  ($pdo, $cfg, $id); return; }
        if ($next === 'join'   && $method === 'POST')   { tla_join    ($pdo, $cfg, $id); return; }
        if ($next === 'join'   && $method === 'DELETE') { tla_withdraw($pdo, $cfg, $id); return; }
        if ($next === 'settle' && $method === 'POST')   { tla_settle  ($pdo, $cfg, $id); return; }
    }
    throw new ApiException('not_found', "no tomorrow-lab route for $method $sub", 404);
}

function _tla_plan_row(PDO $pdo, int $id, int $requesterId): ?array {
    $st = $pdo->prepare("SELECT p.*, u.display_name AS creator_name, u.avatar_url AS creator_avatar,
                                 (SELECT COUNT(*) FROM tomorrow_lab_joiners j WHERE j.plan_id = p.id) AS joiner_count
                            FROM tomorrow_lab_plans p LEFT JOIN users u ON u.id = p.created_by_user_id
                           WHERE p.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) return null;
    $r['id']                  = (int)$r['id'];
    $r['created_by_user_id']  = (int)$r['created_by_user_id'];
    $r['fee']                 = (int)$r['fee'];
    $r['joiner_count']        = (int)$r['joiner_count'];
    $r['is_mine']             = ($r['created_by_user_id'] === $requesterId);
    $jst = $pdo->prepare("SELECT j.user_id, j.joined_at, j.showed_up, j.penalty_paid, j.bonus_received,
                                  u.display_name, u.avatar_url
                             FROM tomorrow_lab_joiners j JOIN users u ON u.id = j.user_id
                            WHERE j.plan_id = ? ORDER BY j.joined_at ASC");
    $jst->execute([$id]);
    $joiners = [];
    $meJoined = false;
    foreach ($jst->fetchAll(PDO::FETCH_ASSOC) as $jr) {
        $isMe = ((int)$jr['user_id'] === $requesterId);
        if ($isMe) $meJoined = true;
        $joiners[] = [
            'user_id'        => (int)$jr['user_id'],
            'display_name'   => (string)$jr['display_name'],
            'avatar_url'     => $jr['avatar_url'] ?: null,
            'joined_at'      => (string)$jr['joined_at'],
            'showed_up'      => $jr['showed_up'] === null ? null : (bool)$jr['showed_up'],
            'penalty_paid'   => (int)$jr['penalty_paid'],
            'bonus_received' => (int)$jr['bonus_received'],
            'is_me'          => $isMe,
        ];
    }
    $r['joiners']    = $joiners;
    $r['me_joined']  = $meJoined;
    return $r;
}

// GET /api/tomorrow-lab
function tla_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $today = date('Y-m-d');
    $st = $pdo->prepare("SELECT id FROM tomorrow_lab_plans
                          WHERE target_date >= DATE_SUB(?, INTERVAL 7 DAY)
                          ORDER BY target_date DESC");
    $st->execute([$today]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $items[] = _tla_plan_row($pdo, (int)$r['id'], $uid);
    }
    json_response(['items' => $items, 'today' => $today]);
}

// POST /api/tomorrow-lab { target_date, fee, memo? }
function tla_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $date = trim((string)($body['target_date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        throw new ApiException('bad_request', 'target_date は YYYY-MM-DD', 400);
    }
    if ($date < date('Y-m-d')) {
        throw new ApiException('bad_request', '過去の日付は不可', 400);
    }
    $fee = (int)($body['fee'] ?? 20);
    if ($fee < TLA_MIN_FEE || $fee > TLA_MAX_FEE) {
        throw new ApiException('bad_request', sprintf('fee %d-%d', TLA_MIN_FEE, TLA_MAX_FEE), 400);
    }
    $memo = trim((string)($body['memo'] ?? ''));
    if (mb_strlen($memo) > 200) $memo = mb_substr($memo, 0, 200);
    // 同 date が既にあれば join に流す
    $ex = $pdo->prepare("SELECT id FROM tomorrow_lab_plans WHERE target_date = ?");
    $ex->execute([$date]);
    $existingId = (int)$ex->fetchColumn();
    if ($existingId > 0) {
        // 既存プランに join
        _tla_do_join($pdo, $existingId, $uid);
        json_response(['ok' => true, 'id' => $existingId, 'plan' => _tla_plan_row($pdo, $existingId, $uid), 'joined_existing' => true]);
        return;
    }
    // 新規作成 + 自分を最初の joiner に
    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO tomorrow_lab_plans (target_date, fee, memo, created_by_user_id)
                        VALUES (?, ?, ?, ?)")
            ->execute([$date, $fee, $memo ?: null, $uid]);
        $id = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO tomorrow_lab_joiners (plan_id, user_id) VALUES (?, ?)")
            ->execute([$id, $uid]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    json_response(['ok' => true, 'id' => $id, 'plan' => _tla_plan_row($pdo, $id, $uid), 'joined_existing' => false]);
}

function tla_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $plan = _tla_plan_row($pdo, $id, (int)$u['id']);
    if (!$plan) throw new ApiException('not_found', 'plan なし', 404);
    json_response(['plan' => $plan]);
}

function _tla_do_join(PDO $pdo, int $planId, int $uid): void {
    // 過去日は不可
    $st = $pdo->prepare("SELECT target_date, status FROM tomorrow_lab_plans WHERE id = ?");
    $st->execute([$planId]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', 'plan なし', 404);
    if ($p['status'] !== 'open') throw new ApiException('bad_request', '既に精算/キャンセル済', 400);
    if ($p['target_date'] < date('Y-m-d')) {
        throw new ApiException('bad_request', '過去日のプランには参加不可', 400);
    }
    $pdo->prepare("INSERT IGNORE INTO tomorrow_lab_joiners (plan_id, user_id) VALUES (?, ?)")
        ->execute([$planId, $uid]);
}

function tla_join(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    _tla_do_join($pdo, $id, (int)$u['id']);
    json_response(['ok' => true, 'plan' => _tla_plan_row($pdo, $id, (int)$u['id'])]);
}

function tla_withdraw(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // 対象日を過ぎたら取消不可
    $st = $pdo->prepare("SELECT target_date, status FROM tomorrow_lab_plans WHERE id = ?");
    $st->execute([$id]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', 'plan なし', 404);
    if ($p['status'] !== 'open') throw new ApiException('bad_request', '既に精算/キャンセル済', 400);
    if ($p['target_date'] < date('Y-m-d')) {
        throw new ApiException('bad_request', '対象日を過ぎたら取消不可', 400);
    }
    $pdo->prepare("DELETE FROM tomorrow_lab_joiners WHERE plan_id = ? AND user_id = ?")
        ->execute([$id, $uid]);
    json_response(['ok' => true, 'plan' => _tla_plan_row($pdo, $id, $uid)]);
}

// POST /api/tomorrow-lab/{id}/settle
//   creator or admin が対象日以降に叩く。 checkins から showed_up を判定、
//   no-show は fee pt を pot へ、pot は show 者で均等分配 (端数は先着へ)。
function tla_settle(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (string)($u['role'] ?? '') === 'admin';
    $st = $pdo->prepare("SELECT * FROM tomorrow_lab_plans WHERE id = ?");
    $st->execute([$id]);
    $p = $st->fetch(PDO::FETCH_ASSOC);
    if (!$p) throw new ApiException('not_found', 'plan なし', 404);
    if ($p['status'] !== 'open') throw new ApiException('bad_request', '既に精算済', 400);
    if (!$isAdmin && (int)$p['created_by_user_id'] !== $uid) {
        throw new ApiException('forbidden', '精算は起案者 or admin のみ', 403);
    }
    if ($p['target_date'] > date('Y-m-d')) {
        throw new ApiException('bad_request', '対象日を過ぎてから精算してください', 400);
    }
    $fee = (int)$p['fee'];
    // 全 joiners を取得、対象日の checkins を判定
    $jst = $pdo->prepare("SELECT user_id FROM tomorrow_lab_joiners WHERE plan_id = ?");
    $jst->execute([$id]);
    $joinerIds = array_map(fn($r) => (int)$r['user_id'], $jst->fetchAll(PDO::FETCH_ASSOC));
    if (!$joinerIds) {
        $pdo->prepare("UPDATE tomorrow_lab_plans SET status='settled', settled_at=NOW() WHERE id = ?")->execute([$id]);
        json_response(['ok' => true, 'note' => '参加者ゼロ、何もせず精算', 'plan' => _tla_plan_row($pdo, $id, $uid)]);
        return;
    }
    // その日 checkin していれば showed_up
    $place = implode(',', array_fill(0, count($joinerIds), '?'));
    $cst = $pdo->prepare("SELECT user_id FROM checkins WHERE user_id IN ($place) AND checkin_date = ?");
    $cst->execute([...$joinerIds, $p['target_date']]);
    $showedSet = [];
    foreach ($cst->fetchAll(PDO::FETCH_ASSOC) as $r) $showedSet[(int)$r['user_id']] = true;
    $showedUids  = array_values(array_filter($joinerIds, fn($x) => isset($showedSet[$x])));
    $noshowUids  = array_values(array_filter($joinerIds, fn($x) => !isset($showedSet[$x])));

    $pdo->beginTransaction();
    try {
        // 全員の showed_up を更新
        $up = $pdo->prepare("UPDATE tomorrow_lab_joiners SET showed_up = ?, penalty_paid = ?, bonus_received = ? WHERE plan_id = ? AND user_id = ?");
        // no-show → penalty_paid = fee (残高足りなくても徴収は成功: マイナスにする方針)
        //   pot は「show 側の人数分の fee」までとし、余った no-show の徴収は仮想的に (pot に含めるかは要件次第)
        //   実装は「no-show が全員 fee を pot に入れて、show で均等分配」 → シンプル
        $potTotal = 0;
        foreach ($noshowUids as $nuid) {
            $bal = Ledger::balanceOfUser($pdo, $nuid);
            $charge = $fee;   // 残高が足りなくても徴収 (罰金)
            // Ledger を通して SYSTEM (uid=1) へ (pot 仮想口座代わり)
            Ledger::transfer($pdo, $nuid, 1, $charge, 'penalty', 'tomorrow_lab', $id, "明日研究室 no-show 罰金 (#{$id})");
            $potTotal += $charge;
            $up->execute([0, $charge, 0, $id, $nuid]);
        }
        // pot を show 者に均等分配
        $n = count($showedUids);
        if ($n > 0 && $potTotal > 0) {
            $per = intdiv($potTotal, $n);
            $rem = $potTotal - $per * $n;
            // 参加宣言が早い順に余りを回す
            $sortedShow = $showedUids;
            // 早い順 (joined_at ASC) にソート
            $jSort = $pdo->prepare("SELECT user_id FROM tomorrow_lab_joiners WHERE plan_id = ? ORDER BY joined_at ASC");
            $jSort->execute([$id]);
            $order = array_map(fn($r) => (int)$r['user_id'], $jSort->fetchAll(PDO::FETCH_ASSOC));
            usort($sortedShow, fn($a, $b) => array_search($a, $order) - array_search($b, $order));
            $idx = 0;
            foreach ($sortedShow as $suid) {
                $bonus = $per + ($idx < $rem ? 1 : 0);
                Ledger::transfer($pdo, 1, $suid, $bonus, 'penalty', 'tomorrow_lab', $id, "明日研究室 show bonus (#{$id})");
                $up->execute([1, 0, $bonus, $id, $suid]);
                $idx++;
            }
        } else {
            // no-show ゼロ or show ゼロ → show 側の showed_up=1 だけ立てる (bonus 0)
            foreach ($showedUids as $suid) {
                $up->execute([1, 0, 0, $id, $suid]);
            }
        }
        $pdo->prepare("UPDATE tomorrow_lab_plans SET status='settled', settled_at=NOW() WHERE id = ?")->execute([$id]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    // 全員に通知
    global $CFG;
    $creatorName = (string)$pdo->query("SELECT display_name FROM users WHERE id=" . (int)$p['created_by_user_id'])->fetchColumn();
    foreach ($joinerIds as $juid) {
        $showed = isset($showedSet[$juid]);
        $bonus = $showed && $n > 0 ? intdiv($potTotal, $n) : 0;
        $msg = $showed
            ? "🏫 明日研究室 (#{$id}) 精算: 参加ボーナス " . ($bonus + 0) . "pt を受け取りました (no-show " . count($noshowUids) . " 人分)"
            : "🏫 明日研究室 (#{$id}) 精算: 行かなかったため {$fee}pt 罰金を支払いました";
        try { notify_safely($pdo, $CFG, $juid, 'admin_notice', $msg, 'tomorrow_lab', $id); } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'plan' => _tla_plan_row($pdo, $id, $uid),
                   'showed' => count($showedUids), 'noshow' => count($noshowUids),
                   'pot_total' => $potTotal]);
}
