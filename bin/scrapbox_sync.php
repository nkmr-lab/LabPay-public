<?php
// Scrapbox sync — awards points based on yesterday's page edits.
// Run daily via cron:
//   30 4 * * * /usr/bin/php /var/www/labpay/bin/scrapbox_sync.php
// Or trigger manually via admin endpoint POST /api/admin/scrapbox/sync.

declare(strict_types=1);

// Loaded both from CLI (this script) and from the admin sync endpoint.
require_once __DIR__ . '/../src/bootstrap.php';

class ScrapboxSync {
    private PDO $pdo;
    private array $cfg;
    public function __construct(PDO $pdo, array $cfg) { $this->pdo = $pdo; $this->cfg = $cfg; }

    // Sync a single calendar day (Y-m-d, defaults to yesterday in Asia/Tokyo).
    // Returns ['day' => date, 'projects' => [...], 'awards' => [...]].
    public function syncDay(?string $day = null): array {
        $project = trim((string)cfg_get($this->pdo, 'scrapbox_project', ''));
        if ($project === '') {
            return ['day' => null, 'error' => 'scrapbox_project is empty (set in admin config)'];
        }
        $perPage = (int)cfg_get($this->pdo, 'scrapbox_pt_per_page', '3');
        $cap     = (int)cfg_get($this->pdo, 'scrapbox_pt_daily_cap', '20');

        $day = $day ?? (new DateTimeImmutable('yesterday'))->format('Y-m-d');
        $dayStart = (new DateTimeImmutable($day . ' 00:00:00'))->getTimestamp();
        $dayEnd   = (new DateTimeImmutable($day . ' 23:59:59'))->getTimestamp();

        // Fetch page list (paginated). Public projects only.
        $pages = $this->fetchPagesUpdatedAround($project, $dayStart, $dayEnd);

        // Group by editor (Scrapbox `user.name`)
        $editorCounts = [];
        foreach ($pages as $p) {
            $name = $p['user']['name'] ?? null;
            if (!$name) continue;
            $editorCounts[$name] = ($editorCounts[$name] ?? 0) + 1;
        }

        // Map editor name → labpay user
        $awards = [];
        if ($editorCounts) {
            $names = array_keys($editorCounts);
            $placeholders = implode(',', array_fill(0, count($names), '?'));
            $st = $this->pdo->prepare("SELECT id, scrapbox_username FROM users
                WHERE scrapbox_username IN ($placeholders)");
            $st->execute($names);
            $userIdByName = [];
            foreach ($st->fetchAll() as $row) $userIdByName[$row['scrapbox_username']] = (int)$row['id'];

            foreach ($editorCounts as $name => $pageCount) {
                if (!isset($userIdByName[$name])) continue;
                $userId = $userIdByName[$name];
                $points = min($cap, $pageCount * $perPage);
                if ($points <= 0) continue;
                $awarded = $this->awardOnce($userId, $day, $pageCount, $points);
                if ($awarded !== null) {
                    $awards[] = ['user_id' => $userId, 'scrapbox' => $name,
                        'pages' => $pageCount, 'points' => $points, 'ledger_id' => $awarded];
                }
            }
        }

        return ['day' => $day, 'project' => $project, 'editors_found' => count($editorCounts),
            'awards' => $awards];
    }

    // Award `$points` to user once per day; return ledger_id or null if already credited.
    private function awardOnce(int $userId, string $day, int $pages, int $points): ?int {
        // Check existing credit
        $chk = $this->pdo->prepare('SELECT ledger_id FROM scrapbox_credits
            WHERE user_id=? AND credit_date=?');
        $chk->execute([$userId, $day]);
        if ($chk->fetchColumn() !== false) return null;

        $this->pdo->beginTransaction();
        try {
            $sysAcc  = Ledger::accountIdByCode($this->pdo, 'SYSTEM');
            $userAcc = Ledger::accountIdForUser($this->pdo, $userId);
            $ledgerId = Ledger::transfer($this->pdo, $sysAcc, $userAcc, $points,
                'task_reward', 'scrapbox', $userId,
                "Scrapbox 更新 {$pages}件 ({$day})");
            $ins = $this->pdo->prepare('INSERT INTO scrapbox_credits
                (user_id, credit_date, page_count, points_awarded, ledger_id) VALUES (?,?,?,?,?)');
            $ins->execute([$userId, $day, $pages, $points, $ledgerId]);
            $this->pdo->commit();
            return $ledgerId;
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            error_log('[scrapbox] award failed for user ' . $userId . ': ' . $e->getMessage());
            return null;
        }
    }

    // Walk Scrapbox project pages newest-first; stop when we pass the dayStart.
    private function fetchPagesUpdatedAround(string $project, int $dayStart, int $dayEnd): array {
        $hits = [];
        $skip = 0;
        $limit = 100;
        for ($safety = 0; $safety < 30; $safety++) {
            $url = 'https://scrapbox.io/api/pages/' . urlencode($project)
                 . '?sort=updated&limit=' . $limit . '&skip=' . $skip;
            $resp = $this->httpGetJson($url);
            $pages = $resp['pages'] ?? [];
            if (!$pages) break;
            $allOlder = true;
            foreach ($pages as $p) {
                $upd = (int)($p['updated'] ?? 0);
                if ($upd >= $dayStart && $upd <= $dayEnd) $hits[] = $p;
                if ($upd >= $dayStart) $allOlder = false;
            }
            if ($allOlder) break;
            $skip += $limit;
        }
        return $hits;
    }

    private function httpGetJson(string $url): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_USERAGENT => 'labpay-scrapbox-sync/1.0',
        ]);
        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($res === false || $code >= 400) {
            throw new RuntimeException("scrapbox HTTP $code");
        }
        $data = json_decode((string)$res, true);
        if (!is_array($data)) throw new RuntimeException('scrapbox: bad JSON');
        return $data;
    }
}

// CLI entry point
if (PHP_SAPI === 'cli' && realpath($argv[0]) === __FILE__) {
    $sync = new ScrapboxSync($PDO, $CFG);
    $day = $argv[1] ?? null;   // optional Y-m-d argument
    $out = $sync->syncDay($day);
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
}
