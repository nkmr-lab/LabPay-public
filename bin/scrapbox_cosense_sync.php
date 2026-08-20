<?php
// C:\Dropbox\Programs\Claude\labpay\bin\scrapbox_cosense_sync.php
// v1350 fb 中村さん要望「研究ノート編集は 1行=2pt、5行で最大10pt」。
//
// Cosense REST API を直叩きして、その日 line が何行更新されたかを user 別に集計、
// 自分の研究ノート (title に「研究ノート」+display_name を含むページ) の line 数に
// 応じて min(N,5)×2pt を支給する。従来の scrapbox_slack_sync.php (Slack 通知 count)
// と違い、実際の line 更新行数を Cosense API の lines[].updated から拾えるので
// 「大きく書いた 1保存」も正当に評価できる。
//
// 使い方:
//   sudo -u apache php bin/scrapbox_cosense_sync.php               # today, dry-run
//   sudo -u apache php bin/scrapbox_cosense_sync.php --apply       # today, 実支給
//   sudo -u apache php bin/scrapbox_cosense_sync.php 2026-08-20 --apply
//
// 既存 scrapbox_awards テーブルを冪等キーに再利用。同じ (day, user_id) で既に払って
// いれば skip。
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';

final class CosenseSync {
    private PDO $pdo;
    private array $cfg;
    private bool $dryRun;
    /** @var array<string, ?int> Cosense userId → LabPay user_id (null=未マップ) */
    private array $userIdCache = [];
    /** @var array<int, string> LabPay user_id → display_name */
    private array $dispNameCache = [];
    /** @var array<string, string> Cosense userId → displayName (project users から一括 load) */
    private array $cuidToDisplayName = [];

    private bool $ignorePaid;

    public function __construct(PDO $pdo, array $cfg, bool $dryRun = true, bool $ignorePaid = false) {
        $this->pdo = $pdo;
        $this->cfg = $cfg;
        $this->dryRun = $dryRun;
        $this->ignorePaid = $ignorePaid;
        // Cosense の /api/users/{id} は 404 なので、project の members を一括 load して
        // userId → displayName の map を作る (毎日 1回だけ叩けば十分)。
        $this->loadProjectMembers();
    }

    private function loadProjectMembers(): void {
        $project = (string)($this->cfg['cosense']['project'] ?? 'nkmr-lab');
        $r = $this->apiJson("/api/projects/{$project}/users");
        foreach (($r['users'] ?? []) as $u) {
            $id = (string)($u['id'] ?? '');
            $dn = (string)($u['displayName'] ?? $u['name'] ?? '');
            if ($id !== '' && $dn !== '') $this->cuidToDisplayName[$id] = $dn;
        }
    }

