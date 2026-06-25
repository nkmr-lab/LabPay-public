<?php
// /api/ai/* — OpenAI 経由の 補助機能。 現状は スケジュール フリーフォーム 展開のみ。
// config/config.php の openai.api_key が 空のときは 503 で 黙って 断る。

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
    // v748 #359 #360 #361 論文 和訳 要約 (落合メソッド + 図表ピックアップ + 20pt)
    if ($sub === 'paper_translate' && $method === 'POST' && !isset($seg[2])) {
        ai_paper_translate($pdo, $cfg);
        return;
    }
    if ($sub === 'paper_translate' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_paper_translate_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    // v756 #372 みんな の 公開 要約 一覧 (キーワード検索 付き)
    if ($sub === 'paper_translate' && $method === 'GET' && ($seg[2] ?? '') === 'shared') {
        ai_paper_translate_shared_list($pdo, $cfg);
        return;
    }
    // v756 #372 共有 ON/OFF toggle
    if ($sub === 'paper_translate' && $method === 'PATCH' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_translate_patch($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v758 #377 「やりなおす」 (本人 のみ、 保存 された PDF で 再 処理)
    if ($sub === 'paper_translate' && $method === 'POST' && isset($seg[2]) && ctype_digit((string)$seg[2]) && ($seg[3] ?? '') === 'redo') {
        ai_paper_translate_redo($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v775 #399 本人 のみ 削除 (履歴 から 消す)
    if ($sub === 'paper_translate' && $method === 'DELETE' && isset($seg[2]) && ctype_digit((string)$seg[2])) {
        ai_paper_translate_delete($pdo, $cfg, (int)$seg[2]);
        return;
    }
    if ($sub === 'paper_translate' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_translate_list($pdo, $cfg);
        return;
    }
    // v583 #225 レジュメ原稿チェック (paper-review の 軽量版、 5pt、 テキスト入力)
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
    // v613 文字数 / 単語数制限 リライター
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
    // v781 #376 Deep Research (ChatGPT 風 多段 Web 調査)
    if ($sub === 'deep_research' && $method === 'POST' && !isset($seg[2])) {
        ai_deep_research($pdo, $cfg);
        return;
    }
    if ($sub === 'deep_research' && $method === 'GET' && ($seg[2] ?? '') === 'r' && isset($seg[3])) {
        ai_deep_research_get_shared($pdo, $cfg, (string)$seg[3]);
        return;
    }
    // v784 #382 共有 一覧 (q= 検索) — 履歴 list より 先 に 評価 (= 'shared' 文字列 を 数値 と 誤判定 しない)
    if ($sub === 'deep_research' && $method === 'GET' && ($seg[2] ?? '') === 'shared') {
        ai_deep_research_shared_list($pdo, $cfg);
        return;
    }
    // v784 #382 共有 ON/OFF toggle (本人 のみ)
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
    // v788 #386 #387 #388 論文 全訳 (E→J / J→E、 章 ごと + back-translation チェック)
    // v806 paper_full_translate の エラー row を 同 row で 再 投入 (新規 課金 なし)
    if ($sub === 'paper_full_translate' && $method === 'POST' && isset($seg[2])
        && ctype_digit((string)$seg[2]) && ($seg[3] ?? '') === 'retry') {
        ai_paper_full_translate_retry($pdo, $cfg, (int)$seg[2]);
        return;
    }
    // v806 paper_translate の エラー row を 同 row で 再 投入 (新規 課金 なし)
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
    // v789 #389 論文 要約 / 全訳 に いいね・ブックマーク・コメント
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
    // v809 論文 要約 / 全訳 を 時系列 で 合算 した 新着 feed (公開 + 自分)。 ホーム widget +
    //   /#/papers-recent ページ で 共有。 ?offset=&limit= で ページング。
    if ($sub === 'paper_recent' && $method === 'GET' && !isset($seg[2])) {
        ai_paper_recent_feed($pdo, $cfg);
        return;
    }
    // v813 #405 要約 row から ペア の 全訳 を 作る (= 保存 済 PDF を 再 利用、 アップロード 不要)
    if ($sub === 'paper_full_translate' && $method === 'POST'
        && ($seg[2] ?? '') === 'from_summary' && isset($seg[3]) && ctype_digit((string)$seg[3])) {
        ai_paper_full_translate_from_summary($pdo, $cfg, (int)$seg[3]);
        return;
    }
    // v813 #405 同 方向 (全訳 row → 要約) も 対称 で 用意
    if ($sub === 'paper_translate' && $method === 'POST'
        && ($seg[2] ?? '') === 'from_full' && isset($seg[3]) && ctype_digit((string)$seg[3])) {
        ai_paper_translate_from_full($pdo, $cfg, (int)$seg[3]);
        return;
    }
    json_error('not_found', "no ai route for $method $sub", 404);
}

// v809 論文 要約 + 全訳 の 合算 新着 feed。 公開 中 (is_shared=1, done) の もの と
//   自分 の もの (status 問わず) を created_at DESC で 合算。 widget (limit=10) と
//   /#/papers-recent (limit=20, offset=N) の 両方 で 使う。
function ai_paper_recent_feed(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $limit  = max(1, min(50, (int)($_GET['limit']  ?? 10)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));
    // 公開 or 本人 の 要約 + 全訳 を UNION ALL で 取得、 created_at DESC で ソート、
    // limit + offset で 切り出す。 件数 多くて も result_json は 軽量 な title だけ 取り出す。
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
                // 要約 は title_ja / 全訳 は title_translated → title_original
                $title = (string)($j['title_ja'] ?? $j['title_translated'] ?? '') ?: null;
                $titleOrig = (string)($j['title_original'] ?? $j['title_orig'] ?? '') ?: null;
                if ($title === null && $titleOrig !== null) { $title = $titleOrig; $titleOrig = null; }
                // v817 #411 要約 / アブスト の 先頭 約 140 字 を snippet と して 添える
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

// 文字数 (スペースあり / なし) と 単語数を サーバ側で 正確にカウント
function ai_count_text(string $s): array {
    $sNoSpace = preg_replace('/\s+/u', '', $s) ?? '';
    $cWithSpace = mb_strlen($s);
    $cNoSpace   = mb_strlen($sNoSpace);
    // 単語数: 連続する 非空白 を 1 単語 とカウント (英語向け、 日本語は意味なし)
    $words = 0;
    if (preg_match_all('/\S+/u', $s, $m)) $words = count($m[0]);
    return [
        'chars_with_space' => $cWithSpace,
        'chars_no_space'   => $cNoSpace,
        'words'            => $words,
    ];
}

function ai_detect_lang(string $s): string {
    // 日本語文字 (ひら/カナ/漢字) があれば 'ja'、 それ以外 = 'en'
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
        Ledger::transfer($pdo, $uid, 1, REWRITER_COST, 'rewriter', 'rewriter', $taskId, 'リライター 依頼料');
    });

    // 同期で OpenAI を呼ぶ (最大 REWRITER_MAX_ITER 回 リトライ)
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

        // 英文なら 和訳 (原文 + 書き直し)
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
            // 失敗なら 返金
            Ledger::transfer($pdo, 1, $uid, REWRITER_COST, 'refund', 'rewriter', $taskId, 'リライター 失敗返金');
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

const RESUME_CHECK_COST = 5;        // 旧 互換 (gpt-4.1 想定 の 標準 料金)。
const RESUME_CHECK_MODELS = [       // v774 #396 モデル 別 価格 (paper_review と 同じ 軸)
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
        'cost_points'   => RESUME_CHECK_COST,           // 旧 互換
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

    // v598 PDF (multipart) と テキスト (JSON) の 両対応。 Content-Type で 振り分け。
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
            throw new ApiException('bad_request', sprintf('原稿が長すぎます (上限 %d 文字、 現在 %d 文字)。論文査読を使ってください', RESUME_CHECK_MAX_CHARS, $len), 400);
        }
    }

    // v774 #396 モデル選択 + 動的価格 (default gpt-4.1)
    $reqModel = trim((string)($isPdf ? ($_POST['model'] ?? 'gpt-4.1') : ($body['model'] ?? 'gpt-4.1')));
    if (!isset(RESUME_CHECK_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $checkCost = (int)RESUME_CHECK_MODELS[$reqModel];

    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $checkCost) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足です (要 %d pt、現在 %d pt)', $checkCost, $bal), 400);
    }

    // PDF なら OpenAI Files API に 先に アップロード (同期で)。 課金は その後
    if ($isPdf) {
        $apiKey = (string)$cfg['openai']['api_key'];
        $fileId = ai_openai_upload_pdf($tmpPdf, $pdfName, $apiKey);
    }

    // pending レコード + 課金 → 非同期で OpenAI chat 呼出
    $checkId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $title, $text, $fileId, $pdfName, $checkCost, &$checkId) {
        // input_text 列に PDF の場合は 「[PDF: filename]」 を保存
        $inputForDb = $fileId !== null ? "[PDF: " . ($pdfName ?? 'manuscript.pdf') . "]" : $text;
        $pdo->prepare("INSERT INTO resume_checks (user_id, title, input_text, cost_points, status) VALUES (?,?,?,?,'pending')")
            ->execute([$uid, $title, $inputForDb, $checkCost]);
        $checkId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, $checkCost, 'resume_check', 'resume_check', $checkId, '原稿チェック 依頼料');
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $checkId,
        'status'      => 'pending',
        'cost_points' => $checkCost,
        'model'       => $reqModel,
        'message'     => '原稿チェック (' . $reqModel . ') を 受付けました。 30秒〜2分 で 結果 が 出ます。',
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
        $model  = $reqModel;     // v774 #396 ユーザ 指定 モデル
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
            . "  \"terminology_consistency\": {\"score\": 1-5, \"comment\": \"表記揺れの有無\", \"variations\": [\"揺れている表記 (例: 「ユーザ」 と 「ユーザー」)\", ...]},\n"
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
            // エラー時は 課金を返金
            $stU = $pdo->prepare("SELECT user_id FROM resume_checks WHERE id = ?");
            $stU->execute([$checkId]);
            $uid = (int)$stU->fetchColumn();
            if ($uid > 0) {
                Ledger::transfer($pdo, 1, $uid, RESUME_CHECK_COST, 'refund', 'resume_check', $checkId, '原稿チェック 失敗 返金');
            }
        } catch (Throwable $_) {}
    }
}

const PAPER_REVIEW_COST = 10;       // 旧 互換 (gpt-4.1 想定 の 標準 料金)。 v774 #396 モデル別 価格 へ 移行。
const PAPER_REVIEW_MODELS = [       // v774 #396 モデル 別 価格 (paper_translate と 同じ 軸)
    'gpt-4.1'    => 10,
    'gpt-5-mini' => 15,
    'gpt-5'      => 30,
    'o1'         => 50,
];
// v557 #211 拡張: 査読の評価軸を 明示。 貢献の妥当性 / 統計記述の漏れ / 論理の流れ / 章間の一気通貫性 を 徹底チェック。
const PAPER_REVIEW_DEFAULT_PROMPT = <<<PROMPT
あなたは HCI / CSCW 分野で 10 年以上のキャリアを持つ 経験豊富な査読者です。 与えられた PDF の論文を 入念に読み、 章立てを意識して 日本語で要約し、 続けて指定された会議基準で 厳密な査読コメントを作ってください。 返答は valid JSON のみ。 説明文や markdown のコードフェンスは付けないこと。

【特に丁寧に検査するチェックリスト】
1. **貢献の妥当性**: 主張する貢献 (research contribution) が 文献的に新規性があるか、 関連研究との差分が明示されているか、 「これまで誰も解決していなかった」 と言える根拠があるか。 過大な主張・水増しがないか。
2. **実験/統計の記述漏れ**: 参加者数 N / 被験者属性 / 倫理審査 / インフォームドコンセント / 報酬 / 環境 (機材・実験室・オンライン) / プレテスト / 統計手法 (検定の選択理由 / 効果量 / 多重比較補正 / 仮定検証) / 有意水準 / 信頼区間 / サンプルサイズ計算 / 欠損データ処理 が漏れなく書かれているか。
3. **論理的なつながり**: 段落間 / 章間で 「だから何?」 が読者に伝わる接続詞・主張展開になっているか。 唐突に新概念が出る箇所、 結論が飛躍してる箇所がないか。
4. **背景 → 手法 → 実験 → 結果 → 議論 の一気通貫性**:
   - 背景で挙げた問題が、 手法で解決される設計になっているか
   - 手法で導入した要素が、 実験で正しく評価されているか (条件設計 / 比較対象が適切か)
   - 実験結果が、 議論・結論で 元の問題に対する回答として 一貫して整理されているか
   - もし途中で 目的・手段・評価の軸がずれていたら 明示すること
5. **仮説/問い と 結果 の対応**: Introduction で立てた 仮説 (H1, H2,...) や RQ (RQ1, RQ2,...) が、 Results / Discussion で 1 つ 1 つ明示的に対応づけて議論されているか。 立てた問いが結果で 「答えられた / 答えられなかった」 のどちらかが明確になっているか。
6. **用語・編集面の精査**:
   - 用語の一貫性 (同じ概念に対して 異なる表記がないか、 略語の初出での説明があるか)
   - 専門用語の説明不足 (会議の想定読者層を超える専門用語が定義なしで使われていないか)
   - 図表の参照 (全ての Figure / Table が本文中で言及されているか、 言及だけで本文に説明がない図表はないか)
   - 参考文献の妥当性 (存在しなさそうな引用 / 著者名のタイポ / 年号の食い違い / フォーマット不一致がないか)

【strengths / weaknesses に書くべき粒度】
- 抽象的な感想 (「面白い」「意義深い」 等) は避け、 具体的な節 / 図 / 数値 / 主張 を引用して指摘する
- weaknesses は 「どう直せば accept に近づくか」 の具体的な改稿案を 1 つずつ添える
- 漏れの指摘は 「何が書かれていないか」 を 章名 + 段落付近で明示

【改稿案で 安易に薦めてはいけないこと】
- 「N を増やせば良い」 は 簡単に書きがちだが、 既に分析済の論文に対して N を追加すると **p-hacking (追加分析で 偶然 有意差が出るのを待つ行為) のリスク** がある。 N 増の提案をするなら、 同時に **「事前登録 (pre-registration) を行った上で」 / 「効果量と検出力分析で必要 N を見積もった上で」** 等の安全策を添えること。
- 単一の追加分析だけでなく、 **複数の分析を組み合わせて提案** すること (例: 統計的検定だけでなく 質的データのコーディング / 事例分析 / 探索的可視化 を 追加で提案)。

