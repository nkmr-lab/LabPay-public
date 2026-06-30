<?php
// Notifier: in-app notification rows. Optional email via PHP mail() when enabled.
// Important: callers fire AFTER ledger COMMIT so a notification failure does not roll back money.

declare(strict_types=1);

class Notifier {
    private const EMAILABLE_TYPES = ['sale', 'transfer_received', 'task_approved', 'admin_notice'];

    // v656 ref_type + ref_id → アプリ内 URL fragment。 Slack DM 末尾に
    // 「→ https://pay.nkmr.io/#/...」を付けるため。未対応 type は null。
    public static function urlFor(?string $refType, ?int $refId): ?string {
        if (!$refType || !$refId) return null;
        return match ($refType) {
            'money_request'                          => "#/requests/{$refId}",
            'post'                                   => "#/sns/{$refId}",
            'feedback'                               => "#/feedback",
            'rollcall'                               => "#/rollcalls/{$refId}",
            'meetup'                                 => "#/meetups/{$refId}",
            'poll'                                   => "#/polls/{$refId}",
            'task', 'task_approved', 'task_claimed',
            'task_my_claim', 'task_reported',
            'task_cancelled', 'task_expired'         => "#/tasks/{$refId}",
            'auction'                                => "#/auctions/{$refId}",
            'invitation'                             => "#/invitations/{$refId}",
            'group'                                  => "#/groups/{$refId}",
            'prediction'                             => "#/predictions/{$refId}",
            'score_pred'                             => "#/score-predictions/{$refId}",
            'mahjong'                                => "#/mahjong/{$refId}",
            'jinrou'                                 => "#/jinrou/{$refId}",
            'ito'                                    => "#/ito/{$refId}",
            'drafts'                                 => "#/drafts/{$refId}",
            'nomikai'                                => "#/nomikai/{$refId}",
            'roulette'                               => "#/roulette/{$refId}",
            'timer'                                  => "#/timers/{$refId}",
            'bait_request'                           => "#/bait/{$refId}",  // v780 #374 アルバイト申請通知に URL を付ける
            // v781 #376 deep_research / v788 #386 paper_full_translation は ref_id が DB row id だが
            //   URL は share_token なので urlFor では解決できない (body に URL を含めている)
            default                                  => null,
        };
    }

    public static function notify(
        PDO $pdo,
        array $cfg,
        int $userId,
        string $type,
        string $body,
        ?string $refType = null,
        ?int $refId = null
    ): int {
        // v697 #283 admin が自分で送った feedback の通知は最初から既読に
        //   しておく (自作自演の受領通知は表示不要)。 feedback 以外は通常通り。
        $readNow = false;
        if ($refType === 'feedback') {
            try {
                $rk = $pdo->prepare('SELECT role FROM users WHERE id=?');
                $rk->execute([$userId]);
                if ((string)$rk->fetchColumn() === 'admin') $readNow = true;
            } catch (Throwable $_) {}
        }
        if ($readNow) {
            $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id, read_at)
                VALUES (?,?,?,?,?,NOW())');
        } else {
            $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id)
                VALUES (?,?,?,?,?)');
        }
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
                    // v656 通知がどのページに対応するかを URL で末尾に付ける
                    // (Slack 上からすぐ飛べるように)。 unfurl は引き続き off のまま。
                    $slackText = '[LabPay] ' . $body;
                    $frag = self::urlFor($refType, $refId);
                    if ($frag !== null) {
                        $base = rtrim((string)($cfg['app']['base_url'] ?? 'https://pay.nkmr.io'), '/');
                        $slackText .= "\n→ " . $base . '/' . ltrim($frag, '/');
                    }
                    @slack_api_post($cfg, 'chat.postMessage', [
                        'channel' => $sid,        // U-prefix の member ID を直接 channel に渡せば DM
                        'text'    => $slackText,
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

    // notifications 行だけ作る (Slack DM / メールを送らない)。督促のように
    // 「LabPay の通知タブにだけ出したい」系の用途で使う。
    public static function notifyInApp(
        PDO $pdo,
        int $userId,
        string $type,
        string $body,
        ?string $refType = null,
        ?int $refId = null
    ): int {
        $readNow = false;
        if ($refType === 'feedback') {
            try {
                $rk = $pdo->prepare('SELECT role FROM users WHERE id=?');
                $rk->execute([$userId]);
                if ((string)$rk->fetchColumn() === 'admin') $readNow = true;
            } catch (Throwable $_) {}
        }
        if ($readNow) {
            $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id, read_at)
                VALUES (?,?,?,?,?,NOW())');
        } else {
            $ins = $pdo->prepare('INSERT INTO notifications (user_id, type, body, ref_type, ref_id)
                VALUES (?,?,?,?,?)');
        }
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
