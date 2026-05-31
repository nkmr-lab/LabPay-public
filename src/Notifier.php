<?php
// Notifier: in-app notification rows. Optional email via PHP mail() when enabled.
// Important: callers fire AFTER ledger COMMIT so a notification failure does not roll back money.

declare(strict_types=1);

class Notifier {
    private const EMAILABLE_TYPES = ['sale', 'transfer_received', 'task_approved', 'admin_notice'];

    public static function notify(
        PDO $pdo,
        array $cfg,
        int $userId,
        string $type,
        string $body,
        ?string $refType = null,
        ?int $refId = null
    ): int {
        $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id)
            VALUES (?,?,?,?,?)');
        $ins->execute([$userId, $type, mb_substr($body, 0, 255), $refType, $refId]);
        $nid = (int)$pdo->lastInsertId();

        if (!empty($cfg['mail']['enabled']) && in_array($type, self::EMAILABLE_TYPES, true)) {
            try {
                $u = $pdo->prepare('SELECT email, display_name FROM users WHERE id=?');
                $u->execute([$userId]);
                $row = $u->fetch();
                if ($row && filter_var($row['email'], FILTER_VALIDATE_EMAIL)) {
                    $subject = '[LabPay] ' . self::subjectFor($type);
                    $from = $cfg['mail']['from'] ?? 'no-reply@localhost';
                    $headers = "From: $from\r\nContent-Type: text/plain; charset=UTF-8\r\n";
                    $sent = @mail($row['email'], $subject, $body, $headers);
                    if ($sent) {
                        $mk = $pdo->prepare('UPDATE notifications SET emailed_at=NOW() WHERE id=?');
                        $mk->execute([$nid]);
                    }
                }
            } catch (Throwable $e) { /* swallow */ }
        }
        return $nid;
    }

    private static function subjectFor(string $type): string {
        return match ($type) {
            'sale'              => '出品が売れました',
            'sold_out'          => '在庫切れ',
            'transfer_received' => '送金を受け取りました',
            'task_approved'     => 'タスク承認',
            'admin_notice'      => 'お知らせ',
            default             => '通知',
        };
    }
}
