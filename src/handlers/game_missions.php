<?php
// v1274 娯楽ミッション (中村さん要望 D)。
// 主催者 が pt を 出資 して 「setlog に 投稿すれば 20pt もらえる」等 の ゲリラミッション
// を 起票 → 参加者 は 対象機能 で 行動 すると 自動 で 報酬 が 支給。
// 主催者 の 出資額 と 同額 を SYSTEM が 補助 (中村さん 判断 「C案 = 主催者 + SYSTEM 50/50」)。
//
// route: /api/game-missions
//   GET   /api/game-missions             — アクティブ一覧
//   POST  /api/game-missions             — 起票
//   GET   /api/game-missions/{id}        — 詳細 (完了者一覧含む)
//   POST  /api/game-missions/{id}/cancel — 主催者キャンセル (未消化分返還)

declare(strict_types=1);

// 対応する対象機能 (v1274 時点 Phase 1 は setlog のみ hook 済、他は Phase 2)
const GM_FEATURES = [
    'setlog'         => '📸 setlog に投稿',
    'profile_book'   => '🎀 プロフ帳の項目を埋める (Phase2)',
    'bokete'         => '😆 ぼけてに投稿 (Phase2)',
    'trading_cards'  => '🎴 ゼミ人トレカを開ける (Phase2)',
    'tomorrow_lab'   => '🏫 明日ラボ行こうに参加宣言 (Phase2)',
];

// 起票時の 上限 (悪用/事故防止)
const GM_MAX_HOST_DEPOSIT_PT = 200;   // 主催者 1 回 の 最大 出資
const GM_MAX_REWARD_PER_PART = 100;   // 参加者 1 人 あたり 最大 支給
const GM_MAX_PARTICIPANTS    = 20;    // 定員 上限
const GM_MAX_DURATION_HOURS  = 24 * 7; // 7 日 最長

function route_game_missions(PDO $pdo, array $cfg, string $method, array $seg): void {
    gm_sweep_expired($pdo, $cfg);   // 期限切れ の 自動 終了処理 (未消化返還)

    $sub = $seg[1] ?? '';
    $id  = (int)($seg[1] ?? 0);
    $sub2 = $seg[2] ?? '';

    if ($sub === '' && $method === 'GET')  { gm_list($pdo, $cfg); return; }
    if ($sub === '' && $method === 'POST') { gm_create($pdo, $cfg); return; }
    if ($id > 0 && $sub2 === '' && $method === 'GET')  { gm_detail($pdo, $cfg, $id); return; }
    if ($id > 0 && $sub2 === 'cancel' && $method === 'POST') { gm_cancel($pdo, $cfg, $id); return; }
    throw new ApiException('not_found', 'no such endpoint', 404);
}

