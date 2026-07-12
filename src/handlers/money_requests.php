<?php
// /api/money-requests — 請求 (集金) 機能。
// * creator がメンバーを選んで amount (全員同額 or 指定額) を設定
// * 各 recipient は「支払い済」を method (cash/paypay/bank/proxy) 付きでチェック
// * creator は誰がどの方法で払ったかを見られる
// 支払いは外でやり取り。ledger は動かない。

declare(strict_types=1);

function route_money_requests(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === '' && $method === 'GET')  { money_requests_list($pdo, $cfg);   return; }
    if ($sub === '' && $method === 'POST') { money_requests_create($pdo, $cfg); return; }
    if ($sub === 'unpaid-summary' && $method === 'GET') { money_requests_unpaid_summary($pdo, $cfg); return; }

    $id = (int)$sub;
    if ($id > 0) {
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { money_requests_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { money_requests_patch ($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { money_requests_close($pdo, $cfg, $id);  return; }
        if ($next === 'pay'    && $method === 'PATCH') { money_requests_pay  ($pdo, $cfg, $id); return; }
        if ($next === 'unpay'  && $method === 'PATCH') { money_requests_unpay($pdo, $cfg, $id); return; }
        // v1009 LabPay 500pt 部分支払 (請求者が opt-in した ときだけ)
        if ($next === 'pay-labpay'   && $method === 'PATCH') { money_requests_pay_labpay  ($pdo, $cfg, $id); return; }
        if ($next === 'unpay-labpay' && $method === 'PATCH') { money_requests_unpay_labpay($pdo, $cfg, $id); return; }
    }
    json_error('not_found', "no money-requests route for $method $sub", 404);
}

// ─── LIST ────────────────────────────────────────────────────

function money_requests_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 自分が「発起人 (creator) / 代理生成 (created_by) / 受取人」のいずれかに
    // いる請求を返す。
    $st = $pdo->prepare("
        SELECT r.id, r.title, r.memo, r.closed_at, r.created_at,
               r.creator_user_id, r.created_by_user_id,
               uc.display_name AS creator_name,
               ucb.display_name AS created_by_name,
               (SELECT COUNT(*) FROM money_request_recipients WHERE request_id = r.id) AS member_count,
               (SELECT COUNT(*) FROM money_request_recipients WHERE request_id = r.id AND paid_at IS NOT NULL) AS paid_count,
               (SELECT amount_yen FROM money_request_recipients WHERE request_id = r.id AND user_id = ?) AS my_amount,
               (SELECT paid_at    FROM money_request_recipients WHERE request_id = r.id AND user_id = ?) AS my_paid_at
          FROM money_requests r
          JOIN users uc ON uc.id = r.creator_user_id
          LEFT JOIN users ucb ON ucb.id = r.created_by_user_id
         WHERE r.creator_user_id = ?
            OR r.created_by_user_id = ?
            OR EXISTS (SELECT 1 FROM money_request_recipients
                        WHERE request_id = r.id AND user_id = ?)
         ORDER BY r.closed_at IS NULL DESC, r.created_at DESC LIMIT 100");
    $st->execute([$u['id'], $u['id'], $u['id'], $u['id'], $u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

// v658 自分が creator (= 受取側) の請求のうち、未払い受取人を
// 人別に合算。同じ人が複数の請求で払ってない場合は
// 一行にまとめて「user X: 合計 ¥Y (N 件)」と返す。
function money_requests_unpaid_summary(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    // 自分が creator (or created_by) の請求で、受取人が未払いのもの。
    // 削除済請求 (closed_at) は除外。自分が自分宛て (creator==recipient) も除外。
    $st = $pdo->prepare("
        SELECT mr.id   AS request_id,
               mr.title,
               mrr.user_id,
               us.display_name,
               us.avatar_url,
               us.grade,
               mrr.amount_yen
          FROM money_request_recipients mrr
          JOIN money_requests mr ON mr.id = mrr.request_id
          JOIN users us ON us.id = mrr.user_id
         WHERE (mr.creator_user_id = ? OR mr.created_by_user_id = ?)
           AND mr.closed_at IS NULL
           AND mrr.paid_at IS NULL
           AND mrr.user_id <> mr.creator_user_id
         ORDER BY mrr.user_id, mr.id");
    $st->execute([(int)$u['id'], (int)$u['id']]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    // 人別集計
    $perUser = [];
    foreach ($rows as $r) {
        $uid = (int)$r['user_id'];
        if (!isset($perUser[$uid])) {
            $perUser[$uid] = [
                'user_id'      => $uid,
                'display_name' => $r['display_name'],
                'avatar_url'   => $r['avatar_url'],
                'grade'        => $r['grade'] ?? '',
                'total_yen'    => 0,
                'request_count'=> 0,
                'requests'     => [],
            ];
        }
        $perUser[$uid]['total_yen']     += (int)$r['amount_yen'];
        $perUser[$uid]['request_count'] += 1;
        $perUser[$uid]['requests'][]    = [
            'request_id' => (int)$r['request_id'],
            'title'      => $r['title'],
            'amount_yen' => (int)$r['amount_yen'],
        ];
    }
    // 合計額降順
    usort($perUser, fn($a, $b) => $b['total_yen'] - $a['total_yen']);
    json_response(['items' => array_values($perUser)]);
}

// ─── CREATE ──────────────────────────────────────────────────

function money_requests_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)require_field($body, 'title'));
    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title length 1..200', 400);
    }
    $memo = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 5000) : null;
    // v1009 LabPay 500pt 部分支払 の opt-in (デフォルト=無効)。 有効時は amount>=500 の
    //   受取人 のみ 500pt LabPay 送金 で 部分払 が できる。
    $allowLabpayPt = !empty($body['allow_labpay']) ? 500 : 0;
    $dryRun = !empty($body['dry_run']);  // true なら DB に作らず、通知本文だけ previews[] で返す
    // 任意: adhoc_groups の精算サマリ「請求一括生成」から呼ばれた場合に
    // どのグループ由来かを記録する。これがあると groups.js の精算モーダル
    // で「この送金プランはもう支払い済」を表示できる。 FK は ON DELETE
    // SET NULL なので、後でグループを消しても請求は残る。不正な ID を
    // 渡されたら FK 違反で落ちるので別途存在 check はしない。
    $sourceGroupId = isset($body['source_group_id']) && (int)$body['source_group_id'] > 0
        ? (int)$body['source_group_id'] : null;

    // creator_user_id を任意で指定可能 (ワリカ精算で各 creditor を creator
    // として一斉に作るとき用)。指定がなければ呼び出し元自身。指定された
    // ユーザーは存在する human である必要あり。「自分以外を creator にする」
    // のは group 文脈の信頼前提なので追加権限チェックはしない。
    $creatorId = (int)$u['id'];
    $creatorName = (string)$u['display_name'];
    if (isset($body['creator_user_id'])) {
        $cid = (int)$body['creator_user_id'];
        if ($cid <= 0) {
            throw new ApiException('bad_request', 'creator_user_id must be a positive integer', 400);
        }
        if ($cid !== $creatorId) {
            $stC = $pdo->prepare("SELECT display_name FROM users WHERE id=? AND kind='human'");
            $stC->execute([$cid]);
            $cname = $stC->fetchColumn();
            if ($cname === false) {
                throw new ApiException('bad_request', 'creator_user_id not found', 400);
            }
            $creatorId = $cid;
            $creatorName = (string)$cname;
        }
    }

    $recipients = $body['recipients'] ?? null;
    if (!is_array($recipients) || !$recipients) {
        throw new ApiException('bad_request', 'recipients must be a non-empty array', 400);
    }
    // recipients は [{user_id, amount_yen}, ...]
    $rows = [];
    $userIds = [];
    foreach ($recipients as $r) {
        $uid = (int)($r['user_id'] ?? 0);
        $amt = (int)($r['amount_yen'] ?? 0);
        if ($uid <= 0 || $amt <= 0) {
            throw new ApiException('bad_request', 'recipients[].user_id と amount_yen は正の整数で', 400);
        }
        if (isset($userIds[$uid])) {
            throw new ApiException('bad_request', "recipient {$uid} が重複しています", 400);
        }
        $userIds[$uid] = true;
        $rows[] = ['user_id' => $uid, 'amount_yen' => $amt];
    }
    // ユーザー存在チェック
    $uids = array_keys($userIds);
    $place = implode(',', array_fill(0, count($uids), '?'));
    $st = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $st->execute($uids);
    if (count($st->fetchAll()) !== count($uids)) {
        throw new ApiException('bad_request', 'unknown user_id in recipients', 400);
    }

    // recipients の名前を引いておく (preview に必要なので、send 経路と共通化)
    $stN = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
    $stN->execute($uids);
    $names = [];
    foreach ($stN->fetchAll(PDO::FETCH_ASSOC) as $n) $names[(int)$n['id']] = $n['display_name'];

    // 通知本文を組み立てる (実送信 / preview 共通)。memo があれば改行つきで添える。
    $buildMsg = function(int $amount) use ($creatorName, $title, $memo): string {
        $msg = "💴 {$creatorName} から請求: 「{$title}」¥" . number_format($amount);
        if ($memo !== null && trim($memo) !== '') {
            $msg .= "\nメモ: " . $memo;
        }
        return $msg;
    };

    // dry_run: DB を触らず、各人に届くはずの本文を previews[] で返すだけ
    if ($dryRun) {
        $previews = [];
        foreach ($rows as $r) {
            if ((int)$r['user_id'] === $creatorId) continue;
            $previews[] = [
                'user_id'      => (int)$r['user_id'],
                'display_name' => $names[(int)$r['user_id']] ?? "user#{$r['user_id']}",
                'amount_yen'   => (int)$r['amount_yen'],
                'message'      => $buildMsg((int)$r['amount_yen']),
            ];
        }
        json_response(['ok' => true, 'dry_run' => true, 'previews' => $previews]);
        return;
    }

    $rid = db_tx($pdo, function () use ($pdo, $creatorId, $u, $title, $memo, $allowLabpayPt, $rows, $sourceGroupId) {
        $st = $pdo->prepare("INSERT INTO money_requests
            (creator_user_id, created_by_user_id, source_group_id, title, memo, allow_labpay_pt) VALUES (?,?,?,?,?,?)");
        $st->execute([$creatorId, (int)$u['id'], $sourceGroupId, $title, $memo, $allowLabpayPt]);
        $rid = (int)$pdo->lastInsertId();
        $st = $pdo->prepare("INSERT INTO money_request_recipients (request_id, user_id, amount_yen) VALUES (?,?,?)");
        foreach ($rows as $r) $st->execute([$rid, $r['user_id'], $r['amount_yen']]);
        return $rid;
    });

    // recipients に通知 (発起人は除く)
    foreach ($rows as $r) {
        if ((int)$r['user_id'] === $creatorId) continue;
        notify_safely($pdo, $cfg, (int)$r['user_id'], 'admin_notice',
            $buildMsg((int)$r['amount_yen']), 'money_request', $rid);
    }
    // 代理生成 (creator が呼び出し元と別人) の場合、creator 本人にも通知。
    // 自分の名前で勝手に請求が立てられたのに気づけないと困るため。
    if ($creatorId !== (int)$u['id']) {
        $totalYen = 0;
        foreach ($rows as $r) $totalYen += (int)$r['amount_yen'];
        $msg = "💼 {$u['display_name']} さんがあなた宛の請求 "
            . "「{$title}」 (" . count($rows) . " 人, 合計 ¥" . number_format($totalYen) . ") "
            . "を代理で作成しました";
        notify_safely($pdo, $cfg, $creatorId, 'admin_notice', $msg, 'money_request', $rid);
    }
    json_response(['ok' => true, 'id' => $rid, 'creator_user_id' => $creatorId]);
}

// ─── DETAIL ─────────────────────────────────────────────────

function money_requests_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("
        SELECT r.*,
               uc.display_name AS creator_name, uc.avatar_url AS creator_avatar_url,
               uc.paypay_id    AS creator_paypay_id,
               uc.bank_info    AS creator_bank_info,
               ucb.display_name AS created_by_name
          FROM money_requests r
          JOIN users uc ON uc.id = r.creator_user_id
          LEFT JOIN users ucb ON ucb.id = r.created_by_user_id
         WHERE r.id = ?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'request not found', 404);

    // recipient は creator か、自分が含まれるときだけ全リストを見せる
    $stR = $pdo->prepare("
        SELECT rr.id, rr.user_id, rr.amount_yen, rr.paid_at, rr.paid_method,
               rr.paid_proxy_user_id, rr.paid_note,
               rr.labpay_pt, rr.labpay_at,
               u.display_name, u.avatar_url, u.grade,
               up.display_name AS proxy_name
          FROM money_request_recipients rr
          JOIN users u ON u.id = rr.user_id
          LEFT JOIN users up ON up.id = rr.paid_proxy_user_id
         WHERE rr.request_id = ?
         ORDER BY rr.id");
    $stR->execute([$id]);
    $recipients = $stR->fetchAll(PDO::FETCH_ASSOC);

    $isCreator   = (int)$r['creator_user_id']    === (int)$u['id'];
    $isGenerator = (int)($r['created_by_user_id'] ?? 0) === (int)$u['id'];
    $isRecipient = false;
    foreach ($recipients as $rec) if ((int)$rec['user_id'] === (int)$u['id']) $isRecipient = true;
    if (!$isCreator && !$isGenerator && !$isRecipient) {
        throw new ApiException('forbidden', 'この請求に関わっていません', 403);
    }
    $r['recipients'] = $recipients;
    json_response($r);
}

// ─── PATCH (creator edits) ───────────────────────────────────
// 発起人だけが編集可能。受け取る body:
//   title         : 文字列 (任意)
//   memo          : 文字列 or null (任意)
//   recipient_amounts : { user_id: amount_yen, ... } (任意)
// recipient_amounts は「すでに recipient として入っている user_id の金額更新」
// だけ受け付ける。追加/削除は v1 では非対応 (誤操作防止)。

function money_requests_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, created_by_user_id FROM money_requests WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'request not found', 404);
    // 編集できるのは: creator (formally 発起人) / 代理生成した本人 (created_by) / admin
    // ワリカ精算からのバルク生成で創られた請求は created_by = ボタン押した人。
    if ((int)$row['creator_user_id'] !== (int)$u['id']
        && (int)($row['created_by_user_id'] ?? 0) !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '発起人または代理生成者のみ編集できます', 403);
    }
    $body = read_json_body();
    $sets = [];
    $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 200) {
            throw new ApiException('bad_request', 'title length 1..200', 400);
        }
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('memo', $body)) {
        $m = ($body['memo'] === null || $body['memo'] === '')
            ? null : mb_substr((string)$body['memo'], 0, 5000);
        $sets[] = 'memo = ?'; $args[] = $m;
    }
    // v1009 allow_labpay の後付け 切替 (LabPay 部分支払 の 許可)
    if (array_key_exists('allow_labpay', $body)) {
        $sets[] = 'allow_labpay_pt = ?'; $args[] = !empty($body['allow_labpay']) ? 500 : 0;
    }
    if ($sets) {
        $args[] = $id;
        $pdo->prepare('UPDATE money_requests SET ' . implode(', ', $sets) . ' WHERE id = ?')
            ->execute($args);
    }
    if (array_key_exists('recipient_amounts', $body) && is_array($body['recipient_amounts'])) {
        $up = $pdo->prepare("UPDATE money_request_recipients
            SET amount_yen = ? WHERE request_id = ? AND user_id = ?");
        foreach ($body['recipient_amounts'] as $uid => $amt) {
            $uid = (int)$uid;
            $amt = (int)$amt;
            if ($uid <= 0 || $amt <= 0) continue;
            $up->execute([$amt, $id, $uid]);
        }
    }
    json_response(['ok' => true]);
}

