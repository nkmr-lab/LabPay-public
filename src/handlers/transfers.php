<?php
// /api/transfers — peer-to-peer point transfers. Same atomicity guarantees as purchases.

declare(strict_types=1);

function route_transfers(PDO $pdo, array $cfg, string $method, array $seg): void {
    if ($method === 'POST' && !isset($seg[1])) { transfers_create($pdo, $cfg); return; }
    json_error('not_found', "no transfers route for $method", 404);
}

function transfers_create(PDO $pdo, array $cfg): void {
    $sender = Auth::requireUser($pdo, $cfg);
    $body   = read_json_body();
    $toUserId = require_int_positive($body['to_user_id'] ?? null, 'to_user_id');
    $amount   = require_int_positive($body['amount']    ?? null, 'amount');
    $memo     = isset($body['memo']) ? mb_substr((string)$body['memo'], 0, 255) : null;
    $ukey     = (string)require_field($body, 'idempotency_key');
    if (strlen($ukey) < 8 || strlen($ukey) > 80)
        throw new ApiException('bad_request', 'idempotency_key length 8..80', 400);
    if ((int)$sender['id'] === $toUserId)
        throw new ApiException('self_transfer', '自分には送金できません', 400);

    $endpoint = 'POST /api/transfers';
    $cached = idempotency_get($pdo, $ukey, (int)$sender['id'], $endpoint);
    if ($cached) { json_response($cached['body'], $cached['status']); return; }

    // Recipient must exist and be human
    $st = $pdo->prepare("SELECT id, display_name FROM users WHERE id=? AND kind='human'");
    $st->execute([$toUserId]);
    $recipient = $st->fetch();
    if (!$recipient) throw new ApiException('not_found', '送金先のユーザーが見つかりません', 404);

    $pdo->beginTransaction();
    try {
        $senderAcc = Ledger::accountIdForUser($pdo, (int)$sender['id']);
        $recipAcc  = Ledger::accountIdForUser($pdo, $toUserId);

        // Insert transfer row first to get its id for ledger ref
        $ins = $pdo->prepare('INSERT INTO transfers (from_user_id, to_user_id, amount, memo, idempotency_key)
            VALUES (?,?,?,?,?)');
        $ins->execute([$sender['id'], $toUserId, $amount, $memo, $ukey]);
        $transferId = (int)$pdo->lastInsertId();

        Ledger::transfer($pdo, $senderAcc, $recipAcc, $amount, 'transfer',
            'transfer', $transferId, $memo);

        // New balance is sender balance - amount (we just checked balance via Ledger::transfer)
        $newBalance = Ledger::balanceOf($pdo, $senderAcc);

        $payload = [
            'transfer_id' => $transferId,
            'to_user_id'  => $toUserId,
            'to_name'     => $recipient['display_name'],
            'amount'      => $amount,
            'memo'        => $memo,
            'new_balance' => $newBalance,
        ];
        idempotency_save($pdo, $ukey, (int)$sender['id'], $endpoint, $payload, 200);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    try {
        Notifier::notify($pdo, $cfg, $toUserId, 'transfer_received',
            "{$sender['display_name']} から {$amount}pt を受け取りました" . ($memo ? "（{$memo}）" : ''),
            'transfer', $transferId);
    } catch (Throwable $e) {}
    json_response($payload);
}
