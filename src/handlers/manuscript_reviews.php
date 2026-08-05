<?php
// v1282 📝 原稿チェック依頼 (中村さん pr.nkmr.io チャットで仕様確定、
// docs/HANDOFF_manuscript_review.md 参照)。
//
// 依頼者が PDF + タイトル + 複数チェッカー を指定して起票 → 各チェッカーが
// pr.nkmr.io の校閲モードで音声+手書き校正 → 結果 URL が LabPay に戻る
// → 依頼者・チェッカー双方が結果を開ける。
//
// LabPay 台帳 (ポイント) は動かない ("連絡ボード" 設計)。
//
// pr 連携は tasks.php の task_attachments_review* の実装 (review_secret /
// review_sign / review_verify / REVIEW_PR_BASE 定数) をそのまま再利用。
//
// route:
//   GET  /api/manuscript-reviews                                       — 一覧 (自分が依頼した + 頼まれた)
//   POST /api/manuscript-reviews                                       — 作成 (multipart: file + title + message + reviewers[])
//   GET  /api/manuscript-reviews/{id}                                  — 詳細
//   POST /api/manuscript-reviews/{id}/cancel                           — 依頼者キャンセル
//   GET  /api/manuscript-reviews/{id}/reviewers/{rid}/review           — 本人確認 → pr へ 302
//   GET  /api/manuscript-reviews/{id}/reviewers/{rid}/pull?exp&sig     — 署名検証 → PDF 配信 (ログイン不要)
//   POST /api/manuscript-reviews/{id}/reviewers/{rid}/review-result    — pr からのコールバック (ログイン不要)

declare(strict_types=1);

const MR_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const MR_ATTACHMENT_MIME = ['application/pdf'];
const MR_PULL_TTL_SEC    = 900;                    // 15 分
const MR_CB_TTL_SEC      = 6 * 3600;               // 6 時間

function route_manuscript_reviews(PDO $pdo, array $cfg, string $method, array $seg): void {
    $id  = isset($seg[1]) ? (int)$seg[1] : 0;
    $sub2 = $seg[2] ?? '';

    if ($id === 0 && $method === 'GET')  { mr_list($pdo, $cfg); return; }
    if ($id === 0 && $method === 'POST') { mr_create($pdo, $cfg); return; }
    if ($id > 0 && $sub2 === '' && $method === 'GET')            { mr_detail($pdo, $cfg, $id); return; }
    if ($id > 0 && $sub2 === 'cancel' && $method === 'POST')     { mr_cancel($pdo, $cfg, $id); return; }
    if ($id > 0 && $sub2 === 'reviewers' && isset($seg[3])) {
        $rid = (int)$seg[3];
        $sub4 = $seg[4] ?? '';
        if ($sub4 === 'review'        && $method === 'GET')  { mr_review_redirect($pdo, $cfg, $id, $rid); return; }
        if ($sub4 === 'pull'          && $method === 'GET')  { mr_pull($pdo, $cfg, $id, $rid); return; }
        if ($sub4 === 'review-result' && $method === 'POST') { mr_review_result($pdo, $cfg, $id, $rid); return; }
    }
    throw new ApiException('not_found', 'no such endpoint', 404);
}

// ---------- 内部ヘルパ ----------

// 自分が 依頼者 or チェッカー か のいずれか (それ以外は 404 相当) で 親行 取得
function _mr_load_visible(PDO $pdo, int $id, int $uid): array {
    $st = $pdo->prepare('SELECT r.*, u.display_name AS requester_display_name, u.avatar_url AS requester_avatar_url
                           FROM manuscript_reviews r
                      LEFT JOIN users u ON u.id = r.requester_user_id
                          WHERE r.id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) throw new ApiException('not_found', '依頼が見つかりません', 404);
    $isRequester = (int)$r['requester_user_id'] === $uid;
    $chk = $pdo->prepare('SELECT 1 FROM manuscript_review_reviewers WHERE review_id=? AND reviewer_user_id=?');
    $chk->execute([$id, $uid]);
    $isReviewer = (bool)$chk->fetchColumn();
    if (!$isRequester && !$isReviewer) {
        throw new ApiException('forbidden', '閲覧権限がありません', 403);
    }
    $r['is_requester'] = $isRequester;
    $r['is_reviewer']  = $isReviewer;
    return $r;
}

