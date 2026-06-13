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
    json_error('not_found', "no ai route for $method $sub", 404);
}

const PAPER_REVIEW_COST = 10;
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

【strengths / weaknesses に書くべき粒度】
- 抽象的な感想 (「面白い」「意義深い」 等) は避け、 具体的な節 / 図 / 数値 / 主張 を引用して指摘する
- weaknesses は 「どう直せば accept に近づくか」 の具体的な改稿案を 1 つずつ添える
- 漏れの指摘は 「何が書かれていないか」 を 章名 + 段落付近で明示
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
        'custom_prompt'   => $row['custom_prompt'] ?? '',
        'default_prompt'  => PAPER_REVIEW_DEFAULT_PROMPT,
        'share_target_ids' => $shareIds,
        'share_targets'   => $shareUsers,
        'cost_points'     => PAPER_REVIEW_COST,
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
    $st = $pdo->prepare("SELECT pr.id, pr.user_id, pr.pdf_name, pr.target_venue, pr.strictness,
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
        'target_venue' => $row['target_venue'],
        'strictness'   => $row['strictness'],
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

    // v552 #211 課金 10pt (システム宛て)。 残高不足は 400
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < PAPER_REVIEW_COST) {
        throw new ApiException('insufficient_balance', sprintf('ポイント不足です (要 %d pt、 現在 %d pt)', PAPER_REVIEW_COST, $bal), 400);
    }

    // v557 #211 非同期化: PDF を OpenAI に upload → record を pending で保存 +
    //   即座にクライアントに share_token を返す。 GPT への chat.completions 呼出は
    //   fastcgi_finish_request() で クライアント切断後にバックグラウンド実行。
    $apiKey = (string)$cfg['openai']['api_key'];
    $fileId = ai_openai_upload_pdf($tmpPdf, (string)($f['name'] ?? 'paper.pdf'), $apiKey);

    $basePrompt = $customPrompt !== '' ? $customPrompt : PAPER_REVIEW_DEFAULT_PROMPT;
    $sys = $basePrompt .
           "\n\n査読の厳しさは {$strictness} で、 ターゲット会議は {$venue} を想定。";
    $userPrompt = "添付した PDF の論文を 章立て (Abstract / Introduction / Related Work / Method / Results / Discussion / Conclusion など) を意識して 1〜2 段落ずつ日本語で要約し、 続けて査読コメントを作ってください。\n\n"
        . "system prompt のチェックリスト 4 項目 (貢献の妥当性 / 実験統計記述漏れ / 論理的つながり / 背景〜結論 一気通貫性) を 必ず網羅し、 整合性チェック の結果は consistency_check に 4 項目別で残してください。\n\n"
        . "出力 JSON スキーマ:\n"
        . "{ \"sections\": [{\"title\": \"章タイトル\", \"summary_ja\": \"1〜2 段落の和訳要約\"}, ...],\n"
        . "  \"review\": {\n"
        . "    \"decision\": \"Strong Accept / Accept / Weak Accept / Borderline / Weak Reject / Reject / Strong Reject\",\n"
        . "    \"score\": 1-5 の整数,\n"
        . "    \"summary_one_line\": \"査読要約 1 行\",\n"
        . "    \"contribution_validity\": \"貢献の妥当性に関する評価 (100-300 字)\",\n"
        . "    \"missing_descriptions\": [\"漏れている記述項目 (章名 + 該当箇所込み)\", ...],\n"
        . "    \"logical_flow\": \"論理的なつながりの評価、 飛躍箇所の指摘 (100-300 字)\",\n"
        . "    \"consistency_check\": {\n"
        . "       \"background_to_method\": \"背景→手法 が繋がっているか\",\n"
        . "       \"method_to_experiment\": \"手法→実験 が繋がっているか\",\n"
        . "       \"experiment_to_result\": \"実験→結果 が繋がっているか\",\n"
        . "       \"result_to_discussion\": \"結果→議論→結論 が繋がっているか\"\n"
        . "    },\n"
        . "    \"strengths\": [\"具体的な強み (節/数値/主張を引用)\", ...],\n"
        . "    \"weaknesses\": [\"具体的な弱み + 直すべき改稿案\", ...],\n"
        . "    \"revision_to_accept\": [\"採録に導くために 必要な修正を 優先度順に アイテマイズ (具体的 / 実行可能)\", ...],\n"
        . "    \"comments_to_authors\": \"著者への総合コメント (400〜800 文字)\",\n"
        . "    \"confidence\": 1-5 の整数 (査読者の自信)\n"
        . "  }\n"
        . "}";

    // Step 2: chat.completions に file 添付 (gpt-4o 系で対応)
    $model = (string)($cfg['openai']['model'] ?? 'gpt-4o-mini');
    $payload = json_encode([
        'model' => $model,
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user', 'content' => [
                ['type' => 'file', 'file' => ['file_id' => $fileId]],
                ['type' => 'text', 'text' => $userPrompt],
            ]],
        ],
        'temperature' => 0.4,
        'response_format' => ['type' => 'json_object'],
        'max_tokens' => 4000,
    ], JSON_UNESCAPED_UNICODE);

    // v557 #211 非同期: pending レコード作成 + 課金 → 即 share_token 返却 →
    //   fastcgi_finish_request() でクライアント切断 → 裏で OpenAI chat 呼出 → 結果更新
    $token = bin2hex(random_bytes(16));
    $pdfName = (string)($f['name'] ?? 'paper.pdf');
    $reviewId = 0;
    db_tx($pdo, function () use ($pdo, $uid, $token, $fileId, $pdfName, $venue, $strictness, $sys, &$reviewId) {
        $pdo->prepare("INSERT INTO paper_reviews
            (user_id, share_token, file_id, pdf_name, target_venue, strictness, prompt_used,
             sections_json, review_json, cost_points, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,'pending')")
            ->execute([
                $uid, $token, $fileId, mb_substr($pdfName, 0, 255), $venue, $strictness, $sys,
                '[]', 'null', PAPER_REVIEW_COST,
            ]);
        $reviewId = (int)$pdo->lastInsertId();
        Ledger::transfer($pdo, $uid, 1, PAPER_REVIEW_COST, 'paper_review', 'paper_review', $reviewId, '論文査読 依頼料');
    });

    // 早期レスポンス
    json_response_no_exit([
        'ok'           => true,
        'id'           => $reviewId,
        'share_token'  => $token,
        'venue'        => $venue,
        'strictness'   => $strictness,
        'status'       => 'pending',
        'cost_points'  => PAPER_REVIEW_COST,
        'shared_count' => count($shareIds),
        'message'      => '依頼を受け付けました。 OpenAI が査読中… (2-5 分)。 結果ページを開いておくか、 後で /#/paper-review/r/' . $token . ' を確認してください。',
    ]);
    // クライアント切断 → バックグラウンド継続
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(360);

    // 裏で OpenAI を呼ぶ
    ai_paper_review_run_background($pdo, $cfg, $reviewId, $token, $fileId, $payload, $apiKey, $pdfName, $shareIds, $uid);
}

// 早期レスポンス用: json_response と同じ JSON を出力するが exit しない
function json_response_no_exit($data): void {
    if (!headers_sent()) header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function ai_paper_review_run_background(PDO $pdo, array $cfg, int $reviewId, string $token, string $fileId, string $payload, string $apiKey, string $pdfName, array $shareIds, int $uid): void {
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
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
        'messages' => [
            ['role' => 'system', 'content' => $sys],
            ['role' => 'user',   'content' => $context],
        ],
        'temperature' => 0.9,
        'max_tokens' => 30,
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
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
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
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
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
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
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
        'model' => (string)($cfg['openai']['model'] ?? 'gpt-4o-mini'),
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
