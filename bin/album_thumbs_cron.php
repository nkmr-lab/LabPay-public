<?php
// v969 中村研 アルバム サムネ の 事前 fetch。
//
//   実行 元: nkmr_albums.js の RAW テキスト を regex で 舐めて、
//   [title url] パターン を 抽出、 未 fetch or 一定期間 過ぎた error 行 を 対象 に fetch。
//   1 回 の 実行 で fetch する 件数 に 上限 を 設けて 安全。
//   増分 (新規 追加 アルバム / 一週間 前 の エラー リトライ) のみ 処理 する ので 冪等。
//
//   crontab 想定 (/etc/cron.d/labpay-album-thumbs):
//     0,30 * * * * apache /usr/bin/php /var/www/labpay/bin/album_thumbs_cron.php >> /var/log/labpay-album-thumbs.log 2>&1

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/handlers/album_thumbs.php';   // album_thumbs_try_fetch

const MAX_PER_RUN     = 30;   // 1 回 の 実行 で 最大 fetch 件数
const RETRY_ERROR_DAYS= 7;    // error の 再挑戦 間隔

function main(): void {
    global $PDO;

    // v970 URL 一覧 は nkmr_albums テーブル から 取る (旧: nkmr_albums.js の RAW を parse)。
    $urls = $PDO->query("SELECT DISTINCT url FROM nkmr_albums")->fetchAll(PDO::FETCH_COLUMN);
    if (!$urls) {
        echo "[" . date('Y-m-d H:i:s') . "] no albums in nkmr_albums table\n";
        return;
    }
    echo "[" . date('Y-m-d H:i:s') . "] " . count($urls) . " unique URLs in DB\n";

    // 既 fetch / 最近 の error は スキップ、 残り のみ 実行 対象。
    // v969 photo_count が NULL の 行 (v969 で 追加 された 列) は count-only backfill 対象 に。
    $retryCutoff = time() - RETRY_ERROR_DAYS * 86400;
    $toFetch = [];       // フル fetch (thumb + count)
    $toBackfill = [];    // count のみ (thumb ある が count が NULL)
    foreach ($urls as $u) {
        $h = hash('sha256', $u);
        $st = $PDO->prepare("SELECT thumb_filename, photo_count, error_msg,
                                    UNIX_TIMESTAMP(fetched_at) AS ft
                             FROM album_thumbs WHERE url_hash = ?");
        $st->execute([$h]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        if (!$r) {
            $toFetch[] = ['url' => $u, 'hash' => $h];
            continue;
        }
        if (empty($r['thumb_filename'])) {
            $ft = (int)($r['ft'] ?? 0);
            if ($ft > 0 && $ft > $retryCutoff) continue;   // 最近 エラー は 冷却
            $toFetch[] = ['url' => $u, 'hash' => $h];
            continue;
        }
        // thumb ある: count 未取得 なら backfill
        if ($r['photo_count'] === null) {
            $toBackfill[] = ['url' => $u, 'hash' => $h];
        }
    }
    echo "[" . date('Y-m-d H:i:s') . "] fetch=" . count($toFetch)
       . ", count-backfill=" . count($toBackfill) . "\n";

    if (!$toFetch && !$toBackfill) return;

    $processed = 0;
    $success = 0;
    foreach ($toFetch as $t) {
        if ($processed >= MAX_PER_RUN) {
            echo "[" . date('Y-m-d H:i:s') . "] reached MAX_PER_RUN (fetch), stopping\n";
            break;
        }
        $processed++;
        $ok = album_thumbs_try_fetch($PDO, $t['url'], $t['hash']);
        echo "  [$processed] " . ($ok ? 'OK' : 'FAIL') . " fetch: " . $t['url'] . "\n";
        if ($ok) $success++;
        usleep(200 * 1000);
    }
    // fetch 上限 未達 の 分 で backfill も 進める
    foreach ($toBackfill as $t) {
        if ($processed >= MAX_PER_RUN) {
            echo "[" . date('Y-m-d H:i:s') . "] reached MAX_PER_RUN (backfill), stopping\n";
            break;
        }
        $processed++;
        $ok = album_thumbs_backfill_count($PDO, $t['url'], $t['hash']);
        echo "  [$processed] " . ($ok ? 'OK' : 'FAIL') . " count: " . $t['url'] . "\n";
        if ($ok) $success++;
        usleep(200 * 1000);
    }
    echo "[" . date('Y-m-d H:i:s') . "] done: processed=$processed success=$success\n";
}

main();
