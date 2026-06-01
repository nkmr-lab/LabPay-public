<?php
// Scrapbox→Slack bridge: read yesterday's #scrapbox messages, award points.
//
// Run via cron daily at 0:05 JST:
//   5 0 * * * /usr/bin/php /var/www/labpay/bin/scrapbox_slack_sync.php
// Or manually:
//   php bin/scrapbox_slack_sync.php           # = process yesterday
//   php bin/scrapbox_slack_sync.php 2026-06-01  # = process this specific date
//   php bin/scrapbox_slack_sync.php --dry-run   # = don't write ledger, just report
//
// Approach:
//   1. Pick target date (default: yesterday in app timezone).
//   2. Skip if start_date guard hasn't kicked in yet.
//   3. Fetch all Slack messages for that JST date via oldest/latest ts bounds.
//   4. Count attachments per author_name (= editor's Scrapbox display name).
//   5. Map name → LabPay user via user_scrapbox_handles. Unmapped names are
//      logged but not awarded.
//   6. For each (date, user_id) not already in scrapbox_awards, compute
//      points = min(attachments * pt_per_attachment, daily_cap), write
//      a ledger row (type='scrapbox_reward'), insert the awards row, notify.
//   7. Post a single Slack summary message.

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

class ScrapboxSlackSync {
    private PDO $pdo;
    private array $cfg;
    private bool $dryRun;

    public function __construct(PDO $pdo, array $cfg, bool $dryRun = false) {
        $this->pdo    = $pdo;
        $this->cfg    = $cfg;
        $this->dryRun = $dryRun;
    }

