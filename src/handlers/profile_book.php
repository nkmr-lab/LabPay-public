<?php
// v1124 プロフ帳 (平成デザ) — 中村さん要望
//   * 基本情報: 全員最初に埋める → 初回だけ 50pt reward
//   * 他人のプロフを見る = 10pt (一度アンロックすれば無制限閲覧)
//   * 追加質問を投げる = 10pt (匿名可)
//   * 回答したら 5pt reward
//   * 心理テスト = 「基本質問」の一種として扱う (front で答えるだけ)
//
// API:
//   GET  /api/profile-book/questions            → 基本質問リスト (固定 + 心理テスト)
//   GET  /api/profile-book/me                    → 自分の全回答 + reward 状態
//   PUT  /api/profile-book/me                    → 自分の回答 upsert (batch)
//   GET  /api/profile-book/{userId}              → 他人のプロフ (アンロック済ならフル、未はプレビュー)
//   POST /api/profile-book/{userId}/unlock       → 10pt でアンロック
//   POST /api/profile-book/{userId}/questions    → 質問を投げる (10pt)
//   GET  /api/profile-book/questions-for-me      → 自分宛の未回答質問
//   POST /api/profile-book/questions/{qid}/answer → 回答 (+5pt reward)

declare(strict_types=1);

const PB_VIEW_FEE   = 10;
const PB_QUESTION_FEE = 10;
const PB_ANSWER_REWARD = 5;
const PB_BASE_REWARD = 50;

// 基本質問 (固定 + 心理テスト)
function pb_base_questions(): array {
    return [
        // -- 基本情報 --
        ['key' => 'nickname',    'label' => '呼ばれ方', 'category' => 'basic', 'type' => 'text'],
        ['key' => 'hometown',    'label' => '出身地',   'category' => 'basic', 'type' => 'text'],
        ['key' => 'birth_month', 'label' => '誕生月',   'category' => 'basic', 'type' => 'text'],
        ['key' => 'hobby',       'label' => '趣味',     'category' => 'basic', 'type' => 'textarea'],
        ['key' => 'fav_food',    'label' => '好きな食べ物', 'category' => 'basic', 'type' => 'text'],
        ['key' => 'hate_food',   'label' => '苦手な食べ物', 'category' => 'basic', 'type' => 'text'],
        ['key' => 'fav_music',   'label' => '好きな音楽 / アーティスト', 'category' => 'basic', 'type' => 'text'],
        ['key' => 'motto',       'label' => 'モットー / 座右の銘', 'category' => 'basic', 'type' => 'text'],
        ['key' => 'weekend',     'label' => '休日の過ごし方', 'category' => 'basic', 'type' => 'textarea'],
        ['key' => 'research_theme', 'label' => '研究テーマ / 関心', 'category' => 'basic', 'type' => 'textarea'],
        // -- 心理テスト風 --
        ['key' => 'psycho_1', 'label' => '道端で 1000 円札を拾ったらどうする?', 'category' => 'psycho', 'type' => 'text'],
        ['key' => 'psycho_2', 'label' => '無人島に持って行く 3 つのものは?',   'category' => 'psycho', 'type' => 'text'],
        ['key' => 'psycho_3', 'label' => 'もし透明人間になれるなら何する?',     'category' => 'psycho', 'type' => 'text'],
        ['key' => 'psycho_4', 'label' => '最近ハマってる YouTube / TikTok',    'category' => 'psycho', 'type' => 'text'],
        ['key' => 'psycho_5', 'label' => '生まれ変わったら何になりたい?',        'category' => 'psycho', 'type' => 'text'],
    ];
}

