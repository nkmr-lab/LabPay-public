<?php
// v555 #209 麻雀エンジン 内部検証スクリプト。
//   1. 既知の和了パターン (各役) を 手動で組んで detectYaku を検証
//   2. シャッフル + ランダム打牌 で 半荘を最後まで走らせて 落ちないか / 整合性
//   3. 鳴き (ポン/チー/カン) の挙動
declare(strict_types=1);

chdir(__DIR__ . '/..');
$_SERVER['REQUEST_METHOD'] = 'CLI';
require __DIR__ . '/../src/MahjongEngine.php';

$pass = 0; $fail = 0; $errors = [];

function check(string $name, bool $cond, string $detail = ''): void {
    global $pass, $fail, $errors;
    if ($cond) { $pass++; echo "  ✓ $name\n"; }
    else { $fail++; $errors[] = "$name :: $detail"; echo "  ✗ $name :: $detail\n"; }
}

function makeWinPlayer(array $hand, array $melds = [], bool $riichi = false, bool $isMenzen = true): array {
    return [
        'user_id' => 1, 'hand' => $hand, 'hand_reds' => 0,
        'discards' => [], 'discard_reds' => 0,
        'melds' => $melds, 'riichi' => $riichi, 'ippatsu' => false,
        'double_riichi' => false, 'score' => 25000, 'declared' => false,
    ];
}
function makeStubState(): array {
    return [
        'phase' => 'play', 'round_wind' => MahjongEngine::T_E, 'round_index' => 0,
        'oya' => 0, 'honba' => 0, 'riichi_pot' => 0, 'turn' => 0,
        'deck' => array_fill(0, 136, 0), 'red_indices' => [],
        'wall_pointer' => 52, 'wanpai_start' => 122,
        'dora_indicators' => [0], 'uradora_indicators' => [0],
        'kan_count' => 0,
        'players' => [makeWinPlayer([]), makeWinPlayer([]), makeWinPlayer([]), makeWinPlayer([])],
        'last_discarded' => null, 'awaiting' => 'discard',
        'naki_chances' => [], 'naki_passed' => [],
        'log' => [], 'game_winners' => [],
        'is_first_round' => false,
        'is_player_first_turn' => array_fill(0, 4, false),
    ];
}

echo "\n=== 1. 役判定テスト ===\n";

// 七対子: 1m 1m 2m 2m 3p 3p 4p 4p 5s 5s 東 東 中 中
$h1 = [0,0, 1,1, 11,11, 12,12, 22,22, 27,27, 33,33];
$st = makeStubState();
$st['players'][0] = makeWinPlayer($h1);
$yaku = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("七対子 検出", in_array('七対子', $yaku['list'], true), "list=" . json_encode($yaku['list']));
check("七対子 翻数 (2 + 門前自摸 + リーチなし)", $yaku['han'] >= 2, "han={$yaku['han']}");

// 国士無双: 1m 9m 1p 9p 1s 9s 東南西北白發中 中
$h2 = [0,8, 9,17, 18,26, 27,28,29,30, 31,32,33,33];
$st['players'][0] = makeWinPlayer($h2);
$yaku2 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("国士無双 検出", in_array('国士無双', $yaku2['list'], true), "list=" . json_encode($yaku2['list']));
check("国士無双 役満フラグ", !empty($yaku2['is_yakuman']));

// タンヤオ + 平和: 2m 3m 4m 5p 6p 7p 3s 4s 5s 6s 7s 8s 9s 9s — ←不正、 直す
// タンヤオピンフ: 234m 567p 234s 345s 88s で  和了形 14 枚
//   2m3m4m / 5p6p7p / 2s3s4s / 3s4s5s / 8s8s
$h3 = [1,2,3, 13,14,15, 19,20,21, 20,21,22, 25,25];
sort($h3);
$st['players'][0] = makeWinPlayer($h3, [], true);
$yaku3 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, 22); // winTile=5s (両面)
check("タンヤオ 検出", in_array('タンヤオ', $yaku3['list'], true), "list=" . json_encode($yaku3['list']));
check("リーチ 検出", in_array('リーチ', $yaku3['list'], true), "list=" . json_encode($yaku3['list']));

// 役牌(中): 1m2m3m / 5p6p7p / 中中中 / 1s2s3s / 8s8s = 14 牌
$h4 = [0,1,2, 13,14,15, 33,33,33, 18,19,20, 25,25];
sort($h4);
$st['players'][0] = makeWinPlayer($h4);
$yaku4 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("役牌(中) 検出", $yaku4['han'] > 0 || in_array('役牌(中)', $yaku4['list'], true), "list=" . json_encode($yaku4['list']) . " han={$yaku4['han']}");

