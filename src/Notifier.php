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

        // Mail (任意)
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

        // Slack DM (本人が slack_member_id を登録している場合のみ)
        // bot_token と member id がそろっていれば chat.postMessage で DM を 1 通。
        try {
            if (!empty($cfg['slack']['bot_token'])) {
                $u = $pdo->prepare('SELECT slack_member_id FROM users WHERE id=?');
                $u->execute([$userId]);
                $sid = (string)($u->fetchColumn() ?: '');
                if ($sid !== '') {
                    @slack_api_post($cfg, 'chat.postMessage', [
                        'channel' => $sid,        // U-prefix の member ID を直接 channel に渡せば DM
                        'text'    => '[LabPay] ' . $body,
                        // 通知音やバッジを Slack 側で鳴らすため unfurl は off。 LinkUnfurl は許可。
                        'unfurl_links' => false,
                        'unfurl_media' => false,
                    ]);
                }
            }
        } catch (Throwable $e) {
            // Slack 失敗は notification 本体を壊さない (ログだけ)。
            error_log('[Notifier slack DM failed] uid=' . $userId . ' err=' . $e->getMessage());
        }
        return $nid;
    }

    // notifications 行だけ作る (Slack DM / メールを 送らない)。 督促のように
    // 「LabPay の 通知タブ に だけ 出したい」 系の 用途で 使う。
    public static function notifyInApp(
        PDO $pdo,
        int $userId,
        string $type,
        string $body,
        ?string $refType = null,
        ?int $refId = null
    ): int {
        $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id)
            VALUES (?,?,?,?,?)');
        $ins->execute([$userId, $type, mb_substr($body, 0, 255), $refType, $refId]);
        return (int)$pdo->lastInsertId();
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