【実験を 追加実施できないケースのための示唆】
- 査読者は 「再実験せよ」 一辺倒の指示を避け、 **代替案** を 1 つ以上添えること:
  - 既存データの 別角度からの再分析 (例: subgroup analysis / mediating variable / 質的コーディング)
  - 既出公開データセットを使った 補完的検証
  - 既存研究との 比較メタ分析的議論
  - 制約として 「これは現時点のスナップショット研究であり、 後続研究に X を委ねる」 と limitation 章で明示する戦略

【「こういう分析をすると強くなる」 系の提案】
- 著者が見落としていそうな 強化分析を 必ず 1〜3 個アイテマイズ:
  - 例: 効果量の 95% CI、 ベイズ係数、 質的データの 半構造化インタビュー追加、 行動ログの ヒートマップ可視化、 学習曲線の time-series 分析、 個人差を残差で説明、 シミュレーション or 計算モデルでの検証 など

【貢献の独立解釈 (GPT 視点)】
- 論文中で著者が主張する貢献 (Introduction の bullet "Our contributions are:" や Conclusion の要約) を 一度脇に置き、 **GPT の独立した読解** として「この論文の貢献は本当のところ何か」 を 再列挙してください
- そのうえで:
  - 著者が主張する貢献 (author_claimed_contributions): 著者が明示的に書いている貢献リスト
  - GPT が読み取った 貢献候補 (reviewer_perceived_contributions): 論文の中身から GPT が 独立に解釈した 「実質的な貢献」 1〜5 個
  - ギャップの説明 (contribution_gap_explanation): 「あなたの主張は X だが、 私は この論文の貢献は実は Y だと解釈する。 理由は…」 の自由記述。 著者が見落としている可能性のある貢献 や、 逆に 著者が過大主張している貢献の 検証指摘
- 著者の主張と GPT の解釈が 完全一致する場合は その旨を明示 (「両者一致、 貢献の主張は妥当」 等)

【主張が強すぎる文章 / 記述がおかしい文章のリライト提案】
- 過大主張 (「世界初」「決定的に」「絶対に」 等)、 論理飛躍、 曖昧 (「効果的だった」 を 数値で支持していない)、 矛盾、 不適切な比較、 で 問題があれば
- rewrite_suggestions に 以下 の 形 で 1〜5 件 アイテマイズ:
  {
    "original":             "問題のある原文 (原文 ママ、 引用 句 込み)",
    "original_ja":          "原文 の 日本語 訳 (要約 で なく 訳)",
    "reason":               "なぜ 問題 か (過大主張 / 飛躍 / 曖昧 / 矛盾 等)",
    "suggested_rewrite_en": "原文 と 同じ 言語 (= 英語 論文 なら 英語) で の 書き換え 案",
    "suggested_rewrite_ja": "その 書き換え 案 を 日本語 で 訳した もの"
  }
