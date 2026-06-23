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
        // Formula: 5 pt if any edit at all, +5 pt if any edit on the user's
        // OWN research note. Max 10pt/day. Counts (attachments / own_note_attachments)
        // are still stored for transparency but no longer drive the pt math.
        $anyEditPt = (int)cfg_get($this->pdo, 'scrapbox_any_edit_pt', '5');
        $ownNotePt = (int)cfg_get($this->pdo, 'scrapbox_own_note_pt', '5');

        $oldest = (new DateTimeImmutable($day . ' 00:00:00', $tz))->getTimestamp();
        $latest = (new DateTimeImmutable($day . ' 23:59:59', $tz))->getTimestamp();

        $messages = $this->fetchHistory($channel, $oldest, $latest);

        // Per author_name: collect every (page title) so we can later check whether
        // any of them is the editor's OWN research note. An empty title still counts
        // as 1 edit for the "any edit" check but obviously can't be matched as own.
        $perAuthor = [];   // name => [['title' => '...'], ...]
        foreach ($messages as $m) {
            if (($m['username'] ?? '') !== 'Scrapbox') continue;
            if (empty($m['attachments'])) continue;
            foreach ($m['attachments'] as $a) {
                $rawName = trim((string)($a['author_name'] ?? ''));
                if ($rawName === '') continue;
                $title = trim((string)($a['title'] ?? ''));
                // author_name が「Sora, Satoshi Nakamura」のようにカンマ区切りで
                // 複数人入る場合は、各人にそれぞれ 1編集ぶんカウントする (共同編集)。
                $names = array_values(array_filter(array_map('trim', explode(',', $rawName)), fn($s) => $s !== ''));
                foreach ($names as $name) {
                    $perAuthor[$name][] = ['title' => $title];
                }
            }
        }

        // Resolve handles → user_id. Unmapped goes to $unmapped.
        $mapped = [];        // user_id => [titles]
        $mappedNames = [];   // user_id => [scrapbox_name, ...]
        $unmapped = [];      // name => count (for the summary)
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
            foreach ($perAuthor as $name => $edits) {
                if (isset($resolved[$name])) {
                    $uid = $resolved[$name];
                    foreach ($edits as $e) $mapped[$uid][] = $e['title'];
                    $mappedNames[$uid][] = $name;
                } else {
                    $unmapped[$name] = count($edits);
                }
            }
        }

        // Look up users.display_name once for all mapped uids — used to match
        // page titles against the user's "own research note".
        $userNames = [];
        if ($mapped) {
            $uids = array_keys($mapped);
            $place = implode(',', array_fill(0, count($uids), '?'));
            $st = $this->pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($place)");
            $st->execute($uids);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $userNames[(int)$r['id']] = (string)$r['display_name'];
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
        foreach ($mapped as $uid => $titles) {
            if (isset($alreadyPaid[$uid])) {
                $skipped[] = ['user_id' => $uid, 'reason' => 'already_paid'];
                continue;
            }
            $totalEdits = count($titles);
            if ($totalEdits <= 0) continue;

            // "Own research note" = page title contains BOTH 研究ノート AND the
            // user's LabPay display_name. Guard against an empty display_name
            // matching every page (unlikely but defensive).
            $userName = $userNames[$uid] ?? '';
            $ownNoteEdits = 0;
            if ($userName !== '') {
                foreach ($titles as $t) {
                    if (mb_strpos($t, '研究ノート') !== false
                        && mb_strpos($t, $userName) !== false) {
                        $ownNoteEdits++;
                    }
                }
            }
            $pts = $anyEditPt + ($ownNoteEdits > 0 ? $ownNotePt : 0);
            $names = implode(', ', $mappedNames[$uid]);

            if ($this->dryRun) {
                $awarded[] = ['user_id'=>$uid, 'attachments'=>$totalEdits,
                    'own_note_attachments'=>$ownNoteEdits, 'points'=>$pts,
                    'names'=>$names, 'ledger_id'=>null];
                continue;
            }

            $this->pdo->beginTransaction();
            try {
                $toAcc = Ledger::accountIdForUser($this->pdo, $uid);
                $ownNote = $ownNoteEdits > 0 ? " · 自身ノート {$ownNoteEdits}" : '';
                $memo  = "Scrapbox 寄稿 {$day} ({$totalEdits} 件{$ownNote} / {$names})";
                $ledgerId = Ledger::transfer(
                    $this->pdo, $sysAcc, $toAcc, $pts,
                    'scrapbox_reward', 'scrapbox', null, mb_substr($memo, 0, 255)
                );
                $ins = $this->pdo->prepare("INSERT INTO scrapbox_awards
                    (award_date, user_id, attachments, own_note_attachments, points, ledger_id)
                    VALUES (?,?,?,?,?,?)");
                $ins->execute([$day, $uid, $totalEdits, $ownNoteEdits, $pts, $ledgerId]);
                $this->pdo->commit();
            } catch (Throwable $e) {
                if ($this->pdo->inTransaction()) $this->pdo->rollBack();
                $skipped[] = ['user_id'=>$uid, 'reason'=>'error: '.$e->getMessage()];
                continue;
            }

            try {
                $ownPart = $ownNoteEdits > 0 ? " (自身ノート ✓)" : '';
                Notifier::notify($this->pdo, $this->cfg, $uid, 'admin_notice',
                    "Scrapbox 寄稿 {$totalEdits} 件で +{$pts}pt{$ownPart} ({$day})",
                    'scrapbox', null);
            } catch (Throwable $e) { /* swallow */ }

            $awarded[] = ['user_id'=>$uid, 'attachments'=>$totalEdits,
                'own_note_attachments'=>$ownNoteEdits, 'points'=>$pts,
                'names'=>$names, 'ledger_id'=>$ledgerId];
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

    // v794 Scrapbox reader 専用 bot token (= channels:history scope を 持って いて、
    //   #scrapbox に 招待 されて いる Slack App の token)。 config に 'scrapbox_bot_token'
    //   が あれば そちら を 使い、 なければ 既定 の bot_token に フォールバック。
    private function readerToken(): ?string {
        $tok = (string)($this->cfg['slack']['scrapbox_bot_token'] ?? '');
        return $tok !== '' ? $tok : null;
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
            $r = slack_api_get($this->cfg, 'conversations.history', $params, $this->readerToken());
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