function route_profile_book(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub === 'questions' && $method === 'GET' && !isset($seg[2])) { json_response(['items' => pb_base_questions()]); return; }
    if ($sub === 'questions-for-me' && $method === 'GET') { pb_questions_for_me($pdo, $cfg); return; }
    if ($sub === 'questions' && isset($seg[2]) && $seg[3] === 'answer' && $method === 'POST') { pb_answer_question($pdo, $cfg, (int)$seg[2]); return; }
    if ($sub === 'me' && $method === 'GET') { pb_me_get($pdo, $cfg); return; }
    if ($sub === 'me' && $method === 'PUT') { pb_me_put($pdo, $cfg); return; }
    if (ctype_digit((string)$sub)) {
        $uid = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === ''          && $method === 'GET')  { pb_user_get($pdo, $cfg, $uid); return; }
        if ($next === 'unlock'    && $method === 'POST') { pb_unlock($pdo, $cfg, $uid);   return; }
        if ($next === 'questions' && $method === 'POST') { pb_ask_question($pdo, $cfg, $uid); return; }
    }
    throw new ApiException('not_found', "no profile-book route for $method $sub", 404);
}

function _pb_answers_for(PDO $pdo, int $uid): array {
    $st = $pdo->prepare("SELECT q_key, answer_text, updated_at FROM profile_answers WHERE user_id = ?");
    $st->execute([$uid]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) $out[$r['q_key']] = $r['answer_text'];
    return $out;
}