- 例: 「世界初」 → 「To our knowledge, this is the first attempt in the field of ...」 + 「我々 の 知る 限り、 ◯◯ の 分野 で 最初 の 試み で ある」
- 例: 「効果的だった」 → 「Condition A reduced mean response time by X ms compared to B (p<.01, d=0.5), suggesting users tend to prefer A.」 + 「条件 A は B より 平均 反応 時間 が X ms 短く (p<.01, d=0.5)、 ユーザー は A を 好む 傾向 が 示唆 された」
- 旧 フィールド 名 (suggested_rewrite, original のみ) は 後方 互換 で 残して も OK だが、 上記 5 フィールド を 揃える こと を 優先
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
        'cost_points'      => PAPER_REVIEW_COST,        // 旧 互換
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
        'pdf_path'     => $row['pdf_path'],         // v795 アップロード 元 PDF へ の リンク
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
//   target_venue: 「CHI」 等。 空なら HCI 系全般
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
    // v780 #404 オプション: 回答文 (rebuttal / response to reviewers)。 与えられた 場合 は
    //   論文 査読 + 回答 妥当性 評価 モード に なる。 空 なら 従来 通り の 査読 のみ。
    $responseText = trim((string)($_POST['response_text'] ?? ''));
    if (mb_strlen($responseText) > 20000) $responseText = mb_substr($responseText, 0, 20000);
    // v782 #379 回答文 PDF も 同時 に 受け取れる。 テキスト と PDF 両方 ある なら 両方 を GPT に 渡す。
    $responsePdfTmp = null;
    $responsePdfName = null;
    if (isset($_FILES['response_pdf']) && is_uploaded_file($_FILES['response_pdf']['tmp_name'])) {
        $rf = $_FILES['response_pdf'];
        if ($rf['error'] === UPLOAD_ERR_OK) {
            if ($rf['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', '回答 PDF は 30 MB まで', 400);
            $rhead = @file_get_contents($rf['tmp_name'], false, null, 0, 5);
            if ($rhead !== '%PDF-') throw new ApiException('bad_request', '回答 PDF は PDF ファイル を 指定 して ください', 400);
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
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $reviewCost = (int)PAPER_REVIEW_MODELS[$reqModel];

    // 残高チェック (旧 PAPER_REVIEW_COST → 動的 $reviewCost)
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $reviewCost) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足です (要 %d pt、 現在 %d pt)', $reviewCost, $bal), 400);
    }

    // v557 #211 非同期化: PDF を OpenAI に upload → record を pending で保存 +
    //   即座にクライアントに share_token を返す。 GPT への chat.completions 呼出は
    //   fastcgi_finish_request() で クライアント切断後にバックグラウンド実行。
    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // v795 アップロード された PDF を サーバ にも 保存 (結果 ページ から リンク で 開ける ように)。
    //   token が この あと 生成 される ので 先 に 作って 流用 する。
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
    // 回答 PDF も 同じ ように 保存
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
           "\n\n査読の厳しさは {$strictness} で、 ターゲット会議は {$venue} を想定。";
    if ($hasResponse) {
        // v780 #404 回答文 が ある とき は 「査読 + 回答 評価」 モード
        // v782 #379 PDF と text 両方 ある場合 も 同 モード。 PDF は file_id で 添付、 text は user prompt に 埋め込み
        $sys .= "\n\n【回答文 評価 モード】\n"
              . "この 依頼 に は 著者 から の 回答文 (rebuttal / 査読 コメント へ の 反論・返答) が 添えられて います。\n"
              . "通常 の 査読 に 加え、 以下 を 評価 して ください:\n"
              . "(1) 回答 内容 が 査読 で 指摘 する べき 主要 な 弱み / 記述 漏れ / 論理 飛躍 を カバー して いる か\n"
              . "(2) 回答 の 主張 が 論文 本文 と 矛盾 して いない か (回答 で 「分析 し直 した」 と 書いて あるが 本文 が 古い まま の よう な 不整合 を 検出)\n"
              . "(3) 回答 が 「N を 増やす だけ」「再 実験 する だけ」 で 終わって いる など 安直 な 対応 で は ない か (代替 分析 や 限界 明示 への 言及 を 重視)\n"
              . "(4) 回答 の 文章 自体 に 過大 主張 / 曖昧 / 矛盾 が ない か\n"
              . "(5) 査読 で 上げた 改稿 案 に 対して 回答 が 過不足 なく 対応 できて いる か (上記 weaknesses と 突き合わせ)\n"
              . "出力 JSON に 新規 フィールド「response_evaluation」 を 追加 する こと (詳細 は user 指示 の スキーマ 参照)。";
    }
    $userPrompt = "添付した PDF の論文を 章立て (Abstract / Introduction / Related Work / Method / Results / Discussion / Conclusion など) を意識して 1〜2 段落ずつ日本語で要約し、 続けて査読コメントを作ってください。\n\n"
        . "system prompt のチェックリスト 4 項目 (貢献の妥当性 / 実験統計記述漏れ / 論理的つながり / 背景〜結論 一気通貫性) を 必ず網羅し、 整合性チェック の結果は consistency_check に 4 項目別で残してください。\n\n"
        . "出力 JSON スキーマ:\n"
        . "{ \"sections\": [{\"title\": \"章タイトル\", \"summary_ja\": \"1〜2 段落の和訳要約\"}, ...],\n"
        . "  \"review\": {\n"
        . "    \"decision\": \"Strong Accept / Accept / Weak Accept / Borderline / Weak Reject / Reject / Strong Reject\",\n"
        . "    \"score\": 1-5 の整数,\n"
        . "    \"summary_one_line\": \"査読要約 1 行\",\n"
        . "    \"contribution_validity\": \"貢献の妥当性に関する評価 (100-300 字)\",\n"
        . "    \"author_claimed_contributions\": [\"著者が論文中で明示的に主張する貢献 (1 件ずつ)\", ...],\n"
        . "    \"reviewer_perceived_contributions\": [\"GPT が論文を読んで独立に解釈した『実質的な貢献』 1〜5 件\", ...],\n"
        . "    \"contribution_gap_explanation\": \"著者主張 ⇔ GPT 解釈 のギャップ。 一致なら『両者一致』。 ズレがあるなら『あなたの主張は X だが、 私は この論文の貢献は実は Y だと解釈する。 理由は…』 を 200-500 字で自由記述\",\n"
        . "    \"missing_descriptions\": [\"漏れている記述項目 (章名 + 該当箇所込み)\", ...],\n"
        . "    \"logical_flow\": \"論理的なつながりの評価、 飛躍箇所の指摘 (100-300 字)\",\n"
        . "    \"consistency_check\": {\n"
        . "       \"background_to_method\": \"背景→手法 が繋がっているか\",\n"
        . "       \"method_to_experiment\": \"手法→実験 が繋がっているか\",\n"
        . "       \"experiment_to_result\": \"実験→結果 が繋がっているか\",\n"
        . "       \"result_to_discussion\": \"結果→議論→結論 が繋がっているか\"\n"
        . "    },\n"
        . "    \"hypothesis_vs_results\": \"立てた仮説/RQ ⇔ 結果 の対応評価。 答えが出てない問いがあれば指摘\",\n"
        . "    \"editorial_check\": {\n"
        . "      \"terminology_consistency\": \"用語の一貫性、 略語初出説明\",\n"
        . "      \"jargon_explanation\": \"専門用語の説明不足 (会議の想定読者層を超えるもの)\",\n"
        . "      \"figure_table_references\": \"全ての Figure / Table が 本文で言及・説明されているか\",\n"
        . "      \"references_validity\": \"存在しなさそうな引用 / typo / 年号食い違い / フォーマットの不一致\"\n"
        . "    },\n"
        . "    \"strengths\": [\"具体的な強み (節/数値/主張を引用)\", ...],\n"
        . "    \"weaknesses\": [\"具体的な弱み + 直すべき改稿案\", ...],\n"
        . "    \"strengthening_analyses\": [\"こういう追加分析をすると強くなる、 という提案 (1〜3 個、 効果量CI / 質的補完 / シミュレーション 等の具体例)\", ...],\n"
        . "    \"alternatives_when_no_reexp\": [\"追加実験ができない場合の代替案 (既存データ再分析 / 公開データ補完 / limitation 明示 等)\", ...],\n"
        . "    \"rewrite_suggestions\": [{\"original\":\"主張が強すぎる or 記述がおかしい原文 (節 + 引用)\", \"original_ja\":\"原文 の 日本語 訳\", \"reason\":\"なぜ問題か (過大主張 / 飛躍 / 曖昧 / 矛盾 等)\", \"suggested_rewrite_en\":\"原文 と 同じ 言語 で の 書き換え 案 (英語 論文 なら 英語)\", \"suggested_rewrite_ja\":\"その 書き換え 案 の 日本語 訳\"}, ...],\n"
        . "    \"revision_to_accept\": [\"採録に導くために 必要な修正を 優先度順に アイテマイズ (具体的 / 実行可能、 ただし 「N を増やす」 系は p-hacking リスクを添える)\", ...],\n"
        . "    \"comments_to_authors\": \"著者への総合コメント (400〜800 文字)\",\n"
        . ($hasResponse
            ? "    \"response_evaluation\": {\n"
              . "      \"overall_assessment\": \"回答 全体 の 妥当性 評価 (200〜500 字)。 査読 指摘 に 対して 過不足 なく 対応 できて いる か、 安直 な「N 増 / 再 実験」 で 流して いない か、 論文 本文 と 矛盾 が ない か を 含めて\",\n"
              . "      \"covered_points\":      [\"回答 が 良く 対応 でき て いる 指摘 (1 件 ずつ)\", ...],\n"
              . "      \"missing_points\":      [\"査読 で 指摘 すべき に も かかわら ず 回答 が 触れて いない / 不十分 な 論点 (1 件 ずつ + どう 補強 する か の 助言)\", ...],\n"
              . "      \"inconsistencies\":     [\"回答 と 論文 本文 / 数値 / 主張 と の 矛盾 点 (具体 引用 + どこ と どこ が 矛盾 か)\", ...],\n"
              . "      \"weak_arguments\":      [\"回答 中 で 主張 が 弱い / 曖昧 / 飛躍 して いる 箇所 (引用 + 改善案)\", ...],\n"
              . "      \"recommended_revisions_to_response\": [\"回答文 自体 を こう 書き 換える と 査読者 を 説得 し やすい、 と いう 具体 提案 1〜5 件\", ...]\n"
              . "    },\n"
            : ""
          )
        . "    \"confidence\": 1-5 の整数 (査読者の自信)\n"
        . "  }\n"
        . "}";
    if ($responseText !== '') {
        $userPrompt .= "\n\n【著者 から の 回答文 (テキスト)】 (これ を 評価 して response_evaluation に 入れる)\n\n"
                     . "------ ここ から 回答文 ------\n"
                     . $responseText . "\n"
                     . "------ ここ まで ------\n";
    }
    if ($responsePdfTmp !== null) {
        $userPrompt .= "\n\n【著者 から の 回答文 PDF】 が 添付 されて います (2 つめ の PDF ファイル として)。 1 つめ が 論文 本体、 2 つめ が 回答文 PDF。 両方 を 読んで、 response_evaluation を 作って ください。\n";
    }

    // v774 #396 #397 ユーザが 選んだ モデル を 使う。 推論モデル は temperature 非対応
    // v782 #379 回答 PDF が ある なら OpenAI Files API に も アップ → 2 つめ の file content と して 添付
    $responseFileId = null;
    if ($responsePdfTmp !== null) {
        try {
            $responseFileId = ai_openai_upload_pdf($responsePdfTmp, $responsePdfName, $apiKey);
        } catch (Throwable $e) {
            // 失敗 しても 査読 本体 は 続行 (text の 回答 だけ で 動く ケース)
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
        'max_completion_tokens' => 8000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $model)) {
        $payloadArr['temperature'] = 0.3;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    // v557 #211 非同期: pending レコード作成 + 課金 → 即 share_token 返却 →
    //   fastcgi_finish_request() でクライアント切断 → 裏で OpenAI chat 呼出 → 結果更新
    // v795 token は 前段 で PDF 保存 用 に 生成 済 (= ここ で 再 生成 しない)
    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $reviewId = 0;
    // v782 #379 response_text に PDF 添付 マーカ を 追加 (UI で「PDF 添付 されました」 と 出す)
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
        Ledger::transfer($pdo, $uid, 1, $reviewCost, 'paper_review', 'paper_review', $reviewId, '論文査読 依頼料');
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
        'message'      => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が査読中… (2-5 分)。 結果ページを開いておくか、 後で /#/paper-review/r/' . $token . ' を確認してください。',
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
        if (!is_string($content) || $content === '') throw new RuntimeException('empty content');
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
// v748 #359 #360 #361 論文 和訳 要約 (落合メソッド + 図表ピックアップ + 20pt)
// ─────────────────────────────────────────────────────────────
const PAPER_TRANSLATE_COST = 20;

// v773 #395 モデル 一覧 を 整理。 gpt-4o-mini / gpt-4o は 200-300 字 の 短い 要約 しか
//   出さない ので 論文要約 用途 では 失格 → 削除。 真面目 に 要約 する なら 最低 でも 4.1。
// v808 #403 価格 調整 + デフォルト を gpt-5 に。
const PAPER_TRANSLATE_MODELS = [
    'gpt-4.1'     => 20,   // 軽量 (短め に なり がち)
    'gpt-5-mini'  => 30,   // 5 系 軽量
    'gpt-5'       => 50,   // 5 系 標準 (デフォルト、 高品質)
    'o1'          => 80,   // o1 推論 モデル (深い 解析)
];

const PAPER_TRANSLATE_DEFAULT_PROMPT = <<<'PROMPT'
あなた は 研究論文 を 日本語 で 要約 する アシスタント です。

# 最重要 ルール (これ を 守れ ない 出力 は ダメ)

**detailed_sections の 各 節 の body は 600-1000 字 を 目標。 500 字 未満 は 短すぎ、
350 字 で 終わらせる の は ダメ。 短すぎる の も 冗長 も 避け、 「論文 の 章 を 読んだ 感」
が しっかり 残る 適度 な 厚み で 書く。**

単純な 機械翻訳 では なく、 「研究論文 として 何が 書かれて いるか」 を 強く 意識して、
以下 の 順番 で 構造化 した 詳細な 和訳要約 を 作って ください。 全体 で 6000-12000 字 程度 を 目指す。

# 出力 順番 (= 読者 が 上 から 下 へ 読み 進める 順番)

1. summary_one_paragraph: 1 段落 (300-500 字) の 「まず これ だけ 読めば 概要 が 分かる」 全体要約
2. rq_hypothesis: 著者 が 立てた リサーチクエスチョン (RQ) と 仮説、 そして それぞれ に対して
   論文 全体 から 読み取れる 「示唆」 (= こう言える / こう解釈できる / 部分的に こうだ など) を
   必ず 整理。 「結果」 と 断定 せず、 論文 が 示唆 する 内容 として 書く こと
3. contributions: 著者 が 「成し遂げた / 明らかにした」 こと を **完了形 / 名詞句** で 列挙。
   例: × 「説得理論 を 統合 する」 / × 「消費者 の 対処 プロセス の 理解 を 深める」
       ○ 「説得理論 を 統合 した」 / ○ 「消費者 の 対処 プロセス を 明らかにした」
   動詞 形 / 目的句 (= 「○○ する こと」) では なく、 「○○ した」「○○ を 提示 した」 と 書く
4. detailed_sections: 論文 の **実際 の 章 構成 を そのまま 反映** した 章立て 要約 を 作る。
   論文 内 で 章 タイトル (Abstract / Introduction / Background / Related Work / Theory /
   Method / Experiment N / Results / Discussion / Conclusion 等) が 明示 されて いる なら、
   その タイトル を heading に そのまま 採用 (日本語訳 + 必要 なら 原題 併記)。 章 が 細かく
   分かれて いる なら 5-9 個 で 構成、 各節 600-1000 字 で 2-3 段落 に 分けて 丁寧 に 要約 する。
   ・ 1 章 を 1 段落 で 雑 に 終わらせ ない (= 元 論文 が 1 章 で 説明 して いる 量 を 1 段落
     に 圧縮 する のは ダメ)
   ・ 著者 の 主張 / 数値 / 用語 / 図表 へ の 言及 / 引用文献 名 等 を 残す
   ・ 論文 の 章 順 に 並べる (時系列 / 論理 を 入れ替え ない)
   ・ 機械翻訳 ぽい 短文 では なく、 「研究 ノート を 取った 上 で 自分 の 言葉 で 説明」 する 立場 で 書く
   重要 な 図 や 表 は figure_refs で 引用 し、 ページ番号 + page_region (top/middle/bottom/full)
   + キャプション の 和訳 + なぜ 重要 か を 添える
5. experiments: 論文 が 行った 実験 / 調査 を 「**実験N: 何 を 測った / 何 を 操作 した /
   被験者 N=◯◯ / 期間 / 統制 群 等**」 形式 で 列挙。 **必ず「実験1:」「実験2:」… の prefix
   で 始める** (論文 原文 が「Study 1」「研究1」 と 書いて いて も、 出力 は 「実験1:」 に 統一
   する。 UI 側 で 「実験1: 実験の内容」 と 「実験1 の 結果」 を ペア で 表示 する ため、 prefix
   が 揃って いない と ペアリング 失敗 する)。 **自前 の 実験 が ない 理論 / レビュー 論文
   でも、 本文 で 引用 した 実証 研究 の 中 から「この 論文 の 主張 を 支える」 もの を 3-7 件
   ピック して 同 形式 で 列挙 する**: 「(引用) Smith et al. 1989 の 実験: 大学生 N=120 に
   広告 を 5 種類 提示 し、 説得意図 認識 と 態度 変化 を 測定」 等。 配列 を 空 に する のは
   「論文 全体 で 実証 研究 へ の 言及 が 一切 ない」 純 理論 論文 のみ。 PKM の ような 理論
   論文 でも、 関連 する 実証 研究 を 必ず 整理 する こと。
6. results_summary: 上 の 実験 で 「何 が 分かった か」 を 数値 / 効果量 / d / r / p値 /
   信頼区間 込み で 整理。 **自前 実験 の 結果 は 必ず「実験1:」「実験2:」… の prefix で 始める**
   (experiments と 同じ 番号 を 使う こと。 UI 側 で 「実験1」 同士 を ペア に する)。 例:
   「実験1: 役割×アクセス可能性 の 交互作用 有意 (F(1,89)=4.71, p<.03)、 低 アクセス で 標的 M=5.15 vs
   観察者 M=4.41、 高 アクセス で 差 なし」「実験1 (引用 Smith et al.): 説得意図 認識 群 は 統制群 比 で
   態度変化 が 25% 少 (d=0.4, p<.01)」。 引用 研究 の 結果 含 む。 該当 なし なら 空 配列 だが、
   experiments と セット で 並ぶ こと が ほぼ 必須。
7. future_work: 著者 が 示した 今後 の 課題 + 読者 観点 で 自然 に 追加 した 方 が 良い 課題
8. key_references: 参考文献 の 中 で 「この 論文 を 理解 する 上 で 特に 重要、 読者 も 抑え
   ておく べき」 もの を **必ず 3-7 件** ピックアップ (1 件 や 2 件 で 済ませ ない、 引用 文献
   が 多い 論文 ほど この 整理 が 価値 を 持つ)
9. ochiai_method: 最後 に 落合陽一メソッド の 6 項目 で 全体 を 重ね合わせて まとめる

# detailed_sections の 中身

論文 の 流れ に 沿って 4-7 個 の 節 を 作って ください。 各 節:
- heading: 節 タイトル (例: 「背景 と 動機」「提案手法: XX」「実験 設定」「結果 と 考察」)
- body: 節 本文 の 和訳要約 (**600-1000 字、 必ず 2-3 段落 に 分けて 構造化**、
  数値 / 用語 / 手法名 / 著者 主張 / 実験 設定 / 結果 数字 を 残す。 1 段落 300-500 字 を
  目安、 各章 を 「研究 ノート を 取った 上 で 自分 の 言葉 で 丁寧 に 説明」 した レベル に。
  元 論文 で 1 章 が 説明 して いる 内容 を 1 段落 に 圧縮 するな (= 章 が 厚い なら 要約 も
  厚く)。 機械翻訳 の 短い まとめ や 箇条書き 風 の 詰め込み は ダメ、 段落 で 論理 を つなげて
  書く。 文字 数 が 少ない の は その 章 を 軽視 して いる 証拠 と 思え)
- figure_refs: その 節 で 言及 する 重要 な 図 / 表 を 厳選 して 入れる (各 節 0-2 件、 全節
  合計 で 最大 3 件 まで)。 優先 する のは 「提案 手法 の 中核 を 示す 図」 と 「主たる
  結果 の 図 / 表 (=効果量 / 比較表 / プロット)」。 補助的 な 図 (背景 イラスト 等) は 省く。
  page は PDF の 物理ページ番号 (1 始まり) を 正確 に 入れる こと (= サーバ で ページ画像 を
  紐付ける ので 必須)。 page_region は その 図 / 表 の 中心 が ページ を 縦 3 等分 した うち
  どこ に あるか を 厳密 に 答える: ページ 上 1/3 内 なら "top"、 中央 1/3 内 なら "middle"、
  下 1/3 内 なら "bottom"。 図 や 表 が ページ の 大半 を 占める / 跨いで いる / 判断 が
  不確か な とき は "full" に する (= 全 ページ を そのまま 表示)。

  **重要**: 「Figure N は page X の region Y」 と 書いた なら、 本当 に その page の その
  region に **絵 / グラフ / 表 が 視覚的 に 存在 する こと** を 自分 で 再 確認 する。 文章
  だけ の 領域 を 指して は ダメ。 視覚的 な 図 や 表 が 見つから ない なら その figure_refs
  自体 を 出さ ない (= 配列 から 除外)。 不確か なら region を "full" に する。 「キャプション が
  下 だから bottom」 等 の 短絡 を しない、 図 の 本体 が ある 位置 で 判定 する。

  **必須 フィールド**: visual_content — 「この 図 / 表 に 視覚的 に 何 が 描かれて いるか」
  を 50-150 字 で 具体的 に 説明 する。 例: 「3 つ の ボックス (消費者 / 説得者 / 文脈) と 矢印
  で 構成 された フロー 図」「3 列 × 5 行 の 比較表、 行 は 各 条件、 列 は 反応時間 / エラー率 /
  満足度」「散布図、 x軸 は 訓練時間、 y軸 は 正答率」 等、 実際 に PDF を 見た 人 にしか 書け
  ない 具体性 で 書く こと。 「説得知識モデル の 図」 等 タイトル の 焼き直し は 不可。 visual_content が
  書けない なら、 その figure_refs を 出さ ない (= PDF を 見て いない 証拠)。

# トーン
・ **内容 を そのまま 要約 する 立場 で 書く**。 「論文 で は ◯◯ と 主張 して いる」「著者 は
  ◯◯ と 説明 して いる」「論文 では ◯◯ と 述べて いる」 等 の **メタ 解説** は 排除 する。
  「◯◯ で ある」「◯◯ が 生じる」 と 直接 書く。
  例: × 「論文 で は、 消費者 が 説得 知識 を 発展 させる と 主張 して いる」
      ○ 「消費者 は 経験 と 観察 を 通じて 説得 知識 を 発展 させる」
  例: × 「著者 は PKM が 3 つ の 知識 から 成る と 説明 して いる」
      ○ 「PKM は 3 つ の 知識 (トピック / 説得 / エージェント) から 成る」
・ 略語 は 初出 で フルスペル + 日本語訳 を 添える
・ 数値 (実験 N、 効果量、 p 値) は 落とさず 残す
・ 例外: ハルシネーション 回避 の ため 自分 で 推測 を 加える 場合 のみ「ここ から 推測 すると…」
  と 明示 する (= 著者 の 主張 と 自分 の 解釈 を 区別)

# **自然 で 読み やすい 日本語 で 書く** (v777 で 強化)

文章 を 「論文 用語 を 直訳 して 並べた もの」 では なく、 「人 に 説明 する つもり で
書いた 読み やすい 日本語」 に する こと。 学術 直訳 調 / 名詞止め / 機械的 連結 を 避ける。

× 名詞 止め に せず、 述語 で 終える:
  × 「認知容量 は 動機 が 低 アクセス の とき に 決定的 に 働く 示唆」
  ○ 「認知容量 は、 動機 が 低 アクセス の とき に 決定的 に 働く こと を 示唆 する」
  × 「忙しい 標的 は 観察者 より 動機 推論 を 行わず、 販売員 を 誠実 と 捉える 傾向 が 示唆」
  ○ 「忙しい とき は、 観察者 ほど 動機 推論 を しない ため、 販売員 を 誠実 と 捉え やすい」

× 概念 用語 を そのまま 並べた 翻訳 調 の 質問 文 は ダメ。 RQ や 仮説 は 「具体的 な
  シーン が 思い 浮かぶ よう な 自然 な 文」 に 言い 換える:
  × 「消費者 は どの 条件 で 販売員 の 行動 に 潜在的 な 説得動機 を 帰属 し、 説得知識 を 用いる か?」
  ○ 「消費者 は どんな とき に 販売員 の 行動 を 『売り たくて やって いる』 と 受け取り、
       説得知識 を 働かせて 警戒 する のだろう か?」
  × 「認知容量 (標的 / 観察者、 二重課題) は 説得知識 の 使用 に どう 影響 する か?」
  ○ 「会話 に 集中 して 余裕 が ない 立場 (標的) と、 落ち着いて 見て いる 立場 (観察者) で、
       説得知識 の 使い 方 は どう 変わる の か?」

× 「示唆」「帰属」「想起 容易性」「アクセス 可能性」 など、 専門 用語 を そのまま 並べる だけ
  に せず、 必要 なら 補足 説明 や 平易 な 言い 換え を 添える (専門 用語 完全 排除 は しない、
  論文 用語 + 平易 説明 の セット が 望ましい):
  × 「動機 の 想起 容易性 が 効果 を 調整 する」
  ○ 「動機 (販売員 が 売り たがって いる こと) が 思い 浮かび やすい か どうか で、 効果 が 変わる」

文章 を 1 度 書いた 後、 「これ、 同僚 に 読み 上げて 自然 に 響く か?」 と 自分 で 読み 返し、
不自然 な 直訳 調 / 名詞 止め / 助詞 の 抜け / 同じ 述語 (「示す」「した」「である」) の
3 連発 が あれば 言い 換えて から JSON を 出す こと。
・ **日本語 の 文章 中 に 不要 な 半角 スペース を 絶対 に 入れない こと**。 system prompt
  の この 説明 文 は 読み やすさ の ため 「どんな もの」 の ような スペース 入り 表記 を
  使って いる が、 これ は 説明文 の 都合 で、 出力 する JSON の 値 (= 読者 に 見せる 文章)
  では 普通 の 日本語 表記 = 「どんなもの」「研究の動機」 で 書いて ください。
  英数字 / 記号 と 日本語 の 境界 だけ 半角 スペース 入れて OK (例: 「PDF を 読む」 はOK、
  「日本 語」 や 「説 明」 はダメ)

# ハルシネーション 防止 (重要)

各 セクション を 書く 前 に、 PDF の 該当 箇所 を 必ず 確認 して ください。
書いた 後 も、 数値 / 用語 / 著者 が 主張 した 内容 / 引用 / 結果 / 著者名 / 会議名 等 が
PDF の 記述 と 一致 して いるか 自分で 再 精査 し、 ズレ が あれば 修正 して から
JSON を 出力 して ください。 「PDF に そう 書かれて いるか 怪しい が 文脈 上 推測 する」
部分 は 「論文 から の 推測」 と 明示 する こと。 創作 / 拡大解釈 は 厳禁 です。
PDF に 書かれて いない 数値 や 主張 を 補完 しない。

# 出力 JSON スキーマ

{
  "title_ja": "論文 タイトル の 日本語訳 (副題 も)",
  "title_orig": "原題",
  "authors": "著者名 (代表 3 名 まで + et al.)",
  "venue": "発表会議 / ジャーナル + 年",
  "summary_one_paragraph": "1 段落 (300-500 字) の 全体 サマリ",
  "rq_hypothesis": {
    "research_questions": [
      { "rq": "RQ: 質問 文 (RQ が 複数 ある場合 は 「RQ1:」「RQ2:」)",
        "answer": "論文 から 読み取れる 示唆 (例: 「平均反応時間 が X ms 短縮 された ことから、 …と 言える」 等、 断定 せず 示唆 として 書く)" }
    ],
    "hypotheses": [
      { "hypothesis": "H: 仮説 文 (仮説 が 複数 ある場合 は 「H1:」「H2:」)",
        "result":     "示唆: 支持 / 棄却 / 部分支持 + 具体的 な 根拠 (数値 / 効果量 / p 値)、 論文 が 何を 示唆 して いるか の 視点 で 書く" }
    ]
  },
  "contributions": ["著者 が 主張 する 貢献 1", "貢献 2"],
  "detailed_sections": [
    {
      "heading": "節 タイトル",
      "body":    "節 本文 の 和訳要約 (500-900 字、 必要 なら 段落 分け)",
      "figure_refs": [
        { "label": "Figure 2", "page": 3, "page_region": "top",
          "caption_ja": "図 / 表 キャプション の 和訳",
          "visual_content": "視覚的に 何が 描かれて いるか の 具体的 説明 (50-150 字、 必須)",
          "why_important": "なぜ 重要 か (50-150 字)" }
      ]
    }
  ],
  "experiments": [
    "(引用) Smith et al. 1989 の 実験: 大学生 N=120 に 広告 5 種類 を 提示し、 広告 への 説得 意図 認識 度 と その後 の 態度 変化 を 測定 (要因 内 比較、 性別 を 統制 変数)。 操作: 説得 意図 を 明示 する 文言 の 有無。"
  ],
  "results_summary": [
    "(引用 Smith et al.) 説得 意図 を 認識 した 群 は 統制群 比 で 態度変化 が 25% 少 (d=0.4, p<.01)。 説得知識 が 抵抗力 を 高める 証拠。"
  ],
  "future_work":   ["著者 が 示す 今後 の 課題 1", "(読者 観点) 追加 課題 1"],
  "key_references": [
    { "citation":      "[12] や Smith et al. 2024 など 本文 で 参照 されて いる 表記",
      "title_orig":    "参考文献 の 原題 (英語 など 原文 ママ)",
      "title_ja":      "原題 の 日本語訳 (短く 意訳 で OK)",
      "why_important": "この 論文 の 主張 を 理解 する 上で なぜ 必読 か (50-150 字)" }
  ],
  "ochiai_method": {
    "what":          "値 は 説明本文 のみ。「1. どんな もの?」 等 の 番号 / 設問 を 先頭 に 入れない (200-400 字)",
    "vs_prior_work": "値 は 説明本文 のみ (200-400 字)",
    "key_method":    "値 は 説明本文 のみ (200-400 字)",
    "validation":    "値 は 説明本文 のみ (200-400 字)",
    "discussion":    "値 は 説明本文 のみ (100-300 字)",
    "next_papers":   ["タイトル + 1 行 説明 (各 文字列)"]
  }
}

JSON 以外 の 前置き や 解説 は 不要。 JSON のみ を 返却。
PROMPT;

function ai_paper_translate_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    // v772 #393 result_json から title_ja を 引いて 履歴 行 に 表示 用 に 添える。
    $st = $pdo->prepare("SELECT id, share_token, pdf_name, result_json, status, is_shared, shared_at, created_at, finished_at
                          FROM paper_translates WHERE user_id = ? ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $title = null;
        if (!empty($r['result_json'])) {
            $j = json_decode((string)$r['result_json'], true);
            if (is_array($j) && !empty($j['title_ja'])) $title = (string)$j['title_ja'];
        }
        $rows[] = [
            'id'          => (int)$r['id'],
            'share_token' => $r['share_token'],
            'pdf_name'    => $r['pdf_name'],
            'title_ja'    => $title,
            'status'      => $r['status'],
            'is_shared'   => (bool)$r['is_shared'],
            'shared_at'   => $r['shared_at'],
            'created_at'  => $r['created_at'],
            'finished_at' => $r['finished_at'],
        ];
    }
    json_response([
        'items'        => $rows,
        'cost_points'  => PAPER_TRANSLATE_COST,        // 旧 互換
        'models'       => PAPER_TRANSLATE_MODELS,      // v755 #371 モデル別 価格 リスト
        'default_model'=> 'gpt-5',                     // v808 #403 デフォルト を gpt-5 (50pt) に
    ]);
}

// v756 #372 みんな の 公開 要約 一覧 (is_shared=1)。 q= で キーワード 部分一致 検索 (pdf_name +
//   title_ja / title_orig / authors / venue / summary_one_paragraph)。
function ai_paper_translate_shared_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    $q = trim((string)($_GET['q'] ?? ''));
    $args = [];
    $sql = "SELECT pt.id, pt.share_token, pt.pdf_name, pt.result_json, pt.status, pt.shared_at,
                   pt.created_at, pt.finished_at, pt.user_id,
                   u.display_name AS author_name, u.avatar_url AS author_avatar
              FROM paper_translates pt
              JOIN users u ON u.id = pt.user_id
             WHERE pt.is_shared = 1 AND pt.status = 'done'";
    if ($q !== '' && mb_strlen($q) <= 100) {
        // LIKE %q% 検索 (pdf_name + result_json 全体)。 結果セット が 小さい 前提。
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
    json_response(['items' => $items, 'q' => $q]);
}

// v756 #372 共有 ON/OFF (本人 のみ)。 body = { is_shared: bool }
function ai_paper_translate_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が 必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 共有 切替 可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '要約 完了 後 のみ 共有 切替 可', 400);
    $on = (bool)$body['is_shared'];
    $pdo->prepare("UPDATE paper_translates
                      SET is_shared = ?, shared_at = " . ($on ? "NOW()" : "NULL") . "
                    WHERE id = ?")
        ->execute([$on ? 1 : 0, $id]);
    json_response(['ok' => true, 'is_shared' => $on]);
}