// ─── DELETE (creator) ────────────────────────────────────────
// 請求の本番 DELETE。間違って送った請求を完全に消す用途。受取人テーブルは
// money_request_recipients の ON DELETE CASCADE で一緒に消える。
// 既送の通知 (notifications テーブル) は残るが、ref が無効になるだけで害は無い。

function money_requests_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT creator_user_id, created_by_user_id FROM money_requests WHERE id=?");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'request not found', 404);
    // 削除できるのは: creator / 代理生成した本人 / admin。バルク生成した本人が
    // 誤って大量に作ってしまったときに 1 件ずつ消せるように。
    if ((int)$r['creator_user_id'] !== (int)$u['id']
        && (int)($r['created_by_user_id'] ?? 0) !== (int)$u['id']
        && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '発起人・代理生成者・admin のみ削除できます', 403);
    }
    $pdo->prepare("DELETE FROM money_requests WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// ─── PAY / UNPAY (recipient) ─────────────────────────────────
// pay は冪等に「上書き」仕様: paid_at が既にある場合は paid_at を keep して
// method/proxy/note だけ差し替える (「方法を間違えて記録した」を後から訂正
// するための経路)。通知も訂正用の文面に切り替えて creator に飛ばす。

function money_requests_pay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $method = (string)($body['method'] ?? '');
    if (!isset(Labels::PAYMENT_METHOD[$method])) {
        throw new ApiException('bad_request', "method must be cash|paypay|bank|proxy", 400);
    }
    $proxyId = null;
    if ($method === 'proxy') {
        $proxyId = (int)($body['proxy_user_id'] ?? 0);
        if ($proxyId <= 0) {
            throw new ApiException('bad_request', 'proxy_user_id required when method=proxy', 400);
        }
    }
    $note = isset($body['note']) ? mb_substr((string)$body['note'], 0, 500) : null;

    $st = $pdo->prepare("
        SELECT rr.id, rr.amount_yen, rr.paid_at, rr.paid_method,
               r.title, r.creator_user_id
          FROM money_request_recipients rr
          JOIN money_requests r ON r.id = rr.request_id
         WHERE rr.request_id = ? AND rr.user_id = ?");
    $st->execute([$id, $u['id']]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'あなた宛の請求が見つかりません', 404);

    $isCorrection = $row['paid_at'] !== null;
    $oldMethodLabel = $isCorrection ? Labels::paymentMethod((string)$row['paid_method']) : null;

    if ($isCorrection) {
        // 訂正: 初回マークした時刻を keep。method/proxy/note のみ差し替える。
        $pdo->prepare("UPDATE money_request_recipients
            SET paid_method = ?, paid_proxy_user_id = ?, paid_note = ?
            WHERE id = ?")->execute([$method, $proxyId, $note, $row['id']]);
    } else {
        $pdo->prepare("UPDATE money_request_recipients
            SET paid_at = NOW(), paid_method = ?, paid_proxy_user_id = ?, paid_note = ?
            WHERE id = ?")->execute([$method, $proxyId, $note, $row['id']]);
    }

    // creator に通知。訂正と新規で文面を切り替え、誤通知の二重化を避ける。
    if ((int)$row['creator_user_id'] !== (int)$u['id']) {
        $methodLabel = Labels::paymentMethod($method);
        if ($isCorrection) {
            $msg = "✏️ 「{$row['title']}」: {$u['display_name']} が支払い方法を訂正 ({$oldMethodLabel} → {$methodLabel})";
        } else {
            $msg = "💰 「{$row['title']}」: {$u['display_name']} から ¥" . number_format((int)$row['amount_yen']) . " ({$methodLabel}) 支払い済";
        }
        notify_safely($pdo, $cfg, (int)$row['creator_user_id'], 'admin_notice', $msg, 'money_request', $id);
    }
    json_response(['ok' => true, 'corrected' => $isCorrection]);
}

function money_requests_unpay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT id FROM money_request_recipients
        WHERE request_id = ? AND user_id = ?");
    $st->execute([$id, $u['id']]);
    $rid = (int)$st->fetchColumn();
    if (!$rid) throw new ApiException('not_found', 'あなた宛の請求が見つかりません', 404);
    $pdo->prepare("UPDATE money_request_recipients
        SET paid_at=NULL, paid_method=NULL, paid_proxy_user_id=NULL, paid_note=NULL
        WHERE id=?")->execute([$rid]);
    json_response(['ok' => true]);
}

// v1009 LabPay 500pt 部分支払: 受取人 が LabPay pt を 500 (allow_labpay_pt の 値) だけ
//   請求者 に 送金 して、 残額 を 現金 等 で 別途 支払 する。 現金完了 (paid_at) との
//   両立 前提。 冪等 で は なく 「まだ 部分払 して いない 人 だけ 走らせる」 モデル。
function money_requests_pay_labpay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $row = money_requests_load_recipient_for_labpay($pdo, $id, $uid);
    if ((int)$row['allow_labpay_pt'] <= 0) {
        throw new ApiException('bad_request', 'この請求は LabPay 部分支払を許可していません', 400);
    }
    $ptToTransfer = (int)$row['allow_labpay_pt'];
    if ((int)$row['amount_yen'] < $ptToTransfer) {
        throw new ApiException('bad_request', "請求額が {$ptToTransfer} pt 未満なので部分支払は使えません", 400);
    }
    if ($row['labpay_at'] !== null) {
        throw new ApiException('conflict', 'すでに LabPay で 部分支払 済み です', 409);
    }
    if ($row['paid_at'] !== null) {
        throw new ApiException('conflict', 'すでに 全額 支払 済み です', 409);
    }
    $creatorId = (int)$row['creator_user_id'];
    if ($creatorId === $uid) {
        throw new ApiException('bad_request', '自分から自分への LabPay 送金 は 意味ありません', 400);
    }

    db_tx($pdo, function () use ($pdo, $uid, $creatorId, $ptToTransfer, $row, $id) {
        Ledger::transfer($pdo, $uid, $creatorId, $ptToTransfer, 'transfer', 'money_request', $id,
            "「{$row['title']}」LabPay 部分支払");
        $pdo->prepare("UPDATE money_request_recipients
            SET labpay_pt = ?, labpay_at = NOW()
            WHERE id = ?")->execute([$ptToTransfer, (int)$row['id']]);
    });

    // 請求者へ 通知: 「LabPay {N}pt 受領。 残 ¥Y を 現金 で」
    $rest = (int)$row['amount_yen'] - $ptToTransfer;
    $msg = "💠 「{$row['title']}」: {$u['display_name']} から LabPay {$ptToTransfer}pt 受領 (残 ¥"
         . number_format($rest) . " は 現金 等 で 予定)";
    notify_safely($pdo, $cfg, $creatorId, 'admin_notice', $msg, 'money_request', $id);
    json_response(['ok' => true, 'labpay_pt' => $ptToTransfer, 'remaining_yen' => $rest]);
}

// v1009 LabPay 部分支払 の 取消 (受取人 が 誤って 押した とき 用)。 現金 が まだ
//   支払われて いない 限り 取り消せる。 Ledger は 逆方向 の transfer で 相殺。
function money_requests_unpay_labpay(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $row = money_requests_load_recipient_for_labpay($pdo, $id, $uid);
    if ($row['labpay_at'] === null || (int)$row['labpay_pt'] <= 0) {
        throw new ApiException('bad_request', 'LabPay 部分支払 の 記録 が ありません', 400);
    }
    if ($row['paid_at'] !== null) {
        throw new ApiException('bad_request', 'すでに 全額 支払完了 の 記録 が ある ので 取り消せません (先に 支払完了 を 未払いに 戻して ください)', 400);
    }
    $creatorId = (int)$row['creator_user_id'];
    $pt = (int)$row['labpay_pt'];

    db_tx($pdo, function () use ($pdo, $uid, $creatorId, $pt, $row, $id) {
        Ledger::transfer($pdo, $creatorId, $uid, $pt, 'refund', 'money_request', $id,
            "「{$row['title']}」LabPay 部分支払 取消");
        $pdo->prepare("UPDATE money_request_recipients
            SET labpay_pt = 0, labpay_at = NULL
            WHERE id = ?")->execute([(int)$row['id']]);
    });

    $msg = "↩️ 「{$row['title']}」: {$u['display_name']} が LabPay {$pt}pt 部分支払 を 取消";
    notify_safely($pdo, $cfg, $creatorId, 'admin_notice', $msg, 'money_request', $id);
    json_response(['ok' => true]);
}

function money_requests_load_recipient_for_labpay(PDO $pdo, int $id, int $uid): array {
    $st = $pdo->prepare("
        SELECT rr.id, rr.amount_yen, rr.paid_at, rr.labpay_pt, rr.labpay_at,
               r.title, r.creator_user_id, r.allow_labpay_pt
          FROM money_request_recipients rr
          JOIN money_requests r ON r.id = rr.request_id
         WHERE rr.request_id = ? AND rr.user_id = ?");
    $st->execute([$id, $uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'あなた宛の請求が見つかりません', 404);
    return $row;
}