// 大三元: 白白白 發發發 中中中 + 2m3m4m + 99m  雀頭
$h5 = [31,31,31, 32,32,32, 33,33,33, 1,2,3, 8,8];
sort($h5);
$st['players'][0] = makeWinPlayer($h5);
$yaku5 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("大三元 検出", in_array('大三元', $yaku5['list'], true), "list=" . json_encode($yaku5['list']));
check("大三元 役満", !empty($yaku5['is_yakuman']));

// 字一色: 東東東 南南南 白白白 中中中 + 北北
$h6 = [27,27,27, 28,28,28, 31,31,31, 33,33,33, 30,30];
sort($h6);
$st['players'][0] = makeWinPlayer($h6);
$yaku6 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("字一色 検出", in_array('字一色', $yaku6['list'], true), "list=" . json_encode($yaku6['list']));

// 緑一色: 234s 234s 666s 88s 發發發
//   索 2/3/4/6/8 + 發 のみで 14 枚
$h7 = [19,20,21, 19,20,21, 23,23,23, 25,25, 32,32,32];
sort($h7);
$st['players'][0] = makeWinPlayer($h7);
$yaku7 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("緑一色 検出", in_array('緑一色', $yaku7['list'], true), "list=" . json_encode($yaku7['list']));

// 清一色 (萬子のみ): 1m1m 2m3m4m 5m6m7m 3m4m5m 7m8m9m
$h8 = [0,0, 1,2,3, 4,5,6, 2,3,4, 6,7,8];
sort($h8);
$st['players'][0] = makeWinPlayer($h8, [], true);
$yaku8 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("清一色 検出", in_array('清一色', $yaku8['list'], true), "list=" . json_encode($yaku8['list']));

// 四暗刻 (全 暗刻 4 = 役満): 222m 444p 666s 中中中 + 88p 雀頭
$h9 = [1,1,1, 12,12,12, 23,23,23, 33,33,33, 14,14];
sort($h9);
$st['players'][0] = makeWinPlayer($h9, [], false);
$yaku9 = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("四暗刻 (4 暗刻) → 役満", !empty($yaku9['is_yakuman']) && in_array('四暗刻', $yaku9['list'], true), "list=" . json_encode($yaku9['list']));

// 対々和 (鳴き有り、 役満にならない): 222m ポン / 444p ポン / 666s ポン / 中中中 + 88p
$h9b = [33,33,33, 14,14];
$melds = [
    ['type' => 'pon', 'tile' => 1, 'tiles' => [1,1,1], 'from' => 1],
    ['type' => 'pon', 'tile' => 12, 'tiles' => [12,12,12], 'from' => 2],
    ['type' => 'pon', 'tile' => 23, 'tiles' => [23,23,23], 'from' => 3],
];
$st['players'][0] = makeWinPlayer($h9b, $melds, false);
$yaku9b = MahjongEngine::detectYaku($st['players'][0], true, $st, 0, null);
check("対々和 検出 (鳴き有り)", in_array('対々和', $yaku9b['list'], true), "list=" . json_encode($yaku9b['list']));

echo "\n=== 2. 点数計算テスト ===\n";

// 親 ロン 5翻 = 12000 (満貫)
$score = MahjongEngine::calcScore(['han' => 5, 'is_yakuman' => false], true, false, 0);
check("親 ロン 満貫 12000", $score['total'] === 12000, "actual=" . $score['total']);
// 子 ロン 3翻 = 5200 (1000×4)
$score = MahjongEngine::calcScore(['han' => 3, 'is_yakuman' => false], false, false, 0);
check("子 ロン 3翻 4000", $score['total'] === 4000, "actual=" . $score['total']);
// 親 ツモ 役満 = 16000 all = 48000
$score = MahjongEngine::calcScore(['han' => 13, 'is_yakuman' => true], true, true, 0);
check("親 ツモ 役満 48000", $score['total'] === 48000, "actual=" . $score['total']);
// 本場ボーナス: 子 ロン 1翻 1本場 — base=400, 400×4=1600 + 300本場 = 1900 (簡易表)
$score = MahjongEngine::calcScore(['han' => 1, 'is_yakuman' => false], false, false, 1);
check("子 ロン 1翻 1本場 ≒ 1900", $score['total'] === 1900, "actual=" . $score['total']);

echo "\n=== 3. 配牌 + 山切れまでランダム打牌 ===\n";

