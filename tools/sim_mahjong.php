<?php
// v555 #209 麻雀フル半荘シミュレータ。 4 AI プレイヤー で 半荘を完走させ、
//   整合性検証 (点数合計 = 100000 ± リーチ棒、 全 8 局完了、 鳴き/和了/流局)。
//   AI 戦略:
//     - 自分の番: tsumo可なら宣言。 不可なら 「最も価値が低い」 牌を捨てる (字牌 > 端 > 中)
//     - 鳴き候補: 50% でポン、 50% でパス (チー/カンは 30%)
//     - ロン候補: 必ず宣言 (役があるなら勝ち)
declare(strict_types=1);

chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/MahjongEngine.php';
require __DIR__ . '/../src/handlers/mahjong.php';

// 牌の価値 (低いほど捨て易い): 字牌 > 1/9 > 2/8 > 3/7 > 4/5/6
function tileValue(int $t): int {
    if ($t >= 27) return 0; // 字牌 = 最も捨て易い
    $r = $t % 9;
    if ($r === 0 || $r === 8) return 1; // 端
    if ($r === 1 || $r === 7) return 2;
    if ($r === 2 || $r === 6) return 3;
    return 4; // 中張
}

function aiChooseDiscard(array $hand): int {
    // 最も価値が低い牌を捨てる (ペア優先で残す: 2 枚以上ある牌は残す)
    $cnt = array_fill(0, 34, 0);
    foreach ($hand as $t) $cnt[$t]++;
    $best = null; $bestVal = 999;
    foreach ($hand as $t) {
        $v = tileValue($t);
        if ($cnt[$t] >= 2) $v += 10; // ペア以上は残す
        if ($v < $bestVal) { $bestVal = $v; $best = $t; }
    }
    return $best;
}

function runOneHanchan(int $seed = 0): array {
    if ($seed) mt_srand($seed);
    $playerUids = [101, 102, 103, 104];
    $state = MahjongEngine::newGame($playerUids);
    MahjongEngine::drawForTurn($state);
    $startingScores = array_map(fn($p) => $p['score'], $state['players']);

    $events = [
        'tsumo' => 0, 'ron' => 0, 'ryukyoku' => 0,
        'kyoku' => 0, 'naki' => 0, 'riichi' => 0, 'steps' => 0,
    ];
    $maxSteps = 8000;
    while ($state['phase'] !== 'finished_all' && $events['steps'] < $maxSteps) {
        $events['steps']++;
        if ($state['phase'] === 'kyoku_end') {
            $events['kyoku']++;
            mahjong_maybe_advance_round(null, $state, ['id' => 0, 'buy_in' => 50, 'rake_pct' => 5]);
            continue;
        }
        if ($state['phase'] === 'draw') {
            $events['ryukyoku']++;
            MahjongEngine::ryukyokuPayout($state);
            continue;
        }
        if ($state['awaiting'] === 'discard') {
            $curSeat = $state['turn'];
            $p = $state['players'][$curSeat];
            // tsumo 可なら宣言
            $tCheck = MahjongEngine::tryTsumo($state, $curSeat);
            if ($tCheck['ok']) {
                $isOya = ($curSeat === $state['oya']);
                $score = MahjongEngine::calcScore($tCheck['yaku'], $isOya, true, (int)$state['honba']);
                mahjong_apply_win($state, $curSeat, null, $score, $tCheck['yaku'], true);
                $events['tsumo']++;
                continue;
            }
            // 立直可能か (5% でリーチを試す)
            if (!$p['riichi'] && mt_rand(0, 100) < 10) {
                $r = MahjongEngine::declareRiichi($state, $curSeat);
                if ($r['ok']) {
                    $events['riichi']++;
                    // リーチした人は最後の手の最後の牌を切る (簡略)
                }
            }
            // 打牌
            $tile = aiChooseDiscard($state['players'][$curSeat]['hand']);
            $r = MahjongEngine::discard($state, $curSeat, $tile);
            if (!$r['ok']) {
                throw new RuntimeException("discard fail at step {$events['steps']}: {$r['msg']}");
            }
            // 鳴き候補が無いなら 即 turn 進める
            if (!$state['naki_chances']) {
                mahjong_advance_after_discard($state);
                if ($state['phase'] === 'kyoku_end') continue;
            }
            continue;
        }
        if ($state['awaiting'] === 'naki_window' || $state['awaiting'] === 'ron_chance') {
            // 各 seat を チェック: ロン可能なら宣言、 鳴きは 確率で
            $discarder = $state['last_discarded']['by'] ?? null;
            $done = false;
            for ($s = 0; $s < 4 && !$done; $s++) {
                if ($s === $discarder) continue;
                if (in_array($s, $state['naki_passed'], true)) continue;
                $ronCheck = MahjongEngine::tryRon($state, $s);
                if ($ronCheck['ok']) {
                    $isOya = ($s === $state['oya']);
                    $score = MahjongEngine::calcScore($ronCheck['yaku'], $isOya, false, (int)$state['honba']);
                    mahjong_apply_win($state, $s, $discarder, $score, $ronCheck['yaku'], false);
                    $events['ron']++;
                    $done = true;
                    break;
                }
                // 鳴きを 50% 確率で
                $myChances = array_filter($state['naki_chances'], fn($c) => $c['seat'] === $s);
                if ($myChances && mt_rand(0, 100) < 50) {
                    $c = reset($myChances);
                    $extra = ['tile' => $c['tile']];
                    if ($c['type'] === 'chi') $extra['with'] = $c['with'];
                    $r = MahjongEngine::declareNaki($state, $s, $c['type'], $extra);
                    if ($r['ok']) { $events['naki']++; $done = true; break; }
                }
                // pass
                MahjongEngine::nakiPass($state, $s);
            }
            if ($done) continue;
            // 全員 pass しても advance しなかった場合 (drawForTurn が呼ばれて続行)
            if ($state['awaiting'] === 'naki_window' || $state['awaiting'] === 'ron_chance') {
                // 強制 advance (鳴きパスが全 3 家分終わった = nakiPass が中で turn 進めたはず)
                if ($state['phase'] === 'draw') {
                    MahjongEngine::ryukyokuPayout($state);
                }
            }
            continue;
        }
        // unknown awaiting → 強制 break
        echo "WARN: unknown awaiting={$state['awaiting']}, phase={$state['phase']}\n";
        break;
    }
    $finalScores = array_map(fn($p) => $p['score'], $state['players']);
    return [
        'events' => $events,
        'phase' => $state['phase'],
        'round_index' => $state['round_index'],
        'starting_scores' => $startingScores,
        'final_scores' => $finalScores,
        'riichi_pot' => $state['riichi_pot'],
        'log_tail' => array_slice($state['log'], -10),
    ];
}

