<?php
// v590 大富豪 (シンプル MVP)。ローカルルール:
//   - 4 人 (lobby は 2-4 人で開始可)、ジョーカー 1 + 52 = 53 枚
//   - 単出し / ペア / 3 枚 / 4 枚出し OK (同枚数で上を出す)
//   - パス全員 → 場流れ + 最後に出した人から
//   - 上がった順に 1 位 / 2 位 / ... の rank
//   - ジョーカーはどの強さでも (簡易: 単体 = 最強として扱う)
//   - 縛り / 革命 / 階段などの特殊ルールは省略 (シンプル MVP)
//   - 1 ゲーム 5pt 預託、 1 位が pot 総取り (v1068 で 2pt → 5pt、中村さん「安すぎたので」)
declare(strict_types=1);

const DAIFUGO_FEE = 5;
const DAIFUGO_MAX_PLAYERS = 4;
const DAIFUGO_MIN_PLAYERS = 2;

function route_daifugo(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    if (!isset($seg[1])) throw new ApiException('not_found', 'no route', 404);
    if ($seg[1] === 'games' && !isset($seg[2])) {
        if ($method === 'GET') { daifugo_list($pdo, $uid); return; }
        if ($method === 'POST') { daifugo_create($pdo, $uid); return; }
    }
    if ($seg[1] === 'games' && isset($seg[2])) {
        $gid = (int)$seg[2];
        $action = $seg[3] ?? '';
        if ($method === 'GET' && $action === '')        { daifugo_state($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'join')   { daifugo_join($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'start')  { daifugo_start($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'play')   { daifugo_play($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'pass')   { daifugo_pass($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'cancel') { daifugo_cancel($pdo, $uid, $gid); return; }
        if ($method === 'POST' && $action === 'resign') { daifugo_resign($pdo, $uid, $gid); return; }
    }
    json_error('not_found', "no daifugo route", 404);
}

// カード ID = 0-52 (0-12: ♣3-A, 13-25: ♦, 26-38: ♥, 39-51: ♠, 52: Joker)
// 強さ: 3 が最弱、 2 が最強、ジョーカーが最強+1
function daifugo_rank_of(int $card): int {
    if ($card === 52) return 14;
    return $card % 13; // 0=3, 12=2
}
function daifugo_suit_of(int $card): int {
    if ($card === 52) return -1;
    return intdiv($card, 13);
}

function daifugo_list(PDO $pdo, int $uid): void {
    $st = $pdo->prepare("SELECT g.id, g.creator_user_id, g.status, g.fee, g.pot_total, g.created_at, g.finished_at,
                                (SELECT COUNT(*) FROM daifugo_players p WHERE p.game_id=g.id) AS player_count,
                                EXISTS(SELECT 1 FROM daifugo_players p WHERE p.game_id=g.id AND p.user_id=?) AS me_in,
                                uc.display_name AS creator_name
                           FROM daifugo_games g JOIN users uc ON uc.id=g.creator_user_id
                          WHERE g.status IN ('lobby','playing')
                             OR (g.status IN ('finished','cancelled') AND g.finished_at > DATE_SUB(NOW(), INTERVAL 1 DAY))
                          ORDER BY g.id DESC LIMIT 30");
    $st->execute([$uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $r['id'] = (int)$r['id'];
        $r['creator_user_id'] = (int)$r['creator_user_id'];
        $r['player_count'] = (int)$r['player_count'];
        $r['me_in'] = (bool)$r['me_in'];
    }
    json_response(['items' => $rows]);
}

function daifugo_create(PDO $pdo, int $uid): void {
    // v632 対象者指定 → 即起動: body.member_ids = [uid, ...] が渡れば招待制で即開始
    $body = read_json_body();
    $invitees = $body['member_ids'] ?? null;
    $gid = 0;
    db_tx($pdo, function () use ($pdo, $uid, $invitees, &$gid) {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < DAIFUGO_FEE) throw new ApiException('insufficient_balance', "ポイント不足", 400);
        $pdo->prepare("INSERT INTO daifugo_games (creator_user_id, fee, state_json, pot_total) VALUES (?,?,'{}',0)")
            ->execute([$uid, DAIFUGO_FEE]);
        $gid = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO daifugo_players (game_id, user_id, seat) VALUES (?,?,0)")->execute([$gid, $uid]);
        Ledger::transfer($pdo, $uid, 1, DAIFUGO_FEE, 'daifugo_buyin', 'daifugo', $gid, "大富豪 #{$gid} buy-in");
        $pdo->prepare("UPDATE daifugo_games SET pot_total = pot_total + ? WHERE id=?")->execute([DAIFUGO_FEE, $gid]);
        // 招待制: 全員参加 + 全員から fee 一括徴収 + その場で deal して playing 開始
        if (is_array($invitees) && count($invitees) > 0) {
            daifugo_create_with_invitees($pdo, $uid, $gid, $invitees);
        }
    });
    // 通知 (tx 外、失敗しても卓は残る)
    if (is_array($invitees) && count($invitees) > 0) {
        try {
            global $CFG;
            $stN = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
            $stN->execute([$uid]); $by = (string)$stN->fetchColumn();
            foreach ($invitees as $iv) {
                $iv = (int)$iv; if ($iv === $uid) continue;
                notify_safely($pdo, $CFG, $iv, 'admin_notice',
                    "🃏 {$by} さんから大富豪 #{$gid} に招待されました (すぐに開始)",
                    'daifugo', $gid);
            }
        } catch (Throwable $_) {}
    }
    json_response(['ok' => true, 'id' => $gid]);
}

function daifugo_create_with_invitees(PDO $pdo, int $creatorUid, int $gid, array $invitees): void {
    $invitees = array_values(array_unique(array_map('intval', $invitees)));
    $invitees = array_values(array_filter($invitees, fn($u) => $u !== $creatorUid));
    if (!count($invitees)) return;
    if (1 + count($invitees) > DAIFUGO_MAX_PLAYERS) throw new ApiException('bad_request', sprintf('最大 %d 人', DAIFUGO_MAX_PLAYERS), 400);
    // human チェック
    $place = implode(',', array_fill(0, count($invitees), '?'));
    $stU = $pdo->prepare("SELECT id FROM users WHERE id IN ($place) AND kind='human'");
    $stU->execute($invitees);
    $valid = array_map(fn($r) => (int)$r['id'], $stU->fetchAll(PDO::FETCH_ASSOC));
    if (count($valid) !== count($invitees)) throw new ApiException('bad_request', '無効なメンバーが含まれます', 400);
    // 残高一括チェック
    foreach ($invitees as $iv) {
        if (Ledger::balanceOfUser($pdo, $iv) < DAIFUGO_FEE) {
            $name = $pdo->prepare("SELECT display_name FROM users WHERE id=?");
            $name->execute([$iv]);
            throw new ApiException('insufficient_balance', sprintf('%s さんのポイント不足で開始不可', $name->fetchColumn()), 400);
        }
    }
    // 着席 + 徴収
    $seat = 1;
    foreach ($invitees as $iv) {
        $pdo->prepare("INSERT INTO daifugo_players (game_id, user_id, seat) VALUES (?,?,?)")->execute([$gid, $iv, $seat]);
        Ledger::transfer($pdo, $iv, 1, DAIFUGO_FEE, 'daifugo_buyin', 'daifugo', $gid, "大富豪 #{$gid} buy-in (招待)");
        $pdo->prepare("UPDATE daifugo_games SET pot_total = pot_total + ? WHERE id=?")->execute([DAIFUGO_FEE, $gid]);
        $seat++;
    }
    // すぐ配って開始 (= daifugo_start の中身を直接適用)
    $players = $pdo->prepare("SELECT user_id, seat FROM daifugo_players WHERE game_id=? ORDER BY seat");
    $players->execute([$gid]);
    $players = $players->fetchAll(PDO::FETCH_ASSOC);
    shuffle($players);   // v665 着席順をランダムに
    $deck = range(0, 52);
    shuffle($deck);
    $hands = [];
    $n = count($players);
    for ($i = 0; $i < $n; $i++) $hands[] = [];
    foreach ($deck as $i => $c) $hands[$i % $n][] = $c;
    foreach ($hands as &$h) sort($h);
    unset($h);
    $starter = 0;
    foreach ($hands as $i => $h) if (in_array(0, $h, true)) { $starter = $i; break; }
    $state = [
        'players' => [],
        'turn' => $starter,
        'last_play' => null,
        'pass_count' => 0,
        'finished_ranks' => [],
        'log' => [],
        'revolution' => false,
    ];
    for ($i = 0; $i < $n; $i++) {
        $state['players'][] = ['user_id' => (int)$players[$i]['user_id'], 'seat' => $i, 'hand' => $hands[$i], 'rank' => null, 'passed' => false];
    }
    $pdo->prepare("UPDATE daifugo_games SET status='playing', state_json=?, state_ver=state_ver+1 WHERE id=?")
        ->execute([json_encode($state), $gid]);
}

function daifugo_join(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', 'already started', 400);
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM daifugo_players WHERE game_id=" . (int)$gid)->fetchColumn();
        if ($cnt >= DAIFUGO_MAX_PLAYERS) throw new ApiException('bad_request', 'lobby full', 400);
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < DAIFUGO_FEE) throw new ApiException('insufficient_balance', "ポイント不足", 400);
        // 既に参加 ?
        $stE = $pdo->prepare("SELECT 1 FROM daifugo_players WHERE game_id=? AND user_id=?");
        $stE->execute([$gid, $uid]);
        if ($stE->fetchColumn()) throw new ApiException('bad_request', '既に参加済', 400);
        $pdo->prepare("INSERT INTO daifugo_players (game_id, user_id, seat) VALUES (?,?,?)")->execute([$gid, $uid, $cnt]);
        Ledger::transfer($pdo, $uid, 1, DAIFUGO_FEE, 'daifugo_buyin', 'daifugo', $gid, "大富豪 #{$gid} buy-in (join)");
        $pdo->prepare("UPDATE daifugo_games SET pot_total = pot_total + ? WHERE id=?")->execute([DAIFUGO_FEE, $gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_start(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', 'already started', 400);
        $players = $pdo->query("SELECT user_id, seat FROM daifugo_players WHERE game_id={$gid} ORDER BY seat")->fetchAll(PDO::FETCH_ASSOC);
        if (count($players) < DAIFUGO_MIN_PLAYERS) throw new ApiException('bad_request', '2 人以上で開始', 400);
        shuffle($players);   // v665 着席順をランダムに
        // カード配布
        $deck = range(0, 52);
        shuffle($deck);
        $hands = [];
        $n = count($players);
        for ($i = 0; $i < $n; $i++) $hands[] = [];
        foreach ($deck as $i => $c) $hands[$i % $n][] = $c;
        foreach ($hands as &$h) sort($h);
        unset($h);
        // ♣3 (= card 0) を持ってる人が親 (= 配布がランダムなので親も自動的にランダム)
        $starter = 0;
        foreach ($hands as $i => $h) if (in_array(0, $h, true)) { $starter = $i; break; }
        $state = [
            'players' => [],
            'turn' => $starter,
            'last_play' => null,        // ['cards' => [...], 'by' => seat, 'count' => N, 'rank' => R]
            'pass_count' => 0,
            'finished_ranks' => [],     // 上がった順 [seat, seat, ...]
            'log' => [],
            // v595 革命 (4 枚同時出しで強弱反転) + 8切り (rank=5 = "8" で場流し)
            'revolution' => false,
        ];
        for ($i = 0; $i < $n; $i++) {
            $state['players'][] = ['user_id' => (int)$players[$i]['user_id'], 'seat' => $i, 'hand' => $hands[$i], 'rank' => null, 'passed' => false];
        }
        $pdo->prepare("UPDATE daifugo_games SET status='playing', state_json=?, state_ver=state_ver+1 WHERE id=?")
            ->execute([json_encode($state), $gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_play(PDO $pdo, int $uid, int $gid): void {
    $body = read_json_body();
    $cards = $body['cards'] ?? [];
    if (!is_array($cards) || !count($cards)) throw new ApiException('bad_request', 'cards 必須', 400);
    $cards = array_values(array_unique(array_map('intval', $cards)));
    sort($cards);
    db_tx($pdo, function () use ($pdo, $uid, $gid, $cards) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        $state = json_decode($g['state_json'], true);
        $myIdx = null;
        foreach ($state['players'] as $i => $p) if ($p['user_id'] === $uid) { $myIdx = $i; break; }
        if ($myIdx === null) throw new ApiException('forbidden', 'not in game', 403);
        if ($state['turn'] !== $myIdx) throw new ApiException('bad_request', 'not your turn', 400);
        $hand = $state['players'][$myIdx]['hand'];
        foreach ($cards as $c) if (!in_array($c, $hand, true)) throw new ApiException('bad_request', 'card not in hand', 400);
        // 同じ数 (rank) か (ジョーカーはワイルド)
        $ranks = array_map('daifugo_rank_of', array_filter($cards, fn($c) => $c !== 52));
        if (count(array_unique($ranks)) > 1) throw new ApiException('bad_request', '同じ数のカードを揃えてください', 400);
        $playRank = !empty($ranks) ? reset($ranks) : 14; // ジョーカー単体は最強
        $playCount = count($cards);
        // 直前と同数 + 強い rank か (v595 革命で反転)
        $last = $state['last_play'];
        $rev = !empty($state['revolution']);
        if ($last && $last['count'] !== $playCount) throw new ApiException('bad_request', "場と同じ枚数 ({$last['count']}) で出してください", 400);
        if ($last) {
            if (!$rev && $playRank <= $last['rank']) throw new ApiException('bad_request', '場のカードより強い数を出してください', 400);
            if ($rev  && $playRank >= $last['rank']) throw new ApiException('bad_request', '革命中: 場のカードより弱い数を出してください', 400);
        }
        // 出す → 手札から抜く
        $newHand = array_values(array_diff($hand, $cards));
        $state['players'][$myIdx]['hand'] = $newHand;
        $state['last_play'] = ['cards' => $cards, 'by' => $myIdx, 'count' => $playCount, 'rank' => $playRank];
        $state['pass_count'] = 0;
        foreach ($state['players'] as &$p) $p['passed'] = false;
        unset($p);
        $state['log'][] = "{$state['players'][$myIdx]['user_id']} が {$playCount} 枚 (rank " . ($playRank + 3) . ") を出した";
        // v595 革命: 4 枚同時出し (ジョーカー込みでも 4 枚) で強弱反転
        if ($playCount >= 4) {
            $state['revolution'] = !$state['revolution'];
            $state['log'][] = $state['revolution'] ? "革命! 強弱反転" : "革命返し! 通常に戻る";
        }
        // 上がり判定
        if (empty($newHand)) {
            $state['finished_ranks'][] = $myIdx;
            $state['players'][$myIdx]['rank'] = count($state['finished_ranks']);
        }
        // v595 8切り: rank=5 (= 「8」) で場流し + 同じプレイヤーがもう一度
        $isEightCut = in_array(5, $ranks, true);
        if ($isEightCut && !empty($newHand)) {
            $state['last_play'] = null;
            $state['log'][] = "8切り! 場が流れて同じプレイヤーから";
            $state['turn'] = $myIdx;
        } else {
            // 通常: 次のターン
            $state['turn'] = daifugo_next_turn($state, $myIdx);
        }
        // ゲーム終了 (上がり残 1 人)
        $remaining = array_filter($state['players'], fn($p) => count($p['hand']) > 0);
        if (count($remaining) <= 1) {
            foreach ($remaining as $idx => $p) {
                $state['finished_ranks'][] = $idx;
                $state['players'][$idx]['rank'] = count($state['finished_ranks']);
            }
            // v612 プレイフィーのみ (= 1位もポイントもらわず、 pot はシステム取り)
            $pdo->prepare("UPDATE daifugo_games SET state_json=?, state_ver=state_ver+1, status='finished', finished_at=NOW() WHERE id=?")
                ->execute([json_encode($state), $gid]);
            return;
        }
        $pdo->prepare("UPDATE daifugo_games SET state_json=?, state_ver=state_ver+1 WHERE id=?")
            ->execute([json_encode($state), $gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_pass(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'not playing', 400);
        $state = json_decode($g['state_json'], true);
        $myIdx = null;
        foreach ($state['players'] as $i => $p) if ($p['user_id'] === $uid) { $myIdx = $i; break; }
        if ($myIdx === null) throw new ApiException('forbidden', 'not in game', 403);
        if ($state['turn'] !== $myIdx) throw new ApiException('bad_request', 'not your turn', 400);
        if (!$state['last_play']) throw new ApiException('bad_request', '場にカードがない時は出さないと進めません', 400);
        $state['players'][$myIdx]['passed'] = true;
        $state['pass_count']++;
        $state['log'][] = "{$state['players'][$myIdx]['user_id']} がパス";
        $state['turn'] = daifugo_next_turn($state, $myIdx);
        // 直前に出した人以外全員パス → 場流れ
        $activeCount = 0;
        foreach ($state['players'] as $p) if (count($p['hand']) > 0) $activeCount++;
        if ($state['pass_count'] >= $activeCount - 1) {
            $state['last_play'] = null;
            $state['pass_count'] = 0;
            foreach ($state['players'] as &$p) $p['passed'] = false;
            unset($p);
            $state['log'][] = "場が流れた";
            // 最後に出した人 from log: turn をそこに戻す
            // 簡易: 直前 last_play の by を探す  — clear 済みなので現在の turn をそのまま維持
        }
        $pdo->prepare("UPDATE daifugo_games SET state_json=?, state_ver=state_ver+1 WHERE id=?")
            ->execute([json_encode($state), $gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_next_turn(array $state, int $cur): int {
    $n = count($state['players']);
    for ($k = 1; $k <= $n; $k++) {
        $next = ($cur + $k) % $n;
        if (count($state['players'][$next]['hand']) > 0) return $next;
    }
    return $cur;
}

// v637 投了。 playing 中の参加者が押すとゲーム終了 (ポイント戻りません)。
function daifugo_resign(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'playing') throw new ApiException('bad_request', 'プレイ中以外は投了不可', 400);
        $stE = $pdo->prepare("SELECT 1 FROM daifugo_players WHERE game_id=? AND user_id=?");
        $stE->execute([$gid, $uid]);
        if (!$stE->fetchColumn()) throw new ApiException('forbidden', '参加者ではない', 403);
        $pdo->prepare("UPDATE daifugo_games SET status='finished', finished_at=NOW() WHERE id=?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_cancel(PDO $pdo, int $uid, int $gid): void {
    db_tx($pdo, function () use ($pdo, $uid, $gid) {
        $st = $pdo->prepare("SELECT * FROM daifugo_games WHERE id=? FOR UPDATE");
        $st->execute([$gid]);
        $g = $st->fetch(PDO::FETCH_ASSOC);
        if (!$g) throw new ApiException('not_found', 'not found', 404);
        if ($g['status'] !== 'lobby') throw new ApiException('bad_request', '開始後はキャンセル不可', 400);
        if ((int)$g['creator_user_id'] !== $uid) throw new ApiException('forbidden', '起案者のみ', 403);
        $players = $pdo->query("SELECT user_id FROM daifugo_players WHERE game_id=" . (int)$gid)->fetchAll(PDO::FETCH_COLUMN);
        foreach ($players as $puid) {
            Ledger::transfer($pdo, 1, (int)$puid, (int)$g['fee'], 'daifugo_refund', 'daifugo', $gid, "大富豪キャンセル返金");
        }
        $pdo->prepare("UPDATE daifugo_games SET status='cancelled', finished_at=NOW(), pot_total=0 WHERE id=?")->execute([$gid]);
    });
    json_response(['ok' => true]);
}

function daifugo_state(PDO $pdo, int $uid, int $gid): void {
    $st = $pdo->prepare("SELECT g.*, uc.display_name AS creator_name FROM daifugo_games g JOIN users uc ON uc.id=g.creator_user_id WHERE g.id=?");
    $st->execute([$gid]);
    $g = $st->fetch(PDO::FETCH_ASSOC);
    if (!$g) throw new ApiException('not_found', 'not found', 404);
    $players = $pdo->prepare("SELECT p.user_id, p.seat, u.display_name, u.avatar_url FROM daifugo_players p JOIN users u ON u.id=p.user_id WHERE p.game_id=? ORDER BY p.seat");
    $players->execute([$gid]);
    $playersInfo = $players->fetchAll(PDO::FETCH_ASSOC);
    if ($g['status'] === 'lobby' || $g['status'] === 'cancelled') {
        json_response([
            'id' => (int)$g['id'], 'status' => $g['status'], 'fee' => (int)$g['fee'],
            'pot_total' => (int)$g['pot_total'], 'creator_user_id' => (int)$g['creator_user_id'],
            'players' => array_map(fn($p) => ['user_id' => (int)$p['user_id'], 'seat' => (int)$p['seat'], 'display_name' => $p['display_name'], 'avatar_url' => $p['avatar_url']], $playersInfo),
        ]);
        return;
    }
    $state = json_decode($g['state_json'], true);
    $mySeat = null;
    foreach ($state['players'] as $i => $p) if ($p['user_id'] === $uid) { $mySeat = $i; break; }
    // v665 着席順が起家順と違うので、 uid キーで情報を引く
    $infoByUid = [];
    foreach ($playersInfo as $pi) { $infoByUid[(int)$pi['user_id']] = $pi; }
    // 公開部分のみ
    $publicPlayers = [];
    foreach ($state['players'] as $i => $p) {
        $info = $infoByUid[(int)$p['user_id']] ?? null;
        $publicPlayers[] = [
            'seat' => $i,
            'user_id' => $p['user_id'],
            'display_name' => $info['display_name'] ?? null,
            'avatar_url' => $info['avatar_url'] ?? null,
            'hand_count' => count($p['hand']),
            'rank' => $p['rank'],
            'passed' => $p['passed'],
            'my_hand' => $i === $mySeat ? $p['hand'] : null,
        ];
    }
    json_response([
        'id' => (int)$g['id'], 'status' => $g['status'], 'fee' => (int)$g['fee'],
        'pot_total' => (int)$g['pot_total'], 'creator_user_id' => (int)$g['creator_user_id'],
        'players' => $publicPlayers,
        'turn' => $state['turn'],
        'last_play' => $state['last_play'],
        'my_seat' => $mySeat,
        'my_turn' => $state['turn'] === $mySeat,
        'finished_ranks' => $state['finished_ranks'],
        'log' => array_slice($state['log'] ?? [], -10),
        'revolution' => !empty($state['revolution']),
        'finished_at' => $g['finished_at'],
    ]);
}
