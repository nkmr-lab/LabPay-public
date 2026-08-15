<?php
/**
 * auth ホスト (vps16) 上で 実行 する 一度きり migration。
 * LabPay の users テーブル (slack_member_id / cosense_pat) を auth の 暗号化 profile store に転記。
 *
 * 使い方 (vps16 上):
 *   1) 事前に labpay_profiles.tsv を /tmp/labpay_profiles.tsv に scp しておく
 *      (tab 区切り: email \t slack_member_id \t base64(cosense_pat))
 *   2) sudo -u nkmrauth php /tmp/auth_profile_import.php /tmp/labpay_profiles.tsv
 *      (nkmrauth グループで実行しないと SQLite / profile.key を読めない)
 *
 * 動作:
 *   ・ email から allowed_emails 経由で user(shortname) を解決
 *   ・ 現状の profile を load → slack_member_id / cosense_pat のみ 上書き → save
 *     (電話 / 口座 等の 既存 field は 温存)
 *   ・ 全件 dry-run 表示 → 「--apply」引数 が あれば 実書き込み
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') { fwrite(STDERR, "cli only\n"); exit(1); }
$argvIn = $argv;
array_shift($argvIn);   // 自分自身
$apply = false;
$tsv   = '';
foreach ($argvIn as $a) {
    if ($a === '--apply') { $apply = true; continue; }
    if ($tsv === '') { $tsv = $a; continue; }
}
if ($tsv === '' || !is_file($tsv)) {
    fwrite(STDERR, "usage: php auth_profile_import.php <tsv> [--apply]\n");
    exit(1);
}

$CONFIG = require '/etc/nkmrauth/config.php';
require_once '/etc/nkmrauth/lib_token.php';
require_once '/etc/nkmrauth/lib_auth.php';
require_once '/etc/nkmrauth/lib_usage.php';
require_once '/etc/nkmrauth/roster.php';
require_once '/etc/nkmrauth/profiles.php';

// 名簿を実効化 (index.php と同じ手順)
$__eff = roster_effective(roster_load_raw($CONFIG));
$CONFIG['allowed_emails'] = $__eff['allowed_emails'];
$CONFIG['people']         = $__eff['people'];

$fh = fopen($tsv, 'rb');
if (!$fh) { fwrite(STDERR, "cannot open {$tsv}\n"); exit(1); }

$stats = ['total' => 0, 'ok' => 0, 'skipped_unknown_email' => 0, 'skipped_no_change' => 0, 'errors' => 0];

while (($line = fgets($fh)) !== false) {
    $line = rtrim($line, "\r\n");
    if ($line === '') continue;
    $stats['total']++;
    $parts = explode("\t", $line);
    $email = strtolower(trim($parts[0] ?? ''));
    $slack = trim($parts[1] ?? '');
    $patB64 = trim($parts[2] ?? '');
    $pat = $patB64 !== '' ? base64_decode($patB64, true) : '';
    if ($pat === false) $pat = '';

    if ($email === '') { $stats['errors']++; continue; }
    $user = $CONFIG['allowed_emails'][$email] ?? '';
    if ($user === '') {
        fwrite(STDERR, "SKIP unknown email: {$email}\n");
        $stats['skipped_unknown_email']++;
        continue;
    }

    $cur = profile_load($CONFIG, $user);
    $before = ['slack' => (string)$cur['slack_member_id'], 'cosense' => (string)$cur['cosense_pat']];
    if ($slack === '' && $pat === '') { $stats['skipped_no_change']++; continue; }
    if ($slack !== '') $cur['slack_member_id'] = $slack;
    if ($pat   !== '') $cur['cosense_pat']     = $pat;

    $chSlack = ($cur['slack_member_id'] !== $before['slack']);
    $chPat   = ($cur['cosense_pat']     !== $before['cosense']);
    if (!$chSlack && !$chPat) { $stats['skipped_no_change']++; continue; }

    $shortPat = $pat === '' ? '' : substr($pat, 0, 4) . '…(' . strlen($pat) . 'B)';
    echo sprintf("%-16s %-40s slack=%-14s cosense=%s\n",
        $user, $email,
        $chSlack ? ('→ ' . $slack) : '(keep)',
        $chPat   ? ('→ ' . $shortPat) : '(keep)'
    );

    if ($apply) {
        if (profile_save($CONFIG, $user, $cur, 'migration-labpay')) {
            profile_audit($CONFIG, $user, 'migration-import', 'labpay:slack,cosense');
            $stats['ok']++;
        } else {
            fwrite(STDERR, "SAVE FAILED: {$user}\n");
            $stats['errors']++;
        }
    }
}
fclose($fh);

echo "\n=== " . ($apply ? 'APPLIED' : 'DRY-RUN') . " ===\n";
foreach ($stats as $k => $v) echo "{$k}: {$v}\n";
if (!$apply) echo "(no writes performed — add --apply to commit)\n";
