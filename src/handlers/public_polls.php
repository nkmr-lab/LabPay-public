<?php
// /api/public-polls — 公開 URL で 誰でも 投票 できる 汎用 poll (v942)。
//   選択肢 を 複数行 テキスト で 入力 → anon cookie で 1 人 1 票 (multi_select 時 は
//   複数 選択 可)。 起案者 は 集計 を いつでも 閲覧、 一般 は visibility 設定 に 従う。
// joint-events は 「合同研究会 の セッション別 発表 投票」 専用 (v941)。 別機能。

declare(strict_types=1);

const PP_ANON_COOKIE = 'public_polls_anon';   // 32 hex
const PP_ANON_TTL_DAYS = 90;
const PP_VISIBILITIES = ['creator','open','after_deadline'];

function route_public_polls(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';

    // 公開系: /api/public-polls/public/{token} , /vote
    if ($sub === 'public') {
        $token = $seg[2] ?? '';
        $tail  = $seg[3] ?? '';
        if ($token === '' || !ctype_alnum($token) || strlen($token) < 8 || strlen($token) > 32) {
            throw new ApiException('bad_request', 'token 不正', 400);
        }
        if ($tail === '' && $method === 'GET')    { pp_public_get($pdo, $cfg, $token); return; }
        if ($tail === 'vote' && $method === 'POST') { pp_public_vote($pdo, $cfg, $token); return; }
        throw new ApiException('not_found', "no public route for $method $token/$tail", 404);
    }

    // 以下 認証必須。
    if ($sub === '' && $method === 'GET')  { pp_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { pp_create($pdo, $cfg); return; }

    if (ctype_digit((string)$sub)) {
        $id = (int)$sub;
        $next = $seg[2] ?? '';
        if ($next === '' && $method === 'GET')    { pp_detail($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'PATCH')  { pp_update($pdo, $cfg, $id); return; }
        if ($next === '' && $method === 'DELETE') { pp_delete($pdo, $cfg, $id); return; }
        if ($next === 'close' && $method === 'PATCH') { pp_close($pdo, $cfg, $id); return; }
    }
    throw new ApiException('not_found', "no public-polls route for $method $sub", 404);
}

// ---------- helpers ----------

function pp_sweep(PDO $pdo): void {
    $pdo->exec("UPDATE public_polls SET status='closed', closed_at=NOW()
                 WHERE status='open' AND deadline_at <= NOW()");
    $pdo->exec("UPDATE public_polls SET status='open'
                 WHERE status='scheduled' AND opens_at IS NOT NULL AND opens_at <= NOW()");
}

function pp_require_owner(PDO $pdo, int $id, int $uid): array {
    $st = $pdo->prepare("SELECT * FROM public_polls WHERE id = ? AND deleted_at IS NULL");
    $st->execute([$id]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) throw new ApiException('not_found', 'poll なし', 404);
    if ((int)$r['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
    return $r;
}

function pp_parse_dt(?string $raw): ?string {
    if ($raw === null) return null;
    $raw = trim($raw);
    if ($raw === '') return null;
    $dt = DateTime::createFromFormat('Y-m-d\TH:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i', $raw)
       ?: DateTime::createFromFormat('Y-m-d\TH:i:s', $raw)
       ?: DateTime::createFromFormat('Y-m-d H:i:s', $raw);
    if (!$dt) throw new ApiException('bad_request', "日時形式が不正: $raw", 400);
    return $dt->format('Y-m-d H:i:s');
}

function pp_ensure_anon_id(): string {
    $anon = $_COOKIE[PP_ANON_COOKIE] ?? '';
    if (!is_string($anon) || !preg_match('/^[0-9a-f]{32}$/', $anon)) {
        $anon = bin2hex(random_bytes(16));
        setcookie(PP_ANON_COOKIE, $anon, [
            'expires'  => time() + 86400 * PP_ANON_TTL_DAYS,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    return $anon;
}

function pp_load_options(PDO $pdo, int $pollId): array {
    $st = $pdo->prepare("SELECT id, label, sort_order FROM public_poll_options WHERE poll_id = ? ORDER BY sort_order, id");
    $st->execute([$pollId]);
    return $st->fetchAll(PDO::FETCH_ASSOC);
}

// 集計 (option_id → 得票数)。 free_text は 別 集計。
function pp_load_tallies(PDO $pdo, int $pollId): array {
    $st = $pdo->prepare("SELECT option_id, COUNT(*) AS cnt FROM public_poll_votes
                          WHERE poll_id = ? AND option_id IS NOT NULL GROUP BY option_id");
    $st->execute([$pollId]);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[(int)$r['option_id']] = (int)$r['cnt'];
    }
    return $out;
}

function pp_load_free_texts(PDO $pdo, int $pollId): array {
    $st = $pdo->prepare("SELECT id, voter_name, free_text, created_at FROM public_poll_votes
                          WHERE poll_id = ? AND free_text IS NOT NULL AND free_text != ''
                          ORDER BY id DESC LIMIT 500");
    $st->execute([$pollId]);
    return $st->fetchAll(PDO::FETCH_ASSOC);
}

// ---------- 認証付き ----------

function pp_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    pp_sweep($pdo);
    $st = $pdo->prepare("
        SELECT p.id, p.title, p.public_token, p.opens_at, p.deadline_at, p.multi_select,
               p.visibility, p.status, p.closed_at, p.created_at,
               (SELECT COUNT(*) FROM public_poll_options o WHERE o.poll_id = p.id) AS option_count,
               (SELECT COUNT(*) FROM public_poll_votes v WHERE v.poll_id = p.id) AS vote_count,
               (SELECT COUNT(DISTINCT v.voter_anon_id) FROM public_poll_votes v WHERE v.poll_id = p.id) AS voter_count
          FROM public_polls p
         WHERE p.creator_user_id = ? AND p.deleted_at IS NULL
         ORDER BY p.id DESC LIMIT 200");
    $st->execute([(int)$u['id']]);
    json_response(['items' => $st->fetchAll(PDO::FETCH_ASSOC)]);
}

function pp_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $body = read_json_body();
    $title = trim((string)($body['title'] ?? ''));
    if ($title === '' || mb_strlen($title) > 300) throw new ApiException('bad_request', 'title 1..300', 400);
    $desc = trim((string)($body['body'] ?? ''));
    if (mb_strlen($desc) > 5000) $desc = mb_substr($desc, 0, 5000);
    $deadline = pp_parse_dt((string)($body['deadline_at'] ?? ''));
    if (!$deadline) throw new ApiException('bad_request', 'deadline_at 必須', 400);
    if (strtotime($deadline) <= time() + 30) throw new ApiException('bad_request', '締切は現在より先に', 400);

    $opensAt = pp_parse_dt($body['opens_at'] ?? null);
    if ($opensAt !== null && strtotime($opensAt) >= strtotime($deadline)) {
        throw new ApiException('bad_request', '公開開始は締切より前に', 400);
    }

    $multi = !empty($body['multi_select']) ? 1 : 0;
    $allowFreeText = (!empty($body['allow_free_text']) && $multi) ? 1 : 0;
    $vis = (string)($body['visibility'] ?? 'after_deadline');
    if (!in_array($vis, PP_VISIBILITIES, true)) throw new ApiException('bad_request', 'visibility 不正', 400);

    $opts = $body['options'] ?? [];
    if (!is_array($opts)) throw new ApiException('bad_request', 'options 配列', 400);
    $clean = [];
    foreach ($opts as $o) {
        $s = trim((string)$o);
        if ($s === '' || mb_strlen($s) > 300) continue;
        $clean[] = $s;
    }
    if (count($clean) < 2 || count($clean) > 50) {
        throw new ApiException('bad_request', '選択肢は 2〜50 個', 400);
    }

    $initialStatus = ($opensAt !== null && strtotime($opensAt) > time() + 30) ? 'scheduled' : 'open';
    // v945 URL 短縮。 32 桁 → 8 桁 (32bit)。 4 桁 コード と 併用 なので 十分。
    $token = bin2hex(random_bytes(4));
    $pollId = 0;

    db_tx($pdo, function () use ($pdo, $u, $title, $desc, $token, $opensAt, $deadline, $multi, $allowFreeText, $vis, $initialStatus, $clean, &$pollId) {
        $ins = $pdo->prepare("INSERT INTO public_polls
            (creator_user_id, title, body, public_token, opens_at, deadline_at,
             multi_select, allow_free_text, visibility, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([(int)$u['id'], $title, $desc ?: null, $token, $opensAt, $deadline,
                        $multi, $allowFreeText, $vis, $initialStatus]);
        $pollId = (int)$pdo->lastInsertId();
        $stO = $pdo->prepare("INSERT INTO public_poll_options (poll_id, label, sort_order) VALUES (?, ?, ?)");
        foreach ($clean as $i => $lbl) $stO->execute([$pollId, $lbl, $i]);
    });
    $code = public_codes_allocate($pdo, 'public-poll', $pollId,
                '/public_polls.html?t=' . $token, (int)$u['id']);
    json_response(['id' => $pollId, 'public_token' => $token, 'public_code' => $code, 'status' => $initialStatus]);
}

function pp_detail(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    pp_sweep($pdo);
    $poll = pp_require_owner($pdo, $id, (int)$u['id']);
    $options = pp_load_options($pdo, $id);
    $tallies = pp_load_tallies($pdo, $id);
    $freeTexts = pp_load_free_texts($pdo, $id);
    $code = public_codes_lookup_by_ref($pdo, 'public-poll', $id);
    $totalVoters = (int)$pdo->query("SELECT COUNT(DISTINCT voter_anon_id)
                    FROM public_poll_votes WHERE poll_id = " . (int)$id)->fetchColumn();
    json_response([
        'poll'         => $poll,
        'public_code'  => $code,
        'options'      => $options,
        'tallies'      => $tallies,
        'free_texts'   => $freeTexts,
        'total_voters' => $totalVoters,
        'is_creator'   => true,
    ]);
}

function pp_update(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    pp_require_owner($pdo, $id, (int)$u['id']);
    $body = read_json_body();
    $sets = []; $args = [];
    if (array_key_exists('title', $body)) {
        $t = trim((string)$body['title']);
        if ($t === '' || mb_strlen($t) > 300) throw new ApiException('bad_request', 'title 1..300', 400);
        $sets[] = 'title = ?'; $args[] = $t;
    }
    if (array_key_exists('body', $body)) {
        $b = trim((string)$body['body']);
        if (mb_strlen($b) > 5000) $b = mb_substr($b, 0, 5000);
        $sets[] = 'body = ?'; $args[] = $b ?: null;
    }
    if (array_key_exists('deadline_at', $body)) {
        $d = pp_parse_dt((string)$body['deadline_at']);
        if (!$d) throw new ApiException('bad_request', 'deadline_at 必須', 400);
        $sets[] = 'deadline_at = ?'; $args[] = $d;
    }
    if (array_key_exists('opens_at', $body)) {
        $raw = trim((string)$body['opens_at']);
        if ($raw === '') {
            $sets[] = "opens_at = NULL, status = IF(status = 'scheduled', 'open', status)";
        } else {
            $o = pp_parse_dt($raw);
            $sets[] = 'opens_at = ?'; $args[] = $o;
        }
    }
    if (array_key_exists('visibility', $body)) {
        $v = (string)$body['visibility'];
        if (!in_array($v, PP_VISIBILITIES, true)) throw new ApiException('bad_request', 'visibility 不正', 400);
        $sets[] = 'visibility = ?'; $args[] = $v;
    }
    if (!$sets) { json_response(['ok' => true]); return; }
    $args[] = $id;
    $pdo->prepare("UPDATE public_polls SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
    json_response(['ok' => true]);
}

function pp_delete(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    pp_require_owner($pdo, $id, (int)$u['id']);
    $pdo->prepare("UPDATE public_polls SET deleted_at = NOW() WHERE id = ?")->execute([$id]);
    json_response(['ok' => true]);
}

function pp_close(PDO $pdo, array $cfg, int $id): void {
    $u = Auth::requireUser($pdo, $cfg);
    pp_require_owner($pdo, $id, (int)$u['id']);
    $pdo->prepare("UPDATE public_polls SET status='closed', closed_at=NOW() WHERE id = ? AND status='open'")
        ->execute([$id]);
    json_response(['ok' => true]);
}

// ---------- 公開系 (未認証) ----------

function pp_public_get(PDO $pdo, array $cfg, string $token): void {
    pp_sweep($pdo);
    $st = $pdo->prepare("SELECT * FROM public_polls WHERE public_token = ? AND deleted_at IS NULL");
    $st->execute([$token]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', 'poll なし', 404);
    if ((string)$poll['status'] === 'scheduled') {
        throw new ApiException('not_open', 'まだ公開されていません', 400);
    }
    $options = pp_load_options($pdo, (int)$poll['id']);
    // 集計 の 見え方 決定
    $vis = (string)$poll['visibility'];
    $isClosed = (string)$poll['status'] === 'closed';
    $tallyVisible = ($vis === 'open') || ($vis === 'after_deadline' && $isClosed);
    $tallies = $tallyVisible ? pp_load_tallies($pdo, (int)$poll['id']) : [];
    $freeTexts = $tallyVisible ? pp_load_free_texts($pdo, (int)$poll['id']) : [];
    // 自分 の 投票
    $anon = pp_ensure_anon_id();
    $stM = $pdo->prepare("SELECT option_id, free_text FROM public_poll_votes
                            WHERE poll_id = ? AND voter_anon_id = ?");
    $stM->execute([(int)$poll['id'], $anon]);
    $myVotes = [];
    $myFreeText = '';
    foreach ($stM->fetchAll(PDO::FETCH_ASSOC) as $r) {
        if ($r['option_id'] !== null) $myVotes[] = (int)$r['option_id'];
        if ($r['free_text']) $myFreeText = $r['free_text'];
    }
    json_response([
        'poll' => [
            'id'              => (int)$poll['id'],
            'title'           => $poll['title'],
            'body'            => $poll['body'],
            'deadline_at'     => $poll['deadline_at'],
            'multi_select'    => (int)$poll['multi_select'] === 1,
            'allow_free_text' => (int)$poll['allow_free_text'] === 1,
            'visibility'      => $vis,
            'status'          => $poll['status'],
            'closed_at'       => $poll['closed_at'],
        ],
        'options'       => $options,
        'my_votes'      => $myVotes,
        'my_free_text'  => $myFreeText,
        'tally_visible' => $tallyVisible,
        'tallies'       => $tallies,
        'free_texts'    => $freeTexts,
    ]);
}

function pp_public_vote(PDO $pdo, array $cfg, string $token): void {
    pp_sweep($pdo);
    $st = $pdo->prepare("SELECT * FROM public_polls WHERE public_token = ? AND deleted_at IS NULL");
    $st->execute([$token]);
    $poll = $st->fetch(PDO::FETCH_ASSOC);
    if (!$poll) throw new ApiException('not_found', 'poll なし', 404);
    if ((string)$poll['status'] !== 'open') throw new ApiException('closed', '公開中ではありません', 400);

    $body = read_json_body();
    $optionIds = $body['option_ids'] ?? [];
    if (!is_array($optionIds)) throw new ApiException('bad_request', 'option_ids 配列', 400);
    $optionIds = array_values(array_unique(array_filter(array_map('intval', $optionIds))));
    $freeText = trim((string)($body['free_text'] ?? ''));
    if ($freeText !== '') $freeText = mb_substr($freeText, 0, 2000);
    $voterName = trim((string)($body['voter_name'] ?? ''));
    if (mb_strlen($voterName) > 100) $voterName = mb_substr($voterName, 0, 100);

    $multi = (int)$poll['multi_select'] === 1;
    $allowFree = (int)$poll['allow_free_text'] === 1;
    if (!$multi && count($optionIds) > 1) {
        throw new ApiException('bad_request', '単一選択の投票です', 400);
    }
    if (count($optionIds) === 0 && !($multi && $allowFree && $freeText !== '')) {
        throw new ApiException('bad_request',
            $allowFree ? '選択肢を選ぶか、自由記述を書いてください' : '1 つ以上選んでください', 400);
    }

    // 選択肢 の 存在 検証
    if ($optionIds) {
        $in = implode(',', array_fill(0, count($optionIds), '?'));
        $stO = $pdo->prepare("SELECT id FROM public_poll_options WHERE poll_id = ? AND id IN ($in)");
        $stO->execute(array_merge([(int)$poll['id']], $optionIds));
        $valid = array_column($stO->fetchAll(PDO::FETCH_ASSOC), 'id');
        if (count($valid) !== count($optionIds)) {
            throw new ApiException('bad_request', '存在しない選択肢が含まれます', 400);
        }
    }

    $anon = pp_ensure_anon_id();
    db_tx($pdo, function () use ($pdo, $poll, $anon, $optionIds, $freeText, $voterName) {
        // 既存 の 自分 の 投票 を 一旦 全部 消して 再挿入 (再投票 は 常に 許可 する MVP)
        $pdo->prepare("DELETE FROM public_poll_votes WHERE poll_id = ? AND voter_anon_id = ?")
            ->execute([(int)$poll['id'], $anon]);
        $ins = $pdo->prepare("INSERT INTO public_poll_votes
            (poll_id, option_id, voter_anon_id, voter_name, free_text)
            VALUES (?, ?, ?, ?, ?)");
        foreach ($optionIds as $oid) {
            $ins->execute([(int)$poll['id'], $oid, $anon, $voterName ?: null, null]);
        }
        if ($freeText !== '') {
            $ins->execute([(int)$poll['id'], null, $anon, $voterName ?: null, $freeText]);
        }
    });
    json_response(['ok' => true]);
}
