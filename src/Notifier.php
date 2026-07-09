<?php
// Notifier: in-app notification rows. Optional email via PHP mail() when enabled.
// Important: callers fire AFTER ledger COMMIT so a notification failure does not roll back money.

declare(strict_types=1);

class Notifier {
    private const EMAILABLE_TYPES = ['sale', 'transfer_received', 'task_approved', 'admin_notice'];

    // v959 fb#476 通知 type → カテゴリ (Slack ON/OFF 設定 の 粒度)。
    //   money: 金 が 動く / 動いた → 見逃せない
    //   action: 自分 の 対応 待ち → 見逃せない
    //   social: SNS / group / 飲み会 → コミュニケーション 系
    //   utility: 自動 発生 系 (タイマー / 点呼 / MAC 未登録 リマインダー 等)
    //   game: 遊び 系 (麻雀 / 予想 / オークション 等)
    //   reward: ポイント 受け取り 系 (寄稿 ボーナス 等) — Slack だと 溜まって うざい
    //   admin: admin_notice / feedback 返信 等
    //   その他 未 分類 は 'admin' 扱い。
    private const TYPE_CATEGORY = [
        // money
        'sale'              => 'money',
        'sold_out'          => 'money',
        'transfer_received' => 'money',
        'task_approved'     => 'money',
        'purchase'          => 'money',
        'money_request'     => 'money',
        // action
        'task'          => 'action',
        'task_claimed'  => 'action',
        'task_my_claim' => 'action',
        'task_reported' => 'action',
        'task_cancelled'=> 'action',
        'task_expired'  => 'action',
        'poll'          => 'action',
        'meetup'        => 'action',
        'invitation'    => 'action',
        'bait_request'  => 'action',
        'drafts'        => 'action',
        'feedback'      => 'action',
        // social
        'post'       => 'social',
        'group_post' => 'social',
        'group'      => 'social',
        'nomikai'    => 'social',
        'share'      => 'social',
        // utility (自動 発生 系)
        'timer'          => 'utility',
        'rollcall'       => 'utility',
        'random_groups'  => 'utility',
        'mac_reminder'   => 'utility',
        'roulette'       => 'utility',
        // game
        'auction'    => 'game',
        'prediction' => 'game',
        'score_pred' => 'game',
        'mahjong'    => 'game',
        'jinrou'     => 'game',
        'ito'        => 'game',
        // reward
        'scrapbox_reward' => 'reward',
        // admin
        'admin_notice' => 'admin',
    ];

    public static function categoryFor(string $type): string {
        return self::TYPE_CATEGORY[$type] ?? 'admin';
    }

    // v959 全 カテゴリ 一覧 + 表示 用 情報 (UI で 使う)。
    public static function categories(): array {
        return [
            ['key' => 'money',   'label' => '💰 金銭関係',   'desc' => '購入・売れた・送金受取・タスク承認・支払請求'],
            ['key' => 'action',  'label' => '🎯 対応要',     'desc' => 'タスク・投票・集会・招待・アルバイト申請・フィードバック'],
            ['key' => 'social',  'label' => '📢 社交',       'desc' => 'らぼったー・グループ・飲み会・共有'],
            ['key' => 'game',    'label' => '🎮 ゲーム',     'desc' => '麻雀・人狼・it・予想・オークション'],
            ['key' => 'utility', 'label' => '⏰ 自動発生',   'desc' => 'タイマー・点呼・ランダムグループ・MAC 未登録リマインダー・ルーレット'],
            ['key' => 'reward',  'label' => '🏆 ポイント',   'desc' => 'Scrapbox 寄稿ボーナス 等 の 定期報酬'],
            ['key' => 'admin',   'label' => '📣 お知らせ',   'desc' => '管理者からのお知らせ・その他'],
        ];
    }

    // v959 Slack DM を 送って よい か? user_notify_slack_prefs に 明示 OFF が あれば false。
    public static function isSlackEnabledForCategory(PDO $pdo, int $userId, string $category): bool {
        try {
            $st = $pdo->prepare("SELECT enabled FROM user_notify_slack_prefs WHERE user_id = ? AND category = ?");
            $st->execute([$userId, $category]);
            $r = $st->fetchColumn();
            if ($r === false) return true;  // 明示 設定 なし = default ON
            return (int)$r === 1;
        } catch (Throwable $_) {
            return true;  // テーブル 無い / エラー は default ON で fallback
        }
    }

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
        // v959 fb#476 ユーザ の Slack 通知設定 (カテゴリ別 ON/OFF) を チェック して skip 可。
        try {
            if (!empty($cfg['slack']['bot_token'])
                && self::isSlackEnabledForCategory($pdo, $userId, self::categoryFor($type))) {
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