function ai_paper_translate_get_shared(PDO $pdo, array $cfg, string $token): void {
    $u = Auth::requireUser($pdo, $cfg);
    $meId = (int)$u['id'];
    $st = $pdo->prepare("SELECT pt.id, pt.user_id, pt.pdf_name, pt.pdf_path, pt.pdf_sha256, pt.model, pt.result_json, pt.status,
                                pt.error_msg, pt.created_at, pt.finished_at,
                                pt.pages_count, pt.pages_dir, pt.is_shared, pt.shared_at,
                                u.display_name AS author_name, u.avatar_url AS author_avatar
                           FROM paper_translates pt JOIN users u ON u.id = pt.user_id
                          WHERE pt.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'paper_translate not found', 404);
    $reactions = ai_paper_reactions_summary($pdo, 'paper_translate', (int)$row['id'], $meId);  // v789 #389
    // v797 同 PDF (= 同 sha256) で 自分 の paper_full_translations row が あれ ば 相互 リンク を 出す
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
        'pdf_path'      => $row['pdf_path'],    // v758 #377 redo 可能 か client が判定
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
        'reactions'     => $reactions,   // v789 #389
        'cross_refs'    => $crossRefs,   // v797 同 PDF の 全訳 等
    ]);
}

function ai_paper_translate(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($contentType, 'multipart/form-data')) {
        throw new ApiException('bad_request', 'PDF を multipart/form-data でアップロード してください', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要です', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmpPdf = $f['tmp_name'];
    $head = @file_get_contents($tmpPdf, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイル では ありません', 400);

    // v808 #403 デフォルト を gpt-5 に。 未対応 モデル は 400。
    $reqModel = trim((string)($_POST['model'] ?? 'gpt-5'));
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $cost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    // v804 「終わった 瞬間 共有 ON」 オプション
    $autoShare = !empty($_POST['auto_share']) ? 1 : 0;

    // v797 同 PDF を 識別 する SHA-256 を 算出 (= 横展開 用 / 「同 PDF の 全訳 が ある」 リンク 等)。
    //   注意: 同 PDF + 同 モデル でも 再 処理 は 別 row + 別 課金 で 行う (要約 と 全訳 で 扱う 軸 が
    //   違う ので、 「同 ファイル なら 流用」 で 課金 を スキップ する とは しない 方針)。
    $pdfSha = hash_file('sha256', $tmpPdf);

    // v808 #402 ラボ PI (user_id=3 = 中村) は SYSTEM の 表現 でも あり、 自分 で 自分 に
    //   ポイント を 払って も 意味 が ない の で 課金 スキップ (cost は そのまま 表示 用 に 保持)。
    $skipCharge = ($uid === 3);

    if (!$skipCharge) {
        // 残高 チェック
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // v750 #366 図表 抽出: PDF を ページ単位 JPEG に レンダリング (pdftoppm)。
    // v757 #375 解像度 を 110 → 160 DPI に bump、 図表 を crop 表示 する 時 の 質 を 上げる。
    // v758 #377 PDF 本体 も サーバ に 保存 (やりなおす 用)。
    //   client は figure_refs の page + page_region から この ページ画像 を crop 表示。
    $token = bin2hex(random_bytes(16));
    $publicDir = '/var/www/labpay/public';
    $pagesRel = '/uploads/paper_pages/' . $token;
    $pagesAbs = $publicDir . $pagesRel;
    @mkdir($pagesAbs, 0775, true);
    // PDF 本体 を 保存
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
    } catch (Throwable $_) { /* ページレンダリング失敗 は 致命的ではない */ }

    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付 した PDF の 研究論文 を、 system prompt の 指示 に 沿って 詳細 サマリ + 落合メソッド で 日本語 要約 してください。 figure_refs の page 番号 は PDF の 物理ページ (1 始まり) で 正確に。 出力 JSON のみ。";

    // v755 #371 ユーザ が 選んだ モデル を 使う (config の default は 無視)。
    // v757 #376 ハルシネーション 防止 の self-check を 明示。 temperature を 下げる。
    $model = $reqModel;
    // v774 #397 gpt-5 / o1 等 の 推論モデル は temperature を 受け付けない。
    $payloadArr = [
        'model' => $model,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt . "\n\n書く 前 と 書いた 後 で、 必ず PDF の 該当 箇所 を 再確認 し、 数値 / 著者 主張 / 結果 が 一致 する こと を 自分 で 検証 して から JSON を 出して ください。 ハルシネーション は 厳禁 です。"],
            ]],
        ],
        'response_format' => ['type' => 'json_object'],
        'max_completion_tokens' => 24000,
    ];
    if (!preg_match('/^(gpt-5|o1|o3)/', $model)) {
        $payloadArr['temperature'] = 0.2;
    }
    $payload = json_encode($payloadArr, JSON_UNESCAPED_UNICODE);

    // $token は すでに 上の pdftoppm セクション で 生成 済み (= ページ画像 dir 用)。
    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $fileId, $pdfName, $sys, $pagesCount, $pagesRel, $pdfRel, $pdfSha, $reqModel, $cost, $autoShare, $skipCharge, &$rowId) {
        $pdo->prepare("INSERT INTO paper_translates
            (user_id, share_token, file_id, pdf_name, pdf_sha256, prompt_used, result_json, cost_points, status, pages_count, pages_dir, pdf_path, model, auto_share)
            VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)")
            ->execute([$uid, $token, $fileId, mb_substr($pdfName, 0, 255), $pdfSha, $sys, 'null', $cost,
                       $pagesCount > 0 ? $pagesCount : null, $pagesCount > 0 ? $pagesRel : null,
                       $pdfRel, $reqModel, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        // v808 #402 ラボ PI は 課金 スキップ (cost は 表示 上 残す が ledger 転送 しない)
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $rowId, '論文要約 依頼料');
        }
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $rowId,
        'share_token' => $token,
        'status'      => 'pending',
        'cost_points' => $cost,
        'model'       => $reqModel,
        'message'     => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が要約中… (1-4 分、 推論 モデル の 場合 は 3-8 分)。 結果ページを開いておくか、 後で /#/paper-translate/r/' . $token . ' を確認してください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    ai_paper_translate_run_background($pdo, $cfg, $rowId, $token, $fileId, $payload, $apiKey, $pdfName, $uid);
}

// v775 #399 本人 のみ 履歴 から 削除。 関連 ファイル (pdf / pages / paper_pdfs) も 削除。
function ai_paper_translate_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id, pages_dir, pdf_path FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 削除可', 403);
    $publicDir = '/var/www/labpay/public';
    // ページ画像 ディレクトリ 削除
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