// ---------- GET /api/game-missions ----------
function gm_list(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    // アクティブ + 過去 7 日以内の 終了分 も 返す (履歴として)
    $st = $pdo->query('SELECT m.*,
                             (SELECT COUNT(*) FROM game_mission_completions c WHERE c.mission_id = m.id) AS claimed_count_actual,
                             h.display_name AS host_display_name
                        FROM game_missions m
                        LEFT JOIN users h ON h.id = m.host_user_id
                       WHERE m.status = "active"
                          OR (m.status <> "active" AND m.ended_at > NOW() - INTERVAL 7 DAY)
                       ORDER BY m.status = "active" DESC, m.ends_at DESC
                       LIMIT 200');
    $rows = $st->fetchAll();

    // 自分の完了状況を batch 取得
    $meComp = [];
    if ($rows) {
        $ids = array_map(fn($r) => (int)$r['id'], $rows);
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $mc  = $pdo->prepare("SELECT mission_id FROM game_mission_completions
                              WHERE user_id = ? AND mission_id IN ($ph)");
        $mc->execute(array_merge([$uid], $ids));
        foreach ($mc->fetchAll() as $r) $meComp[(int)$r['mission_id']] = true;
    }

    foreach ($rows as &$r) {
        $r['is_mine']       = ((int)$r['host_user_id']) === $uid;
        $r['completed_by_me'] = !empty($meComp[(int)$r['id']]);
        $r['feature_label'] = GM_FEATURES[$r['target_feature']] ?? $r['target_feature'];
        $r['remaining']     = max(0, (int)$r['max_participants'] - (int)$r['claimed_count_actual']);
    }
    json_response(['items' => $rows, 'features' => GM_FEATURES,
                   'limits' => [
                       'max_host_deposit'  => GM_MAX_HOST_DEPOSIT_PT,
                       'max_reward'        => GM_MAX_REWARD_PER_PART,
                       'max_participants'  => GM_MAX_PARTICIPANTS,
                       'max_duration_hours'=> GM_MAX_DURATION_HOURS,
                   ]]);
}

// ---------- POST /api/game-missions ----------
function gm_create(PDO $pdo, array $cfg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $b = read_json_body();

    $title    = trim((string)($b['title'] ?? ''));
    $desc     = trim((string)($b['description'] ?? ''));
    $feature  = (string)($b['target_feature'] ?? '');
    $reward   = (int)($b['reward_per_participant'] ?? 0);
    $capacity = (int)($b['max_participants'] ?? 0);
    $hours    = (int)($b['duration_hours'] ?? 0);

    if ($title === '' || mb_strlen($title) > 200) {
        throw new ApiException('bad_request', 'title 必須 (1-200 字)', 400);
    }
    if (mb_strlen($desc) > 1000) {
        throw new ApiException('bad_request', 'description 1000 字以内', 400);
    }
    if (!isset(GM_FEATURES[$feature])) {
        throw new ApiException('bad_request', 'target_feature が不正', 400);
    }
    if ($reward < 1 || $reward > GM_MAX_REWARD_PER_PART) {
        throw new ApiException('bad_request', '報酬は 1-' . GM_MAX_REWARD_PER_PART . 'pt', 400);
    }
    if ($capacity < 1 || $capacity > GM_MAX_PARTICIPANTS) {
        throw new ApiException('bad_request', '定員は 1-' . GM_MAX_PARTICIPANTS . '人', 400);
    }
    if ($hours < 1 || $hours > GM_MAX_DURATION_HOURS) {
        throw new ApiException('bad_request', '期限は 1-' . GM_MAX_DURATION_HOURS . ' 時間', 400);
    }
    $hostDeposit = $reward * $capacity;   // 主催者 出資 = 報酬 × 定員
    if ($hostDeposit > GM_MAX_HOST_DEPOSIT_PT) {
        throw new ApiException('bad_request', '主催者出資が上限' . GM_MAX_HOST_DEPOSIT_PT . 'ptを超えます (報酬×定員=' . $hostDeposit . 'pt)', 400);
    }
    $systemGrant = $hostDeposit;          // SYSTEM 補助 (50/50)

    // 残高チェック
    $hostBal = Ledger::balanceOfUser($pdo, $uid);
    if ($hostBal < $hostDeposit) {
        throw new ApiException('bad_request', "残高不足 (要 {$hostDeposit}pt / 現在 {$hostBal}pt)", 400);
    }

    $missionId = db_tx($pdo, function () use ($pdo, $uid, $title, $desc, $feature, $reward,
                                              $capacity, $hours, $hostDeposit, $systemGrant) {
        $ins = $pdo->prepare('INSERT INTO game_missions
            (host_user_id, title, description, target_feature,
             host_deposit_pt, system_grant_pt, reward_per_participant,
             max_participants, ends_at)
            VALUES (?,?,?,?,?,?,?,?, NOW() + INTERVAL ? HOUR)');
        $ins->execute([$uid, $title, $desc, $feature,
                       $hostDeposit, $systemGrant, $reward, $capacity, $hours]);
        $mid = (int)$pdo->lastInsertId();

        // 主催者 → ESCROW
        $hostAcc = Ledger::accountIdForUser($pdo, $uid);
        $escAcc  = Ledger::accountIdByCode($pdo, 'ESCROW');
        Ledger::transfer($pdo, $hostAcc, $escAcc, $hostDeposit,
                         'mission_deposit', 'mission', $mid,
                         "娯楽ミッション「{$title}」主催者出資");

        // SYSTEM → ESCROW (補助)
        $sysUid = (int)$pdo->query("SELECT id FROM users WHERE kind='system' LIMIT 1")->fetchColumn();
        if ($sysUid > 0 && $systemGrant > 0) {
            $sysAcc = Ledger::accountIdForUser($pdo, $sysUid);
            Ledger::transfer($pdo, $sysAcc, $escAcc, $systemGrant,
                             'mission_deposit', 'mission', $mid,
                             "娯楽ミッション「{$title}」SYSTEM 補助");
        }
        return $mid;
    });

    // Slack 通知 fire-and-forget
    try {
        $baseUrl = rtrim((string)($cfg['app']['base_url'] ?? ''), '/');
        $link = $baseUrl . '/#/game-missions/' . $missionId;
        $featLbl = GM_FEATURES[$feature] ?? $feature;
        $msg = "🎯 *娯楽ミッション*  <{$link}|{$title}>\n"
             . "主催: {$u['display_name']}  ·  {$featLbl}  ·  {$reward}pt × {$capacity}人  ·  期限 {$hours}h";
        slack_notify($cfg, $msg);
    } catch (Throwable $e) { /* swallow */ }

    json_response(['ok' => true, 'id' => $missionId]);
}

// ---------- GET /api/game-missions/{id} ----------
function gm_detail(PDO $pdo, array $cfg, int $mid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];

    $st = $pdo->prepare('SELECT m.*, h.display_name AS host_display_name
                           FROM game_missions m
                      LEFT JOIN users h ON h.id = m.host_user_id
                          WHERE m.id = ?');
    $st->execute([$mid]);
    $m = $st->fetch();
    if (!$m) throw new ApiException('not_found', 'ミッションがありません', 404);

    $m['is_mine'] = ((int)$m['host_user_id']) === $uid;
    $m['feature_label'] = GM_FEATURES[$m['target_feature']] ?? $m['target_feature'];

    // 完了者一覧
    $ct = $pdo->prepare('SELECT c.*, u.display_name, u.avatar_url
                           FROM game_mission_completions c
                      LEFT JOIN users u ON u.id = c.user_id
                          WHERE c.mission_id = ?
                       ORDER BY c.completed_at ASC');
    $ct->execute([$mid]);
    $m['completions'] = $ct->fetchAll();
    $m['completed_by_me'] = false;
    foreach ($m['completions'] as $c) {
        if ((int)$c['user_id'] === $uid) { $m['completed_by_me'] = true; break; }
    }
    $m['remaining'] = max(0, (int)$m['max_participants'] - count($m['completions']));

    json_response($m);
}

// ---------- POST /api/game-missions/{id}/cancel ----------
function gm_cancel(PDO $pdo, array $cfg, int $mid): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $isAdmin = (($u['role'] ?? '') === 'admin');

    db_tx($pdo, function () use ($pdo, $mid, $uid, $isAdmin) {
        $st = $pdo->prepare('SELECT * FROM game_missions WHERE id = ? FOR UPDATE');
        $st->execute([$mid]);
        $m = $st->fetch();
        if (!$m) throw new ApiException('not_found', 'ミッションがありません', 404);
        if ((int)$m['host_user_id'] !== $uid && !$isAdmin) {
            throw new ApiException('forbidden', '主催者のみキャンセルできます', 403);
        }
        if ($m['status'] !== 'active') {
            throw new ApiException('bad_request', '既に終了しています', 400);
        }
        gm_finalize_locked($pdo, $m, 'cancelled');
    });
    json_response(['ok' => true]);
}

// ---------- 期限切れ の 自動終了 sweep (list 呼び出し前 に 都度チェック) ----------
function gm_sweep_expired(PDO $pdo, array $cfg): void {
    $st = $pdo->query('SELECT id FROM game_missions WHERE status = "active" AND ends_at <= NOW()');
    $ids = array_map('intval', array_column($st->fetchAll(), 'id'));
    foreach ($ids as $mid) {
        try {
            db_tx($pdo, function () use ($pdo, $mid) {
                $st = $pdo->prepare('SELECT * FROM game_missions WHERE id = ? FOR UPDATE');
                $st->execute([$mid]);
                $m = $st->fetch();
                if (!$m || $m['status'] !== 'active') return;
                gm_finalize_locked($pdo, $m, 'ended');
            });
        } catch (Throwable $e) { /* swallow — 個別失敗で全体を止めない */ }
    }
}

// ---------- 終了処理 (未消化 返還) ----------
// 呼び出し側 が SELECT … FOR UPDATE 済 と 前提。
function gm_finalize_locked(PDO $pdo, array $m, string $reason): void {
    $mid = (int)$m['id'];
    $status = ($reason === 'cancelled') ? 'cancelled' : 'ended';

    $ct = $pdo->prepare('SELECT COALESCE(SUM(reward_pt),0) FROM game_mission_completions WHERE mission_id = ?');
    $ct->execute([$mid]);
    $claimedPt = (int)$ct->fetchColumn();

    $totalPool = (int)$m['host_deposit_pt'] + (int)$m['system_grant_pt'];
    $remaining = max(0, $totalPool - $claimedPt);

    if ($remaining > 0) {
        // 半々 で 主催者 と SYSTEM に 返還 (端数は SYSTEM 側で吸収)
        $toHost = intdiv($remaining, 2);
        $toSys  = $remaining - $toHost;
        $escAcc = Ledger::accountIdByCode($pdo, 'ESCROW');

        if ($toHost > 0) {
            $hostAcc = Ledger::accountIdForUser($pdo, (int)$m['host_user_id']);
            Ledger::transfer($pdo, $escAcc, $hostAcc, $toHost,
                             'mission_refund', 'mission', $mid,
                             "娯楽ミッション「{$m['title']}」未消化返還 (主催者半分)");
        }
        if ($toSys > 0) {
            $sysUid = (int)$pdo->query("SELECT id FROM users WHERE kind='system' LIMIT 1")->fetchColumn();
            if ($sysUid > 0) {
                $sysAcc = Ledger::accountIdForUser($pdo, $sysUid);
                Ledger::transfer($pdo, $escAcc, $sysAcc, $toSys,
                                 'mission_refund', 'mission', $mid,
                                 "娯楽ミッション「{$m['title']}」未消化返還 (SYSTEM半分)");
            }
        }
    }

    $up = $pdo->prepare('UPDATE game_missions SET status = ?, ended_at = NOW() WHERE id = ?');
    $up->execute([$status, $mid]);
}

// ---------- 外部から呼ぶ hook: 対象 feature で 行動 した 参加者 に 報酬 支給 ----------
// setlog / bokete / profile_book 等 の handler の 中 で 呼び出す:
//   gm_check_and_reward($pdo, $cfg, $userId, 'setlog');
// 返り値: 支給された mission_id の配列 (通常 0 or 1 件、複数 mission 並列時は 複数)。
function gm_check_and_reward(PDO $pdo, array $cfg, int $userId, string $feature): array {
    // 該当 feature の アクティブ mission を 取得 (定員未達、 期限未達)
    $st = $pdo->prepare('SELECT id FROM game_missions
                          WHERE target_feature = ?
                            AND status = "active"
                            AND ends_at > NOW()');
    $st->execute([$feature]);
    $ids = array_map('intval', array_column($st->fetchAll(), 'id'));
    if (!$ids) return [];

    $awarded = [];
    foreach ($ids as $mid) {
        try {
            $ok = db_tx($pdo, function () use ($pdo, $mid, $userId) {
                $st = $pdo->prepare('SELECT * FROM game_missions WHERE id = ? FOR UPDATE');
                $st->execute([$mid]);
                $m = $st->fetch();
                if (!$m || $m['status'] !== 'active') return false;
                if ((int)$m['host_user_id'] === $userId) return false;   // 主催者本人は対象外

                // 既 完了 チェック
                $chk = $pdo->prepare('SELECT 1 FROM game_mission_completions WHERE mission_id = ? AND user_id = ?');
                $chk->execute([$mid, $userId]);
                if ($chk->fetchColumn()) return false;

                // 定員 チェック
                $cnt = (int)$pdo->query('SELECT COUNT(*) FROM game_mission_completions WHERE mission_id = ' . $mid)
                                ->fetchColumn();
                if ($cnt >= (int)$m['max_participants']) {
                    // 定員 達成 → 期限 前でも 自動 終了
                    gm_finalize_locked($pdo, $m, 'ended');
                    return false;
                }

                $reward = (int)$m['reward_per_participant'];
                $escAcc = Ledger::accountIdByCode($pdo, 'ESCROW');
                $userAcc = Ledger::accountIdForUser($pdo, $userId);
                $lid = Ledger::transfer($pdo, $escAcc, $userAcc, $reward,
                                        'mission_reward', 'mission', $mid,
                                        "娯楽ミッション「{$m['title']}」達成報酬");

                $ins = $pdo->prepare('INSERT INTO game_mission_completions
                    (mission_id, user_id, reward_pt, ledger_id) VALUES (?,?,?,?)');
                $ins->execute([$mid, $userId, $reward, $lid]);
                $pdo->prepare('UPDATE game_missions SET claimed_count = claimed_count + 1 WHERE id = ?')
                    ->execute([$mid]);

                // 定員 到達 なら 即 終了処理 (残額 0 のはず、返還 なし)
                if ($cnt + 1 >= (int)$m['max_participants']) {
                    // 再取得 (claimed_count 更新後の値で finalize)
                    $st2 = $pdo->prepare('SELECT * FROM game_missions WHERE id = ? FOR UPDATE');
                    $st2->execute([$mid]);
                    $m2 = $st2->fetch();
                    if ($m2) gm_finalize_locked($pdo, $m2, 'ended');
                }
                return true;
            });
            if ($ok) {
                $awarded[] = $mid;
                notify_safely($pdo, $cfg, $userId, 'admin_notice',
                    "🎯 娯楽ミッション達成! /#/game-missions/{$mid}",
                    'game_mission', $mid);
            }
        } catch (Throwable $e) { /* 個別失敗は swallow */ }
    }
    return $awarded;
}
