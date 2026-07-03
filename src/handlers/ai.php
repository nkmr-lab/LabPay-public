<?php
// /api/ai/* — OpenAI 経由の補助機能。現状はスケジュールフリーフォーム展開のみ。
// config/config.php の openai.api_key が空のときは 503 で黙って断る。

declare(strict_types=1);

function route_ai(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'expand_schedule' && $method === 'POST') {
        ai_expand_schedule($pdo, $cfg);
        return;
    }
    if ($sub === 'translate_image' && $method === 'POST') {
        ai_translate_image($pdo, $cfg);
        return;
    }
    if ($sub === 'place_lookup' && $method === 'POST') {
        ai_place_lookup($pdo, $cfg);
        return;
    }
    if ($sub === 'translations' && $method === 'GET' && !isset($seg[2])) {
        ai_translations_list($pdo, $cfg);
        return;
    }
    // v840 #422 Deep Research / 論文要約 / 論文全訳結果の ⭐ スター
    //   POST   /api/ai/stars  body { kind, ref_id }  → 付ける (idempotent)
    //   DELETE /api/ai/stars  body { kind, ref_id }  → 外す
    if ($sub === 'stars' && in_array($method, ['POST', 'DELETE'], true) && !isset($seg[2])) {
        ai_stars_toggle($pdo, $cfg, $method);
        return;
    }
    // v841 #424 同結果の 🔖 ブックマーク (個人メモ、他人には数だけ見える)
    if ($sub === 'bookmarks' && in_array($method, ['POST', 'DELETE'], true) && !isset($seg[2])) {
        ai_bookmarks_toggle($pdo, $cfg, $method);
        return;
    }
    if ($sub === 'translations' && $method === 'DELETE' && isset($seg[2])) {
        ai_translation_delete($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'assistant' && $method === 'POST') {
        ai_assistant($pdo, $cfg);
        return;
    }
    if ($sub === 'chat' && $method === 'POST') {
        ai_chat($pdo, $cfg);
        return;
    }
    if ($sub === 'short_title' && $method === 'POST') {
        ai_short_title($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_review' && $method === 'POST' && !isset($seg[2])) {
        ai_paper_review($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_review' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_paper_review_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    if ($sub === 'paper_review' && $method === 'GET' && ($seg[2] ?? '') === 'settings') {
        ai_paper_review_settings_get($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_review' && $method === 'PUT' && ($seg[2] ?? '') === 'settings') {
        ai_paper_review_settings_put($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_review' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_review_list($pdo, $cfg);
        return;
    }
    // v748 #359 #360 #361 論文和訳要約 (落合メソッド + 図表ピックアップ + 20pt)
    if ($sub === 'paper_translate' && $method === 'POST' && !isset($seg[2])) {
        ai_paper_translate($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_translate' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_paper_translate_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    // v756 #372 みんなの公開要約一覧 (キーワード検索付き)
    if ($sub === 'paper_translate' && $method === 'GET' && ($seg[2] ?? '') === 'shared') {
        ai_paper_translate_shared_list($pdo, $cfg);
        return;
    }
    // v756 #372 共有 ON/OFF toggle
    if ($sub === 'paper_translate' && $method === 'PATCH' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_translate_patch($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v758 #377 「やりなおす」 (本人のみ、保存された PDF で再処理)
    if ($sub === 'paper_translate' && $method === 'POST' && isset($seg[2]) && ctype_digit((string)$seg[2]) && ($seg[3] ?? '') === 'redo') {
        ai_paper_translate_redo($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v775 #399 本人のみ削除 (履歴から消す)
    if ($sub === 'paper_translate' && $method === 'DELETE' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_translate_delete($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'paper_translate' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_translate_list($pdo, $cfg);
        return;
    }
    // v583 #225 レジュメ原稿チェック (paper-review の軽量版、 5pt、テキスト入力)
    if ($sub === 'resume_check' && $method === 'POST' && !isset($seg[2])) {
        ai_resume_check($pdo, $cfg);
        return;
    }
    if ($sub === 'resume_check' && $method === 'GET' && !isset($seg[2])) {
        ai_resume_check_list($pdo, $cfg);
        return;
    }
    if ($sub === 'resume_check' && $method === 'GET' && isset($seg[2])) {
        ai_resume_check_get($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v613 文字数 / 単語数制限リライター
    if ($sub === 'rewriter' && $method === 'POST' && !isset($seg[2])) {
        ai_rewriter_run($pdo, $cfg);
        return;
    }
    if ($sub === 'rewriter' && $method === 'GET' && !isset($seg[2])) {
        ai_rewriter_list($pdo, $cfg);
        return;
    }
    if ($sub === 'rewriter' && $method === 'GET' && isset($seg[2])) {
        ai_rewriter_get($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v781 #376 Deep Research (ChatGPT 風多段 Web 調査)
    if ($sub === 'deep_research' && $method === 'POST' && !isset($seg[2])) {
        ai_deep_research($pdo, $cfg);
        return;
    }
    if ($sub === 'deep_research' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_deep_research_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    // v784 #382 共有一覧 (q= 検索) — 履歴 list より先に評価 (= 'shared' 文字列を数値と誤判定しない)
    if ($sub === 'deep_research' && $method === 'GET' && ($seg[2] ?? '') === 'shared') {
        ai_deep_research_shared_list($pdo, $cfg);
        return;
    }
    // v784 #382 共有 ON/OFF toggle (本人のみ)
    if ($sub === 'deep_research' && $method === 'PATCH' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_deep_research_patch($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'deep_research' && $method === 'GET' && !isset($seg[2])) {
        ai_deep_research_list($pdo, $cfg);
        return;
    }
    if ($sub === 'deep_research' && $method === 'DELETE' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_deep_research_delete($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v788 #386 #387 #388 論文全訳 (E→J / J→E、章ごと + back-translation チェック)
    // v806 paper_full_translate のエラー row を同 row で再投入 (新規課金なし)
    if ($sub === 'paper_full_translate' && $method === 'POST' && isset($seg[2])
        && ctype_digit((string)$seg[2]) && ($seg[3] ?? '') === 'retry') {
        ai_paper_full_translate_retry($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v806 paper_translate のエラー row を同 row で再投入 (新規課金なし)
    if ($sub === 'paper_translate' && $method === 'POST' && isset($seg[2])
        && ctype_digit((string)$seg[2]) && ($seg[3] ?? '') === 'retry') {
        ai_paper_translate_retry($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'POST' && !isset($seg[2])) {
        ai_paper_full_translate($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_paper_full_translate_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'GET' && ($seg[2] ?? '') === 'shared') {
        ai_paper_full_translate_shared_list($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'PATCH' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_full_translate_patch($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_full_translate_list($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_full_translate' && $method === 'DELETE' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_full_translate_delete($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v789 #389 論文要約 / 全訳にいいね・ブックマーク・コメント
    if (in_array($sub, ['paper_translate', 'paper_full_translate'], true)
        && isset($seg[2]) && ctype_digit((string)$seg[2])
        && ($seg[3] ?? '') === 'react' && $method === 'POST') {
        ai_paper_react_toggle($pdo, $cfg, $sub === 'paper_translate' ? 'paper_translate' : 'paper_full_translation', (int)$seg[2]);
        return;
    }
    if (in_array($sub, ['paper_translate', 'paper_full_translate'], true)
        && isset($seg[2]) && ctype_digit((string)$seg[2])
        && ($seg[3] ?? '') === 'comments' && $method === 'GET' && !isset($seg[4])) {
        ai_paper_comments_list($pdo, $cfg, $sub === 'paper_translate' ? 'paper_translate' : 'paper_full_translation', (int)$seg[2]);
        return;
    }
    if (in_array($sub, ['paper_translate', 'paper_full_translate'], true)
        && isset($seg[2]) && ctype_digit((string)$seg[2])
        && ($seg[3] ?? '') === 'comments' && $method === 'POST' && !isset($seg[4])) {
        ai_paper_comment_create($pdo, $cfg, $sub === 'paper_translate' ? 'paper_translate' : 'paper_full_translation', (int)$seg[2]);
        return;
    }
    if (in_array($sub, ['paper_translate', 'paper_full_translate'], true)
        && isset($seg[2]) && ctype_digit((string)$seg[2])
        && ($seg[3] ?? '') === 'comments' && $method === 'DELETE' && isset($seg[4]) && ctype_digit((string)$seg[4])) {
        ai_paper_comment_delete($pdo, $cfg, $sub === 'paper_translate' ? 'paper_translate' : 'paper_full_translation', (int)$seg[2], (int)$seg[4]);
        return;
    }
    // v809 論文要約 / 全訳を時系列で合算した新着 feed (公開 + 自分)。ホーム widget +
    //   /#/papers-recent ページで共有。 ?offset=&limit= でページング。
    if ($sub === 'paper_recent' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_recent_feed($pdo, $cfg);
        return;
    }
    // v813 #405 要約 row からペアの全訳を作る (= 保存済 PDF を再利用、アップロード不要)
    if ($sub === 'paper_full_translate' && $method === 'POST'
        && ($seg[2] ?? '') === 'from_summary' && isset($seg[3]) && ctype_digit((string)$seg[3])) {
        ai_paper_full_translate_from_summary($pdo, $cfg, (int)$seg[3]);
        return;
    }
    // v813 #405 同方向 (全訳 row → 要約) も対称で用意
    if ($sub === 'paper_translate' && $method === 'POST'
        && ($seg[2] ?? '') === 'from_full' && isset($seg[3]) && ctype_digit((string)$seg[3])) {
        ai_paper_translate_from_full($pdo, $cfg, (int)$seg[3]);
        return;
    }
    json_error('not_found', "no ai route for $method $sub", 404);
}

// v809 論文要約 + 全訳の合算新着 feed。公開中 (is_shared=1, done) のものと
//   自分のもの (status 問わず) を created_at DESC で合算。 widget (limit=10) と
//   /#/papers-recent (limit=20, offset=N) の両方で使う。
function ai_paper_recent_feed(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $limit  = max(1, min(50, (int)($_GET['limit']  ?? 10)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    // 公開 or 本人の要約 + 全訳を UNION ALL で取得、 created_at DESC でソート、
    // limit + offset で切り出す。件数多くても result_json は軽量な title だけ取り出す。
    $sql = "
      SELECT * FROM (
        SELECT 'summary' AS kind,
               pt.id, pt.share_token, pt.user_id, pt.pdf_name, pt.result_json,
               pt.status, pt.is_shared, pt.created_at, pt.finished_at,
               NULL AS direction,
               u.display_name AS author_name, u.avatar_url AS author_avatar
          FROM paper_translates pt
          JOIN users u ON u.id = pt.user_id
         WHERE pt.user_id = :uid1
            OR (pt.is_shared = 1 AND pt.status = 'done')
        UNION ALL
        SELECT 'full' AS kind,
               pft.id, pft.share_token, pft.user_id, pft.pdf_name, pft.result_json,
               pft.status, pft.is_shared, pft.created_at, pft.finished_at,
               pft.direction,
               u.display_name AS author_name, u.avatar_url AS author_avatar
          FROM paper_full_translations pft
          JOIN users u ON u.id = pft.user_id
         WHERE pft.user_id = :uid2
            OR (pft.is_shared = 1 AND pft.status = 'done')
      ) t
      ORDER BY t.created_at DESC
      LIMIT $limit OFFSET $offset
    ";
    $st = $pdo->prepare($sql);
    $st->execute([':uid1' => $uid, ':uid2' => $uid]);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $title = null;
        $titleOrig = null;
        $snippet = null;
        if (!empty($r['result_json'])) {
            $j = json_decode((string)$r['result_json'], true);
            if (is_array($j)) {
                // 要約は title_ja / 全訳は title_translated → title_original
                $title = (string)($j['title_ja'] ?? $j['title_translated'] ?? '') ?: null;
                $titleOrig = (string)($j['title_original'] ?? $j['title_orig'] ?? '') ?: null;
                if ($title === null && $titleOrig !== null) { $title = $titleOrig; $titleOrig = null; }
                // v817 #411 要約 / アブストの先頭約 140 字を snippet として添える
                $snipRaw = (string)($j['summary_one_paragraph'] ?? $j['abstract_ja'] ?? $j['abstract_translated'] ?? $j['abstract'] ?? $j['abstract_original'] ?? '');
                if ($snipRaw !== '') {
                    $snipRaw = preg_replace('/\s+/u', ' ', trim($snipRaw)) ?? '';
                    $snippet = mb_strlen($snipRaw) > 140 ? (mb_substr($snipRaw, 0, 140) . '…') : $snipRaw;
                }
            }
        }
        $items[] = [
            'kind'          => $r['kind'],  // 'summary' or 'full'
            'id'            => (int)$r['id'],
            'share_token'   => $r['share_token'],
            'url_slug'      => $r['kind'] === 'summary' ? 'paper-summary' : 'paper-translate-full',
            'pdf_name'      => $r['pdf_name'],
            'title'         => $title,
            'title_original'=> $titleOrig,
            'snippet'       => $snippet,
            'direction'     => $r['direction'],
            'status'        => $r['status'],
            'is_shared'     => (bool)$r['is_shared'],
            'is_mine'       => ((int)$r['user_id'] === $uid),
            'created_at'    => $r['created_at'],
            'finished_at'   => $r['finished_at'],
            'author_id'     => (int)$r['user_id'],
            'author_name'   => $r['author_name'],
            'author_avatar' => $r['author_avatar'],
        ];
    }
    // v840 papers-recent は 2 種類 (summary=paper_translate / full=paper_full_translation) が
    //   混在するので、種類ごとに分けて star 情報をひっぱり、後で戻し合成する。
    $byKind = ['summary' => [], 'full' => []];
    foreach ($items as $i => $it) $byKind[$it['kind']][] = ['id' => $it['id'], '_idx' => $i];
    if ($byKind['summary']) {
        ai_stars_enrich($pdo, 'paper_translate', $byKind['summary'], $uid);
        ai_bookmarks_enrich($pdo, 'paper_translate', $byKind['summary'], $uid);
        foreach ($byKind['summary'] as $r) {
            $i = $r['_idx'];
            $items[$i]['star_count'] = $r['star_count'] ?? 0;
            $items[$i]['my_starred'] = $r['my_starred'] ?? false;
            $items[$i]['star_users'] = $r['star_users'] ?? [];
            $items[$i]['bookmark_count'] = $r['bookmark_count'] ?? 0;
            $items[$i]['my_bookmarked']  = $r['my_bookmarked']  ?? false;
            $items[$i]['star_kind']  = 'paper_translate';
        }
    }
    if ($byKind['full']) {
        ai_stars_enrich($pdo, 'paper_full_translation', $byKind['full'], $uid);
        ai_bookmarks_enrich($pdo, 'paper_full_translation', $byKind['full'], $uid);
        foreach ($byKind['full'] as $r) {
            $i = $r['_idx'];
            $items[$i]['star_count'] = $r['star_count'] ?? 0;
            $items[$i]['my_starred'] = $r['my_starred'] ?? false;
            $items[$i]['star_users'] = $r['star_users'] ?? [];
            $items[$i]['bookmark_count'] = $r['bookmark_count'] ?? 0;
            $items[$i]['my_bookmarked']  = $r['my_bookmarked']  ?? false;
            $items[$i]['star_kind']  = 'paper_full_translation';
        }
    }
    $sort = (string)($_GET['sort'] ?? '');
    if ($sort === 'stars') {
        usort($items, function($a, $b) {
            $da = (int)($a['star_count'] ?? 0); $db = (int)($b['star_count'] ?? 0);
            if ($db !== $da) return $db <=> $da;
            return strcmp((string)($b['created_at'] ?? ''), (string)($a['created_at'] ?? ''));
        });
    }
    json_response([
        'items'  => $items,
        'limit'  => $limit,
        'offset' => $offset,
        'has_more' => count($items) === $limit,
    ]);
}

const REWRITER_COST = 1;
const REWRITER_MAX_INPUT = 10000;
const REWRITER_MAX_ITER  = 3;

// 文字数 (スペースあり / なし) と単語数をサーバ側で正確にカウント
function ai_count_text(string $s): array {
    $sNoSpace = preg_replace('/\s+/u', '', $s) ?? '';
    $cWithSpace = mb_strlen($s);
    $cNoSpace   = mb_strlen($sNoSpace);
    // 単語数: 連続する非空白を 1 単語とカウント (英語向け、日本語は意味なし)
    $words = 0;
    if (preg_match_all('/\S+/u', $s, $m)) $words = count($m[0]);
    return [
        'chars_with_space' => $cWithSpace,
        'chars_no_space'   => $cNoSpace,
        'words'            => $words,
    ];
}

function ai_detect_lang(string $s): string {
    // 日本語文字 (ひら/カナ/漢字) があれば 'ja'、それ以外 = 'en'
    return preg_match('/[\x{3040}-\x{30FF}\x{4E00}-\x{9FFF}]/u', $s) ? 'ja' : 'en';
}

function ai_rewriter_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, target_mode, target_count, status, iterations, detected_lang,
                                rewritten_chars_with_space, rewritten_chars_no_space, rewritten_words,
                                created_at, finished_at, LEFT(source_text, 80) AS source_head
                           FROM rewriter_tasks WHERE user_id = ? ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['target_count'] = (int)$r['target_count'];
        $r['iterations'] = (int)$r['iterations'];
    }
    unset($r);
    json_response(['items' => $rows]);
}

function ai_rewriter_get(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT * FROM rewriter_tasks WHERE id = ? AND user_id = ?");
    $st->execute([$id, $uid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    foreach (['id','target_count','iterations','source_chars_with_space','source_chars_no_space','source_words',
              'rewritten_chars_with_space','rewritten_chars_no_space','rewritten_words','cost_points'] as $k) {
        if ($r[$k] !== null) $r[$k] = (int)$r[$k];
    }
    json_response($r);
}

function ai_rewriter_run(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $body = read_json_body();
    $text = trim((string)require_field($body, 'text'));
    $mode = (string)require_field($body, 'mode');
    if (!in_array($mode, ['chars_no_space','chars_with_space','words'], true)) {
        throw new ApiException('bad_request', 'mode は chars_no_space / chars_with_space / words', 400);
    }
    $target = (int)require_field($body, 'target');
    if ($target < 10 || $target > 5000) throw new ApiException('bad_request', 'target は 10-5000', 400);
    if (mb_strlen($text) < 20) throw new ApiException('bad_request', '原稿が短すぎ (20文字以上)', 400);
    if (mb_strlen($text) > REWRITER_MAX_INPUT) throw new ApiException('bad_request', '原稿が長すぎ (上限 ' . REWRITER_MAX_INPUT . ' 文字)', 400);

    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < REWRITER_COST) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %d、現在 %d)', REWRITER_COST, $bal), 400);
    }

    $lang = ai_detect_lang($text);
    $srcCount = ai_count_text($text);

    // pending 記録 + 課金
    $taskId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $text, $mode, $target, $lang, $srcCount, &$taskId) {
        $pdo->prepare("INSERT INTO rewriter_tasks
            (user_id, source_text, target_mode, target_count, detected_lang,
             source_chars_with_space, source_chars_no_space, source_words,
             cost_points, status)
            VALUES (?,?,?,?,?,?,?,?,?,'processing')")
            ->execute([
                $uid, $text, $mode, $target, $lang,
                $srcCount['chars_with_space'], $srcCount['chars_no_space'], $srcCount['words'],
                REWRITER_COST,
            ]);
        $taskId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, REWRITER_COST, 'rewriter', 'rewriter', $taskId, 'リライター依頼料');
    });

    // 同期で OpenAI を呼ぶ (最大 REWRITER_MAX_ITER 回リトライ)
    $apiKey = (string)$cfg['openai']['api_key'];
    $model  = (string)($cfg['openai']['model'] ?? 'gpt-5-mini');
    try {
        $modeLabel = [
            'chars_no_space'   => 'スペースなし' . $target . '文字',
            'chars_with_space' => 'スペース込み' . $target . '文字',
            'words'            => $target . '単語',
        ][$mode];
        $sys = "あなたは学術原稿のリライト担当者です。アブストラクト / リバッタル / 概要のような短い文書を、指定された文字数 / 単語数制限以内に書き直してください。論旨と専門性を損なわないよう、語彙の選択や冗長表現の削減で対応してください。出力は書き直した本文のみ、説明や見出しは入れない。";
        $rewritten = '';
        $iter = 0;
        $lastCount = null;
        for ($i = 0; $i < REWRITER_MAX_ITER; $i++) {
            $iter++;
            $extra = '';
            if ($i > 0 && $lastCount !== null) {
                $overBy = $lastCount - $target;
                $extra = "\n\n前回の試みは {$lastCount} で、目標 {$target} を {$overBy} 超過していました。さらに削減してください。";
            }
            $userPrompt = "以下の原稿を **{$modeLabel} 以内** に書き直してください。{$extra}\n\n----- 原稿 -----\n{$text}\n----- /原稿 -----\n\n出力は書き直した文章のみ。";
            $payload = json_encode([
                'model' => $model,
                'messages' => [
                    ['role' => 'system', 'content' => $sys],
                    ['role' => 'user',   'content' => $userPrompt],
                ],
                'temperature' => 0.4,
                'max_completion_tokens' => 2000,
            ], JSON_UNESCAPED_UNICODE);
            $resp = ai_openai_call($payload, $apiKey);
            $rewritten = trim((string)($resp['choices'][0]['message']['content'] ?? ''));
            if ($rewritten === '') throw new RuntimeException('OpenAI 応答が空');
            $cnt = ai_count_text($rewritten);
            $lastCount = $cnt[$mode];
            if ($lastCount <= $target) break;
        }
        $rwCount = ai_count_text($rewritten);

        // 英文なら和訳 (原文 + 書き直し)
        $srcTrans = null; $rwTrans = null;
        if ($lang === 'en') {
            $srcTrans = ai_translate_to_jp($text, $apiKey, $model);
            $rwTrans  = ai_translate_to_jp($rewritten, $apiKey, $model);
        }

        $pdo->prepare("UPDATE rewriter_tasks SET
            rewritten_text=?, rewritten_chars_with_space=?, rewritten_chars_no_space=?, rewritten_words=?,
            source_translation=?, rewritten_translation=?,
            iterations=?, status='done', finished_at=NOW()
            WHERE id=?")
            ->execute([
                $rewritten,
                $rwCount['chars_with_space'], $rwCount['chars_no_space'], $rwCount['words'],
                $srcTrans, $rwTrans,
                $iter, $taskId,
            ]);
    } catch (Throwable $e) {
        try {
            $pdo->prepare("UPDATE rewriter_tasks SET status='error', error_msg=?, finished_at=NOW() WHERE id=?")
                ->execute([mb_substr($e->getMessage(), 0, 500), $taskId]);
            // 失敗なら返金
            Ledger::transfer($pdo, 1, $uid, REWRITER_COST, 'refund', 'rewriter', $taskId, 'リライター失敗返金');
        } catch (Throwable $_) {}
        throw new ApiException('server_error', 'リライト失敗: ' . $e->getMessage(), 500);
    }
    ai_rewriter_get($pdo, $cfg, $taskId);
}

function ai_openai_call(string $payload, string $apiKey): array {
    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_TIMEOUT        => 120,
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException("OpenAI curl 失敗: $err");
    if ($code !== 200) throw new RuntimeException("OpenAI HTTP $code: " . substr($resp, 0, 300));
    $data = json_decode($resp, true);
    if (!is_array($data)) throw new RuntimeException('OpenAI 応答 parse 失敗');
    return $data;
}

function ai_translate_to_jp(string $text, string $apiKey, string $model): string {
    $payload = json_encode([
        'model' => $model,
        'messages' => [
            ['role' => 'system', 'content' => 'あなたは学術文書の翻訳者です。専門用語を保ちつつ自然な日本語に訳してください。出力は和訳のみ。'],
            ['role' => 'user',   'content' => $text],
        ],
        'temperature' => 0.3,
        'max_completion_tokens' => 2500,
    ], JSON_UNESCAPED_UNICODE);
    $r = ai_openai_call($payload, $apiKey);
    return trim((string)($r['choices'][0]['message']['content'] ?? ''));
}

const RESUME_CHECK_COST = 5;        // 旧互換 (gpt-4.1 想定の標準料金)。
const RESUME_CHECK_MODELS = [       // v774 #396 モデル別価格 (paper_review と同じ軸)
    'gpt-4.1'    => 5,
    'gpt-5-mini' => 8,
    'gpt-5'      => 15,
    'o1'         => 25,
];
// テキスト入力時の上限。PDF 入力時は OpenAI Files 経由なので制限なし (10 MB 上限のみ)。
const RESUME_CHECK_MAX_CHARS = 8000;

function ai_resume_check_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, title, status, cost_points, created_at, finished_at,
                                LEFT(input_text, 100) AS input_head
                           FROM resume_checks WHERE user_id = ? ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['cost_points'] = (int)$r['cost_points']; }
    unset($r);
    json_response([
        'items'         => $rows,
        'cost_points'   => RESUME_CHECK_COST,           // 旧互換
        'max_chars'     => RESUME_CHECK_MAX_CHARS,
        'models'        => RESUME_CHECK_MODELS,         // v774 #396
        'default_model' => 'gpt-4.1',
    ]);
}

function ai_resume_check_get(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT * FROM resume_checks WHERE id = ? AND user_id = ?");
    $st->execute([$id, $uid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'not found', 404);
    json_response([
        'id'          => (int)$r['id'],
        'title'       => $r['title'],
        'input_text'  => $r['input_text'],
        'result'      => $r['result_json'] ? json_decode($r['result_json'], true) : null,
        'cost_points' => (int)$r['cost_points'],
        'status'      => $r['status'],
        'error_msg'   => $r['error_msg'],
        'created_at'  => $r['created_at'],
        'finished_at' => $r['finished_at'],
    ]);
}

function ai_resume_check(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    // v598 PDF (multipart) とテキスト (JSON) の両対応。 Content-Type で振り分け。
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    $isPdf = str_starts_with($contentType, 'multipart/form-data') && isset($_FILES['file']);

    $title = null;
    $text  = '';
    $fileId = null;
    $pdfName = null;

    if ($isPdf) {
        $f = $_FILES['file'];
        if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
        if ($f['size'] > 10 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 10 MB まで (原稿チェック)', 400);
        $tmpPdf = $f['tmp_name'];
        $head = @file_get_contents($tmpPdf, false, null, 0, 5);
        if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイルではありません', 400);
        $pdfName = (string)($f['name'] ?? 'manuscript.pdf');
        $title = isset($_POST['title']) ? mb_substr(trim((string)$_POST['title']), 0, 200) : mb_substr($pdfName, 0, 200);
        if ($title === '') $title = $pdfName;
    } else {
        $body = read_json_body();
        $text  = trim((string)require_field($body, 'text'));
        $title = isset($body['title']) ? mb_substr(trim((string)$body['title']), 0, 200) : null;
        if ($title === '') $title = null;
        $len = mb_strlen($text);
        if ($len < 50) throw new ApiException('bad_request', '原稿が短すぎます (50 文字以上)', 400);
        if ($len > RESUME_CHECK_MAX_CHARS) {
            throw new ApiException('bad_request', sprintf('原稿が長すぎます (上限 %d 文字、現在 %d 文字)。論文査読を使ってください', RESUME_CHECK_MAX_CHARS, $len), 400);
        }
    }

    // v774 #396 モデル選択 + 動的価格 (default gpt-4.1)
    $reqModel = trim((string)($isPdf ? ($_POST['model'] ?? 'gpt-4.1') : ($body['model'] ?? 'gpt-4.1')));
    if (!isset(RESUME_CHECK_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $checkCost = (int)RESUME_CHECK_MODELS[$reqModel];

    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $checkCost) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足です (要 %d pt、現在 %d pt)', $checkCost, $bal), 400);
    }

    // PDF なら OpenAI Files API に先にアップロード (同期で)。課金はその後
    if ($isPdf) {
        $apiKey = (string)$cfg['openai']['api_key'];
        $fileId = ai_openai_upload_pdf($tmpPdf, $pdfName, $apiKey);
    }

    // pending レコード + 課金 → 非同期で OpenAI chat 呼出
    $checkId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $text, $fileId, $pdfName, $checkCost, &$checkId) {
        // input_text 列に PDF の場合は「[PDF: filename]」を保存
        $inputForDb = $fileId !== null ? "[PDF: " . ($pdfName ?? 'manuscript.pdf') . "]" : $text;
        $pdo->prepare("INSERT INTO resume_checks (user_id, title, input_text, cost_points, status) VALUES (?,?,?,?,'pending')")
            ->execute([$uid, $title, $inputForDb, $checkCost]);
        $checkId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $checkCost, 'resume_check', 'resume_check', $checkId, '原稿チェック依頼料');
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $checkId,
        'status'      => 'pending',
        'cost_points' => $checkCost,
        'model'       => $reqModel,
        'message'     => '原稿チェック (' . $reqModel . ') を受付けました。 30秒〜2分で結果が出ます。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(240);

    ai_resume_check_run_background($pdo, $cfg, $checkId, $text, $fileId, $reqModel);
}

function ai_resume_check_run_background(PDO $pdo, array $cfg, int $checkId, string $text, ?string $fileId = null, string $reqModel = 'gpt-4.1'): void {
    try {
        $pdo->prepare("UPDATE resume_checks SET status='processing' WHERE id = ?")->execute([$checkId]);
        $apiKey = (string)$cfg['openai']['api_key'];
        $model  = $reqModel;     // v774 #396 ユーザ指定モデル
        $sys = <<<PROMPT
あなたは学術/業務の短い原稿 (1-2 ページ相当、レジュメ/概要/申請書など) のチェック担当者です。
論文ほど厳密にはチェックしません。建設的に、著者が次の改稿ですぐ直せる粒度で指摘してください。
以下を必ず網羅:
- 背景説明の妥当性 (なぜそれが課題か、動機は伝わるか)
- 論理展開の妥当性 (飛躍/前提抜け/順序の妥当性)
- 専門用語の説明 (対象読者を想定して、説明が足りない/過剰な箇所)
- 日本語の接続詞 (「しかし」「したがって」「そして」等が変じゃないか)
- 表記揺れ (用語/数字書式/記号の一貫性)
- 引用文献 (あれば: 表記の妥当性/存在しなさそう/typo)
PROMPT;
        $userPromptText = "出力 JSON スキーマ:\n"
            . "{ \"summary_one_line\": \"1行で全体講評\",\n"
            . "  \"overall_score\": 1-5の整数 (1=要大幅改稿, 5=ほぼOK),\n"
            . "  \"background_validity\": {\"score\": 1-5, \"comment\": \"背景説明の妥当性 (50-200字)\"},\n"
            . "  \"logical_flow\": {\"score\": 1-5, \"comment\": \"論理展開の妥当性\", \"issues\": [\"具体的な飛躍/順序問題を引用付きで\", ...]},\n"
            . "  \"jargon_explanation\": {\"score\": 1-5, \"comment\": \"専門用語の説明適切さ\", \"missing\": [\"説明不足の用語\", ...]},\n"
            . "  \"japanese_connectives\": {\"score\": 1-5, \"comment\": \"接続詞の適切さ\", \"issues\": [{\"original\": \"原文の問題箇所\", \"suggested\": \"こう書き直すと良い\"}, ...]},\n"
            . "  \"terminology_consistency\": {\"score\": 1-5, \"comment\": \"表記揺れの有無\", \"variations\": [\"揺れている表記 (例: 「ユーザ」と「ユーザー」)\", ...]},\n"
            . "  \"citations_check\": {\"score\": 1-5, \"comment\": \"引用の問題点 (引用が無ければ 'なし')\", \"issues\": [\"具体的な引用問題\", ...]},\n"
            . "  \"rewrite_suggestions\": [{\"original\": \"原文の該当箇所\", \"reason\": \"なぜ問題か\", \"suggested_rewrite\": \"こう書き直すと良い\"}, ...],\n"
            . "  \"comments_to_author\": \"著者への総合コメント (200-500字、励まし + 優先度付きの改善提案)\"\n"
            . "}\n\n"
            . "scoreはその項目で1-5を厳しめにつけてください。issues/variations/rewrite_suggestionsは該当があれば書く、なければ空配列でOK。";
        if ($fileId !== null) {
            // PDF 添付モード
            $messages = [
                ['role' => 'system', 'content' => $sys],
                ['role' => 'user', 'content' => [
                    ['type' => 'file', 'file' => ['file_id' => $fileId]],
                    ['type' => 'text', 'text' => "添付の PDF 原稿をチェックして、JSON で返してください。\n\n" . $userPromptText],
                ]],
            ];
        } else {
            $messages = [
                ['role' => 'system', 'content' => $sys],
                ['role' => 'user', 'content' => "以下の原稿をチェックして、JSON で返してください。\n\n----- 原稿 -----\n" . $text . "\n----- /原稿 -----\n\n" . $userPromptText],
            ];
        }
        $payloadArr = [
            'model' => $model,
            'messages' => $messages,
            'response_format' => ['type' => 'json_object'],
            'max_completion_tokens' => 3000,
        ];
        if (!preg_match('/^(gpt-5|o1|o3)/', $model)) $payloadArr['temperature'] = 0.3;
        $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);
        $ch = curl_init('https://api.openai.com/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
            ],
            CURLOPT_TIMEOUT        => 120,
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($resp === false) throw new RuntimeException("OpenAI curl 失敗: $err");
        if ($code !== 200) throw new RuntimeException("OpenAI HTTP $code: " . substr($resp, 0, 500));
        $data = json_decode($resp, true);
        $content = $data['choices'][0]['message']['content'] ?? '';
        if ($content === '') throw new RuntimeException('OpenAI 応答が空');
        $result = json_decode($content, true);
        if (!is_array($result)) throw new RuntimeException('JSON parse 失敗');
        $pdo->prepare("UPDATE resume_checks SET result_json = ?, status='done', finished_at=NOW() WHERE id = ?")
            ->execute([json_encode($result, JSON_UNESCAPED_UNICODE), $checkId]);
    } catch (Throwable $e) {
        try {
            $pdo->prepare("UPDATE resume_checks SET status='error', error_msg = ?, finished_at=NOW() WHERE id = ?")
                ->execute([mb_substr($e->getMessage(), 0, 500), $checkId]);
            // エラー時は課金を返金
            $stU = $pdo->prepare("SELECT user_id FROM resume_checks WHERE id = ?");
            $stU->execute([$checkId]);
            $uid = (int)$stU->fetchColumn();
            if ($uid > 0) {
                Ledger::transfer($pdo, 1, $uid, RESUME_CHECK_COST, 'refund', 'resume_check', $checkId, '原稿チェック失敗返金');
            }
        } catch (Throwable $_) {}
    }
}

const PAPER_REVIEW_COST = 10;       // 旧互換 (gpt-4.1 想定の標準料金)。 v774 #396 モデル別価格へ移行。
const PAPER_REVIEW_MODELS = [       // v774 #396 モデル別価格 (paper_translate と同じ軸)
    'gpt-4.1'    => 10,
    'gpt-5-mini' => 15,
    'gpt-5'      => 30,
    'o1'         => 50,
];
// v557 #211 拡張: 査読の評価軸を明示。貢献の妥当性 / 統計記述の漏れ / 論理の流れ / 章間の一気通貫性を徹底チェック。
const PAPER_REVIEW_DEFAULT_PROMPT = <<<PROMPT
あなたは HCI / CSCW 分野で 10 年以上のキャリアを持つ経験豊富な査読者です。与えられた PDF の論文を入念に読み、章立てを意識して日本語で要約し、続けて指定された会議基準で厳密な査読コメントを作ってください。返答は valid JSON のみ。説明文や markdown のコードフェンスは付けないこと。

【特に丁寧に検査するチェックリスト】
1. **貢献の妥当性**: 主張する貢献 (research contribution) が文献的に新規性があるか、関連研究との差分が明示されているか、「これまで誰も解決していなかった」と言える根拠があるか。過大な主張・水増しがないか。
2. **実験/統計の記述漏れ**: 参加者数 N / 被験者属性 / 倫理審査 / インフォームドコンセント / 報酬 / 環境 (機材・実験室・オンライン) / プレテスト / 統計手法 (検定の選択理由 / 効果量 / 多重比較補正 / 仮定検証) / 有意水準 / 信頼区間 / サンプルサイズ計算 / 欠損データ処理が漏れなく書かれているか。
3. **論理的なつながり**: 段落間 / 章間で「だから何?」が読者に伝わる接続詞・主張展開になっているか。唐突に新概念が出る箇所、結論が飛躍してる箇所がないか。
4. **背景 → 手法 → 実験 → 結果 → 議論の一気通貫性**:
   - 背景で挙げた問題が、手法で解決される設計になっているか
   - 手法で導入した要素が、実験で正しく評価されているか (条件設計 / 比較対象が適切か)
   - 実験結果が、議論・結論で元の問題に対する回答として一貫して整理されているか
   - もし途中で目的・手段・評価の軸がずれていたら明示すること
5. **仮説/問いと結果の対応**: Introduction で立てた仮説 (H1, H2,...) や RQ (RQ1, RQ2,...) が、 Results / Discussion で 1 つ 1 つ明示的に対応づけて議論されているか。立てた問いが結果で「答えられた / 答えられなかった」のどちらかが明確になっているか。
6. **用語・編集面の精査**:
   - 用語の一貫性 (同じ概念に対して異なる表記がないか、略語の初出での説明があるか)
   - 専門用語の説明不足 (会議の想定読者層を超える専門用語が定義なしで使われていないか)
   - 図表の参照 (全ての Figure / Table が本文中で言及されているか、言及だけで本文に説明がない図表はないか)
   - 参考文献の妥当性 (存在しなさそうな引用 / 著者名のタイポ / 年号の食い違い / フォーマット不一致がないか)

【strengths / weaknesses に書くべき粒度】
- 抽象的な感想 (「面白い」「意義深い」等) は避け、具体的な節 / 図 / 数値 / 主張を引用して指摘する
- weaknesses は「どう直せば accept に近づくか」の具体的な改稿案を 1 つずつ添える
- 漏れの指摘は「何が書かれていないか」を章名 + 段落付近で明示

【改稿案で安易に薦めてはいけないこと】
- 「N を増やせば良い」は簡単に書きがちだが、既に分析済の論文に対して N を追加すると **p-hacking (追加分析で偶然有意差が出るのを待つ行為) のリスク** がある。 N 増の提案をするなら、同時に **「事前登録 (pre-registration) を行った上で」 / 「効果量と検出力分析で必要 N を見積もった上で」** 等の安全策を添えること。
- 単一の追加分析だけでなく、 **複数の分析を組み合わせて提案** すること (例: 統計的検定だけでなく質的データのコーディング / 事例分析 / 探索的可視化を追加で提案)。

【実験を追加実施できないケースのための示唆】
- 査読者は「再実験せよ」一辺倒の指示を避け、 **代替案** を 1 つ以上添えること:
  - 既存データの別角度からの再分析 (例: subgroup analysis / mediating variable / 質的コーディング)
  - 既出公開データセットを使った補完的検証
  - 既存研究との比較メタ分析的議論
  - 制約として「これは現時点のスナップショット研究であり、後続研究に X を委ねる」と limitation 章で明示する戦略

【「こういう分析をすると強くなる」系の提案】
- 著者が見落としていそうな強化分析を必ず 1〜3 個アイテマイズ:
  - 例: 効果量の 95% CI、ベイズ係数、質的データの半構造化インタビュー追加、行動ログのヒートマップ可視化、学習曲線の time-series 分析、個人差を残差で説明、シミュレーション or 計算モデルでの検証など

【貢献の独立解釈 (GPT 視点)】
- 論文中で著者が主張する貢献 (Introduction の bullet "Our contributions are:" や Conclusion の要約) を一度脇に置き、 **GPT の独立した読解** として「この論文の貢献は本当のところ何か」を再列挙してください
- そのうえで:
  - 著者が主張する貢献 (author_claimed_contributions): 著者が明示的に書いている貢献リスト
  - GPT が読み取った貢献候補 (reviewer_perceived_contributions): 論文の中身から GPT が独立に解釈した「実質的な貢献」 1〜5 個
  - ギャップの説明 (contribution_gap_explanation): 「あなたの主張は X だが、私はこの論文の貢献は実は Y だと解釈する。理由は…」の自由記述。著者が見落としている可能性のある貢献や、逆に著者が過大主張している貢献の検証指摘
- 著者の主張と GPT の解釈が完全一致する場合はその旨を明示 (「両者一致、貢献の主張は妥当」等)

【主張が強すぎる文章 / 記述がおかしい文章のリライト提案】
- 過大主張 (「世界初」「決定的に」「絶対に」等)、論理飛躍、曖昧 (「効果的だった」を数値で支持していない)、矛盾、不適切な比較、で問題があれば
- rewrite_suggestions に以下の形で 1〜5 件アイテマイズ:
  {
    "original":             "問題のある原文 (原文ママ、引用句込み)",
    "original_ja":          "原文の日本語訳 (要約でなく訳)",
    "reason":               "なぜ問題か (過大主張 / 飛躍 / 曖昧 / 矛盾等)",
    "suggested_rewrite_en": "原文と同じ言語 (= 英語論文なら英語) での書き換え案",
    "suggested_rewrite_ja": "その書き換え案を日本語で訳したもの"
  }
- 例: 「世界初」 → 「To our knowledge, this is the first attempt in the field of ...」 + 「我々の知る限り、 ◯◯ の分野で最初の試みである」
- 例: 「効果的だった」 → 「Condition A reduced mean response time by X ms compared to B (p<.01, d=0.5), suggesting users tend to prefer A.」 + 「条件 A は B より平均反応時間が X ms 短く (p<.01, d=0.5)、ユーザーは A を好む傾向が示唆された」
- 旧フィールド名 (suggested_rewrite, original のみ) は後方互換で残しても OK だが、上記 5 フィールドを揃えることを優先
PROMPT;

function ai_paper_review_settings_get(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT custom_prompt, share_target_ids FROM user_paper_review_settings WHERE user_id = ?");
    $st->execute([$uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $shareIds = [];
    if (!empty($row['share_target_ids'])) {
        $tmp = json_decode($row['share_target_ids'], true);
        if (is_array($tmp)) $shareIds = array_values(array_map('intval', $tmp));
    }
    // 共有対象の表示名も付ける
    $shareUsers = [];
    if ($shareIds) {
        $place = implode(',', array_fill(0, count($shareIds), '?'));
        $stU = $pdo->prepare("SELECT id, display_name, avatar_url FROM users WHERE id IN ($place)");
        $stU->execute($shareIds);
        $shareUsers = array_map(fn($r) => [
            'id' => (int)$r['id'], 'display_name' => $r['display_name'], 'avatar_url' => $r['avatar_url'],
        ], $stU->fetchAll(PDO::FETCH_ASSOC));
    }
    json_response([
        'custom_prompt'    => $row['custom_prompt'] ?? '',
        'default_prompt'   => PAPER_REVIEW_DEFAULT_PROMPT,
        'share_target_ids' => $shareIds,
        'share_targets'    => $shareUsers,
        'cost_points'      => PAPER_REVIEW_COST,        // 旧互換
        'models'           => PAPER_REVIEW_MODELS,      // v774 #396
        'default_model'    => 'gpt-4.1',
    ]);
}

function ai_paper_review_settings_put(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $customPrompt = isset($body['custom_prompt']) ? trim((string)$body['custom_prompt']) : '';
    if (mb_strlen($customPrompt) > 4000) throw new ApiException('bad_request', 'prompt は 4000 文字まで', 400);
    if ($customPrompt === '') $customPrompt = null;
    $shareIds = $body['share_target_ids'] ?? [];
    if (!is_array($shareIds)) $shareIds = [];
    $shareIds = array_values(array_unique(array_map('intval', $shareIds)));
    $shareIds = array_filter($shareIds, fn($x) => $x > 0 && $x !== $uid);
    if (count($shareIds) > 30) throw new ApiException('bad_request', '共有対象は 30 名まで', 400);
    $pdo->prepare("INSERT INTO user_paper_review_settings (user_id, custom_prompt, share_target_ids)
                    VALUES (?,?,?)
                    ON DUPLICATE KEY UPDATE custom_prompt = VALUES(custom_prompt), share_target_ids = VALUES(share_target_ids)")
        ->execute([$uid, $customPrompt, json_encode(array_values($shareIds), JSON_UNESCAPED_UNICODE)]);
    json_response(['ok' => true]);
}

function ai_paper_review_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, share_token, pdf_name, target_venue, strictness, created_at
                          FROM paper_reviews WHERE user_id = ? ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; }
    unset($r);
    json_response(['items' => $rows]);
}

function ai_paper_review_get_shared(PDO $pdo, array $cfg, string $token): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT pr.id, pr.user_id, pr.pdf_name, pr.pdf_path, pr.target_venue, pr.strictness,
                                 pr.response_text, pr.response_pdf_path,
                                 pr.sections_json, pr.review_json, pr.created_at,
                                 pr.status, pr.error_msg,
                                 u.display_name AS author_name, u.avatar_url AS author_avatar
                            FROM paper_reviews pr JOIN users u ON u.id = pr.user_id
                           WHERE pr.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'review not found', 404);
    json_response([
        'id'           => (int)$row['id'],
        'author_id'    => (int)$row['user_id'],
        'author_name'  => $row['author_name'],
        'author_avatar'=> $row['author_avatar'],
        'pdf_name'     => $row['pdf_name'],
        'pdf_path'     => $row['pdf_path'],         // v795 アップロード元 PDF へのリンク
        'target_venue' => $row['target_venue'],
        'strictness'   => $row['strictness'],
        'response_text'=> $row['response_text'],    // v780 #404
        'response_pdf_path' => $row['response_pdf_path'],  // v795 回答 PDF
        'sections'     => json_decode($row['sections_json'] ?: '[]', true) ?: [],
        'review'       => json_decode($row['review_json'] ?: 'null', true),
        'status'       => $row['status'] ?? 'done',
        'error_msg'    => $row['error_msg'],
        'created_at'   => $row['created_at'],
    ]);
}

// v550 #206 論文章立て和訳要約 + 査読アプリ。
//   POST /api/ai/paper_review { text, target_venue?, strictness? }
//   text: 論文の本文 (英語 or 日本語、 〜 30000 文字)
//   target_venue: 「CHI」等。空なら HCI 系全般
//   strictness: 「緩め」「やや厳しめ」(default)「厳しめ」
//   返値: { sections: [{title, summary_ja}, ...], review: {decision, score, strengths,
//          weaknesses, comments_to_authors} }
function ai_paper_review(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    // v551 #206 OpenAI Files API + Chat Completions で PDF を直接読ませる方式。
    //   1. multipart/form-data の file を OpenAI Files API に upload (purpose=user_data)
    //   2. 返ってきた file_id を chat.completions の messages.content に
    //      {type:'file', file:{file_id}} で添付して GPT-4o に読ませる
    //   3. 査読 JSON を取得して返す
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'PDF を multipart/form-data でアップロードしてください', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要です', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmpPdf = $f['tmp_name'];
    $head = @file_get_contents($tmpPdf, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイルではありません', 400);

    $venue = trim((string)($_POST['target_venue'] ?? ''));
    if ($venue === '') $venue = 'HCI 系の国際会議 (CHI / UIST / IUI / DIS / CSCW など)';
    $strictness = (string)($_POST['strictness'] ?? 'やや厳しめ');
    if (!in_array($strictness, ['緩め', 'やや厳しめ', '厳しめ'], true)) $strictness = 'やや厳しめ';
    // v780 #404 オプション: 回答文 (rebuttal / response to reviewers)。与えられた場合は
    //   論文査読 + 回答妥当性評価モードになる。空なら従来通りの査読のみ。
    $responseText = trim((string)($_POST['response_text'] ?? ''));
    if (mb_strlen($responseText) > 20000) $responseText = mb_substr($responseText, 0, 20000);
    // v782 #379 回答文 PDF も同時に受け取れる。テキストと PDF 両方あるなら両方を GPT に渡す。
    $responsePdfTmp = null;
    $responsePdfName = null;
    if (isset($_FILES['response_pdf']) && is_uploaded_file($_FILES['response_pdf']['tmp_name'])) {
        $rf = $_FILES['response_pdf'];
        if ($rf['error'] === UPLOAD_ERR_OK) {
            if ($rf['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '回答 PDF は 30 MB まで', 400);
            $rhead = @file_get_contents($rf['tmp_name'], false, null, 0, 5);
            if ($rhead !== '%PDF-') throw new ApiException('bad_request', '回答 PDF は PDF ファイルを指定してください', 400);
            $responsePdfTmp  = $rf['tmp_name'];
            $responsePdfName = (string)($rf['name'] ?? 'rebuttal.pdf');
        }
    }
    $hasResponse = $responseText !== '' || $responsePdfTmp !== null;

    // v552 #211 #212 ユーザー設定 (custom_prompt + share_target_ids) を取得
    $stS = $pdo->prepare("SELECT custom_prompt, share_target_ids FROM user_paper_review_settings WHERE user_id = ?");
    $stS->execute([$uid]);
    $settings = $stS->fetch(PDO::FETCH_ASSOC) ?: [];
    $customPrompt = trim((string)($settings['custom_prompt'] ?? ''));
    $shareIds = [];
    if (!empty($settings['share_target_ids'])) {
        $tmp = json_decode($settings['share_target_ids'], true);
        if (is_array($tmp)) $shareIds = array_values(array_map('intval', $tmp));
    }
    $shareIds = array_filter($shareIds, fn($x) => $x > 0 && $x !== $uid);

    // v774 #396 モデル選択 + 動的価格 (default gpt-4.1)
    $reqModel = trim((string)($_POST['model'] ?? 'gpt-4.1'));
    if (!isset(PAPER_REVIEW_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $reviewCost = (int)PAPER_REVIEW_MODELS[$reqModel];

    // 残高チェック (旧 PAPER_REVIEW_COST → 動的 $reviewCost)
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $reviewCost) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足です (要 %d pt、現在 %d pt)', $reviewCost, $bal), 400);
    }

    // v557 #211 非同期化: PDF を OpenAI に upload → record を pending で保存 +
    //   即座にクライアントに share_token を返す。 GPT への chat.completions 呼出は
    //   fastcgi_finish_request() でクライアント切断後にバックグラウンド実行。
    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // v795 アップロードされた PDF をサーバにも保存 (結果ページからリンクで開けるように)。
    //   token がこのあと生成されるので先に作って流用する。
    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pdfRel = '/uploads/paper_reviews/' . $token . '/original.pdf';
    $pdfAbs = $publicDir . $pdfRel;
    @mkdir(dirname($pdfAbs), 0775, true);
    if (!copy($tmpPdf, $pdfAbs)) {
        fwrite(STDERR, "[paper_review] failed to save PDF locally: $pdfAbs\n");
        $pdfRel = null;
    } else {
        @chmod($pdfAbs, 0644);
    }
    // 回答 PDF も同じように保存
    $responsePdfRel = null;
    if ($responsePdfTmp !== null) {
        $responsePdfRel = '/uploads/paper_reviews/' . $token . '/response.pdf';
        $responsePdfAbs = $publicDir . $responsePdfRel;
        if (!copy($responsePdfTmp, $responsePdfAbs)) {
            fwrite(STDERR, "[paper_review] failed to save response PDF: $responsePdfAbs\n");
            $responsePdfRel = null;
        } else {
            @chmod($responsePdfAbs, 0644);
        }
    }

    $basePrompt = $customPrompt !== '' ? $customPrompt : PAPER_REVIEW_DEFAULT_PROMPT;
    $sys = $basePrompt .
           "\n\n査読の厳しさは {$strictness} で、ターゲット会議は {$venue} を想定。";
    if ($hasResponse) {
        // v780 #404 回答文があるときは「査読 + 回答評価」モード
        // v782 #379 PDF と text 両方ある場合も同モード。 PDF は file_id で添付、 text は user prompt に埋め込み
        $sys .= "\n\n【回答文評価モード】\n"
              . "この依頼には著者からの回答文 (rebuttal / 査読コメントへの反論・返答) が添えられています。\n"
              . "通常の査読に加え、以下を評価してください:\n"
              . "(1) 回答内容が査読で指摘するべき主要な弱み / 記述漏れ / 論理飛躍をカバーしているか\n"
              . "(2) 回答の主張が論文本文と矛盾していないか (回答で「分析し直した」と書いてあるが本文が古いままのような不整合を検出)\n"
              . "(3) 回答が「N を増やすだけ」「再実験するだけ」で終わっているなど安直な対応ではないか (代替分析や限界明示への言及を重視)\n"
              . "(4) 回答の文章自体に過大主張 / 曖昧 / 矛盾がないか\n"
              . "(5) 査読で上げた改稿案に対して回答が過不足なく対応できているか (上記 weaknesses と突き合わせ)\n"
              . "出力 JSON に新規フィールド「response_evaluation」を追加すること (詳細は user 指示のスキーマ参照)。";
    }
    $userPrompt = "添付した PDF の論文を章立て (Abstract / Introduction / Related Work / Method / Results / Discussion / Conclusion など) を意識して 1〜2 段落ずつ日本語で要約し、続けて査読コメントを作ってください。\n\n"
        . "system prompt のチェックリスト 4 項目 (貢献の妥当性 / 実験統計記述漏れ / 論理的つながり / 背景〜結論一気通貫性) を必ず網羅し、整合性チェックの結果は consistency_check に 4 項目別で残してください。\n\n"
        . "出力 JSON スキーマ:\n"
        . "{ \"sections\": [{\"title\": \"章タイトル\", \"summary_ja\": \"1〜2 段落の和訳要約\"}, ...],\n"
        . "  \"review\": {\n"
        . "    \"decision\": \"Strong Accept / Accept / Weak Accept / Borderline / Weak Reject / Reject / Strong Reject\",\n"
        . "    \"score\": 1-5 の整数,\n"
        . "    \"summary_one_line\": \"査読要約 1 行\",\n"
        . "    \"contribution_validity\": \"貢献の妥当性に関する評価 (100-300 字)\",\n"
        . "    \"author_claimed_contributions\": [\"著者が論文中で明示的に主張する貢献 (1 件ずつ)\", ...],\n"
        . "    \"reviewer_perceived_contributions\": [\"GPT が論文を読んで独立に解釈した『実質的な貢献』 1〜5 件\", ...],\n"
        . "    \"contribution_gap_explanation\": \"著者主張 ⇔ GPT 解釈のギャップ。一致なら『両者一致』。ズレがあるなら『あなたの主張は X だが、私はこの論文の貢献は実は Y だと解釈する。理由は…』を 200-500 字で自由記述\",\n"
        . "    \"missing_descriptions\": [\"漏れている記述項目 (章名 + 該当箇所込み)\", ...],\n"
        . "    \"logical_flow\": \"論理的なつながりの評価、飛躍箇所の指摘 (100-300 字)\",\n"
        . "    \"consistency_check\": {\n"
        . "       \"background_to_method\": \"背景→手法が繋がっているか\",\n"
        . "       \"method_to_experiment\": \"手法→実験が繋がっているか\",\n"
        . "       \"experiment_to_result\": \"実験→結果が繋がっているか\",\n"
        . "       \"result_to_discussion\": \"結果→議論→結論が繋がっているか\"\n"
        . "    },\n"
        . "    \"hypothesis_vs_results\": \"立てた仮説/RQ ⇔ 結果の対応評価。答えが出てない問いがあれば指摘\",\n"
        . "    \"editorial_check\": {\n"
        . "      \"terminology_consistency\": \"用語の一貫性、略語初出説明\",\n"
        . "      \"jargon_explanation\": \"専門用語の説明不足 (会議の想定読者層を超えるもの)\",\n"
        . "      \"figure_table_references\": \"全ての Figure / Table が本文で言及・説明されているか\",\n"
        . "      \"references_validity\": \"存在しなさそうな引用 / typo / 年号食い違い / フォーマットの不一致\"\n"
        . "    },\n"
        . "    \"strengths\": [\"具体的な強み (節/数値/主張を引用)\", ...],\n"
        . "    \"weaknesses\": [\"具体的な弱み + 直すべき改稿案\", ...],\n"
        . "    \"strengthening_analyses\": [\"こういう追加分析をすると強くなる、という提案 (1〜3 個、効果量CI / 質的補完 / シミュレーション等の具体例)\", ...],\n"
        . "    \"alternatives_when_no_reexp\": [\"追加実験ができない場合の代替案 (既存データ再分析 / 公開データ補完 / limitation 明示等)\", ...],\n"
        . "    \"rewrite_suggestions\": [{\"original\":\"主張が強すぎる or 記述がおかしい原文 (節 + 引用)\", \"original_ja\":\"原文の日本語訳\", \"reason\":\"なぜ問題か (過大主張 / 飛躍 / 曖昧 / 矛盾等)\", \"suggested_rewrite_en\":\"原文と同じ言語での書き換え案 (英語論文なら英語)\", \"suggested_rewrite_ja\":\"その書き換え案の日本語訳\"}, ...],\n"
        . "    \"revision_to_accept\": [\"採録に導くために必要な修正を優先度順にアイテマイズ (具体的 / 実行可能、ただし「N を増やす」系は p-hacking リスクを添える)\", ...],\n"
        . "    \"comments_to_authors\": \"著者への総合コメント (400〜800 文字)\",\n"
        . ($hasResponse
            ? "    \"response_evaluation\": {\n"
              . "      \"overall_assessment\": \"回答全体の妥当性評価 (200〜500 字)。査読指摘に対して過不足なく対応できているか、安直な「N 増 / 再実験」で流していないか、論文本文と矛盾がないかを含めて\",\n"
              . "      \"covered_points\":      [\"回答が良く対応できている指摘 (1 件ずつ)\", ...],\n"
              . "      \"missing_points\":      [\"査読で指摘すべきにもかかわらず回答が触れていない / 不十分な論点 (1 件ずつ + どう補強するかの助言)\", ...],\n"
              . "      \"inconsistencies\":     [\"回答と論文本文 / 数値 / 主張との矛盾点 (具体引用 + どことどこが矛盾か)\", ...],\n"
              . "      \"weak_arguments\":      [\"回答中で主張が弱い / 曖昧 / 飛躍している箇所 (引用 + 改善案)\", ...],\n"
              . "      \"recommended_revisions_to_response\": [\"回答文自体をこう書き換えると査読者を説得しやすい、という具体提案 1〜5 件\", ...]\n"
              . "    },\n"
            : ""
          )
        . "    \"confidence\": 1-5 の整数 (査読者の自信)\n"
        . "  }\n"
        . "}";
    if ($responseText !== '') {
        $userPrompt .= "\n\n【著者からの回答文 (テキスト)】 (これを評価して response_evaluation に入れる)\n\n"
                     . "------ ここから回答文 ------\n"
                     . $responseText . "\n"
                     . "------ ここまで ------\n";
    }
    if ($responsePdfTmp !== null) {
        $userPrompt .= "\n\n【著者からの回答文 PDF】が添付されています (2 つめの PDF ファイルとして)。 1 つめが論文本体、 2 つめが回答文 PDF。両方を読んで、 response_evaluation を作ってください。\n";
    }

    // v774 #396 #397 ユーザが選んだモデルを使う。推論モデルは temperature 非対応
    // v782 #379 回答 PDF があるなら OpenAI Files API にもアップ → 2 つめの file content として添付
    $responseFileId = null;
    if ($responsePdfTmp !== null) {
        try {
            $responseFileId = ai_openai_upload_pdf($responsePdfTmp, $responsePdfName, $apiKey);
        } catch (Throwable $e) {
            // 失敗しても査読本体は続行 (text の回答だけで動くケース)
            $responseFileId = null;
            fwrite(STDERR, "[paper_review] response_pdf upload failed: " . $e->getMessage() . "\n");
        }
    }
    $userContent = [
        ['type' => 'file', 'file' => ['file_id' => $fileId]],
    ];
    if ($responseFileId !== null) {
        $userContent[] = ['type' => 'file', 'file' => ['file_id' => $responseFileId]];
    }
    $userContent[] = ['type' => 'text', 'text' => $userPrompt];

    $model = $reqModel;
    $payloadArr = [
        'model' => $model,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => $userContent],
        ],
        'response_format' => ['type' => 'json_object'],
        // v919 fb#468 gpt-5 で 「empty content」 で 失敗 の 報告。 gpt-5 / o1 は 推論トークン が
        //   max_completion_tokens に 食い込む ので、 8000 だと 査読本文 を 吐く 前に 打ち切られる。
        //   paper_translate と 同じ 24000 に 引き上げ。
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $model)) {
        $payloadArr['temperature'] = 0.3;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    // v557 #211 非同期: pending レコード作成 + 課金 → 即 share_token 返却 →
    //   fastcgi_finish_request() でクライアント切断 → 裏で OpenAI chat 呼出 → 結果更新
    // v795 token は前段で PDF 保存用に生成済 (= ここで再生成しない)
    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $reviewId = 0;
    // v782 #379 response_text に PDF 添付マーカを追加 (UI で「PDF 添付されました」と出す)
    $responseTextForDb = $responseText !== '' ? $responseText : null;
    if ($responsePdfTmp !== null) {
        $pdfMarker = "📎 [回答 PDF 添付: " . $responsePdfName . "]";
        $responseTextForDb = $responseTextForDb === null ? $pdfMarker : $pdfMarker . "\n\n" . $responseTextForDb;
    }
    db_tx($pdo, function () use ($pdo, $uid, $token, $fileId, $pdfName, $pdfRel, $venue, $strictness, $responseTextForDb, $responsePdfRel, $sys, $reviewCost, &$reviewId) {
        $pdo->prepare("INSERT INTO paper_reviews
            (user_id, share_token, file_id, pdf_name, pdf_path, target_venue, strictness, response_text, response_pdf_path, prompt_used,
             sections_json, review_json, cost_points, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')")
            ->execute([
                $uid, $token, $fileId, mb_substr($pdfName, 0, 255), $pdfRel, $venue, $strictness,
                $responseTextForDb, $responsePdfRel, $sys,
                '[]', 'null', $reviewCost,
            ]);
        $reviewId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $reviewCost, 'paper_review', 'paper_review', $reviewId, '論文査読依頼料');
    });

    // 早期レスポンス
    json_response_no_exit([
        'ok'           => true,
        'id'           => $reviewId,
        'share_token'  => $token,
        'venue'        => $venue,
        'strictness'   => $strictness,
        'status'       => 'pending',
        'cost_points'  => $reviewCost,
        'model'        => $reqModel,
        'shared_count' => count($shareIds),
        'message'      => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が査読中… (2-5 分)。結果ページを開いておくか、後で /#/paper-review/r/' . $token . ' を確認してください。',
    ]);
    // クライアント切断 → バックグラウンド継続
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    // 裏で OpenAI を呼ぶ
    ai_paper_review_run_background($pdo, $cfg, $reviewId, $token, $fileId, $payload, $apiKey, $pdfName, $shareIds, $uid, $responseFileId);
}

// 早期レスポンス用: json_response と同じ JSON を出力するが exit しない
function json_response_no_exit($data): void {
    if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function ai_paper_review_run_background(PDO $pdo, array $cfg, int $reviewId, string $token, string $fileId, string $payload, string $apiKey, string $pdfName, array $shareIds, int $uid, ?string $responseFileId = null): void {
    try {
        $pdo->prepare("UPDATE paper_reviews SET status='processing' WHERE id = ?")->execute([$reviewId]);
        $ch = curl_init('https://api.openai.com/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 300,
        ]);
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        ai_openai_delete_file($fileId, $apiKey);
        if ($responseFileId !== null) {
            try { ai_openai_delete_file($responseFileId, $apiKey); } catch (Throwable $_) {}
        }

        if ($resp === false || $status >= 400) {
            $errMsg = '';
            if ($resp !== false) {
                $errJ = json_decode((string)$resp, true);
                $errMsg = $errJ['error']['message'] ?? '';
            }
            throw new RuntimeException('OpenAI: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''));
        }
        $j = json_decode((string)$resp, true);
        $content = $j['choices'][0]['message']['content'] ?? null;
        if (!is_string($content) || $content === '') {
            // v919 fb#468 デバッグ 目的 で finish_reason と usage を エラー文 に 含める
            //   (「length で 打ち切り」 が 明示 されれば すぐ max_completion_tokens 不足 と 分かる)。
            $finish = $j['choices'][0]['finish_reason'] ?? 'unknown';
            $usage = $j['usage'] ?? [];
            $totalT = (int)($usage['total_tokens'] ?? 0);
            $reasonT = (int)(($usage['completion_tokens_details']['reasoning_tokens'] ?? 0));
            throw new RuntimeException("empty content (finish={$finish}, total={$totalT}, reasoning={$reasonT})");
        }
        $parsed = json_decode($content, true);
        if (!is_array($parsed)) throw new RuntimeException('invalid JSON');

        $sections = $parsed['sections'] ?? [];
        $review   = $parsed['review']   ?? null;
        $pdo->prepare("UPDATE paper_reviews SET sections_json = ?, review_json = ?, status='done' WHERE id = ?")
            ->execute([
                json_encode($sections, JSON_UNESCAPED_UNICODE),
                json_encode($review, JSON_UNESCAPED_UNICODE),
                $reviewId,
            ]);

        // 投稿者に完了通知
        try {
            $shortTitle = !empty($sections[0]['title']) ? mb_substr((string)$sections[0]['title'], 0, 60) : $pdfName;
            $decision = is_array($review) ? (string)($review['decision'] ?? '') : '';
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "✅ 査読完了: 「{$shortTitle}」 " . ($decision ? "({$decision})" : "") . " /#/paper-review/r/{$token}",
                'paper_review', $reviewId);
        } catch (Throwable $_) {}
        // 共有対象通知
        if ($shareIds) {
            $stN = $pdo->prepare("SELECT display_name FROM users WHERE id = ?");
            $stN->execute([$uid]);
            $authorName = (string)$stN->fetchColumn();
            $shortTitle = !empty($sections[0]['title']) ? mb_substr((string)$sections[0]['title'], 0, 60) : $pdfName;
            $decision = is_array($review) ? (string)($review['decision'] ?? '') : '';
            foreach ($shareIds as $tid) {
                try {
                    notify_safely($pdo, $cfg, (int)$tid, 'admin_notice',
                        "📄 {$authorName} が査読しました: 「{$shortTitle}」 " . ($decision ? "({$decision})" : "") . " /#/paper-review/r/{$token}",
                        'paper_review', $reviewId);
                } catch (Throwable $_) {}
            }
        }
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE paper_reviews SET status='error', error_msg = ? WHERE id = ?")
            ->execute([mb_substr($e->getMessage(), 0, 500), $reviewId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ 査読失敗: " . $e->getMessage() . " /#/paper-review/r/{$token}",
                'paper_review', $reviewId);
        } catch (Throwable $_) {}
    }
}

// ─────────────────────────────────────────────────────────────
// v748 #359 #360 #361 論文和訳要約 (落合メソッド + 図表ピックアップ + 20pt)
// ─────────────────────────────────────────────────────────────
const PAPER_TRANSLATE_COST = 20;

// v914 「非共有=基本額、 共有=半額」 モデル (v913 の 「共有=基本額 / 非共有=倍額」 を 数式は 同じ ratio に 保ったまま
//   ポジティブな フレーミングに 言い換え + 実価格 も 半減)。 論文要約 / 全訳 / DeepResearch 共通。
//   研究成果を ラボ 全体に還元してくれるなら 半額 に なる、 という 前向きな 表現。 base = モデル定数 (表示価格 = 非共有 の 価格)。
function _ai_share_priced_cost(int $baseCost, bool $willShare): int {
    return $willShare ? intdiv($baseCost, 2) : $baseCost;
}

// v773 #395 モデル一覧を整理。 gpt-4o-mini / gpt-4o は 200-300 字の短い要約しか
//   出さないので論文要約用途では失格 → 削除。真面目に要約するなら最低でも 4.1。
// v808 #403 価格調整 + デフォルトを gpt-5 に。
const PAPER_TRANSLATE_MODELS = [
    'gpt-4.1'     => 20,   // 軽量 (短めになりがち)
    'gpt-5-mini'  => 30,   // 5 系軽量
    'gpt-5'       => 50,   // 5 系標準 (デフォルト、高品質)
    'o1'          => 80,   // o1 推論モデル (深い解析)
];

const PAPER_TRANSLATE_DEFAULT_PROMPT = <<<'PROMPT'
あなたは研究論文を日本語で要約するアシスタントです。

# 最重要ルール (これを守れない出力はダメ)

**detailed_sections の各節の body は 600-1000 字を目標。 500 字未満は短すぎ、
350 字で終わらせるのはダメ。短すぎるのも冗長も避け、「論文の章を読んだ感」
がしっかり残る適度な厚みで書く。**

単純な機械翻訳ではなく、「研究論文として何が書かれているか」を強く意識して、
以下の順番で構造化した詳細な和訳要約を作ってください。全体で 6000-12000 字程度を目指す。

# 出力順番 (= 読者が上から下へ読み進める順番)

1. summary_one_paragraph: 1 段落 (300-500 字) の「まずこれだけ読めば概要が分かる」全体要約
2. rq_hypothesis: 著者が立てたリサーチクエスチョン (RQ) と仮説、そしてそれぞれに対して
   論文全体から読み取れる「示唆」 (= こう言える / こう解釈できる / 部分的にこうだなど) を
   必ず整理。「結果」と断定せず、論文が示唆する内容として書くこと
3. contributions: 著者が「成し遂げた / 明らかにした」ことを **完了形 / 名詞句** で列挙。
   例: × 「説得理論を統合する」 / × 「消費者の対処プロセスの理解を深める」
       ○ 「説得理論を統合した」 / ○ 「消費者の対処プロセスを明らかにした」
   動詞形 / 目的句 (= 「○○ すること」) ではなく、「○○ した」「○○ を提示した」と書く
4. detailed_sections: 論文の **実際の章構成をそのまま反映** した章立て要約を作る。
   論文内で章タイトル (Abstract / Introduction / Background / Related Work / Theory /
   Method / Experiment N / Results / Discussion / Conclusion 等) が明示されているなら、
   そのタイトルを heading にそのまま採用 (日本語訳 + 必要なら原題併記)。章が細かく
   分かれているなら 5-9 個で構成、各節 600-1000 字で 2-3 段落に分けて丁寧に要約する。
   ・ 1 章を 1 段落で雑に終わらせない (= 元論文が 1 章で説明している量を 1 段落
     に圧縮するのはダメ)
   ・著者の主張 / 数値 / 用語 / 図表への言及 / 引用文献名等を残す
   ・論文の章順に並べる (時系列 / 論理を入れ替えない)
   ・機械翻訳ぽい短文ではなく、「研究ノートを取った上で自分の言葉で説明」する立場で書く
   重要な図や表は figure_refs で引用し、ページ番号 + page_region (top/middle/bottom/full)
   + キャプションの和訳 + なぜ重要かを添える
5. experiments: 論文が行った実験 / 調査を「**実験N: 何を測った / 何を操作した /
   被験者 N=◯◯ / 期間 / 統制群等**」形式で列挙。 **必ず「実験1:」「実験2:」… の prefix
   で始める** (論文原文が「Study 1」「研究1」と書いていても、出力は「実験1:」に統一
   する。 UI 側で「実験1: 実験の内容」と「実験1 の結果」をペアで表示するため、 prefix
   が揃っていないとペアリング失敗する)。 **自前の実験がない理論 / レビュー論文
   でも、本文で引用した実証研究の中から「この論文の主張を支える」ものを 3-7 件
   ピックして同形式で列挙する**: 「(引用) Smith et al. 1989 の実験: 大学生 N=120 に
   広告を 5 種類提示し、説得意図認識と態度変化を測定」等。配列を空にするのは
   「論文全体で実証研究への言及が一切ない」純理論論文のみ。 PKM のような理論
   論文でも、関連する実証研究を必ず整理すること。
6. results_summary: 上の実験で「何が分かったか」を数値 / 効果量 / d / r / p値 /
   信頼区間込みで整理。 **自前実験の結果は必ず「実験1:」「実験2:」… の prefix で始める**
   (experiments と同じ番号を使うこと。 UI 側で「実験1」同士をペアにする)。例:
   「実験1: 役割×アクセス可能性の交互作用有意 (F(1,89)=4.71, p<.03)、低アクセスで標的 M=5.15 vs
   観察者 M=4.41、高アクセスで差なし」「実験1 (引用 Smith et al.): 説得意図認識群は統制群比で
   態度変化が 25% 少 (d=0.4, p<.01)」。引用研究の結果含む。該当なしなら空配列だが、
   experiments とセットで並ぶことがほぼ必須。
7. future_work: 著者が示した今後の課題 + 読者観点で自然に追加した方が良い課題
8. key_references: 参考文献の中で「この論文を理解する上で特に重要、読者も抑え
   ておくべき」ものを **必ず 3-7 件** ピックアップ (1 件や 2 件で済ませない、引用文献
   が多い論文ほどこの整理が価値を持つ)
9. ochiai_method: 最後に落合陽一メソッドの 6 項目で全体を重ね合わせてまとめる

# detailed_sections の中身

論文の流れに沿って 4-7 個の節を作ってください。各節:
- heading: 節タイトル (例: 「背景と動機」「提案手法: XX」「実験設定」「結果と考察」)
- body: 節本文の和訳要約 (**600-1000 字、必ず 2-3 段落に分けて構造化**、
  数値 / 用語 / 手法名 / 著者主張 / 実験設定 / 結果数字を残す。 1 段落 300-500 字を
  目安、各章を「研究ノートを取った上で自分の言葉で丁寧に説明」したレベルに。
  元論文で 1 章が説明している内容を 1 段落に圧縮するな (= 章が厚いなら要約も
  厚く)。機械翻訳の短いまとめや箇条書き風の詰め込みはダメ、段落で論理をつなげて
  書く。文字数が少ないのはその章を軽視している証拠と思え)
- figure_refs: その節で言及する重要な図 / 表を厳選して入れる (各節 0-2 件、全節
  合計で最大 3 件まで)。優先するのは「提案手法の中核を示す図」と「主たる
  結果の図 / 表 (=効果量 / 比較表 / プロット)」。補助的な図 (背景イラスト等) は省く。
  page は PDF の物理ページ番号 (1 始まり) を正確に入れること (= サーバでページ画像を
  紐付けるので必須)。 page_region はその図 / 表の中心がページを縦 3 等分したうち
  どこにあるかを厳密に答える: ページ上 1/3 内なら "top"、中央 1/3 内なら "middle"、
  下 1/3 内なら "bottom"。図や表がページの大半を占める / 跨いでいる / 判断が
  不確かなときは "full" にする (= 全ページをそのまま表示)。

  **重要**: 「Figure N は page X の region Y」と書いたなら、本当にその page のその
  region に **絵 / グラフ / 表が視覚的に存在すること** を自分で再確認する。文章
  だけの領域を指してはダメ。視覚的な図や表が見つからないならその figure_refs
  自体を出さない (= 配列から除外)。不確かなら region を "full" にする。「キャプションが
  下だから bottom」等の短絡をしない、図の本体がある位置で判定する。

  **必須フィールド**: visual_content — 「この図 / 表に視覚的に何が描かれているか」
  を 50-150 字で具体的に説明する。例: 「3 つのボックス (消費者 / 説得者 / 文脈) と矢印
  で構成されたフロー図」「3 列 × 5 行の比較表、行は各条件、列は反応時間 / エラー率 /
  満足度」「散布図、 x軸は訓練時間、 y軸は正答率」等、実際に PDF を見た人にしか書け
  ない具体性で書くこと。「説得知識モデルの図」等タイトルの焼き直しは不可。 visual_content が
  書けないなら、その figure_refs を出さない (= PDF を見ていない証拠)。

# トーン
・ **内容をそのまま要約する立場で書く**。「論文では ◯◯ と主張している」「著者は
  ◯◯ と説明している」「論文では ◯◯ と述べている」等の **メタ解説** は排除する。
  「◯◯ である」「◯◯ が生じる」と直接書く。
  例: × 「論文では、消費者が説得知識を発展させると主張している」
      ○ 「消費者は経験と観察を通じて説得知識を発展させる」
  例: × 「著者は PKM が 3 つの知識から成ると説明している」
      ○ 「PKM は 3 つの知識 (トピック / 説得 / エージェント) から成る」
・略語は初出でフルスペル + 日本語訳を添える
・数値 (実験 N、効果量、 p 値) は落とさず残す
・例外: ハルシネーション回避のため自分で推測を加える場合のみ「ここから推測すると…」
  と明示する (= 著者の主張と自分の解釈を区別)

# **自然で読みやすい日本語で書く** (v777 で強化)

文章を「論文用語を直訳して並べたもの」ではなく、「人に説明するつもりで
書いた読みやすい日本語」にすること。学術直訳調 / 名詞止め / 機械的連結を避ける。

× 名詞止めにせず、述語で終える:
  × 「認知容量は動機が低アクセスのときに決定的に働く示唆」
  ○ 「認知容量は、動機が低アクセスのときに決定的に働くことを示唆する」
  × 「忙しい標的は観察者より動機推論を行わず、販売員を誠実と捉える傾向が示唆」
  ○ 「忙しいときは、観察者ほど動機推論をしないため、販売員を誠実と捉えやすい」

× 概念用語をそのまま並べた翻訳調の質問文はダメ。 RQ や仮説は「具体的な
  シーンが思い浮かぶような自然な文」に言い換える:
  × 「消費者はどの条件で販売員の行動に潜在的な説得動機を帰属し、説得知識を用いるか?」
  ○ 「消費者はどんなときに販売員の行動を『売りたくてやっている』と受け取り、
       説得知識を働かせて警戒するのだろうか?」
  × 「認知容量 (標的 / 観察者、二重課題) は説得知識の使用にどう影響するか?」
  ○ 「会話に集中して余裕がない立場 (標的) と、落ち着いて見ている立場 (観察者) で、
       説得知識の使い方はどう変わるのか?」

× 「示唆」「帰属」「想起容易性」「アクセス可能性」など、専門用語をそのまま並べるだけ
  にせず、必要なら補足説明や平易な言い換えを添える (専門用語完全排除はしない、
  論文用語 + 平易説明のセットが望ましい):
  × 「動機の想起容易性が効果を調整する」
  ○ 「動機 (販売員が売りたがっていること) が思い浮かびやすいかどうかで、効果が変わる」

文章を 1 度書いた後、「これ、同僚に読み上げて自然に響くか?」と自分で読み返し、
不自然な直訳調 / 名詞止め / 助詞の抜け / 同じ述語 (「示す」「した」「である」) の
3 連発があれば言い換えてから JSON を出すこと。
・ **日本語の文章中に不要な半角スペースを絶対に入れないこと**。 system prompt
  のこの説明文は読みやすさのため「どんなもの」のようなスペース入り表記を
  使っているが、これは説明文の都合で、出力する JSON の値 (= 読者に見せる文章)
  では普通の日本語表記 = 「どんなもの」「研究の動機」で書いてください。
  英数字 / 記号と日本語の境界だけ半角スペース入れて OK (例: 「PDF を読む」はOK、
  「日本語」や「説明」はダメ)

# ハルシネーション防止 (重要)

各セクションを書く前に、 PDF の該当箇所を必ず確認してください。
書いた後も、数値 / 用語 / 著者が主張した内容 / 引用 / 結果 / 著者名 / 会議名等が
PDF の記述と一致しているか自分で再精査し、ズレがあれば修正してから
JSON を出力してください。「PDF にそう書かれているか怪しいが文脈上推測する」
部分は「論文からの推測」と明示すること。創作 / 拡大解釈は厳禁です。
PDF に書かれていない数値や主張を補完しない。

# 出力 JSON スキーマ

{
  "title_ja": "論文タイトルの日本語訳 (副題も)",
  "title_orig": "原題",
  "authors": "著者名 (代表 3 名まで + et al.)",
  "venue": "発表会議 / ジャーナル + 年",
  "summary_one_paragraph": "1 段落 (300-500 字) の全体サマリ",
  "rq_hypothesis": {
    "research_questions": [
      { "rq": "RQ: 質問文 (RQ が複数ある場合は「RQ1:」「RQ2:」)",
        "answer": "論文から読み取れる示唆 (例: 「平均反応時間が X ms 短縮されたことから、 …と言える」等、断定せず示唆として書く)" }
    ],
    "hypotheses": [
      { "hypothesis": "H: 仮説文 (仮説が複数ある場合は「H1:」「H2:」)",
        "result":     "示唆: 支持 / 棄却 / 部分支持 + 具体的な根拠 (数値 / 効果量 / p 値)、論文が何を示唆しているかの視点で書く" }
    ]
  },
  "contributions": ["著者が主張する貢献 1", "貢献 2"],
  "detailed_sections": [
    {
      "heading": "節タイトル",
      "body":    "節本文の和訳要約 (500-900 字、必要なら段落分け)",
      "figure_refs": [
        { "label": "Figure 2", "page": 3, "page_region": "top",
          "caption_ja": "図 / 表キャプションの和訳",
          "visual_content": "視覚的に何が描かれているかの具体的説明 (50-150 字、必須)",
          "why_important": "なぜ重要か (50-150 字)" }
      ]
    }
  ],
  "experiments": [
    "(引用) Smith et al. 1989 の実験: 大学生 N=120 に広告 5 種類を提示し、広告への説得意図認識度とその後の態度変化を測定 (要因内比較、性別を統制変数)。操作: 説得意図を明示する文言の有無。"
  ],
  "results_summary": [
    "(引用 Smith et al.) 説得意図を認識した群は統制群比で態度変化が 25% 少 (d=0.4, p<.01)。説得知識が抵抗力を高める証拠。"
  ],
  "future_work":   ["著者が示す今後の課題 1", "(読者観点) 追加課題 1"],
  "key_references": [
    { "citation":      "[12] や Smith et al. 2024 など本文で参照されている表記",
      "title_orig":    "参考文献の原題 (英語など原文ママ)",
      "title_ja":      "原題の日本語訳 (短く意訳で OK)",
      "why_important": "この論文の主張を理解する上でなぜ必読か (50-150 字)" }
  ],
  "ochiai_method": {
    "what":          "値は説明本文のみ。「1. どんなもの?」等の番号 / 設問を先頭に入れない (200-400 字)",
    "vs_prior_work": "値は説明本文のみ (200-400 字)",
    "key_method":    "値は説明本文のみ (200-400 字)",
    "validation":    "値は説明本文のみ (200-400 字)",
    "discussion":    "値は説明本文のみ (100-300 字)",
    "next_papers":   ["タイトル + 1 行説明 (各文字列)"]
  }
}

JSON 以外の前置きや解説は不要。 JSON のみを返却。
PROMPT;

function ai_paper_translate_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v841 #423 自分の履歴タイルにも原題 / 著者 / 投稿先 / summary snippet を返す
    $st = $pdo->prepare("SELECT id, share_token, pdf_name, result_json, status, is_shared, shared_at, created_at, finished_at
                          FROM paper_translates WHERE user_id = ? ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $title = null;
        $titleOrig = null;
        $authors = null;
        $venue = null;
        $summary = null;
        if (!empty($r['result_json'])) {
            $j = json_decode((string)$r['result_json'], true);
            if (is_array($j)) {
                $title = !empty($j['title_ja']) ? (string)$j['title_ja'] : null;
                $titleOrig = !empty($j['title_orig']) ? (string)$j['title_orig'] : (!empty($j['title_original']) ? (string)$j['title_original'] : null);
                $authors = !empty($j['authors']) ? (string)$j['authors'] : null;
                $venue = !empty($j['venue']) ? (string)$j['venue'] : null;
                $summary = !empty($j['summary_one_paragraph']) ? (string)$j['summary_one_paragraph'] : null;
            }
        }
        $rows[] = [
            'id'          => (int)$r['id'],
            'share_token' => $r['share_token'],
            'pdf_name'    => $r['pdf_name'],
            'title_ja'    => $title,
            'title_orig'  => $titleOrig,
            'authors'     => $authors,
            'venue'       => $venue,
            'summary_one_paragraph' => $summary,
            'status'      => $r['status'],
            'is_shared'   => (bool)$r['is_shared'],
            'shared_at'   => $r['shared_at'],
            'created_at'  => $r['created_at'],
            'finished_at' => $r['finished_at'],
        ];
    }
    ai_stars_enrich($pdo, 'paper_translate', $rows, $uid);
    ai_bookmarks_enrich($pdo, 'paper_translate', $rows, $uid);
    $sort = (string)($_GET['sort'] ?? '');
    $rows = ai_stars_apply_sort('paper_translate', $rows, $sort);
    json_response([
        'items'        => $rows,
        'cost_points'  => PAPER_TRANSLATE_COST,        // 旧互換
        'models'       => PAPER_TRANSLATE_MODELS,      // v755 #371 モデル別価格リスト
        'default_model'=> 'gpt-5',                     // v808 #403 デフォルトを gpt-5 (50pt) に
    ]);
}

// v756 #372 みんなの公開要約一覧 (is_shared=1)。 q= でキーワード部分一致検索 (pdf_name +
//   title_ja / title_orig / authors / venue / summary_one_paragraph)。
function ai_paper_translate_shared_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $myUid = (int)$u['id'];
    $q = trim((string)($_GET['q'] ?? ''));
    $args = [];
    $sql = "SELECT pt.id, pt.share_token, pt.pdf_name, pt.result_json, pt.status, pt.shared_at,
                   pt.created_at, pt.finished_at, pt.user_id,
                   u.display_name AS author_name, u.avatar_url AS author_avatar
              FROM paper_translates pt
              JOIN users u ON u.id = pt.user_id
             WHERE pt.is_shared = 1 AND pt.status = 'done'";
    if ($q !== '' && mb_strlen($q) <= 100) {
        // LIKE %q% 検索 (pdf_name + result_json 全体)。結果セットが小さい前提。
        $sql .= " AND (pt.pdf_name LIKE ? OR pt.result_json LIKE ?)";
        $args[] = '%' . $q . '%';
        $args[] = '%' . $q . '%';
    }
    $sql .= " ORDER BY pt.shared_at DESC LIMIT 100";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $result = json_decode($r['result_json'] ?: 'null', true);
        $items[] = [
            'id'                  => (int)$r['id'],
            'share_token'         => $r['share_token'],
            'pdf_name'            => $r['pdf_name'],
            'title_ja'            => is_array($result) ? ($result['title_ja']  ?? null) : null,
            'title_orig'          => is_array($result) ? ($result['title_orig']?? null) : null,
            'authors'             => is_array($result) ? ($result['authors']   ?? null) : null,
            'venue'               => is_array($result) ? ($result['venue']     ?? null) : null,
            'summary_one_paragraph' => is_array($result) ? ($result['summary_one_paragraph'] ?? null) : null,
            'shared_at'           => $r['shared_at'],
            'created_at'          => $r['created_at'],
            'author_id'           => (int)$r['user_id'],
            'author_name'         => $r['author_name'],
            'author_avatar'       => $r['author_avatar'],
        ];
    }
    ai_stars_enrich($pdo, 'paper_translate', $items, $myUid);
    ai_bookmarks_enrich($pdo, 'paper_translate', $items, $myUid);
    $sort = (string)($_GET['sort'] ?? '');
    $items = ai_stars_apply_sort('paper_translate', $items, $sort);
    json_response(['items' => $items, 'q' => $q]);
}

// v756 #372 共有 ON/OFF (本人のみ)。 body = { is_shared: bool }
// v913 共有=基本額 / 非共有=倍額 モデル: share_priced=1 の row は toggle 時に 差額を Ledger 経由 で 追加課金/返金 する。
function ai_paper_translate_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status, is_shared, share_priced, cost_points FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ共有切替可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '要約完了後のみ共有切替可', 400);
    $on = (bool)$body['is_shared'];
    _ai_apply_share_toggle_delta($pdo, 'paper_translates', 'paper_translate', $id, $uid, $row, $on);
    json_response(['ok' => true, 'is_shared' => $on]);
}

// v913 共有 toggle 差額処理 の 共通ロジック (3 機能 共通)。 v914 で フレーミングを 「共有=半額割引」 に 反転。
//   share_priced=0 (旧 row / 中村 PI) の場合 は 差額処理 スキップ、 単に is_shared を フリップ するだけ。
//   share_priced=1 の場合 (v914 モデル: shared paid = base/2、 unshared paid = base):
//     - 非共有 (base paid) → 共有 (base/2): paid / 2 を SYSTEM → user に 返金 (半額割引 発動)、 cost_points を 半額 に。
//     - 共有 (base/2 paid) → 非共有 (base): paid と 同額 を user → SYSTEM に 追加課金 (半額割引 停止)、 cost_points を 倍額 に。
//   ratio は v913 と 同じ 1:2 なので、 差額 計算 (±cost_points/2) は そのまま。 変わったのは 名目 base の 意味と ラベル。
function _ai_apply_share_toggle_delta(PDO $pdo, string $table, string $refType, int $rowId, int $uid, array $row, bool $on): void {
    $curShared = (int)($row['is_shared'] ?? 0) === 1;
    if ($curShared === $on) {
        // 変化なし (念のため冪等に UPDATE だけ)
        $pdo->prepare("UPDATE {$table} SET is_shared=?, shared_at=" . ($on ? "COALESCE(shared_at, NOW())" : "NULL") . " WHERE id=?")
            ->execute([$on ? 1 : 0, $rowId]);
        return;
    }
    $sharePriced = (int)($row['share_priced'] ?? 0) === 1;
    $paidCost = (int)($row['cost_points'] ?? 0);
    $isPi = ($uid === 3);  // v808 #402 中村 PI は そもそも 課金ゼロ、 差額処理 も なし
    // 旧 row / PI / 未課金 の場合、 表示切替のみ
    if (!$sharePriced || $isPi || $paidCost <= 0) {
        $pdo->prepare("UPDATE {$table}
                          SET is_shared=?, shared_at=" . ($on ? "NOW()" : "NULL") . "
                        WHERE id=?")
            ->execute([$on ? 1 : 0, $rowId]);
        return;
    }
    if ($on) {
        // 非共有 → 共有: 半額割引 発動 → 差額 返金 = paidCost / 2 (paidCost = base だったので、 base/2 分 戻る)
        $delta = intdiv($paidCost, 2);
        $newCost = $paidCost - $delta;
        db_tx($pdo, function () use ($pdo, $table, $refType, $rowId, $uid, $delta, $newCost) {
            if ($delta > 0) {
                Ledger::transfer($pdo, 1, $uid, $delta, 'refund', $refType, $rowId, '共有 ON にしたため 半額割引 返金');
            }
            $pdo->prepare("UPDATE {$table} SET is_shared=1, shared_at=NOW(), cost_points=? WHERE id=?")
                ->execute([$newCost, $rowId]);
        });
    } else {
        // 共有 → 非共有: 半額割引 停止 → 差額 追加課金 = paidCost (paidCost = base/2 だったので、 もう base/2 分 追加 で base に)
        $delta = $paidCost;
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $delta) {
            throw new ApiException('insufficient_balance',
                sprintf('非共有 に戻すには 追加 %d pt 必要 (現在 %d pt)。 共有のままなら 追加課金なし。', $delta, $bal), 400);
        }
        $newCost = $paidCost + $delta;
        db_tx($pdo, function () use ($pdo, $table, $refType, $rowId, $uid, $delta, $newCost) {
            Ledger::transfer($pdo, $uid, 1, $delta, 'upcharge', $refType, $rowId, '非共有 に戻したため 半額割引 停止 (差額 追加課金)');
            $pdo->prepare("UPDATE {$table} SET is_shared=0, shared_at=NULL, cost_points=? WHERE id=?")
                ->execute([$newCost, $rowId]);
        });
    }
}

function ai_paper_translate_get_shared(PDO $pdo, array $cfg, string $token): void {
    $u = Auth::requireUser($pdo, $cfg);
    $meId = (int)$u['id'];
    $st = $pdo->prepare("SELECT pt.id, pt.user_id, pt.pdf_name, pt.pdf_path, pt.pdf_sha256, pt.model, pt.result_json, pt.status,
                                pt.error_msg, pt.created_at, pt.finished_at,
                                pt.pages_count, pt.pages_dir, pt.is_shared, pt.shared_at,
                                pt.cost_points, pt.share_priced,
                                u.display_name AS author_name, u.avatar_url AS author_avatar
                           FROM paper_translates pt JOIN users u ON u.id = pt.user_id
                          WHERE pt.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'paper_translate not found', 404);
    $reactions = ai_paper_reactions_summary($pdo, 'paper_translate', (int)$row['id'], $meId);  // v789 #389
    // v797 同 PDF (= 同 sha256) で自分の paper_full_translations row があれば相互リンクを出す
    $crossRefs = [];
    if (!empty($row['pdf_sha256']) && (int)$row['user_id'] === $meId) {
        $stX = $pdo->prepare("SELECT share_token, direction, model, status FROM paper_full_translations
                                WHERE user_id=? AND pdf_sha256=? AND status IN ('processing','done')
                                ORDER BY id DESC LIMIT 3");
        $stX->execute([$meId, $row['pdf_sha256']]);
        foreach ($stX as $r) {
            $crossRefs[] = [
                'kind' => 'paper_full_translation',
                'share_token' => $r['share_token'],
                'direction' => $r['direction'],
                'model' => $r['model'],
                'status' => $r['status'],
                'url_slug' => 'paper-translate-full',
            ];
        }
    }
    json_response([
        'id'            => (int)$row['id'],
        'author_id'     => (int)$row['user_id'],
        'author_name'   => $row['author_name'],
        'author_avatar' => $row['author_avatar'],
        'pdf_name'      => $row['pdf_name'],
        'pdf_path'      => $row['pdf_path'],    // v758 #377 redo 可能か client が判定
        'model'         => $row['model'],
        'result'        => json_decode($row['result_json'] ?: 'null', true),
        'status'        => $row['status'] ?? 'done',
        'error_msg'     => $row['error_msg'],
        'created_at'    => $row['created_at'],
        'finished_at'   => $row['finished_at'],
        'pages_count'   => $row['pages_count'] !== null ? (int)$row['pages_count'] : null,
        'pages_dir'     => $row['pages_dir'],
        'is_shared'     => (bool)$row['is_shared'],
        'shared_at'     => $row['shared_at'],
        'cost_points'   => (int)$row['cost_points'],   // v913 toggle 差額 UI 用
        'share_priced'  => (int)($row['share_priced'] ?? 0) === 1,  // v913
        'reactions'     => $reactions,   // v789 #389
        'cross_refs'    => $crossRefs,   // v797 同 PDF の全訳等
    ]);
}

function ai_paper_translate(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'PDF を multipart/form-data でアップロードしてください', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要です', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmpPdf = $f['tmp_name'];
    $head = @file_get_contents($tmpPdf, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイルではありません', 400);

    // v808 #403 デフォルトを gpt-5 に。未対応モデルは 400。
    $reqModel = trim((string)($_POST['model'] ?? 'gpt-5'));
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $baseCost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    // v804 「終わった瞬間共有 ON」オプション
    $autoShare = !empty($_POST['auto_share']) ? 1 : 0;
    // v913 共有すると基本額、 非共有だと倍額。 auto_share の意思決定を そのまま cost に反映。
    $cost = _ai_share_priced_cost($baseCost, (bool)$autoShare);

    // v797 同 PDF を識別する SHA-256 を算出 (= 横展開用 / 「同 PDF の全訳がある」リンク等)。
    //   注意: 同 PDF + 同モデルでも再処理は別 row + 別課金で行う (要約と全訳で扱う軸が
    //   違うので、「同ファイルなら流用」で課金をスキップするとはしない方針)。
    $pdfSha = hash_file('sha256', $tmpPdf);

    // v808 #402 ラボ PI (user_id=3 = 中村) は SYSTEM の表現でもあり、自分で自分に
    //   ポイントを払っても意味がないので課金スキップ (cost はそのまま表示用に保持)。
    $skipCharge = ($uid === 3);

    if (!$skipCharge) {
        // 残高チェック
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // v750 #366 図表抽出: PDF をページ単位 JPEG にレンダリング (pdftoppm)。
    // v757 #375 解像度を 110 → 160 DPI に bump、図表を crop 表示する時の質を上げる。
    // v758 #377 PDF 本体もサーバに保存 (やりなおす用)。
    //   client は figure_refs の page + page_region からこのページ画像を crop 表示。
    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pagesRel = '/uploads/paper_pages/' . $token;
    $pagesAbs = $publicDir . $pagesRel;
    @mkdir($pagesAbs, 0775, true);
    // PDF 本体を保存
    $pdfRel = '/uploads/paper_pdfs/' . $token . '/original.pdf';
    $pdfAbs = $publicDir . $pdfRel;
    @mkdir(dirname($pdfAbs), 0775, true);
    if (!copy($tmpPdf, $pdfAbs)) {
        fwrite(STDERR, "[paper_translate] failed to save PDF locally: $pdfAbs\n");
        $pdfRel = null;
    } else {
        @chmod($pdfAbs, 0644);
    }
    $pagesCount = 0;
    try {
        $cmd = sprintf('pdftoppm -jpeg -jpegopt quality=85 -r 160 %s %s 2>&1',
            escapeshellarg($tmpPdf),
            escapeshellarg($pagesAbs . '/page')
        );
        exec($cmd, $out, $rc);
        if ($rc === 0) {
            foreach (glob($pagesAbs . '/page-*.jpg') ?: [] as $p) @chmod($p, 0644);
            $pagesCount = count(glob($pagesAbs . '/page-*.jpg') ?: []);
        }
    } catch (Throwable $_) { /* ページレンダリング失敗は致命的ではない */ }

    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付した PDF の研究論文を、 system prompt の指示に沿って詳細サマリ + 落合メソッドで日本語要約してください。 figure_refs の page 番号は PDF の物理ページ (1 始まり) で正確に。出力 JSON のみ。";

    // v755 #371 ユーザが選んだモデルを使う (config の default は無視)。
    // v757 #376 ハルシネーション防止の self-check を明示。 temperature を下げる。
    $model = $reqModel;
    // v774 #397 gpt-5 / o1 等の推論モデルは temperature を受け付けない。
    $payloadArr = [
        'model' => $model,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt . "\n\n書く前と書いた後で、必ず PDF の該当箇所を再確認し、数値 / 著者主張 / 結果が一致することを自分で検証してから JSON を出してください。ハルシネーションは厳禁です。"],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $model)) {
        $payloadArr['temperature'] = 0.2;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    // $token はすでに上の pdftoppm セクションで生成済み (= ページ画像 dir 用)。
    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $fileId, $pdfName, $sys, $pagesCount, $pagesRel, $pdfRel, $pdfSha, $reqModel, $cost, $autoShare, $skipCharge, &$rowId) {
        $pdo->prepare("INSERT INTO paper_translates
            (user_id, share_token, file_id, pdf_name, pdf_sha256, prompt_used, result_json, cost_points, status, pages_count, pages_dir, pdf_path, model, auto_share, share_priced)
            VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,1)")
            ->execute([$uid, $token, $fileId, mb_substr($pdfName, 0, 255), $pdfSha, $sys, 'null', $cost,
                       $pagesCount > 0 ? $pagesCount : null, $pagesCount > 0 ? $pagesRel : null,
                       $pdfRel, $reqModel, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        // v808 #402 ラボ PI は課金スキップ (cost は表示上残すが ledger 転送しない)
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $rowId, '論文要約依頼料');
        }
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $rowId,
        'share_token' => $token,
        'status'      => 'pending',
        'cost_points' => $cost,
        'model'       => $reqModel,
        'message'     => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が要約中… (1-4 分、推論モデルの場合は 3-8 分)。結果ページを開いておくか、後で /#/paper-translate/r/' . $token . ' を確認してください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    ai_paper_translate_run_background($pdo, $cfg, $rowId, $token, $fileId, $payload, $apiKey, $pdfName, $uid);
}

// v775 #399 本人のみ履歴から削除。関連ファイル (pdf / pages / paper_pdfs) も削除。
function ai_paper_translate_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id, pages_dir, pdf_path FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ削除可', 403);
    $publicDir = '/var/www/labpay/public';
    // ページ画像ディレクトリ削除
    if (!empty($row['pages_dir'])) {
        $abs = $publicDir . $row['pages_dir'];
        if (is_dir($abs)) {
            foreach (glob($abs . '/*') ?: [] as $f) @unlink($f);
            @rmdir($abs);
        }
    }
    // PDF + dir 削除
    if (!empty($row['pdf_path'])) {
        $pdfAbs = $publicDir . $row['pdf_path'];
        @unlink($pdfAbs);
        @rmdir(dirname($pdfAbs));
    }
    $pdo->prepare("DELETE FROM paper_translates WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

// v758 #377 既存 row の PDF を使って再処理 (本人のみ)。 body: { model?: string }
function ai_paper_translate_redo(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $body = read_json_body();
    $reqModel = isset($body['model']) ? trim((string)$body['model']) : '';
    $st = $pdo->prepare("SELECT * FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ', 403);
    if (empty($row['pdf_path'])) throw new ApiException('bad_request', 'PDF 保存がない古い要約はやりなおせません', 400);
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体が見つかりません', 404);

    // モデル: body で指定されたらそれ、なければ前回使ったモデル、それもなければ gpt-4o
    if ($reqModel === '') $reqModel = (string)($row['model'] ?? 'gpt-4o');
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $baseCost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    // v913 share_priced=1 (新プライシング) の row は 現 is_shared に応じて 基本 or 倍額。
    //   share_priced=0 (旧 row) は 従来通り 基本額のまま。
    $sharePriced = (int)($row['share_priced'] ?? 0) === 1;
    $isShared = (bool)($row['is_shared'] ?? 0);
    $cost = $sharePriced ? _ai_share_priced_cost($baseCost, $isShared) : $baseCost;
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) {
        throw new ApiException('insufficient_balance',
            sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付した PDF の研究論文を、 system prompt の指示に沿って詳細サマリ + 落合メソッドで日本語要約してください。 figure_refs の page 番号は PDF の物理ページ (1 始まり) で正確に。出力 JSON のみ。\n\n書く前と書いた後で、必ず PDF の該当箇所を再確認し、数値 / 著者主張 / 結果が一致することを自分で検証してから JSON を出してください。ハルシネーションは厳禁です。";

    // v774 #397 推論モデルは temperature 非対応
    $payloadArr = [
        'model' => $reqModel,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $reqModel)) {
        $payloadArr['temperature'] = 0.2;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    db_tx($pdo, function () use ($pdo, $uid, $id, $reqModel, $cost) {
        $pdo->prepare("UPDATE paper_translates SET status='pending', model=?, cost_points=cost_points+? WHERE id=?")
            ->execute([$reqModel, $cost, $id]);
        Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $id, '論文要約やりなおし');
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $id,
        'status'      => 'pending',
        'model'       => $reqModel,
        'cost_points' => $cost,
        'message'     => '再処理を開始しました (' . $reqModel . ')',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    $token = (string)($row['share_token'] ?? '');
    $pdfName = (string)($row['pdf_name'] ?? 'paper.pdf');
    ai_paper_translate_run_background($pdo, $cfg, $id, $token, $fileId, $payload, $apiKey, $pdfName, $uid);
}

// v777 #401 多段階要約の 2 段目: 1 段目が出力した JSON の日本語を「学術直訳調」 →
//   「自然で読みやすい日本語」に書き直す。数値 / 著者名 / 固有名詞 / 構造 (キー / 配列 / 文献番号)
//   はそのまま、言い回し・文末・助詞・冗長表現だけを改善。安価で速いモデルを使う
//   (本来の要約と別軸の「日本語校正」タスクなので 1 件数円で十分)。
function ai_paper_translate_polish_ja(array $parsed, string $apiKey): ?array {
    $sys = <<<'PROMPT'
あなたは日本語の文章校正アシスタントです。与えられた JSON は、別の AI が英語論文を
日本語で要約したものです。ただし学術直訳調 / 名詞止め / 不自然な連結が多く残って
います。これを「同僚に説明するつもりで書いた読みやすい日本語」に書き直して
ください。同じ JSON スキーマで返却します。

# 必ず守るルール (内容はいじらない、言い回しだけ直す)

1. **キー / 配列 / オブジェクト構造は一切変更しない**。同じキー名、同じ配列長、
   同じネストで返却する。
2. **数値 / 効果量 / p 値 / d 値 / 信頼区間 / 著者名 / 年 / 論文タイトル原文 / 文献番号 /
   会議名 / N 値 / セクション番号は一切変更しない**。「F(1,89)=4.71, p<.03」等の数値
   表記はコピーして保持。
3. **論文が主張している内容を改竄しない**。「示唆する」を「証明した」に書き換える
   等、強度を変えるのは禁止。「示唆」が残っても「ことを示唆する」に直す等、文末が
   自然になるように整えるだけ。
4. **新しい情報を加えない**。元の JSON にない数値 / 解釈を追加するのはハルシネーション
   と同じ。削るのも最低限で OK (重複削除は OK、情報損失はダメ)。

# 何を直すか

A. **名詞止めの文末** を述語で終え、自然な文にする:
   × 「認知容量は動機が低アクセスのときに決定的に働く示唆」
   ○ 「認知容量は、動機が低アクセスのときに決定的に働くことを示唆する」
   × 「忙しい標的は観察者より動機推論を行わず」
   ○ 「忙しいときは、観察者より動機推論をしない」

B. **学術直訳調の RQ・仮説** を「具体的なシーンが思い浮かぶ自然な文」に言い換える
   (構造 = key 値の文字列は書き換えて OK):
   × 「消費者はどの条件で販売員の行動に潜在的な説得動機を帰属し、説得知識を用いるか?」
   ○ 「消費者はどんなときに販売員の行動を『売りたくてやっている』と受け取り、
        説得知識を働かせて警戒するのだろうか?」

C. **専門用語だけの羅列** には平易な補足を添える (用語を消すのではなく、用語 + 平易
   説明の形に):
   × 「動機の想起容易性が効果を調整する」
   ○ 「動機 (販売員が売りたがっていること) が思い浮かびやすいかどうかで、効果が変わる」

D. **同じ述語の 3 連発** を避ける (「示す」「示す」「示す」や「した」「した」「した」が
   並んだら、「明らかにした」「確かめた」「裏付けられた」等で変化をつける)。

E. **冗長なメタ解説** (「論文では ◯◯ と主張している」「著者は ◯◯ と説明している」)
   は削って直接書く (「◯◯ である」「◯◯ が生じる」)。

F. **「・」や中点でつないだ機械翻訳風短文** は段落の中で文になるよう接続詞で
   つなぐ (「また」「これに対し」「その一方で」等)。

G. **日本語の文中に半角スペースを入れない**。「日本語」「説明」等の妙な切れ目が
   あれば詰める。英数字と日本語の境界はスペース OK。

# 出力
入力 JSON と同じスキーマで、上記観点で書き直した JSON のみを返却してください。
JSON 以外の前置き / 説明は不要。
PROMPT;

    $userText = "次の JSON を上記ルールで校正してください。同じスキーマで返却:\n\n"
              . json_encode($parsed, JSON_UNESCAPED_UNICODE);

    $payloadArr = [
        'model' => 'gpt-4.1',  // 校正タスクは安く速く
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user',   'content' => $userText],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 16000,
        'temperature' => 0.3,
    ];
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 180,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) {
        $errMsg = '';
        if ($resp !== false) {
            $errJ = json_decode((string)$resp, true);
            $errMsg = $errJ['error']['message'] ?? '';
        }
        throw new RuntimeException('polish: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''));
    }
    $j = json_decode((string)$resp, true);
    $content = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($content) || $content === '') {
        $finish = $j['choices'][0]['finish_reason'] ?? '?';
        throw new RuntimeException('polish: empty content (finish=' . $finish . ')');
    }
    $polished = json_decode($content, true);
    if (!is_array($polished)) throw new RuntimeException('polish: invalid JSON');

    // 安全弁: トップレベルの主要キーが落ちていないことを確認。落ちていたら元を返す。
    foreach (['title_ja', 'summary_one_paragraph', 'rq_hypothesis', 'detailed_sections'] as $k) {
        if (!array_key_exists($k, $polished) && array_key_exists($k, $parsed)) {
            return null; // ポリッシュが構造を壊した → 諦めて元を使う
        }
    }
    return $polished;
}

function ai_paper_translate_run_background(PDO $pdo, array $cfg, int $rowId, string $token, string $fileId, string $payload, string $apiKey, string $pdfName, int $uid): void {
    try {
        $pdo->prepare("UPDATE paper_translates SET status='processing' WHERE id = ?")->execute([$rowId]);
        $ch = curl_init('https://api.openai.com/v1/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 300,
        ]);
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        ai_openai_delete_file($fileId, $apiKey);

        if ($resp === false || $status >= 400) {
            $errMsg = '';
            if ($resp !== false) {
                $errJ = json_decode((string)$resp, true);
                $errMsg = $errJ['error']['message'] ?? '';
            }
            throw new RuntimeException('OpenAI: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''));
        }
        $j = json_decode((string)$resp, true);
        $content = $j['choices'][0]['message']['content'] ?? null;
        $finish  = $j['choices'][0]['finish_reason'] ?? '?';
        $usage   = $j['usage'] ?? [];
        if (!is_string($content) || $content === '') {
            // v776 #400 reasoning モデルで max_completion_tokens 不足 (= 全部 reasoning に消費)
            //   の切り分けのため finish_reason + usage を error_msg に残す。
            $info = " (finish=$finish";
            if (!empty($usage)) $info .= ", reasoning=" . ($usage['completion_tokens_details']['reasoning_tokens'] ?? '?') . ", completion=" . ($usage['completion_tokens'] ?? '?');
            $info .= ")";
            throw new RuntimeException('empty content' . $info);
        }
        $parsed = json_decode($content, true);
        if (!is_array($parsed)) throw new RuntimeException('invalid JSON');

        // v777 #401 2 段階目: 学術直訳調を自然で読みやすい日本語に書き直すポリッシュ。
        //   失敗しても元の JSON で続行 (本体を落とさない)。別モデル (gpt-4.1) を使う
        //   ことで安く・速く仕上げる。 status は processing のまま (ユーザには「要約中」
        //   の一貫した見え方)。
        try {
            $polished = ai_paper_translate_polish_ja($parsed, $apiKey);
            if (is_array($polished)) {
                $parsed = $polished;
            }
        } catch (Throwable $polishE) {
            // ポリッシュ失敗はログ残して元 JSON で続行
            fwrite(STDERR, "[paper_translate] polish failed (row $rowId): " . $polishE->getMessage() . "\n");
        }

        $pdo->prepare("UPDATE paper_translates SET result_json = ?, status='done', finished_at = NOW() WHERE id = ?")
            ->execute([json_encode($parsed, JSON_UNESCAPED_UNICODE), $rowId]);
        // v804 auto_share=1 なら公開 ON に
        $pdo->prepare("UPDATE paper_translates SET is_shared=1, shared_at=NOW() WHERE id=? AND auto_share=1 AND is_shared=0")
            ->execute([$rowId]);

        try {
            $shortTitle = (string)($parsed['title_ja'] ?? $pdfName);
            $shortTitle = mb_substr($shortTitle, 0, 60);
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "✅ 論文要約完了: 「{$shortTitle}」 /#/paper-summary/r/{$token}",
                'paper_translate', $rowId);
        } catch (Throwable $_) {}
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE paper_translates SET status='error', error_msg = ?, finished_at = NOW() WHERE id = ?")
            ->execute([mb_substr($e->getMessage(), 0, 500), $rowId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ 論文要約失敗: " . $e->getMessage() . " /#/paper-summary/r/{$token}",
                'paper_translate', $rowId);
        } catch (Throwable $_) {}
    }
}

// PDF を OpenAI Files API にアップロード。 purpose=user_data (chat.completions の
//   file content 用)。 file_id を返す。
function ai_openai_upload_pdf(string $tmpPath, string $filename, string $apiKey): string {
    $ch = curl_init('https://api.openai.com/v1/files');
    $cfile = new CURLFile($tmpPath, 'application/pdf', $filename);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_POSTFIELDS => ['purpose' => 'user_data', 'file' => $cfile],
        CURLOPT_TIMEOUT => 90,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) {
        $errMsg = '';
        if ($resp !== false) {
            $errJ = json_decode((string)$resp, true);
            $errMsg = $errJ['error']['message'] ?? '';
        }
        throw new ApiException('upstream_error', 'OpenAI files upload: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''), 502);
    }
    $j = json_decode((string)$resp, true);
    $id = $j['id'] ?? '';
    if (!is_string($id) || $id === '') throw new ApiException('upstream_error', 'file_id 取得失敗', 502);
    return $id;
}

function ai_openai_delete_file(string $fileId, string $apiKey): void {
    $ch = curl_init('https://api.openai.com/v1/files/' . urlencode($fileId));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_TIMEOUT => 15,
    ]);
    @curl_exec($ch);
    curl_close($ch);
}

// ============================================================================
// v781 #376 Deep Research — ChatGPT の Deep Research 機能を真似た多段 Web 調査。
//   OpenAI Responses API + web_search hosted tool で Web を横断検索し、
//   構造化された調査レポート (要点 / セクション / 出典) を JSON で返す。
//   コスト: 軽い (gpt-5-mini, 100pt) / 標準 (gpt-5, 250pt) / 深い (gpt-5 + 高 reasoning, 500pt)。
//   実 token / 検索回数は usage_json に記録して後から参照可能。
// ============================================================================

// v783 #380 深さ × モデル別ポイントを実 API コストベースで再計算。
//   OpenAI Responses API 2026/06 時点のおおむねの料金:
//     - web_search hosted tool: ~$0.030 per call
//     - gpt-5-mini: $0.15/1M input、 $1.50/1M output
//     - gpt-5:      $1.25/1M input、 $10.00/1M output
//   ざっくり試算 (1 USD ≈ 150 円、 1 pt = 1 円):
//     - light (gpt-5-mini, ~4 検索, 5K in / 3K out): ~$0.13 = 約 20 円
//     - standard (gpt-5, ~7 検索, 15K in / 10K out): ~$0.33 = 約 50 円
//     - deep (gpt-5 高 reasoning, ~12 検索, 30K in / 30K out): ~$0.70 = 約 100 円
//   実トークン / 検索数は usage_json に残すので、実コストがズレた場合は後で調整。
const DEEP_RESEARCH_TIERS = [
    // v853 価格半額化 (20/50/100 → 10/25/50)
    'light'    => ['model' => 'gpt-5-mini', 'effort' => 'low',    'cost' => 10, 'max_tokens' => 8000,  'label' => '軽い (gpt-5-mini, ~4 検索)'],
    'standard' => ['model' => 'gpt-5',      'effort' => 'medium', 'cost' => 25, 'max_tokens' => 16000, 'label' => '標準 (gpt-5, ~7 検索)'],
    'deep'     => ['model' => 'gpt-5',      'effort' => 'high',   'cost' => 50, 'max_tokens' => 32000, 'label' => '深い (gpt-5 高 reasoning, ~12 検索)'],
];

const DEEP_RESEARCH_SYSTEM_PROMPT = <<<'PROMPT'
あなたは「深く横断的に Web を調べて整理して報告する」リサーチアシスタントです。
ユーザから与えられたリサーチクエリに対して、 web_search ツールを必要なだけ使って
複数の信頼できる情報源を横断し、以下の構造で日本語の調査レポートを作って
ください。

# 振る舞い
- 最初にクエリを分解し、調べるべきサブトピック (3-6 個) を自分で立てる
- それぞれについて web_search を使い、一次情報 / 学術論文 / 公式ドキュメントを優先
- 1 つのソースだけで結論を出さず、複数ソースを突き合わせて食い違いも拾う
- 引用は必ず URL + 短い出典名 (例: 「OpenAI 公式ブログ」「Wikipedia」「Nature 2024」) を
  そのまま残す。出典を落とさない
- 「分からない / 確認できない」はそう書く。知らないことを創作しない
- 用語は初出で簡潔に説明
- 日本語の文中に不要な半角スペースを入れない (英数字 / 記号との境界は OK)

# 出力 JSON スキーマ (これをそのまま返す)

{
  "query_understanding": "ユーザクエリを自分がどう理解し、何を調べるつもりか (100-300 字)",
  "sub_questions": ["立てたサブ問い 1", "問い 2", ...],
  "sections": [
    {
      "heading": "セクションタイトル",
      "body": "そのセクションの説明本文 (400-1000 字、必要なら段落分け)。数値や主要用語は残す",
      "sources": [
        {"label": "短い出典名 (例: 「Smith 2024 (Nature)」)", "url": "https://...",
         "first_author": "Smith, J. など第一著者名 (論文の場合)",
         "title": "論文 / 記事タイトル (原文)",
         "venue": "Nature 2024 / OpenAI 公式ブログなど投稿先 / 媒体"},
        ...
      ]
    },
    ...
  ],
  "summary": "全セクションを通した結論 / 重要ポイントの要約 (400-800 字)",
  "key_findings": ["3-7 個の重要発見・主張を 1 行ずつ"],
  "open_questions": ["まだ残っている問い・追加で調べると良いこと"],
  "all_sources": [
    {"label": "短い出典名", "url": "https://...",
     "first_author": "第一著者名 (論文の場合)",
     "title":        "論文 / 記事タイトル (原文)",
     "venue":        "Nature / arXiv / 著者公式ブログなど投稿先 / 媒体",
     "why":          "なぜ参照したか (50-100 字)"},
    ...
  ]
}

# 出典 (sources / all_sources) の必須ルール
論文を参照した場合は **first_author + title + venue** を出来るだけ埋める。
URL だけで終わらない事 (ユーザがぱっと見て何の出典か分かる情報量を残す)。
論文でない (ブログ / 公式ドキュメント / Wikipedia 等) の場合は title + venue 中心で OK、
first_author は該当しないなら省略で OK。

JSON 以外の前置き / 解説 / markdown コードフェンスは不要、 JSON のみを返却。
PROMPT;

function ai_deep_research_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, share_token, query_text, model, depth, cost_points, status,
                                created_at, finished_at, error_msg, is_shared, shared_at
                           FROM deep_researches WHERE user_id = ?
                       ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $items = array_map(function ($r) {
        return [
            'id'          => (int)$r['id'],
            'share_token' => $r['share_token'],
            'query_short' => mb_substr((string)$r['query_text'], 0, 80),
            'model'       => $r['model'],
            'depth'       => $r['depth'],
            'cost_points' => (int)$r['cost_points'],
            'status'      => $r['status'],
            'created_at'  => $r['created_at'],
            'finished_at' => $r['finished_at'],
            'error_msg'   => $r['error_msg'],
            'is_shared'   => (bool)$r['is_shared'],
            'shared_at'   => $r['shared_at'],
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    ai_stars_enrich($pdo, 'deep_research', $items, $uid);
    ai_bookmarks_enrich($pdo, 'deep_research', $items, $uid);
    $sort = (string)($_GET['sort'] ?? '');
    $items = ai_stars_apply_sort('deep_research', $items, $sort);
    json_response([
        'items'  => $items,
        'tiers'  => DEEP_RESEARCH_TIERS,
        'default_depth' => 'standard',
    ]);
}

function ai_deep_research_get_shared(PDO $pdo, array $cfg, string $token): void {
    Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT dr.id, dr.user_id, dr.share_token, dr.query_text, dr.model, dr.depth,
                                 dr.openai_response_id, dr.progress_text,
                                 dr.cost_points, dr.share_priced, dr.status, dr.result_json, dr.usage_json,
                                 dr.error_msg, dr.created_at, dr.finished_at, dr.is_shared, dr.shared_at,
                                 u.display_name AS author_name, u.avatar_url AS author_avatar
                            FROM deep_researches dr JOIN users u ON u.id = dr.user_id
                           WHERE dr.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'deep_research not found', 404);
    // v786 #385 まだ進行中なら OpenAI に進捗を取りに行く
    if ($row['status'] === 'processing' && !empty($row['openai_response_id'])) {
        try { $row = ai_deep_research_poll($pdo, $cfg, $row); }
        catch (Throwable $_) { /* poll 失敗は致命的ではない */ }
    }
    json_response([
        'id'                 => (int)$row['id'],
        'author_id'          => (int)$row['user_id'],
        'author_name'        => $row['author_name'],
        'author_avatar'      => $row['author_avatar'],
        'query_text'         => $row['query_text'],
        'model'              => $row['model'],
        'depth'              => $row['depth'],
        'cost_points'        => (int)$row['cost_points'],
        'status'             => $row['status'],
        'progress_text'      => $row['progress_text'] ?? null,
        'openai_response_id' => $row['openai_response_id'] ?? null,
        'result'             => json_decode($row['result_json'] ?: 'null', true),
        'usage'              => json_decode($row['usage_json']  ?: 'null', true),
        'error_msg'          => $row['error_msg'],
        'created_at'         => $row['created_at'],
        'finished_at'        => $row['finished_at'],
        'is_shared'          => (bool)$row['is_shared'],
        'shared_at'          => $row['shared_at'],
        'share_priced'       => (int)($row['share_priced'] ?? 0) === 1,  // v913
    ]);
}

// v784 #382 共有 ON / OFF (本人のみ)
// v913 差額 追加課金/返金 は _ai_apply_share_toggle_delta 経由。
function ai_deep_research_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status, is_shared, share_priced, cost_points FROM deep_researches WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ共有切替可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '調査完了後のみ共有切替可', 400);
    $on = (bool)$body['is_shared'];
    _ai_apply_share_toggle_delta($pdo, 'deep_researches', 'deep_research', $id, $uid, $row, $on);
    json_response(['ok' => true, 'is_shared' => $on]);
}

// v784 #382 みんなの共有 Deep Research 一覧。 q= でキーワード検索 (query_text + result_json 内 LIKE)
function ai_deep_research_shared_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $myUid = (int)$u['id'];
    $q = trim((string)($_GET['q'] ?? ''));
    $args = [];
    $sql = "SELECT dr.id, dr.share_token, dr.query_text, dr.model, dr.depth,
                   dr.cost_points, dr.result_json, dr.shared_at, dr.created_at, dr.finished_at,
                   dr.user_id, u.display_name AS author_name, u.avatar_url AS author_avatar
              FROM deep_researches dr
              JOIN users u ON u.id = dr.user_id
             WHERE dr.is_shared = 1 AND dr.status = 'done'";
    if ($q !== '' && mb_strlen($q) <= 100) {
        $sql .= " AND (dr.query_text LIKE ? OR dr.result_json LIKE ?)";
        $args[] = '%' . $q . '%';
        $args[] = '%' . $q . '%';
    }
    $sql .= " ORDER BY dr.shared_at DESC LIMIT 100";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $result = json_decode($r['result_json'] ?: 'null', true);
        $items[] = [
            'id'            => (int)$r['id'],
            'share_token'   => $r['share_token'],
            'query_short'   => mb_substr((string)$r['query_text'], 0, 120),
            'summary_short' => is_array($result) ? mb_substr((string)($result['summary'] ?? ''), 0, 200) : '',
            'model'         => $r['model'],
            'depth'         => $r['depth'],
            'cost_points'   => (int)$r['cost_points'],
            'shared_at'     => $r['shared_at'],
            'created_at'    => $r['created_at'],
            'author_id'     => (int)$r['user_id'],
            'author_name'   => $r['author_name'],
            'author_avatar' => $r['author_avatar'],
        ];
    }
    ai_stars_enrich($pdo, 'deep_research', $items, $myUid);
    ai_bookmarks_enrich($pdo, 'deep_research', $items, $myUid);
    $sort = (string)($_GET['sort'] ?? '');
    $items = ai_stars_apply_sort('deep_research', $items, $sort);
    json_response(['items' => $items, 'q' => $q]);
}

function ai_deep_research_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id FROM deep_researches WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ削除可', 403);
    $pdo->prepare("DELETE FROM deep_researches WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function ai_deep_research(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $body = read_json_body();
    $query = trim((string)($body['query'] ?? ''));
    if ($query === '') throw new ApiException('bad_request', 'query が必要です', 400);
    if (mb_strlen($query) > 4000) throw new ApiException('bad_request', 'query は 4000 字まで', 400);
    $depth = (string)($body['depth'] ?? 'standard');
    if (!isset(DEEP_RESEARCH_TIERS[$depth])) {
        throw new ApiException('bad_request', '未対応 depth: ' . $depth, 400);
    }
    $tier = DEEP_RESEARCH_TIERS[$depth];
    $baseCost = (int)$tier['cost'];
    // v913 「終わった瞬間 共有 ON」 (paper_translate と同じ pattern)。 共有=基本額 / 非共有=倍額
    $autoShare = !empty($body['auto_share']) ? 1 : 0;
    $cost = _ai_share_priced_cost($baseCost, (bool)$autoShare);

    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) {
        throw new ApiException('insufficient_balance',
            sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $token = bin2hex(random_bytes(16));

    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $query, $tier, $depth, $cost, $autoShare, &$rowId) {
        $pdo->prepare("INSERT INTO deep_researches
            (user_id, share_token, query_text, model, depth, cost_points, share_priced, auto_share, status)
            VALUES (?,?,?,?,?,?,1,?,'pending')")
            ->execute([$uid, $token, $query, $tier['model'], $depth, $cost, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $cost, 'deep_research', 'deep_research', $rowId, 'Deep Research 依頼料 (' . $depth . ')');
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $rowId,
        'share_token' => $token,
        'status'      => 'pending',
        'cost_points' => $cost,
        'depth'       => $depth,
        'message'     => '依頼を受け付けました。 OpenAI (' . $tier['model'] . ' / ' . $depth . ') が調査中… (深さにより 1-15 分)。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(900);

    ai_deep_research_run_background($pdo, $cfg, $rowId, $token, $query, $tier, $apiKey, $uid);
}

// v786 #385 OpenAI Responses API は web_search + reasoning だと 30 分超を普通に使うため、
//   従来の同期 POST 1 本だけだと PHP プロセスが PHP-FPM の request_terminate_timeout に
//   殺されて結果が DB に入らず status=processing で永遠に残る。 background=true で
//   投げて、結果ページアクセスのたびに GET /v1/responses/{id} で進捗 / 完了を取り
//   行く方式に改修 (= polling)。
function ai_deep_research_run_background(PDO $pdo, array $cfg, int $rowId, string $token, string $query, array $tier, string $apiKey, int $uid): void {
    try {
        $pdo->prepare("UPDATE deep_researches SET status='processing', progress_text='OpenAI に依頼中…' WHERE id = ?")->execute([$rowId]);

        $payloadArr = [
            'model' => $tier['model'],
            'input' => [
                ['role' => 'system', 'content' => DEEP_RESEARCH_SYSTEM_PROMPT],
                ['role' => 'user',   'content' => $query],
            ],
            'tools' => [['type' => 'web_search']],
            'max_output_tokens' => (int)$tier['max_tokens'],
            'background' => true,   // 非同期化、 response_id だけ即返ってくる
        ];
        if (preg_match('/^(gpt-5|o1|o3)/', (string)$tier['model'])) {
            $payloadArr['reasoning'] = ['effort' => (string)$tier['effort']];
        }
        $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

        $ch = curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_TIMEOUT => 60,  // background なら数秒で response_id が返る
        ]);
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($resp === false || $status >= 400) {
            $errMsg = '';
            if ($resp !== false) {
                $errJ = json_decode((string)$resp, true);
                $errMsg = $errJ['error']['message'] ?? '';
            }
            throw new RuntimeException('OpenAI: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''));
        }
        $j = json_decode((string)$resp, true);
        $rid = (string)($j['id'] ?? '');
        if ($rid === '') throw new RuntimeException('response_id 取得失敗');

        $pdo->prepare("UPDATE deep_researches
                          SET openai_response_id = ?, progress_text = ?
                        WHERE id = ?")
            ->execute([$rid, '🌐 Web 検索を開始…', $rowId]);
        // 完了通知はポーリング側で発火 (get_shared 内)
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE deep_researches SET status='error', error_msg = ?, finished_at = NOW() WHERE id = ?")
            ->execute([mb_substr($e->getMessage(), 0, 1000), $rowId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ Deep Research 失敗: " . $e->getMessage() . " /#/deep-research/r/{$token}",
                'deep_research', $rowId);
        } catch (Throwable $_) {}
    }
}

// v786 #385 OpenAI に進捗を取りに行くヘルパ。 status=processing で openai_response_id が
//   ある行を渡すと、 GET /v1/responses/{id} を叩いて status を更新する。
//   - completed: result_json + usage_json を保存 → status='done' → 通知
//   - failed:    status='error' → error_msg 保存 → 通知
//   - その他: progress_text だけ更新 (web_search 件数 / 状態)
function ai_deep_research_poll(PDO $pdo, array $cfg, array $row): array {
    $apiKey = (string)$cfg['openai']['api_key'];
    $rid    = (string)$row['openai_response_id'];
    if ($apiKey === '' || $rid === '') return $row;

    $ch = curl_init('https://api.openai.com/v1/responses/' . urlencode($rid));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) {
        return $row; // poll 失敗は致命的ではない (次回 retry)
    }
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return $row;

    $oaStatus = (string)($j['status'] ?? 'in_progress');

    // 進捗集計
    $searchCount = 0;
    $reasoningCount = 0;
    $hasMessage = false;
    foreach (($j['output'] ?? []) as $it) {
        $t = $it['type'] ?? '';
        if ($t === 'web_search_call') $searchCount++;
        elseif ($t === 'reasoning')   $reasoningCount++;
        elseif ($t === 'message')     $hasMessage = true;
    }

    if ($oaStatus === 'completed') {
        // output_text 抽出
        $text = '';
        foreach (($j['output'] ?? []) as $item) {
            if (($item['type'] ?? '') === 'message') {
                foreach (($item['content'] ?? []) as $c) {
                    if (($c['type'] ?? '') === 'output_text' && isset($c['text'])) {
                        $text .= (string)$c['text'];
                    }
                }
            }
        }
        if ($text === '' && isset($j['output_text']) && is_string($j['output_text'])) {
            $text = (string)$j['output_text'];
        }
        if ($text === '') {
            $pdo->prepare("UPDATE deep_researches SET status='error', error_msg='completed だが output_text が空', finished_at=NOW() WHERE id=?")
                ->execute([$row['id']]);
            $row['status'] = 'error'; return $row;
        }
        $jsonText = $text;
        if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/s', $text, $m)) $jsonText = $m[1];
        elseif (preg_match('/(\{.*\})/s', $text, $m)) $jsonText = $m[1];
        $parsed = json_decode($jsonText, true);
        if (!is_array($parsed)) {
            $pdo->prepare("UPDATE deep_researches SET status='error', error_msg='invalid JSON in output', finished_at=NOW() WHERE id=?")
                ->execute([$row['id']]);
            $row['status'] = 'error'; return $row;
        }
        $usage = $j['usage'] ?? [];
        $usageRec = [
            'input_tokens'  => (int)($usage['input_tokens']  ?? 0),
            'output_tokens' => (int)($usage['output_tokens'] ?? 0),
            'total_tokens'  => (int)($usage['total_tokens']  ?? 0),
            'search_count'  => $searchCount,
        ];
        $pdo->prepare("UPDATE deep_researches
                          SET result_json=?, usage_json=?, status='done',
                              progress_text=NULL, finished_at=NOW()
                        WHERE id=?")
            ->execute([
                json_encode($parsed, JSON_UNESCAPED_UNICODE),
                json_encode($usageRec, JSON_UNESCAPED_UNICODE),
                $row['id'],
            ]);
        // v913 auto_share=1 なら 公開 ON に (paper_translate と同じ pattern)
        $pdo->prepare("UPDATE deep_researches SET is_shared=1, shared_at=NOW() WHERE id=? AND auto_share=1 AND is_shared=0")
            ->execute([(int)$row['id']]);
        try {
            $shortQ = mb_substr((string)$row['query_text'], 0, 60);
            notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice',
                "🔎 Deep Research 完了: 「{$shortQ}」 /#/deep-research/r/{$row['share_token']}",
                'deep_research', (int)$row['id']);
        } catch (Throwable $_) {}
        // 行を最新化して返す
        $row['status'] = 'done';
        $row['result_json'] = json_encode($parsed, JSON_UNESCAPED_UNICODE);
        $row['usage_json']  = json_encode($usageRec, JSON_UNESCAPED_UNICODE);
        $row['progress_text'] = null;
        return $row;
    }
    if ($oaStatus === 'failed' || $oaStatus === 'cancelled' || $oaStatus === 'incomplete') {
        $errMsg = (string)($j['error']['message'] ?? ($j['incomplete_details']['reason'] ?? $oaStatus));
        $pdo->prepare("UPDATE deep_researches SET status='error', error_msg=?, finished_at=NOW() WHERE id=?")
            ->execute(['OpenAI ' . $oaStatus . ': ' . mb_substr($errMsg, 0, 400), (int)$row['id']]);
        $row['status'] = 'error';
        $row['error_msg'] = 'OpenAI ' . $oaStatus . ': ' . $errMsg;
        return $row;
    }

    // 進捗中 (queued / in_progress)
    $progress = "🌐 Web 検索 {$searchCount} 回 / 🧠 推論 {$reasoningCount} 段 (OpenAI: {$oaStatus})";
    $pdo->prepare("UPDATE deep_researches SET progress_text=? WHERE id=?")
        ->execute([$progress, (int)$row['id']]);
    $row['progress_text'] = $progress;
    return $row;
}

// ============================================================================
// v788 #386 #387 #388 論文全訳 — paper-summary と似た UI でフル翻訳を出す。
//   章ごとに訳 → サンプル文を back-translate して整合確認 → 用語統一 + 全体ポリッシュ。
//   direction:
//     en2ja: 英語論文 → 日本語 (要約と同程度のコスト)
//     ja2en: 日本語論文 → 英語 (5x、 + em-dash 等 GPT-isms 除去)
//   Responses API + background mode + polling で長時間ジョブを安全に。
// ============================================================================

// v808 #403 価格調整 + デフォルトを gpt-5 に。
const PAPER_FULL_TRANSLATE_MODELS_EN2JA = [
    'gpt-5-mini' => 30,
    'gpt-5'      => 50,   // デフォルト
    'o1'         => 80,
];
const PAPER_FULL_TRANSLATE_MODELS_JA2EN = [  // 5x
    'gpt-5-mini' => 150,
    'gpt-5'      => 250,  // デフォルト
    'o1'         => 400,
];

const PAPER_FULL_TRANSLATE_SYSTEM_PROMPT_EN2JA = <<<'PROMPT'
あなたは学術論文を **章ごとに全訳** する翻訳アシスタントです。添付された英語論文 PDF
を全訳し、同時に各章で back-translation で訳の信頼性を確認し、最後に全体を
見渡して用語統一と自然さを整えるところまでやってください。

# 大切なルール

1. **全文を訳す** (要約ではない)。段落を飛ばしたり圧縮したりしない。数式 / 図表番号 /
   引用番号 [12] / 著者名表記 (Smith et al., 2024) などはそのまま残す。
2. **章 (Section) 単位で区切って翻訳** する。章タイトルも「Introduction (はじめに)」のよう
   に原題 + 訳を併記。
3. **back-translation**: 各章から 2-3 文をサンプルとして取って日本語 → 英語に逆翻訳し、
   元英文と突き合わせて「ズレがないか」をコメントする。ズレがあれば訳を修正し直す。
4. **用語統一**: 重要用語 (proper noun, jargon) は章をまたいで同じ訳語を使う。章ごとの
   訳が終わったあと、全体ポリッシュで用語ブレを直す。
5. **「論文では 〜 と述べている」などのメタ解説で包まない**。原文と同じ主張で直接訳す。
6. 日本語の文中に不要な半角スペースを入れない (英数字 / 記号との境界は OK)。

# 出力 JSON スキーマ (これをそのまま返却)

{
  "title_original":    "原タイトル (英語)",
  "title_translated":  "日本語タイトル",
  "authors":           "著者名 (代表 3 名まで + et al.)",
  "venue":             "発表会議 / ジャーナル + 年",
  "language_detected": "en",
  "chapters": [
    {
      "chapter_title_original":   "Introduction",
      "chapter_title_translated": "はじめに",
      "translation":              "全文訳 (省略せず)。段落は \n\n で区切る",
      "back_translation_samples": [
        { "ja_translation": "サンプルとして選んだ訳文 (1-2 文)",
          "back_to_en":     "それを逆翻訳した英文",
          "original_en":    "対応する原文 (引用)",
          "notes":          "ズレや訂正のメモ (なしなら空文字列)" }
      ],
      "key_terms": [
        { "original": "term", "translation": "用語訳", "note": "なぜこう訳したか" }
      ]
    }
  ],
  "overall_polish": {
    "terminology_consistency": "全体で用語ブレを統一したメモ (どの用語をどう揃えたか)",
    "adjustments_made":        ["章をまたいで修正した点 1", "..."],
    "remaining_concerns":      ["残った不確かな訳 / 用語 / 数値など"]
  }
}

JSON 以外の前置き / 解説 / markdown コードフェンスは不要、 JSON のみを返却。
PROMPT;

const PAPER_FULL_TRANSLATE_SYSTEM_PROMPT_JA2EN = <<<'PROMPT'
You are a translator who renders Japanese academic papers into **full English chapter-by-chapter**.
Given an attached Japanese PDF, translate the whole paper, run back-translation on samples per chapter
to verify fidelity, then perform a final polish pass that:
- unifies terminology across chapters,
- removes GPT-ish stylistic tells (em-dashes "—", excessive "moreover/furthermore/however" chains,
  hedge clauses like "It is important to note that ..." that feel like LLM filler),
- ensures natural academic English with concrete claims (not vague "we explore" without verbs).

# Rules

1. Translate the **entire text** (not a summary). Keep equation numbers, figure references, citation
   markers (e.g. [12], Smith et al. 2024) verbatim. Keep tables/figures referenced as in the original.
2. Use **chapter (Section) granularity**. For each chapter give the original Japanese chapter title
   AND the English title.
3. **back-translation**: per chapter, pick 2-3 sample sentences, back-translate them to Japanese and
   compare against the original Japanese. Note any drift and fix the English.
4. **terminology consistency**: proper nouns / jargon must use the same English term across chapters.
   Resolve any inconsistency in the final overall_polish pass.
5. **No meta-narration** ("The paper states that ..."). Translate the claim directly in the third
   person where the original implies it.
6. **GPT-ism removal**: scrub em-dashes "—" (replace with commas, parens, or rewrites), avoid
   over-using "moreover/furthermore", avoid "delve into / dive into / leverage" filler.

# Output JSON schema (return this exact shape, JSON only — no markdown fences)

{
  "title_original":    "Original Japanese title",
  "title_translated":  "English title",
  "authors":           "Author names (up to 3 + et al.)",
  "venue":             "Conference/journal + year",
  "language_detected": "ja",
  "chapters": [
    {
      "chapter_title_original":   "はじめに",
      "chapter_title_translated": "Introduction",
      "translation":              "Full English translation. Paragraphs separated by \n\n. No omission.",
      "back_translation_samples": [
        { "en_translation": "1-2 sentence sample from the translation",
          "back_to_ja":     "back-translated Japanese",
          "original_ja":    "matching original Japanese sentence(s)",
          "notes":          "drift notes / fixes; empty string if none" }
      ],
      "key_terms": [
        { "original": "原語", "translation": "term", "note": "why this term" }
      ]
    }
  ],
  "overall_polish": {
    "terminology_consistency": "Notes on how terms were unified across chapters",
    "adjustments_made":        ["cross-chapter edits 1", "..."],
    "gpt_ism_scrub":           ["List of GPT-ism patterns we removed (e.g. removed N em-dashes, replaced 'moreover' chains with shorter connectors)"],
    "remaining_concerns":      ["Uncertain terms / numbers / phrases worth a human pass"]
  }
}

Return ONLY the JSON.
PROMPT;

function ai_paper_full_translate_models_for(string $direction): array {
    return $direction === 'ja2en' ? PAPER_FULL_TRANSLATE_MODELS_JA2EN : PAPER_FULL_TRANSLATE_MODELS_EN2JA;
}

function ai_paper_full_translate_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v807 result_json から title 系も取り出して履歴表示をリッチに
    $st = $pdo->prepare("SELECT id, share_token, pdf_name, direction, model, cost_points, status,
                                created_at, finished_at, is_shared, shared_at, error_msg, result_json
                           FROM paper_full_translations WHERE user_id = ?
                       ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = array_map(function ($r) {
        $result = !empty($r['result_json']) ? json_decode((string)$r['result_json'], true) : null;
        // v841 #423 abstract 系も snippet として返す (= 自分の履歴タイルもみんなと同じ密度に)
        $snippet = null;
        if (is_array($result)) {
            $raw = (string)($result['abstract_translated'] ?? $result['abstract_original'] ?? $result['abstract'] ?? '');
            if ($raw !== '') {
                $raw = preg_replace('/\s+/u', ' ', trim($raw)) ?? '';
                $snippet = mb_strlen($raw) > 140 ? (mb_substr($raw, 0, 140) . '…') : $raw;
            }
        }
        return [
            'id' => (int)$r['id'],
            'share_token' => $r['share_token'],
            'pdf_name'    => $r['pdf_name'],
            'title_translated' => is_array($result) ? ($result['title_translated'] ?? null) : null,
            'title_original'   => is_array($result) ? ($result['title_original']   ?? null) : null,
            'authors'          => is_array($result) ? ($result['authors']          ?? null) : null,
            'venue'            => is_array($result) ? ($result['venue']            ?? null) : null,
            'snippet'          => $snippet,
            'direction'   => $r['direction'],
            'model'       => $r['model'],
            'cost_points' => (int)$r['cost_points'],
            'status'      => $r['status'],
            'created_at'  => $r['created_at'],
            'finished_at' => $r['finished_at'],
            'is_shared'   => (bool)$r['is_shared'],
            'shared_at'   => $r['shared_at'],
            'error_msg'   => $r['error_msg'],
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    ai_stars_enrich($pdo, 'paper_full_translation', $rows, $uid);
    ai_bookmarks_enrich($pdo, 'paper_full_translation', $rows, $uid);
    $sort = (string)($_GET['sort'] ?? '');
    $rows = ai_stars_apply_sort('paper_full_translation', $rows, $sort);
    json_response([
        'items'      => $rows,
        'models_en2ja' => PAPER_FULL_TRANSLATE_MODELS_EN2JA,
        'models_ja2en' => PAPER_FULL_TRANSLATE_MODELS_JA2EN,
        'default_direction' => 'en2ja',
        'default_model'     => 'gpt-5',
    ]);
}

function ai_paper_full_translate_get_shared(PDO $pdo, array $cfg, string $token): void {
    $u = Auth::requireUser($pdo, $cfg);
    $meId = (int)$u['id'];
    $st = $pdo->prepare("SELECT pft.*, u.display_name AS author_name, u.avatar_url AS author_avatar
                           FROM paper_full_translations pft JOIN users u ON u.id = pft.user_id
                          WHERE pft.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'paper_full_translation not found', 404);
    // 進行中なら OpenAI に進捗を取りに行く
    if ($row['status'] === 'processing' && !empty($row['openai_response_id'])) {
        try { $row = ai_paper_full_translate_poll($pdo, $cfg, $row); }
        catch (Throwable $_) {}
    }
    $reactions = ai_paper_reactions_summary($pdo, 'paper_full_translation', (int)$row['id'], $meId);  // v789 #389
    // v797 同 PDF の要約 row があれば相互リンクを出す
    $crossRefs = [];
    if (!empty($row['pdf_sha256']) && (int)$row['user_id'] === $meId) {
        $stX = $pdo->prepare("SELECT share_token, model, status FROM paper_translates
                                WHERE user_id=? AND pdf_sha256=? AND status IN ('processing','done')
                                ORDER BY id DESC LIMIT 3");
        $stX->execute([$meId, $row['pdf_sha256']]);
        foreach ($stX as $r) {
            $crossRefs[] = [
                'kind' => 'paper_translate',
                'share_token' => $r['share_token'],
                'model' => $r['model'],
                'status' => $r['status'],
                'url_slug' => 'paper-summary',
            ];
        }
    }
    json_response([
        'reactions'  => $reactions,
        'cross_refs' => $crossRefs,   // v797
        'id'                 => (int)$row['id'],
        'author_id'          => (int)$row['user_id'],
        'author_name'        => $row['author_name'],
        'author_avatar'      => $row['author_avatar'],
        'pdf_name'           => $row['pdf_name'],
        'pdf_path'           => $row['pdf_path'],
        'direction'          => $row['direction'],
        'model'              => $row['model'],
        'cost_points'        => (int)$row['cost_points'],
        'status'             => $row['status'],
        'progress_text'      => $row['progress_text'] ?? null,
        'openai_response_id' => $row['openai_response_id'] ?? null,
        'result'             => json_decode($row['result_json'] ?: 'null', true),
        'usage'              => json_decode($row['usage_json']  ?: 'null', true),
        'error_msg'          => $row['error_msg'],
        'created_at'         => $row['created_at'],
        'finished_at'        => $row['finished_at'],
        'is_shared'          => (bool)$row['is_shared'],
        'shared_at'          => $row['shared_at'],
        'share_priced'       => (int)($row['share_priced'] ?? 0) === 1,  // v913 toggle 差額 UI 用
    ]);
}

function ai_paper_full_translate_shared_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $myUid = (int)$u['id'];
    $q = trim((string)($_GET['q'] ?? ''));
    $args = [];
    $sql = "SELECT pft.id, pft.share_token, pft.pdf_name, pft.direction, pft.model, pft.cost_points,
                   pft.result_json, pft.shared_at, pft.created_at, pft.finished_at,
                   pft.user_id, u.display_name AS author_name, u.avatar_url AS author_avatar
              FROM paper_full_translations pft JOIN users u ON u.id = pft.user_id
             WHERE pft.is_shared = 1 AND pft.status = 'done'";
    if ($q !== '' && mb_strlen($q) <= 100) {
        $sql .= " AND (pft.pdf_name LIKE ? OR pft.result_json LIKE ?)";
        $args[] = '%' . $q . '%';
        $args[] = '%' . $q . '%';
    }
    $sql .= " ORDER BY pft.shared_at DESC LIMIT 100";
    $st = $pdo->prepare($sql);
    $st->execute($args);
    $items = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $result = json_decode($r['result_json'] ?: 'null', true);
        $items[] = [
            'id' => (int)$r['id'],
            'share_token' => $r['share_token'],
            'pdf_name' => $r['pdf_name'],
            'direction' => $r['direction'],
            'title_original'   => is_array($result) ? ($result['title_original']   ?? null) : null,
            'title_translated' => is_array($result) ? ($result['title_translated'] ?? null) : null,
            'authors' => is_array($result) ? ($result['authors'] ?? null) : null,
            'venue'   => is_array($result) ? ($result['venue']   ?? null) : null,
            'shared_at' => $r['shared_at'],
            'created_at' => $r['created_at'],
            'author_id' => (int)$r['user_id'],
            'author_name' => $r['author_name'],
            'author_avatar' => $r['author_avatar'],
        ];
    }
    ai_stars_enrich($pdo, 'paper_full_translation', $items, $myUid);
    ai_bookmarks_enrich($pdo, 'paper_full_translation', $items, $myUid);
    $sort = (string)($_GET['sort'] ?? '');
    $items = ai_stars_apply_sort('paper_full_translation', $items, $sort);
    json_response(['items' => $items, 'q' => $q]);
}

// v913 差額 追加課金/返金 は _ai_apply_share_toggle_delta 経由。
function ai_paper_full_translate_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status, is_shared, share_priced, cost_points FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ共有切替可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '完了後のみ共有切替可', 400);
    $on = (bool)$body['is_shared'];
    _ai_apply_share_toggle_delta($pdo, 'paper_full_translations', 'paper_full_translate', $id, $uid, $row, $on);
    json_response(['ok' => true, 'is_shared' => $on]);
}

function ai_paper_full_translate_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id, pdf_path FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ削除可', 403);
    if (!empty($row['pdf_path'])) {
        $abs = '/var/www/labpay/public' . $row['pdf_path'];
        @unlink($abs);
        @rmdir(dirname($abs));
    }
    $pdo->prepare("DELETE FROM paper_full_translations WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function ai_paper_full_translate(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'PDF を multipart/form-data でアップロードしてください', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要です', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmpPdf = $f['tmp_name'];
    $head = @file_get_contents($tmpPdf, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイルではありません', 400);

    $direction = (string)($_POST['direction'] ?? 'en2ja');
    if (!in_array($direction, ['en2ja', 'ja2en'], true)) {
        throw new ApiException('bad_request', 'direction は en2ja / ja2en のみ', 400);
    }
    $models = ai_paper_full_translate_models_for($direction);
    $reqModel = trim((string)($_POST['model'] ?? 'gpt-5'));
    if (!isset($models[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $baseCost = (int)$models[$reqModel];
    // v804 「終わった瞬間共有 ON」
    $autoShare = !empty($_POST['auto_share']) ? 1 : 0;
    // v913 共有=基本額 / 非共有=倍額
    $cost = _ai_share_priced_cost($baseCost, (bool)$autoShare);

    // v797 SHA-256 は横展開リンク用だけに算出 (同 PDF でも別ジョブで走らせる、課金も別)
    $pdfSha = hash_file('sha256', $tmpPdf);

    // v808 #402 ラボ PI (user_id=3) は課金スキップ
    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // PDF 保存 (削除時 / 再表示時用)
    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pdfRel = '/uploads/paper_full_translations/' . $token . '/original.pdf';
    $pdfAbs = $publicDir . $pdfRel;
    @mkdir(dirname($pdfAbs), 0775, true);
    if (!copy($tmpPdf, $pdfAbs)) { $pdfRel = null; } else { @chmod($pdfAbs, 0644); }

    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $pdfName, $direction, $reqModel, $cost, $pdfRel, $pdfSha, $autoShare, $skipCharge, &$rowId) {
        $pdo->prepare("INSERT INTO paper_full_translations
            (user_id, share_token, pdf_path, pdf_name, pdf_sha256, direction, model, cost_points, status, progress_text, auto_share)
            VALUES (?,?,?,?,?,?,?,?,'pending','OpenAI に依頼中…',?)")
            ->execute([$uid, $token, $pdfRel, mb_substr($pdfName, 0, 255), $pdfSha, $direction, $reqModel, $cost, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        // v808 #402 ラボ PI は課金スキップ
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_full_translate', 'paper_full_translation', $rowId,
                '論文全訳 (' . $direction . ') 依頼料');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'direction' => $direction, 'model' => $reqModel,
        'message' => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が全訳中… (10-30 分)。結果ページを開いておいても OK、完了通知が届きます。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $rowId, $token, $fileId, $direction, $reqModel, $apiKey, $uid);
}

// v806 エラー row を同 row で再投入 (新規課金 / 新規 row なし)。 v810 #_stuck status=error のもの
// に加え、 status=processing で 30 分以上進まないものも「stale = 詰まっている」と見なし再投入可。
function ai_paper_full_translate_retry(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ再実施可', 403);
    $okError = $row['status'] === 'error';
    $okStaleProc = $row['status'] === 'processing'
        && (int)(strtotime((string)$row['created_at']) ?: 0) > 0
        && (time() - strtotime((string)$row['created_at'])) >= 1800;
    if (!$okError && !$okStaleProc) {
        throw new ApiException('bad_request', '再実施はエラー / 30 分以上経過した処理中のみ (現 status: ' . $row['status'] . ')', 400);
    }
    if (empty($row['pdf_path'])) {
        throw new ApiException('bad_request', 'PDF が残っていないので再実施不可', 400);
    }
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体が見つかりません', 404);

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    // row リセット (新規課金なし)
    $pdo->prepare("UPDATE paper_full_translations
                      SET status='processing', progress_text='再投入中…',
                          openai_response_id=NULL, error_msg=NULL, result_json=NULL,
                          usage_json=NULL, finished_at=NULL
                    WHERE id=?")->execute([$id]);

    json_response_no_exit([
        'ok' => true, 'id' => $id, 'share_token' => $row['share_token'], 'status' => 'processing',
        'message' => '再投入を開始しました (新規課金なし)。結果ページで進捗を確認してください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $id, (string)$row['share_token'], $fileId,
        (string)$row['direction'], (string)$row['model'], $apiKey, $uid);
}

// v806 paper_translate (要約) のエラー row を同 row で再投入 (新規課金なし)。
// v810 #_stuck status=processing で 30 分以上進まない stale row も再投入可。
function ai_paper_translate_retry(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人のみ再実施可', 403);
    $okError = $row['status'] === 'error';
    $okStaleProc = $row['status'] === 'processing'
        && (int)(strtotime((string)$row['created_at']) ?: 0) > 0
        && (time() - strtotime((string)$row['created_at'])) >= 1800;
    if (!$okError && !$okStaleProc) {
        throw new ApiException('bad_request', '再実施はエラー / 30 分以上経過した処理中のみ (現 status: ' . $row['status'] . ')', 400);
    }
    if (empty($row['pdf_path'])) {
        throw new ApiException('bad_request', 'PDF が残っていないので再実施不可', 400);
    }
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体が見つかりません', 404);

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    $reqModel = (string)$row['model'];
    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付した PDF の研究論文を、 system prompt の指示に沿って詳細サマリ + 落合メソッドで日本語要約してください。 figure_refs の page 番号は PDF の物理ページ (1 始まり) で正確に。出力 JSON のみ。\n\n書く前と書いた後で、必ず PDF の該当箇所を再確認し、数値 / 著者主張 / 結果が一致することを自分で検証してから JSON を出してください。ハルシネーションは厳禁です。";

    $payloadArr = [
        'model' => $reqModel,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $reqModel)) {
        $payloadArr['temperature'] = 0.2;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    // row リセット
    $pdo->prepare("UPDATE paper_translates
                      SET status='processing', error_msg=NULL, result_json='null', finished_at=NULL
                    WHERE id=?")->execute([$id]);

    json_response_no_exit([
        'ok' => true, 'id' => $id, 'share_token' => $row['share_token'], 'status' => 'processing',
        'message' => '再投入を開始しました (新規課金なし)。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    ai_paper_translate_run_background($pdo, $cfg, $id, (string)$row['share_token'], $fileId, $payload, $apiKey, (string)$row['pdf_name'], $uid);
}

// v813 #405 要約 row の保存済 PDF を流用してペアの全訳 row を新規作成。
//   アップロード不要、直接「📑 全訳を作る」ボタンから呼ぶ。
function ai_paper_full_translate_from_summary(PDO $pdo, array $cfg, int $summaryId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_translates WHERE id=?");
    $st->execute([$summaryId]);
    $sumRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$sumRow) throw new ApiException('not_found', '要約 row がありません', 404);
    if ((int)$sumRow['user_id'] !== $uid) throw new ApiException('forbidden', '本人の要約のみペア全訳を作れます', 403);
    if (empty($sumRow['pdf_path'])) throw new ApiException('bad_request', '元 PDF が残っていないので全訳を作れません', 400);
    $pdfAbs = '/var/www/labpay/public' . $sumRow['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体が見つかりません', 404);

    $body = read_json_body();
    $direction = (string)($body['direction'] ?? 'en2ja');
    if (!in_array($direction, ['en2ja', 'ja2en'], true)) {
        throw new ApiException('bad_request', 'direction は en2ja / ja2en のみ', 400);
    }
    $models = ai_paper_full_translate_models_for($direction);
    $reqModel = trim((string)($body['model'] ?? 'gpt-5'));
    if (!isset($models[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $baseCost = (int)$models[$reqModel];
    $autoShare = !empty($body['auto_share']) ? 1 : 0;
    // v913 共有=基本額 / 非共有=倍額
    $cost = _ai_share_priced_cost($baseCost, (bool)$autoShare);

    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, (string)$sumRow['pdf_name'], $apiKey);

    // 保存用 PDF を新規 token フォルダにコピー (paper_full_translations は自分の pdf_path を持つ)
    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pdfRel = '/uploads/paper_full_translations/' . $token . '/original.pdf';
    $pdfAbsNew = $publicDir . $pdfRel;
    @mkdir(dirname($pdfAbsNew), 0775, true);
    if (!copy($pdfAbs, $pdfAbsNew)) { $pdfRel = null; } else { @chmod($pdfAbsNew, 0644); }

    $pdfName = (string)$sumRow['pdf_name'];
    $pdfSha = (string)$sumRow['pdf_sha256'];
    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $pdfName, $direction, $reqModel, $cost, $pdfRel, $pdfSha, $autoShare, $skipCharge, &$rowId) {
        $pdo->prepare("INSERT INTO paper_full_translations
            (user_id, share_token, pdf_path, pdf_name, pdf_sha256, direction, model, cost_points, status, progress_text, auto_share)
            VALUES (?,?,?,?,?,?,?,?,'pending','OpenAI に依頼中…',?)")
            ->execute([$uid, $token, $pdfRel, mb_substr($pdfName, 0, 255), $pdfSha, $direction, $reqModel, $cost, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_full_translate', 'paper_full_translation', $rowId,
                '論文全訳 (' . $direction . ') 依頼料 (要約から)');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'direction' => $direction, 'model' => $reqModel,
        'message' => 'ペアの全訳を開始しました。結果ページで進捗を確認してください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $rowId, $token, $fileId, $direction, $reqModel, $apiKey, $uid);
}

// v813 #405 対称: 全訳 row の保存済 PDF を流用してペアの要約 row を新規作成。
function ai_paper_translate_from_full(PDO $pdo, array $cfg, int $fullId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_full_translations WHERE id=?");
    $st->execute([$fullId]);
    $fullRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fullRow) throw new ApiException('not_found', '全訳 row がありません', 404);
    if ((int)$fullRow['user_id'] !== $uid) throw new ApiException('forbidden', '本人の全訳のみペア要約を作れます', 403);
    if (empty($fullRow['pdf_path'])) throw new ApiException('bad_request', '元 PDF が残っていないので要約を作れません', 400);
    $pdfAbs = '/var/www/labpay/public' . $fullRow['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体が見つかりません', 404);

    $body = read_json_body();
    $reqModel = trim((string)($body['model'] ?? 'gpt-5'));
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応モデル: ' . $reqModel, 400);
    }
    $baseCost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    $autoShare = !empty($body['auto_share']) ? 1 : 0;
    // v913 共有=基本額 / 非共有=倍額
    $cost = _ai_share_priced_cost($baseCost, (bool)$autoShare);

    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, (string)$fullRow['pdf_name'], $apiKey);

    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pagesRel = '/uploads/paper_pages/' . $token;
    $pagesAbs = $publicDir . $pagesRel;
    @mkdir($pagesAbs, 0775, true);
    $pdfRel = '/uploads/paper_pdfs/' . $token . '/original.pdf';
    $pdfAbsNew = $publicDir . $pdfRel;
    @mkdir(dirname($pdfAbsNew), 0775, true);
    if (!copy($pdfAbs, $pdfAbsNew)) { $pdfRel = null; } else { @chmod($pdfAbsNew, 0644); }
    $pagesCount = 0;
    try {
        $cmd = sprintf('pdftoppm -jpeg -jpegopt quality=85 -r 160 %s %s 2>&1',
            escapeshellarg($pdfAbs), escapeshellarg($pagesAbs . '/page'));
        exec($cmd, $out, $rc);
        if ($rc === 0) {
            foreach (glob($pagesAbs . '/page-*.jpg') ?: [] as $p) @chmod($p, 0644);
            $pagesCount = count(glob($pagesAbs . '/page-*.jpg') ?: []);
        }
    } catch (Throwable $_) {}

    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付した PDF の研究論文を、 system prompt の指示に沿って詳細サマリ + 落合メソッドで日本語要約してください。 figure_refs の page 番号は PDF の物理ページ (1 始まり) で正確に。出力 JSON のみ。\n\n書く前と書いた後で、必ず PDF の該当箇所を再確認し、数値 / 著者主張 / 結果が一致することを自分で検証してから JSON を出してください。ハルシネーションは厳禁です。";

    $payloadArr = [
        'model' => $reqModel,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $reqModel)) {
        $payloadArr['temperature'] = 0.2;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    $pdfName = (string)$fullRow['pdf_name'];
    $pdfSha = (string)$fullRow['pdf_sha256'];
    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $fileId, $pdfName, $sys, $pagesCount, $pagesRel, $pdfRel, $pdfSha, $reqModel, $cost, $autoShare, $skipCharge, &$rowId) {
        $pdo->prepare("INSERT INTO paper_translates
            (user_id, share_token, file_id, pdf_name, pdf_sha256, prompt_used, result_json, cost_points, status, pages_count, pages_dir, pdf_path, model, auto_share, share_priced)
            VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,1)")
            ->execute([$uid, $token, $fileId, mb_substr($pdfName, 0, 255), $pdfSha, $sys, 'null', $cost,
                       $pagesCount > 0 ? $pagesCount : null, $pagesCount > 0 ? $pagesRel : null,
                       $pdfRel, $reqModel, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $rowId, '論文要約依頼料 (全訳から)');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'model' => $reqModel,
        'message' => 'ペアの要約を開始しました。結果ページで進捗を確認してください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    ai_paper_translate_run_background($pdo, $cfg, $rowId, $token, $fileId, $payload, $apiKey, $pdfName, $uid);
}

function ai_paper_full_translate_submit(PDO $pdo, array $cfg, int $rowId, string $token, string $fileId, string $direction, string $model, string $apiKey, int $uid): void {
    try {
        $pdo->prepare("UPDATE paper_full_translations SET status='processing' WHERE id=?")->execute([$rowId]);

        $sys = $direction === 'ja2en' ? PAPER_FULL_TRANSLATE_SYSTEM_PROMPT_JA2EN : PAPER_FULL_TRANSLATE_SYSTEM_PROMPT_EN2JA;
        $userInstruction = $direction === 'ja2en'
            ? "Translate the attached Japanese paper to full English with chapter-by-chapter back-translation, then a polish pass. Return JSON only per the schema."
            : "添付の英語論文を章ごとに日本語で全訳 + back-translation で整合確認 + 用語統一と全体ポリッシュまでやってください。 JSON のみ返却。";

        $payloadArr = [
            'model' => $model,
            'input' => [
                ['role' => 'system', 'content' => $sys],
                ['role' => 'user', 'content' => [
                    ['type' => 'input_file', 'file_id' => $fileId],
                    ['type' => 'input_text', 'text' => $userInstruction],
                ]],
            ],
            'max_output_tokens' => 64000,
            'background' => true,
        ];
        if (preg_match('/^(gpt-5|o1|o3)/', $model)) {
            $payloadArr['reasoning'] = ['effort' => 'medium'];
        }
        $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

        $ch = curl_init('https://api.openai.com/v1/responses');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
            CURLOPT_POSTFIELDS => $payload, CURLOPT_TIMEOUT => 60,
        ]);
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($resp === false || $status >= 400) {
            $errMsg = '';
            if ($resp !== false) {
                $errJ = json_decode((string)$resp, true);
                $errMsg = $errJ['error']['message'] ?? '';
            }
            throw new RuntimeException('OpenAI: HTTP ' . $status . ($errMsg ? ' — ' . $errMsg : ''));
        }
        $j = json_decode((string)$resp, true);
        $rid = (string)($j['id'] ?? '');
        if ($rid === '') throw new RuntimeException('response_id 取得失敗');

        $pdo->prepare("UPDATE paper_full_translations SET openai_response_id=?, progress_text=? WHERE id=?")
            ->execute([$rid, '📑 章を切り出して翻訳を始めています…', $rowId]);
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg=?, finished_at=NOW() WHERE id=?")
            ->execute([mb_substr($e->getMessage(), 0, 1000), $rowId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ 論文全訳失敗: " . $e->getMessage() . " /#/paper-translate-full/r/{$token}",
                'paper_full_translation', $rowId);
        } catch (Throwable $_) {}
    }
}

// Deep Research と同じポーリング構造で OpenAI に状態を問い合わせ。
function ai_paper_full_translate_poll(PDO $pdo, array $cfg, array $row): array {
    $apiKey = (string)$cfg['openai']['api_key'];
    $rid    = (string)$row['openai_response_id'];
    if ($apiKey === '' || $rid === '') return $row;

    $ch = curl_init('https://api.openai.com/v1/responses/' . urlencode($rid));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) return $row;
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return $row;

    $oaStatus = (string)($j['status'] ?? 'in_progress');
    $reasoningCount = 0; $hasMessage = false;
    foreach (($j['output'] ?? []) as $it) {
        $t = $it['type'] ?? '';
        if ($t === 'reasoning') $reasoningCount++;
        elseif ($t === 'message') $hasMessage = true;
    }

    if ($oaStatus === 'completed') {
        $text = '';
        foreach (($j['output'] ?? []) as $item) {
            if (($item['type'] ?? '') === 'message') {
                foreach (($item['content'] ?? []) as $c) {
                    if (($c['type'] ?? '') === 'output_text' && isset($c['text'])) {
                        $text .= (string)$c['text'];
                    }
                }
            }
        }
        if ($text === '' && isset($j['output_text']) && is_string($j['output_text'])) $text = (string)$j['output_text'];
        if ($text === '') {
            $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg='completed だが output_text が空', finished_at=NOW() WHERE id=?")
                ->execute([$row['id']]);
            $row['status'] = 'error'; return $row;
        }
        $jsonText = $text;
        if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/s', $text, $m)) $jsonText = $m[1];
        elseif (preg_match('/(\{.*\})/s', $text, $m)) $jsonText = $m[1];
        $parsed = json_decode($jsonText, true);
        if (!is_array($parsed)) {
            $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg='invalid JSON in output', finished_at=NOW() WHERE id=?")
                ->execute([$row['id']]);
            $row['status'] = 'error'; return $row;
        }
        $usage = $j['usage'] ?? [];
        $usageRec = [
            'input_tokens'  => (int)($usage['input_tokens']  ?? 0),
            'output_tokens' => (int)($usage['output_tokens'] ?? 0),
            'total_tokens'  => (int)($usage['total_tokens']  ?? 0),
            'chapters_count'=> count($parsed['chapters'] ?? []),
        ];
        $pdo->prepare("UPDATE paper_full_translations
                          SET result_json=?, usage_json=?, status='done',
                              progress_text=NULL, finished_at=NOW()
                        WHERE id=?")
            ->execute([
                json_encode($parsed, JSON_UNESCAPED_UNICODE),
                json_encode($usageRec, JSON_UNESCAPED_UNICODE),
                $row['id'],
            ]);
        // v804 auto_share=1 なら公開 ON に
        $pdo->prepare("UPDATE paper_full_translations SET is_shared=1, shared_at=NOW() WHERE id=? AND auto_share=1 AND is_shared=0")
            ->execute([$row['id']]);
        try {
            $title = is_array($parsed) ? (string)($parsed['title_translated'] ?? $parsed['title_original'] ?? $row['pdf_name']) : $row['pdf_name'];
            $title = mb_substr($title, 0, 60);
            notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice',
                "📑 論文全訳完了: 「{$title}」 /#/paper-translate-full/r/{$row['share_token']}",
                'paper_full_translation', (int)$row['id']);
        } catch (Throwable $_) {}
        $row['status'] = 'done';
        $row['result_json'] = json_encode($parsed, JSON_UNESCAPED_UNICODE);
        $row['usage_json']  = json_encode($usageRec, JSON_UNESCAPED_UNICODE);
        $row['progress_text'] = null;
        return $row;
    }
    if ($oaStatus === 'failed' || $oaStatus === 'cancelled' || $oaStatus === 'incomplete') {
        $errMsg = (string)($j['error']['message'] ?? ($j['incomplete_details']['reason'] ?? $oaStatus));
        $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg=?, finished_at=NOW() WHERE id=?")
            ->execute(['OpenAI ' . $oaStatus . ': ' . mb_substr($errMsg, 0, 400), (int)$row['id']]);
        $row['status'] = 'error'; $row['error_msg'] = 'OpenAI ' . $oaStatus . ': ' . $errMsg;
        return $row;
    }
    $progress = "🧠 推論 {$reasoningCount} 段 / OpenAI: {$oaStatus}";
    $pdo->prepare("UPDATE paper_full_translations SET progress_text=? WHERE id=?")
        ->execute([$progress, (int)$row['id']]);
    $row['progress_text'] = $progress;
    return $row;
}

// ============================================================================
// v789 #389 論文要約 / 全訳共通のいいね・ブックマーク・コメント。
//   ref_type は 'paper_translate' (要約) / 'paper_full_translation' (全訳)。
// ============================================================================

// v841 #424 旧 react エンドポイント。 ai_result_stars / ai_result_bookmarks に書くように変更
// (新フロントは /api/ai/stars と /api/ai/bookmarks を直接呼ぶが、旧キャッシュ /Service worker の
// クライアントが POST してきた場合の互換性のため残す)。
function ai_paper_react_toggle(PDO $pdo, array $cfg, string $refType, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? '');
    if (!in_array($kind, ['like', 'bookmark'], true)) {
        throw new ApiException('bad_request', 'kind は like / bookmark のみ', 400);
    }
    $table = $refType === 'paper_full_translation' ? 'paper_full_translations' : 'paper_translates';
    $st = $pdo->prepare("SELECT id FROM $table WHERE id=?");
    $st->execute([$refId]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'ref not found', 404);

    // like → ai_result_stars、 bookmark → ai_result_bookmarks にトグル
    $tgtTable = $kind === 'like' ? 'ai_result_stars' : 'ai_result_bookmarks';
    $del = $pdo->prepare("DELETE FROM $tgtTable WHERE kind=? AND ref_id=? AND user_id=?");
    $del->execute([$refType, $refId, $uid]);
    $turnedOn = $del->rowCount() === 0;
    if ($turnedOn) {
        $pdo->prepare("INSERT IGNORE INTO $tgtTable (kind, ref_id, user_id) VALUES (?,?,?)")
            ->execute([$refType, $refId, $uid]);
    }
    // 集計
    $countSt = $pdo->prepare("SELECT (SELECT COUNT(*) FROM ai_result_stars WHERE kind=? AND ref_id=?) AS likes,
                                     (SELECT COUNT(*) FROM ai_result_bookmarks WHERE kind=? AND ref_id=?) AS bookmarks");
    $countSt->execute([$refType, $refId, $refType, $refId]);
    $c = $countSt->fetch(PDO::FETCH_ASSOC) ?: ['likes' => 0, 'bookmarks' => 0];
    json_response([
        'ok' => true, 'kind' => $kind, 'on' => $turnedOn,
        'counts' => ['like' => (int)$c['likes'], 'bookmark' => (int)$c['bookmarks']],
    ]);
}

function ai_paper_comments_list(PDO $pdo, array $cfg, string $refType, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT c.id, c.user_id, c.body, c.created_at,
                                u.display_name, u.avatar_url
                           FROM paper_comments c JOIN users u ON u.id = c.user_id
                          WHERE c.ref_type=? AND c.ref_id=?
                          ORDER BY c.created_at ASC LIMIT 200");
    $st->execute([$refType, $refId]);
    $items = array_map(function ($r) use ($uid) {
        return [
            'id' => (int)$r['id'], 'user_id' => (int)$r['user_id'],
            'display_name' => $r['display_name'], 'avatar_url' => $r['avatar_url'],
            'body' => $r['body'], 'created_at' => $r['created_at'],
            'mine' => (int)$r['user_id'] === $uid,
        ];
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items]);
}

function ai_paper_comment_create(PDO $pdo, array $cfg, string $refType, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $text = trim((string)($body['body'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'body が必要', 400);
    if (mb_strlen($text) > 2000) throw new ApiException('bad_request', 'コメントは 2000 字まで', 400);
    $table = $refType === 'paper_full_translation' ? 'paper_full_translations' : 'paper_translates';
    $st = $pdo->prepare("SELECT user_id FROM $table WHERE id=?");
    $st->execute([$refId]);
    $authorUid = (int)$st->fetchColumn();
    if (!$authorUid) throw new ApiException('not_found', 'ref not found', 404);
    $ins = $pdo->prepare("INSERT INTO paper_comments (ref_type, ref_id, user_id, body) VALUES (?,?,?,?)");
    $ins->execute([$refType, $refId, $uid, $text]);
    $cid = (int)$pdo->lastInsertId();
    // 投稿者が別人なら通知
    if ($authorUid !== $uid) {
        try {
            $snippet = mb_substr($text, 0, 60);
            $kindLabel = $refType === 'paper_full_translation' ? '論文全訳' : '論文要約';
            $urlSlug   = $refType === 'paper_full_translation' ? 'paper-translate-full' : 'paper-summary';
            // ref token を取って通知 body に埋め込み (Slack DM が body 内 URL を拾う)
            $st2 = $pdo->prepare("SELECT share_token FROM $table WHERE id=?");
            $st2->execute([$refId]);
            $token = (string)$st2->fetchColumn();
            notify_safely($pdo, $cfg, $authorUid, 'admin_notice',
                "💬 {$u['display_name']} さんがあなたの {$kindLabel} にコメント: 「{$snippet}」 /#/{$urlSlug}/r/{$token}",
                $refType === 'paper_full_translation' ? 'paper_full_translation' : 'paper_translate',
                $refId);
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $cid]);
}

function ai_paper_comment_delete(PDO $pdo, array $cfg, string $refType, int $refId, int $cid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id FROM paper_comments WHERE id=? AND ref_type=? AND ref_id=?");
    $st->execute([$cid, $refType, $refId]);
    $cuid = (int)$st->fetchColumn();
    if (!$cuid) throw new ApiException('not_found', 'comment not found', 404);
    if ($cuid !== $uid && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '本人 / admin のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM paper_comments WHERE id=?")->execute([$cid]);
    json_response(['ok' => true]);
}

// 要約 / 全訳 / Deep Research 詳細ページの反応集計。
// v841 #424 paper_reactions を捨てて ai_result_stars + ai_result_bookmarks に統合 (一覧と同じソース)。
// 後方互換のため like/my_like/bookmark/my_bookmark のキー名はそのまま維持
// (= フロントの既存コードが r.like / r.bookmark を参照しても動く)。
function ai_paper_reactions_summary(PDO $pdo, string $refType, int $refId, int $meId): array {
    // ai_result_stars (= ⭐)
    $stS = $pdo->prepare("SELECT COUNT(*) AS n, MAX(user_id=?) AS mine
                            FROM ai_result_stars WHERE kind=? AND ref_id=?");
    $stS->execute([$meId, $refType, $refId]);
    $rs = $stS->fetch(PDO::FETCH_ASSOC) ?: ['n' => 0, 'mine' => 0];
    // ai_result_bookmarks (= 🔖)
    $stB = $pdo->prepare("SELECT COUNT(*) AS n, MAX(user_id=?) AS mine
                            FROM ai_result_bookmarks WHERE kind=? AND ref_id=?");
    $stB->execute([$meId, $refType, $refId]);
    $rb = $stB->fetch(PDO::FETCH_ASSOC) ?: ['n' => 0, 'mine' => 0];
    $r = [
        // 新キー (v841 以降のフロントが参照)
        'star_count'     => (int)$rs['n'],
        'my_starred'     => (int)$rs['mine'] === 1,
        'bookmark_count' => (int)$rb['n'],
        'my_bookmarked'  => (int)$rb['mine'] === 1,
        // 旧キー (後方互換)
        'like'        => (int)$rs['n'],
        'my_like'     => (int)$rs['mine'] === 1,
        'bookmark'    => (int)$rb['n'],
        'my_bookmark' => (int)$rb['mine'] === 1,
    ];
    // コメント数も軽く取得
    $st2 = $pdo->prepare("SELECT COUNT(*) FROM paper_comments WHERE ref_type=? AND ref_id=?");
    $st2->execute([$refType, $refId]);
    $r['comment_count'] = (int)$st2->fetchColumn();
    return $r;
}

// POST /api/ai/short_title { context: "...説明..." }
//   → { title: "..." }
// 1 行 5-15 字の楽しい日本語タイトルを 1 つだけ返す。タイマーやストップウォッチ
// 作成時の「タイトル空欄 → 自動生成」用。軽い call なのでキャッシュなし / 履歴なし。
function ai_short_title(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $context = trim((string)($body['context'] ?? ''));
    if ($context === '') throw new ApiException('bad_request', 'context required', 400);
    if (mb_strlen($context) > 500) $context = mb_substr($context, 0, 500);

    $sys = "短い楽しい日本語タイトルを 1 つだけ返してください。 5-15 文字。絵文字 1 個まで添えても OK。余計な前置きや解説は不要、タイトル 1 行のみ。引用符 (「」等) で囲まない。";

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user',   'content' => $context],
        ],
        'temperature' => 0.9,
        'max_completion_tokens' => 30,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 15,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) {
        throw new ApiException('upstream_error', 'OpenAI: HTTP ' . $status, 502);
    }
    $j = json_decode((string)$resp, true);
    $text = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new ApiException('upstream_error', 'empty', 502);
    }
    // 整形: 引用符除去 / 1 行に / 最大 30 文字
    $title = trim(preg_replace('/[\r\n]+/', ' ', $text));
    $title = preg_replace('/^[「『"\']+|[」』"\']+$/u', '', $title);
    $title = mb_substr($title, 0, 30);
    json_response(['ok' => true, 'title' => $title]);
}

// POST /api/ai/chat { message, history?: [{role,content},...] }
//   → { text }
// 汎用多言語対話 (主に翻訳用途)。 LabPay 操作には言及せず、ユーザーの
// 入力をそのまま翻訳 / 解説。
function ai_chat(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') throw new ApiException('bad_request', 'message required', 400);
    if (mb_strlen($msg) > 4000) throw new ApiException('bad_request', 'message too long', 400);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    $history = array_slice($history, -20);

    $sys = <<<SYS
あなたは中村さん (日本語話者) のための多言語対話・翻訳アシスタントです。主な
用途は海外出張 (中国、イタリアなど) での翻訳・コミュニケーション支援。

挙動ルール:
- 入力テキストの言語を自動判定
- 日本語で「○○ を中国語で」「これをイタリア語に」と言われたら該当言語へ翻訳
- 「翻訳して」だけなら文脈から最も妥当な訳先 (= 日本語 ↔ 外国語) に
- 外国語が直接入力されたら日本語訳を返す + 短い解説 (発音 / 文化的ニュアンス / 食べ物なら何か / 注意事項など)
- 一般的な質問にも答える (相手先国のマナー、注文のしかた、通貨計算など)
- 余計な前置きは不要、結果を直接

書式:
- 翻訳結果は **太字**
- 発音 / カナ表記が有用なら括弧で添える
- 補足はその下に 1-2 行
- 長文は箇条書きで整理

例:
ユーザー: 「『お会計お願いします』をイタリア語で」
返答:
**Il conto, per favore.**
(イル・コント・ペル・ファヴォーレ / 直訳「勘定書をお願いします」)
└ レストランで一般的。カフェなら "Quanto le devo?" (クアント・レ・デヴォ / いくらですか) も自然。
SYS;

    $messages = [['role' => 'system', 'content' => $sys]];
    foreach ($history as $h) {
        $role = (string)($h['role'] ?? '');
        $role = ($role === 'assistant') ? 'assistant' : 'user';
        $content = mb_substr((string)($h['content'] ?? ''), 0, 4000);
        if ($content === '') continue;
        $messages[] = ['role' => $role, 'content' => $content];
    }
    $messages[] = ['role' => 'user', 'content' => $msg];

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => $messages,
        'temperature' => 0.3,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false || $status >= 500) {
        throw new ApiException('upstream_error', 'OpenAI: ' . ($err ?: 'HTTP ' . $status), 502);
    }
    if ($status >= 400) {
        $j = json_decode((string)$resp, true);
        $msg2 = $j['error']['message'] ?? ('HTTP ' . $status);
        throw new ApiException('upstream_error', 'OpenAI: ' . $msg2, 502);
    }
    $j = json_decode((string)$resp, true);
    $text = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new ApiException('upstream_error', 'empty response', 502);
    }
    json_response(['ok' => true, 'text' => trim($text)]);
}

// POST /api/ai/assistant { message: "...", history?: [{role,content},...] }
//   → { text: "...操作手順..." }
// LabPay の使い方を案内する Q&A エージェント (UI ナビゲーション特化)。
// ユーザーデータ (残高 / 履歴等) にはアクセスしない — そこを答える時は「設定 →
// ...」と操作手順を案内するだけ。
function ai_assistant(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') throw new ApiException('bad_request', 'message required', 400);
    if (mb_strlen($msg) > 2000) throw new ApiException('bad_request', 'message too long', 400);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    $history = array_slice($history, -10); // 直近 10 ターンだけ持ち回す

    $sys = <<<SYS
あなたは LabPay の使い方ガイドアシスタントです。ユーザーの「○○ したいけどどこから?」
「△△ の情報見たい」に、簡潔な操作手順で答えてください。ユーザー本人のデータ
(残高 / 履歴 / 通知等) は見えないので、個別データを聞かれた場合は「○○ メニュー
で確認できます」と場所を案内するに留めること。

回答ルール:
- 太字 (**○○**) で重要ボタン名やメニュー名を強調
- 番号付きリストで手順を並べる
- 関連機能があれば末尾に「関連: ...」で 1 行紹介
- 不明な機能を聞かれたら「LabPay にはその機能はありません」と正直に
- 過度な前置きや「お問い合わせありがとうございます」等は不要、答えだけ

LabPay の主なナビゲーション:
- **ホーム** (#/): 残高、クイックボタン (買う/売る/頼む/送る/翻訳…)、未対応カード、今日の予定、グループ、募集、新着プレイリスト、参加中タイマー
- **買う** (#/buy): 商品一覧 + JAN コードスキャン
- **売る** (#/sell): 出品
- **頼む** (#/tasks): タスク作成 (報酬付き募集 / 指名 / リクエスト) — ホームの「頼む」でも
- **送る** (#/send): 個人間ポイント送金
- **アプリ** (#/apps): ルーレット / 投票 / 点呼 / タイマー / ストップウォッチ / 翻訳 / 待ち合わせ / 飲み会割り勘 / ワリカ電卓 / 請求 / オークション / プレイリスト / ランダム分け / 連絡先 / 重要連絡 / Scrapbox / 関係性グラフ / 運動 / ラボ滞在マップ
- **グループ** (#/groups): 出張 / 旅行向け一時メンバー枠 + スケジュール + ワリカ + 地図 + 翻訳ログ + チャット
- **募集** (#/invitations): お昼ご飯 / 飲み会等カジュアル集合
- **実績** (#/achievements): 学業 / 売買 / 滞在 / ラボ運営など 15 カテゴリ
- **設定** (#/settings): プロフィール / アバター / タブ並び替え / ホーム上部クイックボタン / アプリ表示 / Google Calendar / Zoom 連携 / 端末 (MAC) 登録 / プロフィール (Slack / 電話) / 効果音 / ホームカード並び
- **報告・要望** (#/feedback-admin or トップナビ): バグ報告 / 機能要望
- **通知** (#/notifications): 通知ベルから

特殊機能ヒント:
- **AI 機能**: スケジュールフリーテキスト展開 (グループ予定追加 modal 上部「✨」)、場所名 → 緯度経度+説明+画像自動入力 (タイトル横「🔍 場所を検索」)、画像翻訳 (#/translate)、翻訳ログ (グループに紐づけ可能)
- **位置共有**: グループ地図ページ (#/groups/{id}/map) の「📡 位置共有」トグルでメンバー全員に位置を共有
- **❤️ 行きたい場所**: グループスケジュールの行きたい場所ストックのタイル右下
- **ベル / 中間音**: タイマー作成時に 1ベル/2ベル/3ベル分単位で指定
SYS;

    $messages = [['role' => 'system', 'content' => $sys]];
    foreach ($history as $h) {
        $role = (string)($h['role'] ?? '');
        $role = ($role === 'assistant') ? 'assistant' : 'user';
        $content = mb_substr((string)($h['content'] ?? ''), 0, 2000);
        if ($content === '') continue;
        $messages[] = ['role' => $role, 'content' => $content];
    }
    $messages[] = ['role' => 'user', 'content' => $msg];

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => $messages,
        'temperature' => 0.3,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false || $status >= 500) {
        throw new ApiException('upstream_error', 'OpenAI: ' . ($err ?: 'HTTP ' . $status), 502);
    }
    if ($status >= 400) {
        $j = json_decode((string)$resp, true);
        $msg2 = $j['error']['message'] ?? ('HTTP ' . $status);
        throw new ApiException('upstream_error', 'OpenAI: ' . $msg2, 502);
    }
    $j = json_decode((string)$resp, true);
    $text = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new ApiException('upstream_error', 'empty response', 502);
    }
    json_response(['ok' => true, 'text' => trim($text)]);
}

// POST /api/ai/place_lookup { name: "東京タワー" }
//   → { name, lat, lng, display_name, description, image_url, source }
// 段取り: Nominatim (lat/lng + 表示名) + Wikipedia ja (説明 + 画像 + 補完 coord)。
// 両方 best-effort。 OpenAI 鍵不要 (Wiki + OSM のみ)。
function ai_place_lookup(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 200) {
        throw new ApiException('bad_request', 'name length 1..200', 400);
    }
    $ua = 'LabPay/1.0 (https://pay.nkmr.io)';
    $sources = [];
    $lat = null; $lng = null; $displayName = null; $description = null; $imageUrl = null;

    // 1. Nominatim
    $nUrl = 'https://nominatim.openstreetmap.org/search?'
          . http_build_query(['q' => $name, 'format' => 'json', 'accept-language' => 'ja', 'limit' => 1]);
    $resp = ai_http_get($nUrl, $ua, 10);
    if ($resp !== null) {
        $j = json_decode($resp, true);
        if (!empty($j[0])) {
            $lat = isset($j[0]['lat']) ? (float)$j[0]['lat'] : null;
            $lng = isset($j[0]['lon']) ? (float)$j[0]['lon'] : null;
            $displayName = (string)($j[0]['display_name'] ?? '');
            $sources[] = 'nominatim';
        }
    }

    // 2. Wikipedia ja 検索 → page summary
    $searchUrl = 'https://ja.wikipedia.org/w/api.php?'
        . http_build_query(['action' => 'query', 'list' => 'search', 'srsearch' => $name, 'format' => 'json', 'srlimit' => 1]);
    $resp = ai_http_get($searchUrl, $ua, 10);
    if ($resp !== null) {
        $j = json_decode($resp, true);
        $title = $j['query']['search'][0]['title'] ?? null;
        if ($title) {
            $sumUrl = 'https://ja.wikipedia.org/api/rest_v1/page/summary/' . rawurlencode($title);
            $resp = ai_http_get($sumUrl, $ua, 10);
            if ($resp !== null) {
                $sj = json_decode($resp, true);
                if (is_array($sj)) {
                    $description = isset($sj['extract']) ? mb_substr((string)$sj['extract'], 0, 1000) : $description;
                    if (isset($sj['thumbnail']['source'])) {
                        $imageUrl = (string)$sj['thumbnail']['source'];
                    } elseif (isset($sj['originalimage']['source'])) {
                        $imageUrl = (string)$sj['originalimage']['source'];
                    }
                    if ($lat === null && isset($sj['coordinates']['lat'])) {
                        $lat = (float)$sj['coordinates']['lat'];
                        $lng = (float)$sj['coordinates']['lon'];
                    }
                    if (!$displayName && isset($sj['title'])) {
                        $displayName = (string)$sj['title'];
                    }
                    $sources[] = 'wikipedia';
                }
            }
        }
    }

    if (!$sources) {
        throw new ApiException('not_found', '見つかりませんでした (Nominatim / Wikipedia いずれも 0 件)', 404);
    }
    json_response([
        'ok'           => true,
        'name'         => $name,
        'lat'          => $lat,
        'lng'          => $lng,
        'display_name' => $displayName,
        'description'  => $description,
        'image_url'    => $imageUrl,
        'sources'      => $sources,
    ]);
}

function ai_http_get(string $url, string $ua, int $timeout): ?string {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['User-Agent: ' . $ua, 'Accept: application/json'],
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
    ]);
    $resp = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400) return null;
    return (string)$resp;
}

function ai_assert_configured(array $cfg): void {
    $k = (string)($cfg['openai']['api_key'] ?? '');
    if ($k === '') {
        throw new ApiException('not_configured', 'OpenAI が設定されていません (config.openai.api_key)', 503);
    }
}

// POST /api/ai/expand_schedule
//   body: { text: "明日 12 時から渋谷駅前でランチ 1 時間半" }
//   返値: { fields: { title, day_date, start_time, duration_minutes, ... } }
function ai_expand_schedule(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $text = trim((string)($body['text'] ?? ''));
    if ($text === '') throw new ApiException('bad_request', 'text required', 400);
    if (mb_strlen($text) > 2000) throw new ApiException('bad_request', 'text too long', 400);

    $tz = new DateTimeZone((string)($cfg['app']['timezone'] ?? 'Asia/Tokyo'));
    $today = (new DateTimeImmutable('now', $tz))->format('Y-m-d');
    $dow   = ['日','月','火','水','木','金','土'][(int)(new DateTimeImmutable('now', $tz))->format('w')];

    $system = <<<SYS
あなたはスケジュール抽出器です。ユーザーの日本語フリーテキストから、
以下のフィールドを抽出して JSON で返してください。該当が無いフィールドは null。

本日は {$today} ({$dow})。「明日」「来週月曜」等の相対日付は本日基準で解釈。
時刻が明示されない場合は null。「お昼」 → 12:00、「夕方」 → 17:00、「夜」 → 19:00 と推測。
場所 (location) はそのまま。緯度経度が含まれて居れば別途。

出力 JSON のフィールド (これ以外出力しない):
- title (str, 必須): 短い 1 行タイトル
- day_date (str "YYYY-MM-DD" or null): 開始日
- start_time (str "HH:MM" or null): 開始時刻
- duration_minutes (int or null): 所要時間 (分)
- end_date (str "YYYY-MM-DD" or null): 終了日 (複数日跨ぐ場合)
- end_time (str "HH:MM" or null): 終了時刻
- location (str or null): 場所名 (緯度経度を含む場合は memo に回す)
- memo (str or null): 補足情報
- url (str or null): http(s):// で始まる URL があれば
- kind (str): flight, train, bus, taxi, car, walk, hotel, conf, meeting, meetup, food, fun, other の中で最も適切なもの。待ち合わせ系 (集合 / 待ち合わせ) は meetup。食事は food。観光・遊びは fun。不明は other
SYS;

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user',   'content' => $text],
        ],
        'response_format' => ['type' => 'json_object'],
        'temperature' => 0.1,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 30,
    ]);
    $resp   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($resp === false || $status >= 500) {
        throw new ApiException('upstream_error', 'OpenAI: ' . ($err ?: 'HTTP ' . $status), 502);
    }
    if ($status >= 400) {
        $j = json_decode((string)$resp, true);
        $msg = $j['error']['message'] ?? ('HTTP ' . $status);
        throw new ApiException('upstream_error', 'OpenAI: ' . $msg, 502);
    }
    $j = json_decode((string)$resp, true);
    $content = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($content)) {
        throw new ApiException('upstream_error', 'OpenAI: empty content', 502);
    }
    $fields = json_decode($content, true);
    if (!is_array($fields)) {
        throw new ApiException('upstream_error', 'OpenAI: not JSON', 502);
    }

    // バリデーション + 正規化
    static $ALLOWED_KINDS = ['flight','train','bus','taxi','car','walk','hotel','conf','meeting','meetup','food','fun','other'];
    $out = [
        'title'            => isset($fields['title']) ? mb_substr((string)$fields['title'], 0, 200) : null,
        'day_date'         => ai_norm_date($fields['day_date'] ?? null),
        'start_time'       => ai_norm_time($fields['start_time'] ?? null),
        'duration_minutes' => isset($fields['duration_minutes']) && is_numeric($fields['duration_minutes'])
                                ? max(0, min(60 * 48, (int)$fields['duration_minutes'])) : null,
        'end_date'         => ai_norm_date($fields['end_date'] ?? null),
        'end_time'         => ai_norm_time($fields['end_time'] ?? null),
        'location'         => isset($fields['location']) ? mb_substr((string)$fields['location'], 0, 500) : null,
        'memo'             => isset($fields['memo']) ? mb_substr((string)$fields['memo'], 0, 2000) : null,
        'url'              => isset($fields['url']) && is_string($fields['url']) && preg_match('#^https?://#i', $fields['url'])
                                ? mb_substr($fields['url'], 0, 2000) : null,
        'kind'             => isset($fields['kind']) && in_array($fields['kind'], $ALLOWED_KINDS, true)
                                ? $fields['kind'] : 'other',
    ];
    json_response(['ok' => true, 'fields' => $out]);
}

// POST /api/ai/translate_image
//   body: { image_url: "https://labpay/uploads/...", hint?: "メニューです" }
//   返値: { text: "...日本語訳..." }
// OpenAI Vision (gpt-4o-mini) に画像を直接投げる。 image_url は LabPay 自身の
// /uploads/ に限定 (外部 URL は弾く) → 漏洩リスク最小化。サーバ側で一旦ファイルを
// 読んで base64 data URL に変換して送る (OpenAI から外部 URL fetch を要求しない)。
function ai_translate_image(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $imageUrl = trim((string)($body['image_url'] ?? ''));
    if ($imageUrl === '') throw new ApiException('bad_request', 'image_url required', 400);
    $hint = trim((string)($body['hint'] ?? ''));
    if (mb_strlen($hint) > 500) $hint = mb_substr($hint, 0, 500);
    // v426 グループ共有 (任意)。指定時はそのグループのメンバーである必要あり。
    $groupId = isset($body['group_id']) && (int)$body['group_id'] > 0 ? (int)$body['group_id'] : null;
    if ($groupId !== null) {
        group_assert_member($pdo, $groupId, (int)$u['id']);
    }

    // 自前アップロードパスに限定。 base_url + /uploads/ で始まるか、同じホストの
    // /uploads/ 絶対 path か。
    $base = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    $rel = null;
    if ($base !== '' && strpos($imageUrl, $base . '/uploads/') === 0) {
        $rel = substr($imageUrl, strlen($base));
    } elseif (strpos($imageUrl, '/uploads/') === 0) {
        $rel = $imageUrl;
    }
    if ($rel === null) {
        throw new ApiException('bad_request', 'image_url は LabPay の /uploads/ を指してください', 400);
    }
    $docRoot = realpath(__DIR__ . '/../../public');
    if ($docRoot === false) throw new ApiException('server_error', 'public path resolution failed', 500);
    $fsPath = realpath($docRoot . $rel);
    if ($fsPath === false || strpos($fsPath, $docRoot . DIRECTORY_SEPARATOR . 'uploads') !== 0) {
        throw new ApiException('bad_request', '画像が見つかりません', 400);
    }
    if (filesize($fsPath) > 8 * 1024 * 1024) {
        throw new ApiException('bad_request', '8MB を超える画像は受け付けません', 400);
    }
    $data = file_get_contents($fsPath);
    if ($data === false) throw new ApiException('server_error', 'image read failed', 500);
    $mime = mime_content_type($fsPath) ?: 'image/jpeg';
    if (!preg_match('#^image/#', $mime)) {
        throw new ApiException('bad_request', '画像ファイルのみ受け付けます', 400);
    }
    $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($data);

    $sysPrompt = <<<SYS
画像内の外国語テキスト (メニュー、看板、説明文など) を日本語に翻訳しつつ、
日本人ユーザーが「それが何か」を理解できるよう補足説明も加えてください。

書式:
- まず翻訳をそのまま太字で示す
- 直後の括弧書き ()、もしくは翌行のインデントで、補足説明を付ける
- 補足は: その料理の国・地域、主な材料 / 味の傾向 / 食感 / 食べ方、もしくは看板なら文化的背景や法的意味
- 価格や数字はそのまま保持 (通貨記号 / 単位含めて)
- 不明瞭な部分は (?) を付ける
- メニューなら各料理を 1 品 1 行で整理 (セクション見出しも保つ)

例 (メニュー):
**Mapo Tofu — ¥85**
└ 麻婆豆腐 (豆腐と挽き肉を豆板醤・花椒で辛く炒めた中華四川料理。痺れる辛さ)

**Bún chả — 65,000₫**
└ ブンチャー (米麺 + 炭火焼き豚 + 甘酸っぱいタレのベトナムハノイ料理)

例 (看板):
**進入禁止**
└ 関係者以外入ってはいけません

ルール共通:
- 元のセクション / リスト構造は保つ
- 余計な前置き (「これは…」等) は不要、結果のみ
- 全体を Markdown (見出し / リスト / 太字 OK) で出力
SYS;

    if ($hint !== '') {
        $sysPrompt .= "\n\nユーザーからの補足情報: " . $hint;
    }

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $sysPrompt],
            ['role' => 'user', 'content' => [
                ['type' => 'text', 'text' => '画像を和訳してください。'],
                ['type' => 'image_url', 'image_url' => ['url' => $dataUrl]],
            ]],
        ],
        'temperature' => 0.2,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . (string)$cfg['openai']['api_key'],
        ],
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 60,
    ]);
    $resp   = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($resp === false || $status >= 500) {
        throw new ApiException('upstream_error', 'OpenAI: ' . ($err ?: 'HTTP ' . $status), 502);
    }
    if ($status >= 400) {
        $j = json_decode((string)$resp, true);
        $msg = $j['error']['message'] ?? ('HTTP ' . $status);
        throw new ApiException('upstream_error', 'OpenAI: ' . $msg, 502);
    }
    $j = json_decode((string)$resp, true);
    $text = $j['choices'][0]['message']['content'] ?? null;
    if (!is_string($text) || $text === '') {
        throw new ApiException('upstream_error', 'OpenAI: empty response', 502);
    }
    $text = trim($text);
    // v426 DB に保存。失敗 (例: 容量不足) しても結果は返す。
    $tid = null;
    try {
        $ins = $pdo->prepare("INSERT INTO translations (user_id, group_id, image_url, hint, result_text)
            VALUES (?, ?, ?, ?, ?)");
        $ins->execute([
            (int)$u['id'], $groupId, $imageUrl,
            $hint === '' ? null : $hint,
            $text,
        ]);
        $tid = (int)$pdo->lastInsertId();
    } catch (Throwable $_) { /* swallow */ }
    json_response(['ok' => true, 'text' => $text, 'id' => $tid, 'group_id' => $groupId]);
}

// GET /api/ai/translations
//   - mine=1 : 自分の (group_id IS NULL) ログのみ
//   - group_id=N: そのグループのログ (メンバー必須)
//   - 引数なし: 自分の + 自分が所属するグループの全部 (id DESC 50 件)
function ai_translations_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $mine    = !empty($_GET['mine']);
    $groupId = isset($_GET['group_id']) && (int)$_GET['group_id'] > 0 ? (int)$_GET['group_id'] : null;
    $limit   = max(1, min(200, (int)($_GET['limit'] ?? 50)));

    if ($groupId !== null) {
        group_assert_member($pdo, $groupId, $uid);
        $sql = "SELECT t.*, u.display_name AS user_name, u.avatar_url AS user_avatar_url
                  FROM translations t JOIN users u ON u.id = t.user_id
                 WHERE t.group_id = ? ORDER BY t.id DESC LIMIT {$limit}";
        $st = $pdo->prepare($sql);
        $st->execute([$groupId]);
    } elseif ($mine) {
        $sql = "SELECT t.*, u.display_name AS user_name, u.avatar_url AS user_avatar_url
                  FROM translations t JOIN users u ON u.id = t.user_id
                 WHERE t.user_id = ? AND t.group_id IS NULL
                 ORDER BY t.id DESC LIMIT {$limit}";
        $st = $pdo->prepare($sql);
        $st->execute([$uid]);
    } else {
        // 自分の (group_id NULL) + 自分が member のグループの全部
        $sql = "SELECT t.*, u.display_name AS user_name, u.avatar_url AS user_avatar_url,
                       g.title AS group_title
                  FROM translations t
                  JOIN users u ON u.id = t.user_id
             LEFT JOIN adhoc_groups g ON g.id = t.group_id
                 WHERE (t.user_id = ? AND t.group_id IS NULL)
                    OR (t.group_id IS NOT NULL
                        AND EXISTS (SELECT 1 FROM adhoc_group_members m
                                     WHERE m.group_id = t.group_id AND m.user_id = ?))
                 ORDER BY t.id DESC LIMIT {$limit}";
        $st = $pdo->prepare($sql);
        $st->execute([$uid, $uid]);
    }
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id']       = (int)$r['id'];
        $r['user_id']  = (int)$r['user_id'];
        $r['group_id'] = $r['group_id'] !== null ? (int)$r['group_id'] : null;
        $r['is_mine']  = (int)$r['user_id'] === $uid;
        // v521 #157 履歴 60px サムネ用
        $r['image_thumb_url'] = !empty($r['image_url']) ? thumb_url_for((string)$r['image_url']) : null;
    }
    json_response(['items' => $rows]);
}

function ai_translation_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $st = $pdo->prepare("SELECT user_id FROM translations WHERE id = ?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== (int)$u['id'] && (string)($u['role'] ?? '') !== 'admin') {
        throw new ApiException('forbidden', '作成者のみ削除可', 403);
    }
    $pdo->prepare("DELETE FROM translations WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

function ai_norm_date($v): ?string {
    if (!is_string($v) || $v === '') return null;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
}
function ai_norm_time($v): ?string {
    if (!is_string($v) || $v === '') return null;
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $v, $m)) {
        $h = (int)$m[1]; $i = (int)$m[2];
        if ($h >= 0 && $h <= 23 && $i >= 0 && $i <= 59) {
            return sprintf('%02d:%02d', $h, $i);
        }
    }
    return null;
}

// ───────── v840 ⭐ スター (ai_result_stars) ─────────

function ai_stars_valid_kinds(): array {
    return ['deep_research', 'paper_translate', 'paper_full_translation'];
}

function ai_stars_resolve_table(string $kind): string {
    return [
        'deep_research'           => 'deep_researches',
        'paper_translate'         => 'paper_translates',
        'paper_full_translation'  => 'paper_full_translations',
    ][$kind] ?? '';
}

function ai_stars_toggle(PDO $pdo, array $cfg, string $method): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? '');
    $refId = (int)($body['ref_id'] ?? 0);
    if (!in_array($kind, ai_stars_valid_kinds(), true)) {
        throw new ApiException('bad_request', 'kind が不正', 400);
    }
    if ($refId <= 0) throw new ApiException('bad_request', 'ref_id が必要', 400);
    // ref の存在確認
    $table = ai_stars_resolve_table($kind);
    $st = $pdo->prepare("SELECT id FROM $table WHERE id=?");
    $st->execute([$refId]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'ref not found', 404);

    if ($method === 'POST') {
        $pdo->prepare("INSERT IGNORE INTO ai_result_stars (kind, ref_id, user_id) VALUES (?,?,?)")
            ->execute([$kind, $refId, $uid]);
    } else { // DELETE
        $pdo->prepare("DELETE FROM ai_result_stars WHERE kind=? AND ref_id=? AND user_id=?")
            ->execute([$kind, $refId, $uid]);
    }
    // 集計を返す
    $countSt = $pdo->prepare("SELECT COUNT(*) FROM ai_result_stars WHERE kind=? AND ref_id=?");
    $countSt->execute([$kind, $refId]);
    $count = (int)$countSt->fetchColumn();
    $mineSt = $pdo->prepare("SELECT 1 FROM ai_result_stars WHERE kind=? AND ref_id=? AND user_id=?");
    $mineSt->execute([$kind, $refId, $uid]);
    json_response([
        'ok' => true,
        'kind' => $kind,
        'ref_id' => $refId,
        'star_count' => $count,
        'my_starred' => (bool)$mineSt->fetchColumn(),
    ]);
}

// 結果 list に star_count + my_starred + star_user_names (先頭3名まで) を追加する。
//   items は ['id' => ..., ...] の連想配列の配列で、 in-place に書き換える。
function ai_stars_enrich(PDO $pdo, string $kind, array &$items, int $myUid): void {
    if (!$items) return;
    if (!in_array($kind, ai_stars_valid_kinds(), true)) return;
    $ids = array_values(array_unique(array_map(fn($r) => (int)($r['id'] ?? 0), $items)));
    $ids = array_filter($ids, fn($v) => $v > 0);
    if (!$ids) return;
    $place = implode(',', array_fill(0, count($ids), '?'));
    // 集計: 各 ref の count + 自分が star してるか
    $args = array_merge([$kind], $ids);
    $st = $pdo->prepare("SELECT ref_id, COUNT(*) AS n, MAX(user_id=?) AS mine
                          FROM ai_result_stars
                         WHERE kind=? AND ref_id IN ($place)
                         GROUP BY ref_id");
    $st->execute(array_merge([$myUid, $kind], $ids));
    $byId = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $byId[(int)$r['ref_id']] = ['count' => (int)$r['n'], 'mine' => (int)$r['mine'] === 1];
    }
    // 各 ref の star した人 (先頭 3 名、 display_name) も軽く取る
    $st2 = $pdo->prepare("SELECT s.ref_id, u.display_name, u.avatar_url
                            FROM ai_result_stars s JOIN users u ON u.id = s.user_id
                           WHERE s.kind=? AND s.ref_id IN ($place)
                           ORDER BY s.created_at DESC");
    $st2->execute(array_merge([$kind], $ids));
    $namesById = [];
    foreach ($st2->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $rid = (int)$r['ref_id'];
        if (!isset($namesById[$rid])) $namesById[$rid] = [];
        if (count($namesById[$rid]) < 3) {
            $namesById[$rid][] = ['name' => $r['display_name'], 'avatar' => $r['avatar_url']];
        }
    }
    foreach ($items as &$it) {
        $rid = (int)($it['id'] ?? 0);
        $info = $byId[$rid] ?? ['count' => 0, 'mine' => false];
        $it['star_count'] = $info['count'];
        $it['my_starred'] = $info['mine'];
        $it['star_users'] = $namesById[$rid] ?? [];
    }
    unset($it);
}

// sort=stars のとき、 SQL ORDER BY を star count desc にするための SELECT 句を返すヘルパ。
//   ai.php の各 list クエリで使う想定だが、副問合せが入る分だけ場合分けが面倒なので、
//   list 側は単純な「クエリ実行後 PHP 側で sort」で対応する (件数 100 以下が前提)。
function ai_stars_apply_sort(string $kind, array $items, string $sort): array {
    if ($sort === 'stars') {
        usort($items, function($a, $b) {
            $da = (int)($a['star_count'] ?? 0); $db = (int)($b['star_count'] ?? 0);
            if ($db !== $da) return $db <=> $da;
            // tie-break: created_at desc (元の order が DESC なので id desc fallback)
            return (int)($b['id'] ?? 0) <=> (int)($a['id'] ?? 0);
        });
    }
    return $items;
}

// ───────── v841 🔖 ブックマーク (ai_result_bookmarks) ─────────

function ai_bookmarks_toggle(PDO $pdo, array $cfg, string $method): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? '');
    $refId = (int)($body['ref_id'] ?? 0);
    if (!in_array($kind, ai_stars_valid_kinds(), true)) {
        throw new ApiException('bad_request', 'kind が不正', 400);
    }
    if ($refId <= 0) throw new ApiException('bad_request', 'ref_id が必要', 400);
    $table = ai_stars_resolve_table($kind);
    $st = $pdo->prepare("SELECT id FROM $table WHERE id=?");
    $st->execute([$refId]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'ref not found', 404);

    if ($method === 'POST') {
        $pdo->prepare("INSERT IGNORE INTO ai_result_bookmarks (kind, ref_id, user_id) VALUES (?,?,?)")
            ->execute([$kind, $refId, $uid]);
    } else {
        $pdo->prepare("DELETE FROM ai_result_bookmarks WHERE kind=? AND ref_id=? AND user_id=?")
            ->execute([$kind, $refId, $uid]);
    }
    $countSt = $pdo->prepare("SELECT COUNT(*) FROM ai_result_bookmarks WHERE kind=? AND ref_id=?");
    $countSt->execute([$kind, $refId]);
    $count = (int)$countSt->fetchColumn();
    $mineSt = $pdo->prepare("SELECT 1 FROM ai_result_bookmarks WHERE kind=? AND ref_id=? AND user_id=?");
    $mineSt->execute([$kind, $refId, $uid]);
    json_response([
        'ok' => true,
        'kind' => $kind,
        'ref_id' => $refId,
        'bookmark_count' => $count,
        'my_bookmarked' => (bool)$mineSt->fetchColumn(),
    ]);
}

// 同型の enrich (bookmark_count + my_bookmarked + bookmark_users)
function ai_bookmarks_enrich(PDO $pdo, string $kind, array &$items, int $myUid): void {
    if (!$items) return;
    if (!in_array($kind, ai_stars_valid_kinds(), true)) return;
    $ids = array_values(array_unique(array_map(fn($r) => (int)($r['id'] ?? 0), $items)));
    $ids = array_filter($ids, fn($v) => $v > 0);
    if (!$ids) return;
    $place = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT ref_id, COUNT(*) AS n, MAX(user_id=?) AS mine
                          FROM ai_result_bookmarks
                         WHERE kind=? AND ref_id IN ($place)
                         GROUP BY ref_id");
    $st->execute(array_merge([$myUid, $kind], $ids));
    $byId = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $byId[(int)$r['ref_id']] = ['count' => (int)$r['n'], 'mine' => (int)$r['mine'] === 1];
    }
    foreach ($items as &$it) {
        $rid = (int)($it['id'] ?? 0);
        $info = $byId[$rid] ?? ['count' => 0, 'mine' => false];
        $it['bookmark_count'] = $info['count'];
        $it['my_bookmarked']  = $info['mine'];
    }
    unset($it);
}