    public function syncDay(?string $day = null): array {
        $tz = new DateTimeZone((string)($this->cfg['app']['timezone'] ?? 'Asia/Tokyo'));
        if ($day === null) $day = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
        $startDate = (string)cfg_get($this->pdo, 'scrapbox_start_date', '');
        if ($startDate !== '' && $day < $startDate) {
            return ['day' => $day, 'skipped' => 'before scrapbox_start_date=' . $startDate];
        }
        $oldest = (new DateTimeImmutable($day . ' 00:00:00', $tz))->getTimestamp();
        $latest = (new DateTimeImmutable($day . ' 23:59:59', $tz))->getTimestamp();
        $project = (string)($this->cfg['cosense']['project'] ?? 'nkmr-lab');

        // 上位 500 件を updated 降順で取得。「対象日以降 (>= 対象日 00:00) に page.updated が
        // ある ページ」 を target に する (対象日の line 更新は page.updated >= 対象日に
        // しか 存在し得ないので、これで 過去日 集計時に page.updated が 未来日の ページも
        // 拾える → 中で line 側の updated で 更に フィルタ)。
        //
        // NOTE: /api/pages は sort=updated 指定でも pinned が 先頭に来る (updated が
        // 古くても トップに 割り込む) ので 単純な break は 使えず、 continue で スキップ。
        // 500件 全走査するが これは pages list の JSON を 読むだけで line GET は 対象日
        // 以降の ページに 限られるので 実質コストは 変わらない。
        $pagesRes = $this->apiJson("/api/pages/{$project}?limit=500&sort=updated");
        $targets = [];
        foreach (($pagesRes['pages'] ?? []) as $p) {
            $upd = (int)($p['updated'] ?? 0);
            if ($upd < $oldest) continue;
            $targets[] = (string)$p['title'];
        }

        // 各対象 page を個別 GET、 line ごとに (userId, updated) を見て今日分だけ数える。
        $editsByUser = []; // uid => ['own_lines'=>N, 'any_lines'=>M, 'titles'=>[title,...]]
        foreach ($targets as $title) {
            $detail = $this->apiJson('/api/pages/' . rawurlencode($project) . '/' . rawurlencode($title));
            $lines = $detail['lines'] ?? [];
            $byC = []; // cosense_uid => count
            foreach ($lines as $l) {
                if (!is_array($l)) continue;
                $lu = (int)($l['updated'] ?? 0);
                if ($lu < $oldest || $lu > $latest) continue;
                $cuid = (string)($l['userId'] ?? '');
                if ($cuid === '') continue;
                // 空行 (段落区切りの 空 line) は「編集」から 除外。 中村さん確認済み、
                // 大量編集時に 空 line が 20-50個も 底上げに 入っていた ため。
                if (trim((string)($l['text'] ?? '')) === '') continue;
                $byC[$cuid] = ($byC[$cuid] ?? 0) + 1;
            }
            foreach ($byC as $cuid => $n) {
                $uid = $this->resolveCosenseUid($cuid);
                if (!$uid) continue;
                if (!isset($editsByUser[$uid])) $editsByUser[$uid] = ['own_lines' => 0, 'any_lines' => 0, 'titles' => []];
                $editsByUser[$uid]['any_lines'] += $n;
                $editsByUser[$uid]['titles'][]   = $title;
                $dn = $this->getDisplayName($uid);
                if ($dn !== '' && mb_strpos($title, '研究ノート') !== false && mb_strpos($title, $dn) !== false) {
                    $editsByUser[$uid]['own_lines'] += $n;
                }
            }
        }

        // 支給金額の計算と冪等ガード
        $anyEditPt   = (int)cfg_get($this->pdo, 'scrapbox_any_edit_pt',           '2');
        $ownPerLine  = (int)cfg_get($this->pdo, 'scrapbox_own_note_pt_per_line',  '2');
        $ownCap      = (int)cfg_get($this->pdo, 'scrapbox_own_note_pt_cap',      '10');
        // --force (ignorePaid) は dry-run 検証専用: 既支給を無視して「新ロジックだといくら払うか」だけ出す。
        //   実支給 (--apply) と併用すると二重支給になり得るので、この場合は無視して従来通り冪等チェックを有効に。
        $alreadyPaid = ($this->ignorePaid && $this->dryRun) ? [] : $this->fetchAlreadyPaid($day, array_keys($editsByUser));

        $sysAcc  = null;
        if (!$this->dryRun && $editsByUser) {
            $sysAcc = (int)Ledger::accountIdByCode($this->pdo, 'SYSTEM');
        }

        $awarded = []; $skipped = [];
        foreach ($editsByUser as $uid => $e) {
            if (isset($alreadyPaid[$uid])) { $skipped[] = ['uid' => $uid, 'reason' => 'already_paid']; continue; }
            $ownPt = min($e['own_lines'] * $ownPerLine, $ownCap);
            $anyPt = $e['any_lines'] > 0 ? $anyEditPt : 0;
            $pts   = $ownPt + $anyPt;
            if ($pts <= 0) { $skipped[] = ['uid' => $uid, 'reason' => 'zero_pt']; continue; }
            $uniqTitles = array_values(array_unique($e['titles']));
            $titleStr   = mb_substr(implode(' / ', $uniqTitles), 0, 120);
            $memo = "Scrapbox 寄稿 {$day} (own {$e['own_lines']}行→+{$ownPt}pt, any {$e['any_lines']}行→+{$anyPt}pt / {$titleStr})";
            if ($this->dryRun) {
                $awarded[] = compact('uid') + ['own_lines' => $e['own_lines'], 'any_lines' => $e['any_lines'], 'pts' => $pts, 'memo' => $memo];
                continue;
            }
            $this->pdo->beginTransaction();
            try {
                $toAcc = Ledger::accountIdForUser($this->pdo, $uid);
                $ledgerId = Ledger::transfer(
                    $this->pdo, $sysAcc, $toAcc, $pts,
                    'scrapbox_reward', 'scrapbox', null, mb_substr($memo, 0, 255)
                );
                $ins = $this->pdo->prepare("INSERT INTO scrapbox_awards
                    (award_date, user_id, attachments, own_note_attachments, points, ledger_id)
                    VALUES (?,?,?,?,?,?)");
                $ins->execute([$day, $uid, $e['any_lines'], $e['own_lines'], $pts, $ledgerId]);
                $this->pdo->commit();
            } catch (Throwable $ex) {
                if ($this->pdo->inTransaction()) $this->pdo->rollBack();
                $skipped[] = ['uid' => $uid, 'reason' => 'error: ' . $ex->getMessage()];
                continue;
            }
            try {
                Notifier::notify($this->pdo, $this->cfg, $uid, 'scrapbox_reward',
                    "Scrapbox 寄稿 own {$e['own_lines']}行 / any {$e['any_lines']}行で +{$pts}pt ({$day})",
                    'scrapbox', null);
            } catch (Throwable $_) {}
            $awarded[] = compact('uid') + ['own_lines' => $e['own_lines'], 'any_lines' => $e['any_lines'], 'pts' => $pts, 'ledger_id' => $ledgerId, 'memo' => $memo];
        }
        return ['day' => $day, 'target_pages' => count($targets), 'awarded' => $awarded, 'skipped' => $skipped, 'dry_run' => $this->dryRun];
    }

    private function apiJson(string $path): array {
        $cookie = (string)($this->cfg['cosense']['session_cookie'] ?? '');
        $ch = curl_init('https://scrapbox.io' . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => ['Cookie: connect.sid=' . $cookie, 'User-Agent: LabPay/cosense-sync'],
            CURLOPT_TIMEOUT        => 20,
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code !== 200 || $resp === false) return [];
        $j = json_decode((string)$resp, true);
        return is_array($j) ? $j : [];
    }

    private function resolveCosenseUid(string $cuid): ?int {
        if (array_key_exists($cuid, $this->userIdCache)) return $this->userIdCache[$cuid];
        $name = $this->cuidToDisplayName[$cuid] ?? '';
        if ($name === '') { $this->userIdCache[$cuid] = null; return null; }
        $st = $this->pdo->prepare("SELECT user_id FROM user_scrapbox_handles WHERE scrapbox_name = ? LIMIT 1");
        $st->execute([$name]);
        $uid = (int)$st->fetchColumn();
        $this->userIdCache[$cuid] = $uid ?: null;
        return $uid ?: null;
    }

    private function getDisplayName(int $uid): string {
        if (isset($this->dispNameCache[$uid])) return $this->dispNameCache[$uid];
        $st = $this->pdo->prepare("SELECT display_name FROM users WHERE id = ?");
        $st->execute([$uid]);
        return $this->dispNameCache[$uid] = (string)$st->fetchColumn();
    }

    private function fetchAlreadyPaid(string $day, array $uids): array {
        if (!$uids) return [];
        $ph = implode(',', array_fill(0, count($uids), '?'));
        $st = $this->pdo->prepare("SELECT user_id FROM scrapbox_awards WHERE award_date=? AND user_id IN ($ph)");
        $st->execute(array_merge([$day], $uids));
        $out = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $u) $out[(int)$u] = true;
        return $out;
    }
}

if (PHP_SAPI === 'cli') {
    $cfg = require __DIR__ . '/../config/config.php';
    $pdo = new PDO($cfg['db']['dsn'], $cfg['db']['user'], $cfg['db']['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $args = array_slice($argv, 1);
    $apply = false; $day = null; $force = false;
    foreach ($args as $a) {
        if ($a === '--apply') $apply = true;
        elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $a)) $day = $a;
        elseif ($a === '--dry-run') $apply = false;
        elseif ($a === '--force')   $force = true;   // dry-run で 既支給を 無視して 再計算
    }
    $sync = new CosenseSync($pdo, $cfg, !$apply, $force);
    $r = $sync->syncDay($day);
    echo json_encode($r, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
}