    public function syncDay(?string $day = null): array {
        $tz = new DateTimeZone((string)($this->cfg['app']['timezone'] ?? 'Asia/Tokyo'));
        if ($day === null) {
            $day = (new DateTimeImmutable('yesterday', $tz))->format('Y-m-d');
        }
        // Guard: nothing before configured start date
        $startDate = (string)cfg_get($this->pdo, 'scrapbox_start_date', '');
        if ($startDate !== '' && $day < $startDate) {
            return ['day' => $day, 'skipped' => 'before scrapbox_start_date=' . $startDate];
        }

        $channel = (string)($this->cfg['slack']['scrapbox_channel_id'] ?? '');
        if ($channel === '') {
            return ['day' => $day, 'error' => 'slack.scrapbox_channel_id is empty'];
        }
        // Formula: any contribution → base; each extra update adds per_extra, bonus capped.
        // Defaults base=5, per_extra=1, bonus_cap=5 → 1 update = 5pt, 6+ updates = 10pt.
        $basePt  = (int)cfg_get($this->pdo, 'scrapbox_base_pt', '5');
        $perEx   = (int)cfg_get($this->pdo, 'scrapbox_pt_per_extra', '1');
        $bonusCap= (int)cfg_get($this->pdo, 'scrapbox_bonus_cap', '5');

        $oldest = (new DateTimeImmutable($day . ' 00:00:00', $tz))->getTimestamp();
        $latest = (new DateTimeImmutable($day . ' 23:59:59', $tz))->getTimestamp();

        $messages = $this->fetchHistory($channel, $oldest, $latest);

        // Per author_name attachment tally
        $perAuthor = [];
        foreach ($messages as $m) {
            if (($m['username'] ?? '') !== 'Scrapbox') continue;
            if (empty($m['attachments'])) continue;
            foreach ($m['attachments'] as $a) {
                $name = trim((string)($a['author_name'] ?? ''));
                if ($name === '') continue;
                $perAuthor[$name] = ($perAuthor[$name] ?? 0) + 1;
            }
        }

        // Resolve handles → user_id. Unmapped goes to $unmapped.
        $mapped = [];   // user_id => attachments
        $mappedNames = []; // user_id => [scrapbox_name, ...]
        $unmapped = []; // name => count
        if ($perAuthor) {
            $names = array_keys($perAuthor);
            $place = implode(',', array_fill(0, count($names), '?'));
            $st = $this->pdo->prepare("SELECT scrapbox_name, user_id
                FROM user_scrapbox_handles WHERE scrapbox_name IN ($place)");
            $st->execute($names);
            $resolved = [];
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $resolved[$r['scrapbox_name']] = (int)$r['user_id'];
            }
            foreach ($perAuthor as $name => $cnt) {
                if (isset($resolved[$name])) {
                    $uid = $resolved[$name];
                    $mapped[$uid] = ($mapped[$uid] ?? 0) + $cnt;
                    $mappedNames[$uid][] = $name;
                } else {
                    $unmapped[$name] = $cnt;
                }
            }
        }

        // Idempotency: which (day, user_id) already paid out?
        $alreadyPaid = [];
        if ($mapped) {
            $uids = array_keys($mapped);
            $place = implode(',', array_fill(0, count($uids), '?'));
            $st = $this->pdo->prepare("SELECT user_id FROM scrapbox_awards
                WHERE award_date=? AND user_id IN ($place)");
            $st->execute(array_merge([$day], $uids));
            foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $u) $alreadyPaid[(int)$u] = true;
        }

        $awarded = [];
        $skipped = [];
        $sysAcc  = (int)Ledger::accountIdByCode($this->pdo, 'SYSTEM');
        foreach ($mapped as $uid => $cnt) {
            if (isset($alreadyPaid[$uid])) {
                $skipped[] = ['user_id' => $uid, 'reason' => 'already_paid'];
                continue;
            }
            $pts = $cnt > 0 ? $basePt + min($bonusCap, max(0, $cnt - 1)) * $perEx : 0;
            if ($pts <= 0) continue;
            $names = implode(', ', $mappedNames[$uid]);

            if ($this->dryRun) {
                $awarded[] = ['user_id'=>$uid, 'attachments'=>$cnt, 'points'=>$pts, 'names'=>$names, 'ledger_id'=>null];
                continue;
            }

            $this->pdo->beginTransaction();
            try {
                $toAcc = Ledger::accountIdForUser($this->pdo, $uid);
                $memo  = "Scrapbox 寄稿 {$day} ({$cnt} 件 / {$names})";
                $ledgerId = Ledger::transfer(
                    $this->pdo, $sysAcc, $toAcc, $pts,
                    'scrapbox_reward', 'scrapbox', null, mb_substr($memo, 0, 255)
                );
                $ins = $this->pdo->prepare("INSERT INTO scrapbox_awards
                    (award_date, user_id, attachments, points, ledger_id)
                    VALUES (?,?,?,?,?)");
                $ins->execute([$day, $uid, $cnt, $pts, $ledgerId]);
                $this->pdo->commit();
            } catch (Throwable $e) {
                if ($this->pdo->inTransaction()) $this->pdo->rollBack();
                $skipped[] = ['user_id'=>$uid, 'reason'=>'error: '.$e->getMessage()];
                continue;
            }

            // Notification — swallow errors so one bad row doesn't tank the loop.
            try {
                Notifier::notify($this->pdo, $this->cfg, $uid, 'admin_notice',
                    "Scrapbox 寄稿 {$cnt} 件で +{$pts}pt ({$day})", 'scrapbox', null);
            } catch (Throwable $e) { /* swallow */ }

            $awarded[] = ['user_id'=>$uid, 'attachments'=>$cnt, 'points'=>$pts, 'names'=>$names, 'ledger_id'=>$ledgerId];
        }

        // Slack summary
        if (!$this->dryRun && ($awarded || $unmapped)) {
            $lines = ["📚 Scrapbox 寄稿ボーナス ({$day})"];
            if ($awarded) {
                $totalPt = array_sum(array_column($awarded, 'points'));
                $lines[] = "配布: " . count($awarded) . "人 / " . $totalPt . "pt";
            }
            if ($unmapped) {
                $top = array_slice($unmapped, 0, 5, true);
                arsort($top);
                $list = [];
                foreach ($top as $n => $c) $list[] = "{$n}({$c})";
                $lines[] = "未マッピング: " . implode(', ', $list)
                    . (count($unmapped) > 5 ? ' …' : '');
            }
            try { slack_notify($this->cfg, implode("\n", $lines)); }
            catch (Throwable $e) { /* swallow */ }
        }

        return [
            'day'        => $day,
            'fetched'    => count($messages),
            'awarded'    => $awarded,
            'skipped'    => $skipped,
            'unmapped'   => $unmapped,
            'dry_run'    => $this->dryRun,
        ];
    }

    // Paginated conversations.history for [oldest, latest] inclusive. Slack returns
    // newest-first; we accumulate then sort ascending.
    private function fetchHistory(string $channel, int $oldest, int $latest): array {
        $all = [];
        $cursor = null;
        // Cap pagination at 10 pages (~2000 msgs) — Scrapbox channel won't hit this
        // in a day, but guard against runaway loops if Slack returns weird cursors.
        for ($i = 0; $i < 10; $i++) {
            $params = [
                'channel' => $channel,
                'oldest'  => $oldest,
                'latest'  => $latest,
                'limit'   => 200,
                'inclusive' => 'true',
            ];
            if ($cursor) $params['cursor'] = $cursor;
            $r = slack_api_get($this->cfg, 'conversations.history', $params);
            $all = array_merge($all, $r['messages'] ?? []);
            $cursor = $r['response_metadata']['next_cursor'] ?? '';
            if (!$cursor) break;
        }
        return $all;
    }
}

// CLI entry
if (php_sapi_name() === 'cli') {
    $args = array_slice($argv, 1);
    $dry  = false;
    $day  = null;
    foreach ($args as $a) {
        if ($a === '--dry-run') $dry = true;
        elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $a)) $day = $a;
    }
    $sync = new ScrapboxSlackSync($PDO, $CFG, $dry);
    $res  = $sync->syncDay($day);
    echo json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
}