// review reviewer 行 を id で取得 (親 review_id と一致確認)
function _mr_load_reviewer(PDO $pdo, int $reviewId, int $rid): array {
    $st = $pdo->prepare('SELECT * FROM manuscript_review_reviewers WHERE id=? AND review_id=?');
    $st->execute([$rid, $reviewId]);
    $r = $st->fetch();
    if (!$r) throw new ApiException('not_found', 'reviewer 行が見つかりません', 404);
    return $r;
}

// ---------- GET /api/manuscript-reviews ----------
function mr_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    // 自分が依頼した + 自分がチェッカーの 全て を UNION 相当に。
    $st = $pdo->prepare('
        SELECT DISTINCT r.id, r.requester_user_id, r.title, r.message, r.status,
                        r.filename, r.size_bytes, r.created_at, r.updated_at,
                        u.display_name AS requester_display_name,
                        u.avatar_url   AS requester_avatar_url
          FROM manuscript_reviews r
          LEFT JOIN users u ON u.id = r.requester_user_id
          LEFT JOIN manuscript_review_reviewers rv ON rv.review_id = r.id
         WHERE r.requester_user_id = ? OR rv.reviewer_user_id = ?
         ORDER BY r.updated_at DESC
         LIMIT 200');
    $st->execute([$uid, $uid]);
    $rows = $st->fetchAll();
    if (!$rows) { json_response(['items' => []]); return; }

    // 子 reviewer 行 を batch 取得
    $ids = array_column($rows, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $rvSt = $pdo->prepare("SELECT rv.*, u.display_name AS reviewer_display_name, u.avatar_url AS reviewer_avatar_url
                             FROM manuscript_review_reviewers rv
                        LEFT JOIN users u ON u.id = rv.reviewer_user_id
                            WHERE rv.review_id IN ($ph)
                         ORDER BY rv.created_at ASC");
    $rvSt->execute($ids);
    $rvAll = $rvSt->fetchAll();
    $rvByReview = [];
    foreach ($rvAll as $rv) {
        $rvByReview[(int)$rv['review_id']][] = $rv;
    }

    foreach ($rows as &$r) {
        $rid = (int)$r['id'];
        $r['is_requester'] = ((int)$r['requester_user_id']) === $uid;
        $r['reviewers'] = $rvByReview[$rid] ?? [];
        $r['my_reviewer_id'] = null;
        foreach ($r['reviewers'] as $rv) {
            if ((int)$rv['reviewer_user_id'] === $uid) { $r['my_reviewer_id'] = (int)$rv['id']; break; }
        }
        $r['is_reviewer'] = $r['my_reviewer_id'] !== null;
    }
    unset($r);
    json_response(['items' => $rows]);
}

// ---------- POST /api/manuscript-reviews ----------
function mr_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    // multipart: file + title + message + reviewers[] (or reviewer_ids CSV)
    if (empty($_FILES['file']) || !is_array($_FILES['file'])) {
        throw new ApiException('no_file', 'file (PDF) が必要です', 400);
    }
    $title = mb_substr(trim((string)($_POST['title'] ?? '')), 0, 300);
    if ($title === '') {
        // フォールバック: ファイル名 (拡張子除く)
        $orig = (string)($_FILES['file']['name'] ?? '');
        $title = mb_substr(preg_replace('/\.[^.]+$/', '', basename($orig)) ?: 'untitled', 0, 300);
        if ($title === '') $title = '無題';
    }
    $message = mb_substr(trim((string)($_POST['message'] ?? '')), 0, 4000);
    if ($message === '') $message = null;

    // reviewers: reviewers[] (multiple form fields) or reviewer_ids (CSV)
    $reviewerIds = [];
    if (isset($_POST['reviewers']) && is_array($_POST['reviewers'])) {
        foreach ($_POST['reviewers'] as $x) {
            $n = (int)$x; if ($n > 0) $reviewerIds[$n] = true;
        }
    }
    if (!$reviewerIds && !empty($_POST['reviewer_ids'])) {
        foreach (explode(',', (string)$_POST['reviewer_ids']) as $x) {
            $n = (int)trim($x); if ($n > 0) $reviewerIds[$n] = true;
        }
    }
    unset($reviewerIds[$uid]);   // 自分自身に依頼は不可
    $reviewerIds = array_keys($reviewerIds);
    if (!$reviewerIds) {
        throw new ApiException('bad_request', 'チェッカーを 1 人以上 選んでください', 400);
    }
    if (count($reviewerIds) > 20) {
        throw new ApiException('bad_request', 'チェッカーは 20 人までです', 400);
    }
    // 実在確認 (human user のみ)
    $ph = implode(',', array_fill(0, count($reviewerIds), '?'));
    $chk = $pdo->prepare("SELECT id, display_name FROM users WHERE id IN ($ph) AND kind='human'");
    $chk->execute($reviewerIds);
    $found = $chk->fetchAll();
    if (count($found) !== count($reviewerIds)) {
        throw new ApiException('bad_request', '存在しないユーザが含まれています', 400);
    }

    // 親行を先に INSERT (id が要る) → uploads/manuscript_reviews/{id}/ に保存 → 子行を INSERT
    $newId = db_tx($pdo, function () use ($pdo, $uid, $title, $message, $reviewerIds) {
        // 一旦ダミー filename/stored_name で INSERT して id を取る
        $ins = $pdo->prepare('INSERT INTO manuscript_reviews
            (requester_user_id, title, message, filename, stored_name, size_bytes, mime)
            VALUES (?, ?, ?, "", "", 0, "application/pdf")');
        $ins->execute([$uid, $title, $message]);
        $newId = (int)$pdo->lastInsertId();
        // 子行
        $rvIns = $pdo->prepare('INSERT INTO manuscript_review_reviewers (review_id, reviewer_user_id) VALUES (?, ?)');
        foreach ($reviewerIds as $rvUid) $rvIns->execute([$newId, $rvUid]);
        return $newId;
    });

    // 保存 (トランザクション外、失敗したら親行を消して 500)
    try {
        $saved = save_uploaded_file($_FILES['file'], 'uploads/manuscript_reviews/' . $newId,
            MR_ATTACHMENT_MAX_BYTES, MR_ATTACHMENT_MIME);
    } catch (Throwable $e) {
        $pdo->prepare('DELETE FROM manuscript_reviews WHERE id=?')->execute([$newId]);
        throw $e;
    }
    $orig = mb_substr(basename((string)($_FILES['file']['name'] ?? '')), 0, 255);
    if ($orig === '') $orig = 'document.pdf';
    $pdo->prepare('UPDATE manuscript_reviews SET filename=?, stored_name=?, size_bytes=?, mime=? WHERE id=?')
        ->execute([$orig, $saved['stored_name'], $saved['size'], $saved['mime'], $newId]);

    // 通知 (fire-and-forget)
    try {
        $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
        $link = $baseUrl . '/#/manuscript-reviews/' . $newId;
        foreach ($reviewerIds as $rvUid) {
            notify_safely($pdo, $cfg, (int)$rvUid, 'admin_notice',
                "📝 {$u['display_name']} さんが原稿チェック依頼: 「{$title}」",
                'manuscript_review', $newId);
        }
        // Slack: メンションなしで 1 通 (誰宛かは 本文に)
        $rvNames = array_column($found, 'display_name');
        $msg = "📝 *原稿チェック依頼* <{$link}|{$title}>\n"
             . "依頼: {$u['display_name']}  ·  チェッカー: " . implode(' / ', $rvNames);
        slack_notify($cfg, $msg);
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true, 'id' => $newId]);
}

// ---------- GET /api/manuscript-reviews/{id} ----------
function mr_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $r = _mr_load_visible($pdo, $id, $uid);

    $rvSt = $pdo->prepare('SELECT rv.*, u.display_name AS reviewer_display_name, u.avatar_url AS reviewer_avatar_url
                             FROM manuscript_review_reviewers rv
                        LEFT JOIN users u ON u.id = rv.reviewer_user_id
                            WHERE rv.review_id = ?
                         ORDER BY rv.created_at ASC');
    $rvSt->execute([$id]);
    $r['reviewers'] = $rvSt->fetchAll();
    $r['my_reviewer_id'] = null;
    foreach ($r['reviewers'] as $rv) {
        if ((int)$rv['reviewer_user_id'] === $uid) { $r['my_reviewer_id'] = (int)$rv['id']; break; }
    }
    json_response($r);
}

// ---------- POST /api/manuscript-reviews/{id}/cancel ----------
function mr_cancel(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (($u['role'] ?? '') === 'admin');
    $st = $pdo->prepare('SELECT requester_user_id, status, title FROM manuscript_reviews WHERE id=?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) throw new ApiException('not_found', '依頼が見つかりません', 404);
    if ((int)$row['requester_user_id'] !== $uid && !$isAdmin) {
        throw new ApiException('forbidden', '依頼者のみキャンセルできます', 403);
    }
    if ($row['status'] !== 'open') {
        throw new ApiException('bad_request', '既に終了しています', 400);
    }
    $pdo->prepare('UPDATE manuscript_reviews SET status="cancelled" WHERE id=?')->execute([$id]);
    json_response(['ok' => true]);
}

// ---------- GET /api/manuscript-reviews/{id}/reviewers/{rid}/review ----------
// 本人確認して pr.nkmr.io に 302。
function mr_review_redirect(PDO $pdo, array $cfg, int $id, int $rid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $r  = _mr_load_visible($pdo, $id, $uid);
    if (!in_array($r['status'], ['open'], true)) {
        throw new ApiException('bad_request', 'この依頼は既に終了しています', 400);
    }
    $rv = _mr_load_reviewer($pdo, $id, $rid);
    if ((int)$rv['reviewer_user_id'] !== $uid) {
        throw new ApiException('forbidden', '本人のみ校閲を開始できます', 403);
    }

    // pr との連携ヘルパは tasks.php で 定義済 (review_sign / review_verify / REVIEW_PR_BASE)
    $now  = time();
    $pExp = $now + MR_PULL_TTL_SEC;
    $cExp = $now + MR_CB_TTL_SEC;
    $pSig = review_sign($pdo, "mr_pull:$id:$rid:$pExp");
    $cSig = review_sign($pdo, "mr_cb:$id:$rid:$cExp");

    $base    = rtrim((string)($cfg['app']['base_url'] ?? 'https://pay.nkmr.io'), '/');
    $pullUrl = "$base/api/manuscript-reviews/$id/reviewers/$rid/pull?exp=$pExp&sig=$pSig";
    $cbUrl   = "$base/api/manuscript-reviews/$id/reviewers/$rid/review-result";
    $cbt     = "$cExp.$cSig";
    $title   = (string)($r['title'] ?: ($r['filename'] ?: 'document.pdf'));

    $dest = REVIEW_PR_BASE . '/?src=' . rawurlencode($pullUrl)
          . '&title=' . rawurlencode($title)
          . '&cb='    . rawurlencode($cbUrl)
          . '&cbt='   . rawurlencode($cbt);

    // status を in_review に (初回のみ)
    if ($rv['status'] === 'pending') {
        $pdo->prepare('UPDATE manuscript_review_reviewers SET status="in_review" WHERE id=?')->execute([$rid]);
    }

    if (!headers_sent()) { header_remove('Content-Type'); }
    header('Location: ' . $dest, true, 302);
    exit;
}

// ---------- GET /api/manuscript-reviews/{id}/reviewers/{rid}/pull?exp&sig ----------
// 署名検証で PDF inline 配信 (ログイン不要、 pr 側 fetch 用)。
function mr_pull(PDO $pdo, array $cfg, int $id, int $rid): void {
    $exp = (int)($_GET['exp'] ?? 0);
    $sig = (string)($_GET['sig'] ?? '');
    if ($exp < time()) throw new ApiException('expired', 'link expired', 403);
    if (!review_verify($pdo, "mr_pull:$id:$rid:$exp", $sig)) {
        throw new ApiException('bad_sig', 'invalid signature', 403);
    }
    _mr_load_reviewer($pdo, $id, $rid);   // 存在確認
    $st = $pdo->prepare('SELECT * FROM manuscript_reviews WHERE id=?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) throw new ApiException('not_found', 'review not found', 404);

    $publicDir = realpath(__DIR__ . '/../../public') ?: (__DIR__ . '/../../public');
    $path = $publicDir . '/uploads/manuscript_reviews/' . $id . '/' . $r['stored_name'];
    if (!is_file($path)) throw new ApiException('gone', 'file missing on disk', 410);

    if (!headers_sent()) { header_remove('Content-Type'); }
    header('Content-Type: application/pdf');
    header('Content-Length: ' . (int)$r['size_bytes']);
    header('Content-Disposition: inline; filename="review.pdf"');
    readfile($path);
    exit;
}

// ---------- POST /api/manuscript-reviews/{id}/reviewers/{rid}/review-result ----------
// pr からのコールバック (ログイン不要、 cbt 検証 + host allowlist)。
function mr_review_result(PDO $pdo, array $cfg, int $id, int $rid): void {
    $body = read_json_body();
    $cbt       = (string)($body['cbt'] ?? '');
    $resultUrl = trim((string)($body['resultUrl'] ?? ''));

    $parts = explode('.', $cbt, 2);
    if (count($parts) !== 2) throw new ApiException('bad_token', 'invalid cbt', 403);
    [$exp, $sig] = $parts;
    if ((int)$exp < time()) throw new ApiException('expired', 'token expired', 403);
    if (!review_verify($pdo, "mr_cb:$id:$rid:" . (int)$exp, $sig)) {
        throw new ApiException('bad_sig', 'invalid signature', 403);
    }
    // 結果URL は https + pr.nkmr.io のみ
    if (strtolower((string)(parse_url($resultUrl, PHP_URL_SCHEME) ?: '')) !== 'https'
        || strtolower((string)(parse_url($resultUrl, PHP_URL_HOST) ?: '')) !== 'pr.nkmr.io') {
        throw new ApiException('bad_url', 'result url must be https pr.nkmr.io', 400);
    }
    $rv = _mr_load_reviewer($pdo, $id, $rid);

    db_tx($pdo, function () use ($pdo, $id, $rid, $resultUrl) {
        $pdo->prepare('UPDATE manuscript_review_reviewers
                          SET status="done", result_url=?, result_at=NOW()
                        WHERE id=? AND review_id=?')
            ->execute([$resultUrl, $rid, $id]);
        // 全 reviewer が done なら 親 review も done に
        $ck = $pdo->prepare('SELECT COUNT(*) FROM manuscript_review_reviewers WHERE review_id=? AND status <> "done"');
        $ck->execute([$id]);
        $left = (int)$ck->fetchColumn();
        if ($left === 0) {
            $pdo->prepare('UPDATE manuscript_reviews SET status="done" WHERE id=? AND status="open"')->execute([$id]);
        }
    });

    // 依頼者へ通知 (fire-and-forget)
    try {
        $rq = $pdo->prepare('SELECT r.requester_user_id, r.title, u.display_name AS reviewer_name
                               FROM manuscript_reviews r
                          LEFT JOIN users u ON u.id = ?
                              WHERE r.id = ?');
        $rq->execute([(int)$rv['reviewer_user_id'], $id]);
        $row = $rq->fetch();
        if ($row) {
            $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
            $link = $baseUrl . '/#/manuscript-reviews/' . $id;
            notify_safely($pdo, $cfg, (int)$row['requester_user_id'], 'admin_notice',
                "✅ 原稿チェック完了: 「{$row['title']}」 ({$row['reviewer_name']} さん)",
                'manuscript_review', $id);
            slack_notify($cfg, "✅ *原稿チェック完了* <{$link}|{$row['title']}>  ·  {$row['reviewer_name']} さんが 校閲完了");
        }
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true]);
}