function pb_me_get(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $answers = _pb_answers_for($pdo, $uid);
    $rewarded = (bool)$pdo->query("SELECT 1 FROM profile_reward_claims WHERE user_id={$uid}")->fetchColumn();
    // 追加質問 (自分から出したもの)
    $sq = $pdo->prepare("SELECT id, to_user_id, question_text, is_anonymous, answer_text, answered_at, created_at
                            FROM profile_questions WHERE from_user_id = ? ORDER BY id DESC LIMIT 100");
    $sq->execute([$uid]);
    json_response([
        'answers'  => $answers,
        'rewarded' => $rewarded,
        'reward_amount' => PB_BASE_REWARD,
        'my_questions'  => $sq->fetchAll(PDO::FETCH_ASSOC),
    ]);
}

function pb_me_put(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $answers = is_array($body['answers'] ?? null) ? $body['answers'] : [];
    $validKeys = array_map(fn($q) => $q['key'], pb_base_questions());
    $up = $pdo->prepare("INSERT INTO profile_answers (user_id, q_key, answer_text) VALUES (?, ?, ?)
                          ON DUPLICATE KEY UPDATE answer_text = VALUES(answer_text)");
    $n = 0;
    foreach ($answers as $k => $v) {
        if (!in_array($k, $validKeys, true)) continue;
        $v = trim((string)$v);
        if (mb_strlen($v) > 2000) $v = mb_substr($v, 0, 2000);
        $up->execute([$uid, $k, $v !== '' ? $v : null]);
        $n++;
    }
    // 基本情報 (basic カテゴリ) が最初に一定数以上埋まった時点で初回 reward
    $baseKeys = array_map(fn($q) => $q['key'], array_filter(pb_base_questions(), fn($q) => $q['category'] === 'basic'));
    $filled = 0;
    $cur = _pb_answers_for($pdo, $uid);
    foreach ($baseKeys as $bk) if (!empty($cur[$bk])) $filled++;
    $rewardGiven = false;
    if ($filled >= 6) {
        $already = (bool)$pdo->query("SELECT 1 FROM profile_reward_claims WHERE user_id={$uid}")->fetchColumn();
        if (!$already) {
            $pdo->prepare("INSERT INTO profile_reward_claims (user_id) VALUES (?)")->execute([$uid]);
            try {
                Ledger::transfer($pdo, 1, $uid, PB_BASE_REWARD, 'profile_reward', 'profile_book', $uid, "プロフ帳基本情報埋め reward");
                $rewardGiven = true;
            } catch (Throwable $_) {}
        }
    }
    json_response(['ok' => true, 'saved' => $n, 'reward_given' => $rewardGiven, 'basic_filled' => $filled]);
}

function pb_user_get(PDO $pdo, array $cfg, int $targetId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $tSt = $pdo->prepare("SELECT id, display_name, avatar_url, kind FROM users WHERE id = ?");
    $tSt->execute([$targetId]);
    $t = $tSt->fetch(PDO::FETCH_ASSOC);
    if (!$t || $t['kind'] !== 'human') throw new ApiException('not_found', 'user なし', 404);
    $isMe = ($targetId === $uid);
    $unlocked = $isMe || (bool)$pdo->query("SELECT 1 FROM profile_unlocks WHERE viewer_user_id={$uid} AND target_user_id={$targetId}")->fetchColumn();
    $answers = _pb_answers_for($pdo, $targetId);
    $shape = [
        'user_id'      => $targetId,
        'display_name' => $t['display_name'],
        'avatar_url'   => $t['avatar_url'],
        'is_me'        => $isMe,
        'unlocked'     => $unlocked,
        'view_fee'     => PB_VIEW_FEE,
        'answers'      => $unlocked ? $answers : null,   // 未 unlock は伏せる
        'preview'      => [
            'filled_count' => count(array_filter($answers, fn($v) => $v !== null && $v !== '')),
            'total'        => count(pb_base_questions()),
        ],
    ];
    // 自分がこの人へ投げた質問 (受け答え確認)
    $sq = $pdo->prepare("SELECT id, question_text, is_anonymous, answer_text, answered_at, created_at
                           FROM profile_questions WHERE from_user_id = ? AND to_user_id = ? ORDER BY id DESC LIMIT 50");
    $sq->execute([$uid, $targetId]);
    $shape['my_questions_to_them'] = $sq->fetchAll(PDO::FETCH_ASSOC);
    // 相手が受けた質問と回答 (匿名だと from が hidden)
    $pq = $pdo->prepare("SELECT id, from_user_id, question_text, is_anonymous, answer_text, answered_at, created_at
                           FROM profile_questions WHERE to_user_id = ? AND answered_at IS NOT NULL ORDER BY id DESC LIMIT 50");
    $pq->execute([$targetId]);
    $shape['answered_questions'] = array_map(function ($r) use ($uid) {
        $isMyAsk = ((int)$r['from_user_id'] === $uid);
        if ($r['is_anonymous'] && !$isMyAsk) {
            $r['from_user_id'] = null;   // 匿名の場合 from を隠す (自分の質問は自分に見える)
        }
        return $r;
    }, $pq->fetchAll(PDO::FETCH_ASSOC));
    json_response(['profile' => $shape]);
}

function pb_unlock(PDO $pdo, array $cfg, int $targetId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if ($targetId === $uid) throw new ApiException('bad_request', '自分のプロフは無料', 400);
    // 既にアンロック済なら何もしない
    $ex = $pdo->query("SELECT 1 FROM profile_unlocks WHERE viewer_user_id={$uid} AND target_user_id={$targetId}")->fetchColumn();
    if ($ex) { json_response(['ok' => true, 'already' => true]); return; }
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < PB_VIEW_FEE) throw new ApiException('insufficient_balance', "残高不足 (要 " . PB_VIEW_FEE . "pt)", 400);
    $pdo->beginTransaction();
    try {
        Ledger::transfer($pdo, $uid, 1, PB_VIEW_FEE, 'profile_unlock', 'profile_book', $targetId, "プロフ帳閲覧 unlock");
        $pdo->prepare("INSERT INTO profile_unlocks (viewer_user_id, target_user_id) VALUES (?, ?)")->execute([$uid, $targetId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    json_response(['ok' => true, 'unlocked' => true]);
}

function pb_ask_question(PDO $pdo, array $cfg, int $targetId): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if ($targetId === $uid) throw new ApiException('bad_request', '自分に質問はできません', 400);
    $body = read_json_body();
    $text = trim((string)($body['question_text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 400) throw new ApiException('bad_request', 'question_text 1-400', 400);
    $anon = !empty($body['is_anonymous']) ? 1 : 0;
    $bal = Ledger::balanceOfUser($pdo, $uid);
    if ($bal < PB_QUESTION_FEE) throw new ApiException('insufficient_balance', "残高不足 (要 " . PB_QUESTION_FEE . "pt)", 400);
    $pdo->beginTransaction();
    try {
        Ledger::transfer($pdo, $uid, 1, PB_QUESTION_FEE, 'profile_question', 'profile_book', $targetId, "プロフ帳質問投稿" . ($anon ? " (匿名)" : ""));
        $pdo->prepare("INSERT INTO profile_questions (from_user_id, to_user_id, question_text, is_anonymous) VALUES (?, ?, ?, ?)")
            ->execute([$uid, $targetId, $text, $anon]);
        $qid = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 相手へ通知 (匿名は名前伏せ)
    try {
        global $CFG;
        $askerName = $anon ? '匿名' : (string)$pdo->query("SELECT display_name FROM users WHERE id={$uid}")->fetchColumn();
        notify_safely($pdo, $CFG, $targetId, 'admin_notice',
            "🎀 プロフ帳に質問が届きました" . ($anon ? " (匿名)" : " ({$askerName} さんから)") . ": " . mb_substr($text, 0, 60) . " (回答で +5pt)",
            'profile_book', $qid);
    } catch (Throwable $_) {}
    json_response(['ok' => true, 'id' => $qid]);
}

function pb_questions_for_me(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $st = $pdo->prepare("SELECT id, from_user_id, question_text, is_anonymous, created_at
                            FROM profile_questions WHERE to_user_id = ? AND answered_at IS NULL ORDER BY id DESC");
    $st->execute([$uid]);
    // 匿名は from を隠す (未回答時)
    $items = array_map(function ($r) {
        if ($r['is_anonymous']) $r['from_user_id'] = null;
        return $r;
    }, $st->fetchAll(PDO::FETCH_ASSOC));
    json_response(['items' => $items, 'answer_reward' => PB_ANSWER_REWARD]);
}

function pb_answer_question(PDO $pdo, array $cfg, int $qid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $body = read_json_body();
    $text = trim((string)($body['answer_text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 2000) throw new ApiException('bad_request', 'answer_text 1-2000', 400);
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT * FROM profile_questions WHERE id = ? FOR UPDATE");
        $st->execute([$qid]);
        $q = $st->fetch(PDO::FETCH_ASSOC);
        if (!$q) { $pdo->rollBack(); throw new ApiException('not_found', 'question なし', 404); }
        if ((int)$q['to_user_id'] !== $uid) { $pdo->rollBack(); throw new ApiException('forbidden', '宛先本人のみ回答可', 403); }
        if ($q['answered_at']) { $pdo->rollBack(); throw new ApiException('bad_request', '既に回答済み', 400); }
        $pdo->prepare("UPDATE profile_questions SET answer_text = ?, answered_at = NOW() WHERE id = ?")->execute([$text, $qid]);
        Ledger::transfer($pdo, 1, $uid, PB_ANSWER_REWARD, 'profile_answer', 'profile_book', $qid, "プロフ帳質問回答 reward");
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    // 質問者へ通知 (匿名質問への回答は「あなたの質問に回答が届きました」)
    try {
        global $CFG;
        $st = $pdo->prepare("SELECT from_user_id, is_anonymous FROM profile_questions WHERE id=?");
        $st->execute([$qid]);
        $q2 = $st->fetch(PDO::FETCH_ASSOC);
        notify_safely($pdo, $CFG, (int)$q2['from_user_id'], 'admin_notice',
            "🎀 あなたの質問に回答が届きました → プロフ帳を確認",
            'profile_book', $qid);
    } catch (Throwable $_) {}
    json_response(['ok' => true, 'reward' => PB_ANSWER_REWARD]);
}