// v758 #377 既存 row の PDF を 使って 再 処理 (本人 のみ)。 body: { model?: string }
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
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ', 403);
    if (empty($row['pdf_path'])) throw new ApiException('bad_request', 'PDF 保存 が ない 古い 要約 は やりなおせません', 400);
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体 が 見つかりません', 404);

    // モデル: body で 指定 されたら それ、 なければ 前回 使った モデル、 それも なければ gpt-4o
    if ($reqModel === '') $reqModel = (string)($row['model'] ?? 'gpt-4o');
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $cost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) {
        throw new ApiException('insufficient_balance',
            sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付 した PDF の 研究論文 を、 system prompt の 指示 に 沿って 詳細 サマリ + 落合メソッド で 日本語 要約 してください。 figure_refs の page 番号 は PDF の 物理ページ (1 始まり) で 正確に。 出力 JSON のみ。\n\n書く 前 と 書いた 後 で、 必ず PDF の 該当 箇所 を 再確認 し、 数値 / 著者 主張 / 結果 が 一致 する こと を 自分 で 検証 して から JSON を 出して ください。 ハルシネーション は 厳禁 です。";

    // v774 #397 推論モデル は temperature 非対応
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
        Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $id, '論文要約 やりなおし');
    });

    json_response_no_exit([
        'ok'          => true,
        'id'          => $id,
        'status'      => 'pending',
        'model'       => $reqModel,
        'cost_points' => $cost,
        'message'     => '再 処理 を 開始 しました (' . $reqModel . ')',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    $token = (string)($row['share_token'] ?? '');
    $pdfName = (string)($row['pdf_name'] ?? 'paper.pdf');
    ai_paper_translate_run_background($pdo, $cfg, $id, $token, $fileId, $payload, $apiKey, $pdfName, $uid);
}

// v777 #401 多段階 要約 の 2 段目: 1 段目 が 出力 した JSON の 日本語 を 「学術 直訳 調」 →
//   「自然 で 読み やすい 日本語」 に 書き 直す。 数値 / 著者 名 / 固有名詞 / 構造 (キー / 配列 / 文献 番号)
//   は そのまま、 言い 回し・文末・助詞・冗長表現 だけ を 改善。 安価 で 速い モデル を 使う
//   (本来 の 要約 と 別 軸 の 「日本語 校正」 タスク な ので 1 件 数 円 で 十分)。
function ai_paper_translate_polish_ja(array $parsed, string $apiKey): ?array {
    $sys = <<<'PROMPT'
あなた は 日本語 の 文章 校正 アシスタント です。 与えられた JSON は、 別 の AI が 英語 論文 を
日本語 で 要約 した もの です。 ただし 学術 直訳 調 / 名詞 止め / 不自然 な 連結 が 多く 残って
います。 これ を 「同僚 に 説明 する つもり で 書いた 読み やすい 日本語」 に 書き 直して
ください。 同じ JSON スキーマ で 返却 します。

# 必ず 守る ルール (内容 は いじらない、 言い 回し だけ 直す)

1. **キー / 配列 / オブジェクト 構造 は 一切 変更 しない**。 同じ キー 名、 同じ 配列 長、
   同じ ネスト で 返却 する。
2. **数値 / 効果量 / p 値 / d 値 / 信頼区間 / 著者 名 / 年 / 論文 タイトル 原文 / 文献番号 /
   会議名 / N 値 / セクション 番号 は 一切 変更 しない**。 「F(1,89)=4.71, p<.03」 等 の 数値
   表記 は コピー して 保持。
3. **論文 が 主張 して いる 内容 を 改竄 しない**。 「示唆 する」 を 「証明 した」 に 書き 換える
   等、 強度 を 変える の は 禁止。 「示唆」 が 残って も 「ことを 示唆 する」 に 直す 等、 文末 が
   自然 に なる よう に 整える だけ。
4. **新しい 情報 を 加えない**。 元 の JSON に ない 数値 / 解釈 を 追加 する のは ハルシネーション
   と 同じ。 削る の も 最低限 で OK (重複 削除 は OK、 情報 損失 は ダメ)。

# 何 を 直す か

A. **名詞 止め の 文末** を 述語 で 終え、 自然 な 文 に する:
   × 「認知容量 は 動機 が 低 アクセス の とき に 決定的 に 働く 示唆」
   ○ 「認知容量 は、 動機 が 低 アクセス の とき に 決定的 に 働く こと を 示唆 する」
   × 「忙しい 標的 は 観察者 より 動機 推論 を 行わず」
   ○ 「忙しい とき は、 観察者 より 動機 推論 を しない」

B. **学術 直訳 調 の RQ・仮説** を 「具体的 な シーン が 思い 浮かぶ 自然 な 文」 に 言い 換える
   (構造 = key 値 の 文字列 は 書き 換えて OK):
   × 「消費者 は どの 条件 で 販売員 の 行動 に 潜在的 な 説得動機 を 帰属 し、 説得知識 を 用いる か?」
   ○ 「消費者 は どんな とき に 販売員 の 行動 を 『売り たくて やって いる』 と 受け取り、
        説得知識 を 働かせて 警戒 する のだろう か?」

C. **専門 用語 だけ の 羅列** に は 平易 な 補足 を 添える (用語 を 消す ので は なく、 用語 + 平易
   説明 の 形 に):
   × 「動機 の 想起 容易性 が 効果 を 調整 する」
   ○ 「動機 (販売員 が 売り たがって いる こと) が 思い 浮かび やすい か どうか で、 効果 が 変わる」

D. **同じ 述語 の 3 連発** を 避ける (「示す」「示す」「示す」 や 「した」「した」「した」 が
   並んだら、 「明らかに した」「確かめた」「裏付け られた」 等 で 変化 を つける)。

E. **冗長 な メタ 解説** (「論文 では ◯◯ と 主張 して いる」「著者 は ◯◯ と 説明 して いる」)
   は 削って 直接 書く (「◯◯ で ある」「◯◯ が 生じる」)。

F. **「・」 や 中点 で つないだ 機械翻訳 風 短文** は 段落 の 中 で 文 に なる よう 接続詞 で
   つなぐ (「また」「これ に 対し」「その 一方 で」 等)。

G. **日本語 の 文中 に 半角 スペース を 入れない**。 「日本 語」「説 明」 等 の 妙 な 切れ目 が
   あれば 詰める。 英数字 と 日本語 の 境界 は スペース OK。

# 出力
入力 JSON と 同じ スキーマ で、 上記 観点 で 書き 直した JSON のみ を 返却 して ください。
JSON 以外 の 前置き / 説明 は 不要。
PROMPT;

    $userText = "次 の JSON を 上記 ルール で 校正 して ください。 同じ スキーマ で 返却:\n\n"
              . json_encode($parsed, JSON_UNESCAPED_UNICODE);

    $payloadArr = [
        'model' => 'gpt-4.1',  // 校正 タスク は 安く 速く
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

    // 安全 弁: トップレベル の 主要 キー が 落ちて いない こと を 確認。 落ちて いたら 元 を 返す。
    foreach (['title_ja', 'summary_one_paragraph', 'rq_hypothesis', 'detailed_sections'] as $k) {
        if (!array_key_exists($k, $polished) && array_key_exists($k, $parsed)) {
            return null; // ポリッシュ が 構造 を 壊した → 諦めて 元 を 使う
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
            // v776 #400 reasoning モデル で max_completion_tokens 不足 (= 全部 reasoning に 消費)
            //   の 切り分け の ため finish_reason + usage を error_msg に 残す。
            $info = " (finish=$finish";
            if (!empty($usage)) $info .= ", reasoning=" . ($usage['completion_tokens_details']['reasoning_tokens'] ?? '?') . ", completion=" . ($usage['completion_tokens'] ?? '?');
            $info .= ")";
            throw new RuntimeException('empty content' . $info);
        }
        $parsed = json_decode($content, true);
        if (!is_array($parsed)) throw new RuntimeException('invalid JSON');

        // v777 #401 2 段階目: 学術直訳調 を 自然 で 読み やすい 日本語 に 書き直す ポリッシュ。
        //   失敗 しても 元 の JSON で 続行 (本体 を 落とさ ない)。 別 モデル (gpt-4.1) を 使う
        //   こと で 安く・速く 仕上げる。 status は processing の まま (ユーザ に は 「要約 中」
        //   の 一貫 した 見え方)。
        try {
            $polished = ai_paper_translate_polish_ja($parsed, $apiKey);
            if (is_array($polished)) {
                $parsed = $polished;
            }
        } catch (Throwable $polishE) {
            // ポリッシュ 失敗 は ログ 残し て 元 JSON で 続行
            fwrite(STDERR, "[paper_translate] polish failed (row $rowId): " . $polishE->getMessage() . "\n");
        }

        $pdo->prepare("UPDATE paper_translates SET result_json = ?, status='done', finished_at = NOW() WHERE id = ?")
            ->execute([json_encode($parsed, JSON_UNESCAPED_UNICODE), $rowId]);
        // v804 auto_share=1 なら 公開 ON に
        $pdo->prepare("UPDATE paper_translates SET is_shared=1, shared_at=NOW() WHERE id=? AND auto_share=1 AND is_shared=0")
            ->execute([$rowId]);

        try {
            $shortTitle = (string)($parsed['title_ja'] ?? $pdfName);
            $shortTitle = mb_substr($shortTitle, 0, 60);
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "✅ 論文要約 完了: 「{$shortTitle}」 /#/paper-summary/r/{$token}",
                'paper_translate', $rowId);
        } catch (Throwable $_) {}
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE paper_translates SET status='error', error_msg = ?, finished_at = NOW() WHERE id = ?")
            ->execute([mb_substr($e->getMessage(), 0, 500), $rowId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ 論文要約 失敗: " . $e->getMessage() . " /#/paper-summary/r/{$token}",
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
// v781 #376 Deep Research — ChatGPT の Deep Research 機能 を 真似た 多段 Web 調査。
//   OpenAI Responses API + web_search hosted tool で Web を 横断 検索 し、
//   構造化 された 調査 レポート (要点 / セクション / 出典) を JSON で 返す。
//   コスト: 軽い (gpt-5-mini, 100pt) / 標準 (gpt-5, 250pt) / 深い (gpt-5 + 高 reasoning, 500pt)。
//   実 token / 検索 回数 は usage_json に 記録 して 後 から 参照 可能。
// ============================================================================

// v783 #380 深さ × モデル 別 ポイント を 実 API コスト ベース で 再計算。
//   OpenAI Responses API 2026/06 時点 の おおむね の 料金:
//     - web_search hosted tool: ~$0.030 per call
//     - gpt-5-mini: $0.15/1M input、 $1.50/1M output
//     - gpt-5:      $1.25/1M input、 $10.00/1M output
//   ざっくり 試算 (1 USD ≈ 150 円、 1 pt = 1 円):
//     - light (gpt-5-mini, ~4 検索, 5K in / 3K out): ~$0.13 = 約 20 円
//     - standard (gpt-5, ~7 検索, 15K in / 10K out): ~$0.33 = 約 50 円
//     - deep (gpt-5 高 reasoning, ~12 検索, 30K in / 30K out): ~$0.70 = 約 100 円
//   実 トークン / 検索 数 は usage_json に 残す ので、 実 コスト が ズレ た 場合 は 後 で 調整。
const DEEP_RESEARCH_TIERS = [
    'light'    => ['model' => 'gpt-5-mini', 'effort' => 'low',    'cost' => 20,  'max_tokens' => 8000,  'label' => '軽い (gpt-5-mini, ~4 検索)'],
    'standard' => ['model' => 'gpt-5',      'effort' => 'medium', 'cost' => 50,  'max_tokens' => 16000, 'label' => '標準 (gpt-5, ~7 検索)'],
    'deep'     => ['model' => 'gpt-5',      'effort' => 'high',   'cost' => 100, 'max_tokens' => 32000, 'label' => '深い (gpt-5 高 reasoning, ~12 検索)'],
];

const DEEP_RESEARCH_SYSTEM_PROMPT = <<<'PROMPT'
あなた は 「深く 横断的 に Web を 調べて 整理 して 報告 する」 リサーチ アシスタント です。
ユーザ から 与えられた リサーチ クエリ に 対して、 web_search ツール を 必要 な だけ 使って
複数 の 信頼 できる 情報 源 を 横断 し、 以下 の 構造 で 日本語 の 調査 レポート を 作って
ください。

# 振る舞い
- 最初 に クエリ を 分解 し、 調べる べき サブ トピック (3-6 個) を 自分 で 立てる
- それぞれ について web_search を 使い、 一次 情報 / 学術 論文 / 公式 ドキュメント を 優先
- 1 つ の ソース だけ で 結論 を 出さず、 複数 ソース を 突き合わせて 食い違い も 拾う
- 引用 は 必ず URL + 短い 出典 名 (例: 「OpenAI 公式 ブログ」「Wikipedia」「Nature 2024」) を
  そのまま 残す。 出典 を 落とさない
- 「分から ない / 確認 できない」 は そう 書く。 知らない こと を 創作 しない
- 用語 は 初出 で 簡潔 に 説明
- 日本語 の 文中 に 不要 な 半角 スペース を 入れない (英数字 / 記号 と の 境界 は OK)

# 出力 JSON スキーマ (これ を そのまま 返す)

{
  "query_understanding": "ユーザ クエリ を 自分 が どう 理解 し、 何 を 調べる つもり か (100-300 字)",
  "sub_questions": ["立てた サブ 問い 1", "問い 2", ...],
  "sections": [
    {
      "heading": "セクション タイトル",
      "body": "そのセクション の 説明 本文 (400-1000 字、 必要 なら 段落 分け)。 数値 や 主要 用語 は 残す",
      "sources": [
        {"label": "短い 出典 名 (例: 「Smith 2024 (Nature)」)", "url": "https://...",
         "first_author": "Smith, J. など 第一 著者 名 (論文 の 場合)",
         "title": "論文 / 記事 タイトル (原文)",
         "venue": "Nature 2024 / OpenAI 公式 ブログ など 投稿 先 / 媒体"},
        ...
      ]
    },
    ...
  ],
  "summary": "全 セクション を 通した 結論 / 重要 ポイント の 要約 (400-800 字)",
  "key_findings": ["3-7 個 の 重要 発見・主張 を 1 行 ずつ"],
  "open_questions": ["まだ 残って いる 問い・追加 で 調べる と 良い こと"],
  "all_sources": [
    {"label": "短い 出典 名", "url": "https://...",
     "first_author": "第一 著者 名 (論文 の 場合)",
     "title":        "論文 / 記事 タイトル (原文)",
     "venue":        "Nature / arXiv / 著者 公式 ブログ など 投稿 先 / 媒体",
     "why":          "なぜ 参照 した か (50-100 字)"},
    ...
  ]
}

# 出典 (sources / all_sources) の 必須 ルール
論文 を 参照 した 場合 は **first_author + title + venue** を 出来る だけ 埋める。
URL だけ で 終わら ない 事 (ユーザ が ぱっと 見て 何 の 出典 か 分かる 情報量 を 残す)。
論文 で ない (ブログ / 公式 ドキュメント / Wikipedia 等) の 場合 は title + venue 中心 で OK、
first_author は 該当 しない なら 省略 で OK。

JSON 以外 の 前置き / 解説 / markdown コード フェンス は 不要、 JSON のみ を 返却。
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
                                 dr.cost_points, dr.status, dr.result_json, dr.usage_json,
                                 dr.error_msg, dr.created_at, dr.finished_at, dr.is_shared, dr.shared_at,
                                 u.display_name AS author_name, u.avatar_url AS author_avatar
                            FROM deep_researches dr JOIN users u ON u.id = dr.user_id
                           WHERE dr.share_token = ?");
    $st->execute([$token]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'deep_research not found', 404);
    // v786 #385 まだ 進行中 なら OpenAI に 進捗 を 取り に 行く
    if ($row['status'] === 'processing' && !empty($row['openai_response_id'])) {
        try { $row = ai_deep_research_poll($pdo, $cfg, $row); }
        catch (Throwable $_) { /* poll 失敗 は 致命的 で は ない */ }
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
    ]);
}

// v784 #382 共有 ON / OFF (本人 のみ)
function ai_deep_research_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が 必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status FROM deep_researches WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 共有 切替 可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '調査 完了 後 のみ 共有 切替 可', 400);
    $on = (bool)$body['is_shared'];
    $pdo->prepare("UPDATE deep_researches
                      SET is_shared = ?, shared_at = " . ($on ? "NOW()" : "NULL") . "
                    WHERE id = ?")
        ->execute([$on ? 1 : 0, $id]);
    json_response(['ok' => true, 'is_shared' => $on]);
}

// v784 #382 みんな の 共有 Deep Research 一覧。 q= で キーワード 検索 (query_text + result_json 内 LIKE)
function ai_deep_research_shared_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
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
    json_response(['items' => $items, 'q' => $q]);
}

function ai_deep_research_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id FROM deep_researches WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 削除可', 403);
    $pdo->prepare("DELETE FROM deep_researches WHERE id=?")->execute([$id]);
    json_response(['ok' => true]);
}