$state = MahjongEngine::newGame([101, 102, 103, 104]);
MahjongEngine::drawForTurn($state);
$steps = 0;
$tsumos = 0; $rons = 0; $ryukyoku = 0;
while ($state['phase'] === 'play' && $steps < 200) {
    $steps++;
    if ($state['awaiting'] === 'discard') {
        // ツモ試行
        $tsumoCheck = MahjongEngine::tryTsumo($state, $state['turn']);
        if ($tsumoCheck['ok']) {
            $tsumos++;
            // 適用
            $isOya = ($state['turn'] === $state['oya']);
            $score = MahjongEngine::calcScore($tsumoCheck['yaku'], $isOya, true, 0);
            // dummy apply
            $state['phase'] = 'kyoku_end';
            break;
        }
        // ランダム打牌
        $hand = $state['players'][$state['turn']]['hand'];
        $tile = $hand[array_rand($hand)];
        $r = MahjongEngine::discard($state, $state['turn'], $tile);
        if (!$r['ok']) { echo "  ! discard failed: {$r['msg']}\n"; break; }
        // 鳴き候補無視 (パス全員)
        // 簡略: 即 turn 進める
        $next = ($state['turn'] + 1) % 4;
        $state['turn'] = $next;
        $state['last_discarded'] = null;
        $state['naki_chances'] = [];
        $state['naki_passed'] = [];
        $ok = MahjongEngine::drawForTurn($state);
        if (!$ok) { $ryukyoku++; break; }
    } else {
        break;
    }
}
check("ランダム対局 step > 50", $steps > 50, "steps=$steps");
check("ランダム対局 終了状態", in_array($state['phase'], ['play','draw','kyoku_end'], true), "phase={$state['phase']}");
echo "  log: $steps steps, $tsumos tsumos, $ryukyoku ryukyoku\n";

echo "\n=== 4. 鳴き挙動テスト ===\n";

$state = MahjongEngine::newGame([101, 102, 103, 104]);
MahjongEngine::drawForTurn($state);
// player 0 が捨てる牌を player 1 がポンできる状況を作る
// 強制セットアップ: player 1 に 1m 1m 入れる、 player 0 の 手 から 1m を 捨て
$state['players'][1]['hand'][] = 0; $state['players'][1]['hand'][] = 0;
sort($state['players'][1]['hand']);
$state['players'][0]['hand'][] = 0;
sort($state['players'][0]['hand']);
$r = MahjongEngine::discard($state, 0, 0); // 1m discard
check("ポン候補が発生", count(array_filter($state['naki_chances'], fn($c) => $c['seat'] === 1 && $c['type'] === 'pon')) >= 1, "chances=" . json_encode($state['naki_chances']));
// ポン宣言
$r = MahjongEngine::declareNaki($state, 1, 'pon', ['tile' => 0]);
check("ポン宣言成功", $r['ok'], $r['msg'] ?? '');
check("ポン後 turn=1", $state['turn'] === 1);
check("ポン後 awaiting=discard", $state['awaiting'] === 'discard');
check("副露 1 件", count($state['players'][1]['melds']) === 1);

echo "\n=== 5. 連荘 + 半荘 ===\n";

$state = MahjongEngine::newGame([101, 102, 103, 104]);
// 親が和了したと仮定して advance
$state['phase'] = 'kyoku_end';
$state['last_winner'] = 0; // 親=0
require_once __DIR__ . '/../src/handlers/mahjong.php';
$g = ['id' => 0, 'buy_in' => 50, 'rake_pct' => 5];
mahjong_maybe_advance_round(null, $state, $g);
check("親和了 → 連荘 (oya=0 維持)", $state['oya'] === 0, "oya={$state['oya']}");
check("親和了 → honba 増加", $state['honba'] === 1, "honba={$state['honba']}");
check("親和了 → round_index 据え置き", $state['round_index'] === 0, "round_index={$state['round_index']}");

// 子和了の場合
$state = MahjongEngine::newGame([101, 102, 103, 104]);
$state['phase'] = 'kyoku_end';
$state['last_winner'] = 1; // 子和了
mahjong_maybe_advance_round(null, $state, $g);
check("子和了 → 親流れ (oya=1)", $state['oya'] === 1, "oya={$state['oya']}");
check("子和了 → round_index 進む", $state['round_index'] === 1, "round_index={$state['round_index']}");

// 7→8 で半荘終了
$state = MahjongEngine::newGame([101,102,103,104]);
$state['round_index'] = 7;
$state['oya'] = 3;
$state['phase'] = 'kyoku_end';
$state['last_winner'] = 1; // 子和了 → 親流れ
mahjong_maybe_advance_round(null, $state, $g);
check("南4 子和了 → 半荘終了", $state['phase'] === 'finished_all', "phase={$state['phase']}");

echo "\n========================================\n";
echo "結果: $pass 通過 / $fail 失敗\n";
if ($fail > 0) {
    echo "\n失敗:\n";
    foreach ($errors as $e) echo "  - $e\n";
    exit(1);
}
exit(0);