$N = (int)($argv[1] ?? 3);
echo "Running $N hanchan simulations...\n\n";

$pass = 0; $fail = 0;
for ($i = 0; $i < $N; $i++) {
    echo "--- Hanchan #" . ($i+1) . " ---\n";
    try {
        $r = runOneHanchan($i + 1);
        echo "  Steps: {$r['events']['steps']}, Kyoku: {$r['events']['kyoku']}, Tsumo: {$r['events']['tsumo']}, Ron: {$r['events']['ron']}, Ryukyoku: {$r['events']['ryukyoku']}, Naki: {$r['events']['naki']}, Riichi: {$r['events']['riichi']}\n";
        echo "  Round index: {$r['round_index']}\n";
        echo "  Phase: {$r['phase']}\n";
        $startSum = array_sum($r['starting_scores']);
        $finalSum = array_sum($r['final_scores']) + $r['riichi_pot'];
        echo "  Scores: start=" . implode('/', $r['starting_scores']) . " (sum {$startSum})\n";
        echo "          final=" . implode('/', $r['final_scores']) . " (sum {$finalSum}) + riichi_pot {$r['riichi_pot']}\n";
        // 整合性チェック
        $sumOk = abs($startSum - $finalSum) < 100; // ceil100 で多少ずれる
        $finishedOk = $r['phase'] === 'finished_all';
        $roundOk = $r['round_index'] >= 8;
        if ($sumOk && $finishedOk && $roundOk) {
            echo "  ✓ OK\n"; $pass++;
        } else {
            echo "  ✗ FAIL: sum_ok={$sumOk}, finished={$finishedOk}, round_ok={$roundOk}\n"; $fail++;
        }
    } catch (Throwable $e) {
        echo "  ✗ EXCEPTION: " . $e->getMessage() . "\n";
        echo "    " . $e->getFile() . ':' . $e->getLine() . "\n";
        $fail++;
    }
    echo "\n";
}
echo "========================================\n";
echo "Result: $pass passed / $fail failed\n";
exit($fail > 0 ? 1 : 0);