function ai_deep_research(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);

    $body = read_json_body();
    $query = trim((string)($body['query'] ?? ''));
    if ($query === '') throw new ApiException('bad_request', 'query が 必要 です', 400);
    if (mb_strlen($query) > 4000) throw new ApiException('bad_request', 'query は 4000 字 まで', 400);
    $depth = (string)($body['depth'] ?? 'standard');
    if (!isset(DEEP_RESEARCH_TIERS[$depth])) {
        throw new ApiException('bad_request', '未対応 depth: ' . $depth, 400);
    }
    $tier = DEEP_RESEARCH_TIERS[$depth];
    $cost = (int)$tier['cost'];

    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < $cost) {
        throw new ApiException('insufficient_balance',
            sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $token = bin2hex(random_bytes(16));

    $rowId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $query, $tier, $depth, $cost, &$rowId) {
        $pdo->prepare("INSERT INTO deep_researches
            (user_id, share_token, query_text, model, depth, cost_points, status)
            VALUES (?,?,?,?,?,?,'pending')")
            ->execute([$uid, $token, $query, $tier['model'], $depth, $cost]);
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
        'message'     => '依頼を受け付けました。 OpenAI (' . $tier['model'] . ' / ' . $depth . ') が 調査中… (深さ により 1-15 分)。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(900);

    ai_deep_research_run_background($pdo, $cfg, $rowId, $token, $query, $tier, $apiKey, $uid);
}

// v786 #385 OpenAI Responses API は web_search + reasoning だと 30 分 超 を 普通 に 使う ため、
//   従来 の 同期 POST 1 本 だけ だと PHP プロセス が PHP-FPM の request_terminate_timeout に
//   殺されて 結果 が DB に 入らず status=processing で 永遠 に 残る。 background=true で
//   投げ て、 結果 ページ アクセス の たび に GET /v1/responses/{id} で 進捗 / 完了 を 取り
//   行く 方式 に 改修 (= polling)。
function ai_deep_research_run_background(PDO $pdo, array $cfg, int $rowId, string $token, string $query, array $tier, string $apiKey, int $uid): void {
    try {
        $pdo->prepare("UPDATE deep_researches SET status='processing', progress_text='OpenAI に 依頼 中…' WHERE id = ?")->execute([$rowId]);

        $payloadArr = [
            'model' => $tier['model'],
            'input' => [
                ['role' => 'system', 'content' => DEEP_RESEARCH_SYSTEM_PROMPT],
                ['role' => 'user',   'content' => $query],
            ],
            'tools' => [['type' => 'web_search']],
            'max_output_tokens' => (int)$tier['max_tokens'],
            'background' => true,   // 非同期 化、 response_id だけ 即 返って くる
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
            CURLOPT_TIMEOUT => 60,  // background なら 数 秒 で response_id が 返る
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
            ->execute([$rid, '🌐 Web 検索 を 開始…', $rowId]);
        // 完了通知 は ポーリング 側 で 発火 (get_shared 内)
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

// v786 #385 OpenAI に 進捗 を 取り に 行く ヘルパ。 status=processing で openai_response_id が
//   ある 行 を 渡す と、 GET /v1/responses/{id} を 叩いて status を 更新 する。
//   - completed: result_json + usage_json を 保存 → status='done' → 通知
//   - failed:    status='error' → error_msg 保存 → 通知
//   - その他: progress_text だけ 更新 (web_search 件数 / 状態)
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
        return $row; // poll 失敗 は 致命的 で は ない (次回 retry)
    }
    $j = json_decode((string)$resp, true);
    if (!is_array($j)) return $row;

    $oaStatus = (string)($j['status'] ?? 'in_progress');

    // 進捗 集計
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
            $pdo->prepare("UPDATE deep_researches SET status='error', error_msg='completed だが output_text が 空', finished_at=NOW() WHERE id=?")
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
        try {
            $shortQ = mb_substr((string)$row['query_text'], 0, 60);
            notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice',
                "🔎 Deep Research 完了: 「{$shortQ}」 /#/deep-research/r/{$row['share_token']}",
                'deep_research', (int)$row['id']);
        } catch (Throwable $_) {}
        // 行 を 最新化 して 返す
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
// v788 #386 #387 #388 論文 全訳 — paper-summary と 似た UI で フル 翻訳 を 出す。
//   章 ごと に 訳 → サンプル 文 を back-translate して 整合 確認 → 用語 統一 + 全体 ポリッシュ。
//   direction:
//     en2ja: 英語 論文 → 日本語 (要約 と 同程度 の コスト)
//     ja2en: 日本語 論文 → 英語 (5x、 + em-dash 等 GPT-isms 除去)
//   Responses API + background mode + polling で 長 時間 ジョブ を 安全 に。
// ============================================================================

// v808 #403 価格 調整 + デフォルト を gpt-5 に。
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
あなた は 学術 論文 を **章 ごと に 全訳** する 翻訳 アシスタント です。 添付 された 英語 論文 PDF
を 全訳 し、 同時 に 各 章 で back-translation で 訳 の 信頼性 を 確認 し、 最後 に 全体 を
見渡 して 用語 統一 と 自然 さ を 整える ところ まで やって ください。

# 大切 な ルール

1. **全文 を 訳す** (要約 では ない)。 段落 を 飛ばしたり 圧縮 したり しない。 数式 / 図表 番号 /
   引用 番号 [12] / 著者名 表記 (Smith et al., 2024) など は そのまま 残す。
2. **章 (Section) 単位 で 区切って 翻訳** する。 章 タイトル も 「Introduction (はじめに)」 の よう
   に 原題 + 訳 を 併記。
3. **back-translation**: 各 章 から 2-3 文 を サンプル として 取って 日本語 → 英語 に 逆 翻訳 し、
   元 英文 と 突き合わせて 「ズレ が ない か」 を コメント する。 ズレ が あれば 訳 を 修正 し直す。
4. **用語 統一**: 重要 用語 (proper noun, jargon) は 章 を またいで 同じ 訳語 を 使う。 章 ごと の
   訳 が 終わった あと、 全体 ポリッシュ で 用語 ブレ を 直す。
5. **「論文 で は 〜 と 述べて いる」 などの メタ 解説 で 包まない**。 原文 と 同じ 主張 で 直接 訳す。
6. 日本語 の 文中 に 不要 な 半角 スペース を 入れない (英数字 / 記号 と の 境界 は OK)。

# 出力 JSON スキーマ (これ を そのまま 返却)

{
  "title_original":    "原 タイトル (英語)",
  "title_translated":  "日本語 タイトル",
  "authors":           "著者名 (代表 3 名 まで + et al.)",
  "venue":             "発表 会議 / ジャーナル + 年",
  "language_detected": "en",
  "chapters": [
    {
      "chapter_title_original":   "Introduction",
      "chapter_title_translated": "はじめに",
      "translation":              "全文 訳 (省略 せず)。 段落 は \n\n で 区切る",
      "back_translation_samples": [
        { "ja_translation": "サンプル と して 選んだ 訳文 (1-2 文)",
          "back_to_en":     "それ を 逆 翻訳 した 英文",
          "original_en":    "対応 する 原文 (引用)",
          "notes":          "ズレ や 訂正 の メモ (なし なら 空 文字列)" }
      ],
      "key_terms": [
        { "original": "term", "translation": "用語 訳", "note": "なぜ こう 訳した か" }
      ]
    }
  ],
  "overall_polish": {
    "terminology_consistency": "全体 で 用語 ブレ を 統一 した メモ (どの 用語 を どう 揃え た か)",
    "adjustments_made":        ["章 を またいで 修正 した 点 1", "..."],
    "remaining_concerns":      ["残った 不確か な 訳 / 用語 / 数値 など"]
  }
}

JSON 以外 の 前置き / 解説 / markdown コード フェンス は 不要、 JSON のみ を 返却。
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
    // v807 result_json から title 系 も 取り 出して 履歴 表示 を リッチ に
    $st = $pdo->prepare("SELECT id, share_token, pdf_name, direction, model, cost_points, status,
                                created_at, finished_at, is_shared, shared_at, error_msg, result_json
                           FROM paper_full_translations WHERE user_id = ?
                       ORDER BY id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = array_map(function ($r) {
        $result = !empty($r['result_json']) ? json_decode((string)$r['result_json'], true) : null;
        return [
            'id' => (int)$r['id'],
            'share_token' => $r['share_token'],
            'pdf_name'    => $r['pdf_name'],
            'title_translated' => is_array($result) ? ($result['title_translated'] ?? null) : null,
            'title_original'   => is_array($result) ? ($result['title_original']   ?? null) : null,
            'authors'          => is_array($result) ? ($result['authors']          ?? null) : null,
            'venue'            => is_array($result) ? ($result['venue']            ?? null) : null,
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
    // 進行中 なら OpenAI に 進捗 を 取り に 行く
    if ($row['status'] === 'processing' && !empty($row['openai_response_id'])) {
        try { $row = ai_paper_full_translate_poll($pdo, $cfg, $row); }
        catch (Throwable $_) {}
    }
    $reactions = ai_paper_reactions_summary($pdo, 'paper_full_translation', (int)$row['id'], $meId);  // v789 #389
    // v797 同 PDF の 要約 row が あれ ば 相互 リンク を 出す
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
    ]);
}

function ai_paper_full_translate_shared_list(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
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
    json_response(['items' => $items, 'q' => $q]);
}

function ai_paper_full_translate_patch(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    if (!array_key_exists('is_shared', $body)) {
        throw new ApiException('bad_request', 'is_shared が 必要', 400);
    }
    $st = $pdo->prepare("SELECT user_id, status FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 共有 切替 可', 403);
    if ($row['status'] !== 'done') throw new ApiException('bad_request', '完了 後 のみ 共有 切替 可', 400);
    $on = (bool)$body['is_shared'];
    $pdo->prepare("UPDATE paper_full_translations
                      SET is_shared = ?, shared_at = " . ($on ? "NOW()" : "NULL") . "
                    WHERE id = ?")
        ->execute([$on ? 1 : 0, $id]);
    json_response(['ok' => true, 'is_shared' => $on]);
}

function ai_paper_full_translate_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT user_id, pdf_path FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 削除 可', 403);
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
        throw new ApiException('bad_request', 'PDF を multipart/form-data でアップロード してください', 400);
    }
    if (!isset($_FILES['file']) || !is_uploaded_file($_FILES['file']['tmp_name'])) {
        throw new ApiException('bad_request', 'file (PDF) が必要です', 400);
    }
    $f = $_FILES['file'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ApiException('bad_request', 'upload error ' . $f['error'], 400);
    if ($f['size'] > 30 * 1024 * 1024) throw new ApiException('bad_request', 'PDF は 30 MB まで', 400);
    $tmpPdf = $f['tmp_name'];
    $head = @file_get_contents($tmpPdf, false, null, 0, 5);
    if ($head !== '%PDF-') throw new ApiException('bad_request', 'PDF ファイル では ありません', 400);

    $direction = (string)($_POST['direction'] ?? 'en2ja');
    if (!in_array($direction, ['en2ja', 'ja2en'], true)) {
        throw new ApiException('bad_request', 'direction は en2ja / ja2en のみ', 400);
    }
    $models = ai_paper_full_translate_models_for($direction);
    $reqModel = trim((string)($_POST['model'] ?? 'gpt-5'));
    if (!isset($models[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $cost = (int)$models[$reqModel];
    // v804 「終わった 瞬間 共有 ON」
    $autoShare = !empty($_POST['auto_share']) ? 1 : 0;

    // v797 SHA-256 は 横展開 リンク 用 だけ に 算出 (同 PDF でも 別 ジョブ で 走らせる、 課金 も 別)
    $pdfSha = hash_file('sha256', $tmpPdf);

    // v808 #402 ラボ PI (user_id=3) は 課金 スキップ
    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    // PDF 保存 (削除 時 / 再 表示 時 用)
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
            VALUES (?,?,?,?,?,?,?,?,'pending','OpenAI に 依頼 中…',?)")
            ->execute([$uid, $token, $pdfRel, mb_substr($pdfName, 0, 255), $pdfSha, $direction, $reqModel, $cost, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        // v808 #402 ラボ PI は 課金 スキップ
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_full_translate', 'paper_full_translation', $rowId,
                '論文 全訳 (' . $direction . ') 依頼料');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'direction' => $direction, 'model' => $reqModel,
        'message' => '依頼を受け付けました。 OpenAI (' . $reqModel . ') が 全訳 中… (10-30 分)。 結果ページを 開いて おいて も OK、 完了 通知 が 届きます。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $rowId, $token, $fileId, $direction, $reqModel, $apiKey, $uid);
}

// v806 エラー row を 同 row で 再 投入 (新規 課金 / 新規 row なし)。 v810 #_stuck status=error の もの
// に 加え、 status=processing で 30 分 以上 進ま ない もの も 「stale = 詰まって いる」 と 見なし 再 投入 可。
function ai_paper_full_translate_retry(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_full_translations WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 再 実施 可', 403);
    $okError = $row['status'] === 'error';
    $okStaleProc = $row['status'] === 'processing'
        && (int)(strtotime((string)$row['created_at']) ?: 0) > 0
        && (time() - strtotime((string)$row['created_at'])) >= 1800;
    if (!$okError && !$okStaleProc) {
        throw new ApiException('bad_request', '再 実施 は エラー / 30 分 以上 経過 した 処理 中 のみ (現 status: ' . $row['status'] . ')', 400);
    }
    if (empty($row['pdf_path'])) {
        throw new ApiException('bad_request', 'PDF が 残って いない の で 再 実施 不可', 400);
    }
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体 が 見つかり ません', 404);

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    // row リセット (新規 課金 なし)
    $pdo->prepare("UPDATE paper_full_translations
                      SET status='processing', progress_text='再 投入 中…',
                          openai_response_id=NULL, error_msg=NULL, result_json=NULL,
                          usage_json=NULL, finished_at=NULL
                    WHERE id=?")->execute([$id]);

    json_response_no_exit([
        'ok' => true, 'id' => $id, 'share_token' => $row['share_token'], 'status' => 'processing',
        'message' => '再 投入 を 開始 しました (新規 課金 なし)。 結果 ページ で 進捗 を 確認 して ください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $id, (string)$row['share_token'], $fileId,
        (string)$row['direction'], (string)$row['model'], $apiKey, $uid);
}

// v806 paper_translate (要約) の エラー row を 同 row で 再 投入 (新規 課金 なし)。
// v810 #_stuck status=processing で 30 分 以上 進ま ない stale row も 再 投入 可。
function ai_paper_translate_retry(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_translates WHERE id=?");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'not found', 404);
    if ((int)$row['user_id'] !== $uid) throw new ApiException('forbidden', '本人 のみ 再 実施 可', 403);
    $okError = $row['status'] === 'error';
    $okStaleProc = $row['status'] === 'processing'
        && (int)(strtotime((string)$row['created_at']) ?: 0) > 0
        && (time() - strtotime((string)$row['created_at'])) >= 1800;
    if (!$okError && !$okStaleProc) {
        throw new ApiException('bad_request', '再 実施 は エラー / 30 分 以上 経過 した 処理 中 のみ (現 status: ' . $row['status'] . ')', 400);
    }
    if (empty($row['pdf_path'])) {
        throw new ApiException('bad_request', 'PDF が 残って いない の で 再 実施 不可', 400);
    }
    $pdfAbs = '/var/www/labpay/public' . $row['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体 が 見つかり ません', 404);

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, $row['pdf_name'] ?: 'paper.pdf', $apiKey);

    $reqModel = (string)$row['model'];
    $sys = PAPER_TRANSLATE_DEFAULT_PROMPT;
    $userPrompt = "添付 した PDF の 研究論文 を、 system prompt の 指示 に 沿って 詳細 サマリ + 落合メソッド で 日本語 要約 してください。 figure_refs の page 番号 は PDF の 物理ページ (1 始まり) で 正確に。 出力 JSON のみ。\n\n書く 前 と 書いた 後 で、 必ず PDF の 該当 箇所 を 再確認 し、 数値 / 著者 主張 / 結果 が 一致 する こと を 自分 で 検証 して から JSON を 出して ください。 ハルシネーション は 厳禁 です。";

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
        'message' => '再 投入 を 開始 しました (新規 課金 なし)。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    ai_paper_translate_run_background($pdo, $cfg, $id, (string)$row['share_token'], $fileId, $payload, $apiKey, (string)$row['pdf_name'], $uid);
}

// v813 #405 要約 row の 保存 済 PDF を 流用 して ペア の 全訳 row を 新規 作成。
//   アップロード 不要、 直接 「📑 全訳 を 作る」 ボタン から 呼ぶ。
function ai_paper_full_translate_from_summary(PDO $pdo, array $cfg, int $summaryId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_translates WHERE id=?");
    $st->execute([$summaryId]);
    $sumRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$sumRow) throw new ApiException('not_found', '要約 row が ありません', 404);
    if ((int)$sumRow['user_id'] !== $uid) throw new ApiException('forbidden', '本人 の 要約 のみ ペア 全訳 を 作れ ます', 403);
    if (empty($sumRow['pdf_path'])) throw new ApiException('bad_request', '元 PDF が 残って いない の で 全訳 を 作れ ません', 400);
    $pdfAbs = '/var/www/labpay/public' . $sumRow['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体 が 見つかり ません', 404);

    $body = read_json_body();
    $direction = (string)($body['direction'] ?? 'en2ja');
    if (!in_array($direction, ['en2ja', 'ja2en'], true)) {
        throw new ApiException('bad_request', 'direction は en2ja / ja2en のみ', 400);
    }
    $models = ai_paper_full_translate_models_for($direction);
    $reqModel = trim((string)($body['model'] ?? 'gpt-5'));
    if (!isset($models[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $cost = (int)$models[$reqModel];
    $autoShare = !empty($body['auto_share']) ? 1 : 0;

    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
        }
    }

    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($pdfAbs, (string)$sumRow['pdf_name'], $apiKey);

    // 保存 用 PDF を 新規 token フォルダ に コピー (paper_full_translations は 自分 の pdf_path を 持つ)
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
            VALUES (?,?,?,?,?,?,?,?,'pending','OpenAI に 依頼 中…',?)")
            ->execute([$uid, $token, $pdfRel, mb_substr($pdfName, 0, 255), $pdfSha, $direction, $reqModel, $cost, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_full_translate', 'paper_full_translation', $rowId,
                '論文 全訳 (' . $direction . ') 依頼料 (要約 から)');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'direction' => $direction, 'model' => $reqModel,
        'message' => 'ペア の 全訳 を 開始 し ました。 結果 ページ で 進捗 を 確認 して ください。',
    ]);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(120);

    ai_paper_full_translate_submit($pdo, $cfg, $rowId, $token, $fileId, $direction, $reqModel, $apiKey, $uid);
}

// v813 #405 対称: 全訳 row の 保存 済 PDF を 流用 して ペア の 要約 row を 新規 作成。
function ai_paper_translate_from_full(PDO $pdo, array $cfg, int $fullId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    ai_assert_configured($cfg);
    $st = $pdo->prepare("SELECT * FROM paper_full_translations WHERE id=?");
    $st->execute([$fullId]);
    $fullRow = $st->fetch(PDO::FETCH_ASSOC);
    if (!$fullRow) throw new ApiException('not_found', '全訳 row が ありません', 404);
    if ((int)$fullRow['user_id'] !== $uid) throw new ApiException('forbidden', '本人 の 全訳 のみ ペア 要約 を 作れ ます', 403);
    if (empty($fullRow['pdf_path'])) throw new ApiException('bad_request', '元 PDF が 残って いない の で 要約 を 作れ ません', 400);
    $pdfAbs = '/var/www/labpay/public' . $fullRow['pdf_path'];
    if (!is_file($pdfAbs)) throw new ApiException('not_found', 'PDF 本体 が 見つかり ません', 404);

    $body = read_json_body();
    $reqModel = trim((string)($body['model'] ?? 'gpt-5'));
    if (!isset(PAPER_TRANSLATE_MODELS[$reqModel])) {
        throw new ApiException('bad_request', '未対応 モデル: ' . $reqModel, 400);
    }
    $cost = (int)PAPER_TRANSLATE_MODELS[$reqModel];
    $autoShare = !empty($body['auto_share']) ? 1 : 0;

    $skipCharge = ($uid === 3);
    if (!$skipCharge) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $cost) {
            throw new ApiException('insufficient_balance',
                sprintf('ポイント不足 (要 %d pt、 現在 %d pt)', $cost, $bal), 400);
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
    $userPrompt = "添付 した PDF の 研究論文 を、 system prompt の 指示 に 沿って 詳細 サマリ + 落合メソッド で 日本語 要約 してください。 figure_refs の page 番号 は PDF の 物理ページ (1 始まり) で 正確に。 出力 JSON のみ。\n\n書く 前 と 書いた 後 で、 必ず PDF の 該当 箇所 を 再確認 し、 数値 / 著者 主張 / 結果 が 一致 する こと を 自分 で 検証 して から JSON を 出して ください。 ハルシネーション は 厳禁 です。";

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
            (user_id, share_token, file_id, pdf_name, pdf_sha256, prompt_used, result_json, cost_points, status, pages_count, pages_dir, pdf_path, model, auto_share)
            VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)")
            ->execute([$uid, $token, $fileId, mb_substr($pdfName, 0, 255), $pdfSha, $sys, 'null', $cost,
                       $pagesCount > 0 ? $pagesCount : null, $pagesCount > 0 ? $pagesRel : null,
                       $pdfRel, $reqModel, $autoShare]);
        $rowId = (int)$pdo->lastInsertId();
        if (!$skipCharge) {
            Ledger::transfer($pdo, $uid, 1, $cost, 'paper_translate', 'paper_translate', $rowId, '論文 要約 依頼料 (全訳 から)');
        }
    });

    json_response_no_exit([
        'ok' => true, 'id' => $rowId, 'share_token' => $token, 'status' => 'pending',
        'cost_points' => $cost, 'model' => $reqModel,
        'message' => 'ペア の 要約 を 開始 し ました。 結果 ページ で 進捗 を 確認 して ください。',
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
            : "添付 の 英語 論文 を 章 ごと に 日本語 で 全訳 + back-translation で 整合 確認 + 用語 統一 と 全体 ポリッシュ まで やって ください。 JSON のみ 返却。";

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
            ->execute([$rid, '📑 章 を 切り出し て 翻訳 を 始めて います…', $rowId]);
    } catch (Throwable $e) {
        $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg=?, finished_at=NOW() WHERE id=?")
            ->execute([mb_substr($e->getMessage(), 0, 1000), $rowId]);
        try {
            notify_safely($pdo, $cfg, $uid, 'admin_notice',
                "❌ 論文 全訳 失敗: " . $e->getMessage() . " /#/paper-translate-full/r/{$token}",
                'paper_full_translation', $rowId);
        } catch (Throwable $_) {}
    }
}

// Deep Research と 同じ ポーリング 構造 で OpenAI に 状態 を 問い合わせ。
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
            $pdo->prepare("UPDATE paper_full_translations SET status='error', error_msg='completed だが output_text が 空', finished_at=NOW() WHERE id=?")
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
        // v804 auto_share=1 なら 公開 ON に
        $pdo->prepare("UPDATE paper_full_translations SET is_shared=1, shared_at=NOW() WHERE id=? AND auto_share=1 AND is_shared=0")
            ->execute([$row['id']]);
        try {
            $title = is_array($parsed) ? (string)($parsed['title_translated'] ?? $parsed['title_original'] ?? $row['pdf_name']) : $row['pdf_name'];
            $title = mb_substr($title, 0, 60);
            notify_safely($pdo, $cfg, (int)$row['user_id'], 'admin_notice',
                "📑 論文 全訳 完了: 「{$title}」 /#/paper-translate-full/r/{$row['share_token']}",
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
// v789 #389 論文 要約 / 全訳 共通 の いいね・ブックマーク・コメント。
//   ref_type は 'paper_translate' (要約) / 'paper_full_translation' (全訳)。
// ============================================================================

function ai_paper_react_toggle(PDO $pdo, array $cfg, string $refType, int $refId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $kind = (string)($body['kind'] ?? '');
    if (!in_array($kind, ['like', 'bookmark'], true)) {
        throw new ApiException('bad_request', 'kind は like / bookmark のみ', 400);
    }
    // 存在 確認
    $table = $refType === 'paper_full_translation' ? 'paper_full_translations' : 'paper_translates';
    $st = $pdo->prepare("SELECT id FROM $table WHERE id=?");
    $st->execute([$refId]);
    if (!$st->fetchColumn()) throw new ApiException('not_found', 'ref not found', 404);

    // toggle
    $del = $pdo->prepare("DELETE FROM paper_reactions WHERE ref_type=? AND ref_id=? AND user_id=? AND kind=?");
    $del->execute([$refType, $refId, $uid, $kind]);
    $turnedOn = $del->rowCount() === 0;
    if ($turnedOn) {
        $pdo->prepare("INSERT INTO paper_reactions (ref_type, ref_id, user_id, kind) VALUES (?,?,?,?)")
            ->execute([$refType, $refId, $uid, $kind]);
    }
    // 集計
    $st2 = $pdo->prepare("SELECT kind, COUNT(*) AS n FROM paper_reactions WHERE ref_type=? AND ref_id=? GROUP BY kind");
    $st2->execute([$refType, $refId]);
    $counts = ['like' => 0, 'bookmark' => 0];
    foreach ($st2->fetchAll(PDO::FETCH_ASSOC) as $r) $counts[$r['kind']] = (int)$r['n'];
    json_response([
        'ok' => true, 'kind' => $kind, 'on' => $turnedOn,
        'counts' => $counts,
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
    if ($text === '') throw new ApiException('bad_request', 'body が 必要', 400);
    if (mb_strlen($text) > 2000) throw new ApiException('bad_request', 'コメント は 2000 字 まで', 400);
    $table = $refType === 'paper_full_translation' ? 'paper_full_translations' : 'paper_translates';
    $st = $pdo->prepare("SELECT user_id FROM $table WHERE id=?");
    $st->execute([$refId]);
    $authorUid = (int)$st->fetchColumn();
    if (!$authorUid) throw new ApiException('not_found', 'ref not found', 404);
    $ins = $pdo->prepare("INSERT INTO paper_comments (ref_type, ref_id, user_id, body) VALUES (?,?,?,?)");
    $ins->execute([$refType, $refId, $uid, $text]);
    $cid = (int)$pdo->lastInsertId();
    // 投稿者 が 別人 なら 通知
    if ($authorUid !== $uid) {
        try {
            $snippet = mb_substr($text, 0, 60);
            $kindLabel = $refType === 'paper_full_translation' ? '論文 全訳' : '論文 要約';
            $urlSlug   = $refType === 'paper_full_translation' ? 'paper-translate-full' : 'paper-summary';
            // ref token を 取って 通知 body に 埋め込み (Slack DM が body 内 URL を 拾う)
            $st2 = $pdo->prepare("SELECT share_token FROM $table WHERE id=?");
            $st2->execute([$refId]);
            $token = (string)$st2->fetchColumn();
            notify_safely($pdo, $cfg, $authorUid, 'admin_notice',
                "💬 {$u['display_name']} さん が あなた の {$kindLabel} に コメント: 「{$snippet}」 /#/{$urlSlug}/r/{$token}",
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
        throw new ApiException('forbidden', '本人 / admin のみ 削除 可', 403);
    }
    $pdo->prepare("DELETE FROM paper_comments WHERE id=?")->execute([$cid]);
    json_response(['ok' => true]);
}

// 要約 / 全訳 の get_shared レスポンス に 反応 集計 を 付ける ヘルパ
function ai_paper_reactions_summary(PDO $pdo, string $refType, int $refId, int $meId): array {
    $st = $pdo->prepare("SELECT kind, COUNT(*) AS n, MAX(user_id=?) AS mine
                           FROM paper_reactions WHERE ref_type=? AND ref_id=? GROUP BY kind");
    $st->execute([$meId, $refType, $refId]);
    $r = ['like' => 0, 'bookmark' => 0, 'my_like' => false, 'my_bookmark' => false];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $r[$row['kind']] = (int)$row['n'];
        if ((int)$row['mine'] === 1) $r['my_' . $row['kind']] = true;
    }
    // コメント 数 も 軽く 取得
    $st2 = $pdo->prepare("SELECT COUNT(*) FROM paper_comments WHERE ref_type=? AND ref_id=?");
    $st2->execute([$refType, $refId]);
    $r['comment_count'] = (int)$st2->fetchColumn();
    return $r;
}

// POST /api/ai/short_title { context: "...説明..." }
//   → { title: "..." }
// 1 行 5-15 字 の 楽しい 日本語 タイトル を 1 つだけ 返す。 タイマーや ストップウォッチ
// 作成時の 「タイトル空欄 → 自動生成」 用。 軽い call なので キャッシュなし / 履歴なし。
function ai_short_title(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $context = trim((string)($body['context'] ?? ''));
    if ($context === '') throw new ApiException('bad_request', 'context required', 400);
    if (mb_strlen($context) > 500) $context = mb_substr($context, 0, 500);

    $sys = "短い 楽しい 日本語 タイトル を 1 つだけ 返してください。 5-15 文字。 絵文字 1 個 まで 添えても OK。 余計な 前置き や 解説は 不要、 タイトル 1 行のみ。 引用符 (「」 等) で 囲まない。";

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
    // 整形: 引用符 除去 / 1 行に / 最大 30 文字
    $title = trim(preg_replace('/[\r\n]+/', ' ', $text));
    $title = preg_replace('/^[「『"\']+|[」』"\']+$/u', '', $title);
    $title = mb_substr($title, 0, 30);
    json_response(['ok' => true, 'title' => $title]);
}

// POST /api/ai/chat { message, history?: [{role,content},...] }
//   → { text }
// 汎用 多言語 対話 (主に 翻訳 用途)。 LabPay 操作には 言及せず、 ユーザーの
// 入力を そのまま 翻訳 / 解説。
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
あなたは 中村さん (日本語話者) のための 多言語 対話・翻訳 アシスタント です。 主な
用途は 海外出張 (中国、 イタリア など) での 翻訳・コミュニケーション 支援。

挙動 ルール:
- 入力テキストの 言語を 自動判定
- 日本語で 「○○ を 中国語で」 「これを イタリア語に」 と 言われたら 該当言語へ 翻訳
- 「翻訳して」 だけ なら 文脈から 最も 妥当な 訳先 (= 日本語 ↔ 外国語) に
- 外国語が 直接 入力されたら 日本語訳 を 返す + 短い 解説 (発音 / 文化的 ニュアンス / 食べ物なら 何か / 注意事項 など)
- 一般的な 質問にも 答える (相手先国 の マナー、 注文 の しかた、 通貨 計算 など)
- 余計な 前置き は 不要、 結果を 直接

書式:
- 翻訳 結果は **太字**
- 発音 / カナ表記 が 有用 なら 括弧で 添える
- 補足は その下に 1-2 行
- 長文は 箇条書き で 整理

例:
ユーザー: 「『お会計お願いします』をイタリア語で」
返答:
**Il conto, per favore.**
(イル・コント・ペル・ファヴォーレ / 直訳「勘定書を お願いします」)
└ レストランで 一般的。 カフェなら "Quanto le devo?" (クアント・レ・デヴォ / いくらですか) も 自然。
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
// LabPay の 使い方 を 案内する Q&A エージェント (UI ナビゲーション特化)。
// ユーザー データ (残高 / 履歴 等) には アクセスしない — そこを 答える時は 「設定 →
// ...」 と 操作手順を 案内するだけ。
function ai_assistant(PDO $pdo, array $cfg): void {
    Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $msg = trim((string)($body['message'] ?? ''));
    if ($msg === '') throw new ApiException('bad_request', 'message required', 400);
    if (mb_strlen($msg) > 2000) throw new ApiException('bad_request', 'message too long', 400);
    $history = is_array($body['history'] ?? null) ? $body['history'] : [];
    $history = array_slice($history, -10); // 直近 10 ターン だけ 持ち回す

    $sys = <<<SYS
あなたは LabPay の 使い方 ガイド アシスタント です。 ユーザーの 「○○ したいけど どこ から?」
「△△ の 情報 見たい」 に、 簡潔な 操作手順 で 答えてください。 ユーザー本人の データ
(残高 / 履歴 / 通知 等) は 見えない ので、 個別データを 聞かれた場合は 「○○ メニュー
で 確認 できます」 と 場所を 案内するに 留めること。

回答 ルール:
- 太字 (**○○**) で 重要 ボタン名 や メニュー名 を 強調
- 番号付き リスト で 手順を 並べる
- 関連 機能 が あれば 末尾に 「関連: ...」 で 1 行 紹介
- 不明な機能 を 聞かれたら 「LabPay には その機能は ありません」 と 正直に
- 過度な 前置きや 「お問い合わせ ありがとうございます」 等 は 不要、 答えだけ

LabPay の 主な ナビゲーション:
- **ホーム** (#/): 残高、 クイック ボタン (買う/売る/頼む/送る/翻訳…)、 未対応カード、 今日の予定、 グループ、 募集、 新着 プレイリスト、 参加中タイマー
- **買う** (#/buy): 商品 一覧 + JAN コード スキャン
- **売る** (#/sell): 出品
- **頼む** (#/tasks): タスク作成 (報酬付き 募集 / 指名 / リクエスト) — ホームの 「頼む」 でも
- **送る** (#/send): 個人間 ポイント 送金
- **アプリ** (#/apps): ルーレット / 投票 / 点呼 / タイマー / ストップウォッチ / 翻訳 / 待ち合わせ / 飲み会割り勘 / ワリカ電卓 / 請求 / オークション / プレイリスト / ランダム分け / 連絡先 / 重要連絡 / Scrapbox / 関係性グラフ / 運動 / ラボ滞在マップ
- **グループ** (#/groups): 出張 / 旅行 向け 一時 メンバー枠 + スケジュール + ワリカ + 地図 + 翻訳ログ + チャット
- **募集** (#/invitations): お昼ご飯 / 飲み会 等 カジュアル集合
- **実績** (#/achievements): 学業 / 売買 / 滞在 / ラボ運営 など 15 カテゴリ
- **設定** (#/settings): プロフィール / アバター / タブ並び替え / ホーム上部 クイック ボタン / アプリ表示 / Google Calendar / Zoom 連携 / 端末 (MAC) 登録 / プロフィール (Slack / 電話) / 効果音 / ホーム カード 並び
- **報告・要望** (#/feedback-admin or トップ ナビ): バグ報告 / 機能要望
- **通知** (#/notifications): 通知ベル から

特殊 機能 ヒント:
- **AI 機能**: スケジュール フリーテキスト 展開 (グループ予定追加 modal 上部 「✨」)、 場所名 → 緯度経度+説明+画像 自動入力 (タイトル横 「🔍 場所を検索」)、 画像 翻訳 (#/translate)、 翻訳ログ (グループに 紐づけ可能)
- **位置共有**: グループ 地図ページ (#/groups/{id}/map) の 「📡 位置共有」 トグル で メンバー全員に 位置を 共有
- **❤️ 行きたい場所**: グループ スケジュール の 行きたい場所ストック の タイル 右下
- **ベル / 中間音**: タイマー作成時に 1ベル/2ベル/3ベル 分単位 で 指定
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
// 両方 best-effort。 OpenAI 鍵 不要 (Wiki + OSM のみ)。
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
        throw new ApiException('not_configured', 'OpenAI が 設定されていません (config.openai.api_key)', 503);
    }
}

// POST /api/ai/expand_schedule
//   body: { text: "明日 12 時から 渋谷駅前で ランチ 1 時間半" }
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
あなたは スケジュール 抽出器 です。 ユーザーの 日本語 フリーテキスト から、
以下の フィールドを 抽出して JSON で 返してください。 該当が 無い フィールドは null。

本日は {$today} ({$dow})。 「明日」 「来週月曜」 等の 相対日付は 本日 基準で 解釈。
時刻 が 明示されない 場合は null。 「お昼」 → 12:00、 「夕方」 → 17:00、 「夜」 → 19:00 と 推測。
場所 (location) は そのまま。 緯度経度 が 含まれて居れば 別途。

出力 JSON の フィールド (これ以外 出力しない):
- title (str, 必須): 短い 1 行 タイトル
- day_date (str "YYYY-MM-DD" or null): 開始日
- start_time (str "HH:MM" or null): 開始時刻
- duration_minutes (int or null): 所要時間 (分)
- end_date (str "YYYY-MM-DD" or null): 終了日 (複数日 跨ぐ場合)
- end_time (str "HH:MM" or null): 終了時刻
- location (str or null): 場所 名 (緯度経度 を 含む 場合は memo に 回す)
- memo (str or null): 補足情報
- url (str or null): http(s):// で 始まる URL があれば
- kind (str): flight, train, bus, taxi, car, walk, hotel, conf, meeting, meetup, food, fun, other の 中で 最も 適切な もの。 待ち合わせ系 (集合 / 待ち合わせ) は meetup。 食事は food。 観光・遊び は fun。 不明 は other
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
// OpenAI Vision (gpt-4o-mini) に 画像を 直接 投げる。 image_url は LabPay 自身の
// /uploads/ に 限定 (外部 URL は 弾く) → 漏洩リスク最小化。 サーバ側で 一旦 ファイル を
// 読んで base64 data URL に変換して 送る (OpenAI から 外部 URL fetch を 要求しない)。
function ai_translate_image(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    ai_assert_configured($cfg);
    $body = read_json_body();
    $imageUrl = trim((string)($body['image_url'] ?? ''));
    if ($imageUrl === '') throw new ApiException('bad_request', 'image_url required', 400);
    $hint = trim((string)($body['hint'] ?? ''));
    if (mb_strlen($hint) > 500) $hint = mb_substr($hint, 0, 500);
    // v426 グループ 共有 (任意)。 指定時は その グループの メンバー である 必要あり。
    $groupId = isset($body['group_id']) && (int)$body['group_id'] > 0 ? (int)$body['group_id'] : null;
    if ($groupId !== null) {
        group_assert_member($pdo, $groupId, (int)$u['id']);
    }

    // 自前 アップロード パス に 限定。 base_url + /uploads/ で 始まる か、 同じ ホスト の
    // /uploads/ 絶対 path か。
    $base = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
    $rel = null;
    if ($base !== '' && strpos($imageUrl, $base . '/uploads/') === 0) {
        $rel = substr($imageUrl, strlen($base));
    } elseif (strpos($imageUrl, '/uploads/') === 0) {
        $rel = $imageUrl;
    }
    if ($rel === null) {
        throw new ApiException('bad_request', 'image_url は LabPay の /uploads/ を 指してください', 400);
    }
    $docRoot = realpath(__DIR__ . '/../../public');
    if ($docRoot === false) throw new ApiException('server_error', 'public path resolution failed', 500);
    $fsPath = realpath($docRoot . $rel);
    if ($fsPath === false || strpos($fsPath, $docRoot . DIRECTORY_SEPARATOR . 'uploads') !== 0) {
        throw new ApiException('bad_request', '画像が見つかりません', 400);
    }
    if (filesize($fsPath) > 8 * 1024 * 1024) {
        throw new ApiException('bad_request', '8MB を 超える 画像は 受け付けません', 400);
    }
    $data = file_get_contents($fsPath);
    if ($data === false) throw new ApiException('server_error', 'image read failed', 500);
    $mime = mime_content_type($fsPath) ?: 'image/jpeg';
    if (!preg_match('#^image/#', $mime)) {
        throw new ApiException('bad_request', '画像 ファイルのみ 受け付けます', 400);
    }
    $dataUrl = 'data:' . $mime . ';base64,' . base64_encode($data);

    $sysPrompt = <<<SYS
画像内の 外国語 テキスト (メニュー、 看板、 説明文 など) を 日本語に 翻訳しつつ、
日本人ユーザーが 「それが何か」 を 理解できるよう 補足説明 も 加えてください。

書式:
- まず 翻訳を そのまま 太字 で 示す
- 直後の 括弧書き ()、 もしくは 翌行の インデントで、 補足説明 を 付ける
- 補足は: その料理の 国・地域、 主な材料 / 味の傾向 / 食感 / 食べ方、 もしくは 看板なら 文化的背景 や 法的意味
- 価格 や 数字 は そのまま 保持 (通貨記号 / 単位 含めて)
- 不明瞭 な 部分は (?) を 付ける
- メニューなら 各料理を 1 品 1 行 で 整理 (セクション 見出し も 保つ)

例 (メニュー):
**Mapo Tofu — ¥85**
└ 麻婆豆腐 (豆腐と 挽き肉を 豆板醤・花椒 で 辛く炒めた 中華 四川料理。 痺れる辛さ)

**Bún chả — 65,000₫**
└ ブンチャー (米麺 + 炭火焼き 豚 + 甘酸っぱい タレ の ベトナム ハノイ料理)

例 (看板):
**進入禁止**
└ 関係者以外 入ってはいけません

ルール 共通:
- 元の セクション / リスト 構造は 保つ
- 余計な 前置き (「これは…」 等) は 不要、 結果のみ
- 全体を Markdown (見出し / リスト / 太字 OK) で 出力
SYS;

    if ($hint !== '') {
        $sysPrompt .= "\n\nユーザーからの 補足情報: " . $hint;
    }

    $payload = json_encode([
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-5-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $sysPrompt],
            ['role' => 'user', 'content' => [
                ['type' => 'text', 'text' => '画像を 和訳して ください。'],
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
    // v426 DB に 保存。 失敗 (例: 容量不足) しても 結果は 返す。
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
//   - mine=1 : 自分の (group_id IS NULL) ログ のみ
//   - group_id=N: その グループ の ログ (メンバー 必須)
//   - 引数なし: 自分の + 自分が 所属する グループの 全部 (id DESC 50 件)
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
        // 自分の (group_id NULL) + 自分が member の グループの 全部
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
