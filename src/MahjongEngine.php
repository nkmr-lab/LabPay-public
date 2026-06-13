<?php
// v554 #209 麻雀 Phase 2 エンジン。 門前清のみ (鳴き無し)、 東風戦 4 局。
//   牌コード: 0-8=萬1-9、 9-17=筒1-9、 18-26=索1-9、 27=東 28=南 29=西 30=北、 31=白 32=發 33=中
//   状態は state_json (JSON) で 1 セル保存、 state_ver で楽観ロック (polling)。
declare(strict_types=1);

final class MahjongEngine {
    const SEATS = 4;
    const TILES_PER_TYPE = 4;
    const TYPES = 34;
    const TOTAL_TILES = 136; // 34 * 4
    const HAND_SIZE = 13;
    const WANPAI = 14; // 王牌 (dora 抜き含む)、 ライブ山 = 136 - 14 - 4*13 = 70 牌

    const T_E = 27; const T_S = 28; const T_W = 29; const T_N = 30;
    const T_HAKU = 31; const T_HATSU = 32; const T_CHUN = 33;

    public static function newGame(array $playerUids): array {
        // 全牌 0-33 を各 4 枚 = 136 個。 シャッフル → 山。
        $deck = [];
        for ($i = 0; $i < self::TYPES; $i++) {
            for ($k = 0; $k < self::TILES_PER_TYPE; $k++) $deck[] = $i;
        }
        shuffle($deck);
        // 王牌 14 を 末尾に確保。 ライブ山 = 122 枚 残り (ただし 王牌の dora 表示は別個に持つ)
        // 配牌: 各家 13 枚
        $players = [];
        $pos = 0;
        foreach ($playerUids as $idx => $uid) {
            $hand = array_slice($deck, $pos, self::HAND_SIZE);
            $pos += self::HAND_SIZE;
            sort($hand);
            $players[] = [
                'user_id'   => (int)$uid,
                'hand'      => array_values($hand),
                'discards'  => [],
                'riichi'    => false,
                'score'     => 25000,
                'declared'  => false, // ロン/ツモ宣言済
            ];
        }
        // ライブ山 = 山の 14..(残り) のうち 王牌 14 牌を末尾に。 簡単のため deck の中での
        //   index で wall_pointer を管理し、 wanpai_start から 14 牌は王牌。
        $wallPointer = $pos; // 次のツモ位置
        $wanpaiStart = self::TOTAL_TILES - self::WANPAI; // 122
        $doraIndicators = [$deck[$wanpaiStart + 5]]; // 王牌の ドラ表示牌 (簡略化: 6 枚目)

        return [
            'phase'           => 'play',
            'round_wind'      => self::T_E,
            'round_index'     => 0, // 0..3 for 東1〜東4 (東風戦)
            'oya'             => 0, // 親 (player index)
            'honba'           => 0,
            'turn'            => 0, // 現在の打牌者 (= 親 が最初)
            'deck'            => $deck,
            'wall_pointer'    => $wallPointer,
            'wanpai_start'    => $wanpaiStart,
            'dora_indicators' => $doraIndicators,
            'players'         => $players,
            'last_discarded'  => null, // {by, tile} (ロン受付用)
            'awaiting'        => 'discard', // 'discard' (turn の人が捨てる) | 'tsumo_chance' (turn が ツモ可) | 'ron_chance' (誰かがロン可)
            'log'             => [], // 局のログ
            'game_winners'    => [],
        ];
    }

    // 親 (turn 番) がツモる → 14 枚に。 ツモ後 awaiting='discard'
    public static function drawForTurn(array &$st): bool {
        if ($st['wall_pointer'] >= $st['wanpai_start']) {
            // 流局
            $st['phase'] = 'draw';
            return false;
        }
        $tile = $st['deck'][$st['wall_pointer']];
        $st['wall_pointer']++;
        $st['players'][$st['turn']]['hand'][] = $tile;
        sort($st['players'][$st['turn']]['hand']);
        $st['awaiting'] = 'discard';
        return true;
    }

    // 打牌: turn の人が hand から tile を捨てる
    public static function discard(array &$st, int $playerIdx, int $tile): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今は打牌できません'];
        $hand =& $st['players'][$playerIdx]['hand'];
        $key = array_search($tile, $hand, true);
        if ($key === false) return ['ok' => false, 'msg' => 'その牌は手にありません'];
        array_splice($hand, $key, 1);
        $st['players'][$playerIdx]['discards'][] = $tile;
        $st['last_discarded'] = ['by' => $playerIdx, 'tile' => $tile];
        $st['awaiting'] = 'ron_chance';
        $st['log'][] = ['type' => 'discard', 'by' => $playerIdx, 'tile' => $tile];
        return ['ok' => true];
    }

    // 次の手番へ進める (ロン宣言 0 件 → ツモ)
    public static function advanceTurn(array &$st): bool {
        $st['turn'] = ($st['turn'] + 1) % self::SEATS;
        $st['last_discarded'] = null;
        return self::drawForTurn($st);
    }

    // リーチ宣言 (前提: 門前 + テンパイ + 残り山 4 枚 以上 + 1000 点以上)
    public static function declareRiichi(array &$st, int $playerIdx): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はリーチできません'];
        $p =& $st['players'][$playerIdx];
        if ($p['riichi']) return ['ok' => false, 'msg' => '既にリーチ済'];
        if ($p['score'] < 1000) return ['ok' => false, 'msg' => '1000 点未満ではリーチ不可'];
        if (self::wallRemaining($st) < 4) return ['ok' => false, 'msg' => '残り山 4 枚未満 でリーチ不可'];
        if (!self::isTenpai($p['hand'])) return ['ok' => false, 'msg' => 'テンパイしていません'];
        $p['riichi'] = true;
        $p['score'] -= 1000; // リーチ棒 (簡略: 場に出すだけ。 詰みでは戻ってこない)
        $st['log'][] = ['type' => 'riichi', 'by' => $playerIdx];
        return ['ok' => true];
    }

    public static function wallRemaining(array $st): int {
        return $st['wanpai_start'] - $st['wall_pointer'];
    }

    // ツモ和了試行
    public static function tryTsumo(array &$st, int $playerIdx): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はツモ宣言できません (打牌前のみ)'];
        $p = $st['players'][$playerIdx];
        $hand = $p['hand'];
        if (count($hand) !== 14) return ['ok' => false, 'msg' => '14 枚ではありません'];
        $yaku = self::detectYaku($hand, $p['riichi'], true, $st['round_wind'], self::seatWind($playerIdx, $st['oya']));
        if (empty($yaku['list'])) return ['ok' => false, 'msg' => '役がありません'];
        return ['ok' => true, 'win_type' => 'tsumo', 'yaku' => $yaku];
    }

    // ロン和了試行 (誰でも、 last_discarded の牌を取る)
    public static function tryRon(array &$st, int $playerIdx): array {
        if ($st['awaiting'] !== 'ron_chance') return ['ok' => false, 'msg' => '今はロン宣言できません'];
        if (!$st['last_discarded']) return ['ok' => false, 'msg' => '直前の捨牌がありません'];
        if ($st['last_discarded']['by'] === $playerIdx) return ['ok' => false, 'msg' => '自分の捨牌にはロンできません'];
        $p = $st['players'][$playerIdx];
        $hand = $p['hand'];
        $hand[] = $st['last_discarded']['tile'];
        sort($hand);
        if (count($hand) !== 14) return ['ok' => false, 'msg' => '14 枚にならない'];
        $yaku = self::detectYaku($hand, $p['riichi'], false, $st['round_wind'], self::seatWind($playerIdx, $st['oya']));
        if (empty($yaku['list'])) return ['ok' => false, 'msg' => '役がありません'];
        return ['ok' => true, 'win_type' => 'ron', 'yaku' => $yaku, 'from' => $st['last_discarded']['by'], 'tile' => $st['last_discarded']['tile']];
    }

    // 役判定 (門前清 のみ前提)。
    //   $hand: 14 枚 (sorted)
    //   $riichi: リーチ宣言中か
    //   $isTsumo: 自摸か
    //   $roundWind / $seatWind: 役牌判定用 (27-30)
    public static function detectYaku(array $hand, bool $riichi, bool $isTsumo, int $roundWind, int $seatWind): array {
        if (count($hand) !== 14) return ['list' => [], 'han' => 0];
        $forms = self::findWinForms($hand);
        if (!$forms) return ['list' => [], 'han' => 0];
        // 各 form (4 mentsu + 1 pair or 七対子 or 国士) で 役を判定して 最大翻数を選ぶ
        $best = ['list' => [], 'han' => 0, 'is_yakuman' => false];
        foreach ($forms as $form) {
            $y = self::yakuOfForm($form, $hand, $riichi, $isTsumo, $roundWind, $seatWind);
            $score = $y['han'] + ($y['is_yakuman'] ? 1000 : 0);
            $bs = $best['han'] + ($best['is_yakuman'] ? 1000 : 0);
            if ($score > $bs) $best = $y;
        }
        return $best;
    }

    // テンパイ判定: 残り 1 枚 (任意の 0-33) で和了形になるか
    public static function isTenpai(array $hand13): bool {
        if (count($hand13) !== 13) return false;
        for ($t = 0; $t < self::TYPES; $t++) {
            // 同種 4 枚チェック (自分の手と最後の捨牌で 5 枚目はあり得ないが安全のため)
            $test = $hand13;
            $test[] = $t;
            sort($test);
            if (self::findWinForms($test)) return true;
        }
        return false;
    }

    // 和了形候補を全列挙
    private static function findWinForms(array $hand14): array {
        $forms = [];
        // 七対子
        if (self::isChiitoitsu($hand14)) $forms[] = ['kind' => 'chiitoitsu'];
        // 国士無双
        if (self::isKokushi($hand14)) $forms[] = ['kind' => 'kokushi'];
        // 4 面子 + 1 雀頭
        $cnt = self::count34($hand14);
        for ($t = 0; $t < self::TYPES; $t++) {
            if ($cnt[$t] >= 2) {
                $c2 = $cnt; $c2[$t] -= 2;
                $melds = self::extractMelds($c2, 0);
                if ($melds !== null) $forms[] = ['kind' => 'standard', 'pair' => $t, 'melds' => $melds];
            }
        }
        return $forms;
    }

    private static function extractMelds(array $cnt, int $start): ?array {
        for ($t = $start; $t < self::TYPES; $t++) {
            if ($cnt[$t] === 0) continue;
            // 刻子 (3 枚)
            if ($cnt[$t] >= 3) {
                $c2 = $cnt; $c2[$t] -= 3;
                $rest = self::extractMelds($c2, $t);
                if ($rest !== null) return array_merge([['kind' => 'kotsu', 'tile' => $t]], $rest);
            }
            // 順子 (n, n+1, n+2): 数牌のみ、 8 跨ぎ禁止
            if ($t < 27 && ($t % 9) <= 6 && $cnt[$t + 1] >= 1 && $cnt[$t + 2] >= 1) {
                $c2 = $cnt; $c2[$t]--; $c2[$t + 1]--; $c2[$t + 2]--;
                $rest = self::extractMelds($c2, $t);
                if ($rest !== null) return array_merge([['kind' => 'shuntsu', 'tile' => $t]], $rest);
            }
            return null;
        }
        return [];
    }

    private static function isChiitoitsu(array $hand14): bool {
        if (count($hand14) !== 14) return false;
        $cnt = self::count34($hand14);
        $pairs = 0;
        foreach ($cnt as $c) {
            if ($c === 2) $pairs++;
            elseif ($c !== 0) return false;
        }
        return $pairs === 7;
    }

    private static function isKokushi(array $hand14): bool {
        $yaochuu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]; // 1m/9m, 1p/9p, 1s/9s, 字牌 全部
        $cnt = self::count34($hand14);
        // 13 種 全部 1 枚以上 + どれか 1 種が 2 枚
        $has = 0; $pair = false;
        foreach ($yaochuu as $t) {
            if ($cnt[$t] >= 1) $has++;
            if ($cnt[$t] === 2) $pair = true;
        }
        // 他の牌が無い
        for ($t = 0; $t < self::TYPES; $t++) {
            if (!in_array($t, $yaochuu, true) && $cnt[$t] !== 0) return false;
        }
        return $has === 13 && $pair;
    }

    private static function count34(array $tiles): array {
        $c = array_fill(0, self::TYPES, 0);
        foreach ($tiles as $t) $c[$t]++;
        return $c;
    }

    private static function seatWind(int $playerIdx, int $oya): int {
        // oya = 東。 親から順に 東/南/西/北
        return self::T_E + (($playerIdx - $oya + self::SEATS) % self::SEATS);
    }

    // 役判定本体
    private static function yakuOfForm(array $form, array $hand14, bool $riichi, bool $isTsumo, int $roundWind, int $seatWind): array {
        $list = []; $han = 0; $isYakuman = false;

        if ($form['kind'] === 'kokushi') {
            return ['list' => ['国士無双'], 'han' => 13, 'is_yakuman' => true];
        }
        if ($form['kind'] === 'chiitoitsu') {
            $list[] = '七対子'; $han += 2;
            // タンヤオ / 清一色 / 混一色 / 字一色 等のチェック
            $cnt = self::count34($hand14);
            $tanyao = true;
            for ($i = 0; $i < self::TYPES; $i++) {
                if ($cnt[$i] === 0) continue;
                if (in_array($i, [0,8,9,17,18,26,27,28,29,30,31,32,33], true)) { $tanyao = false; break; }
            }
            if ($tanyao) { $list[] = 'タンヤオ'; $han++; }
            $isHonor = function ($t) { return $t >= 27; };
            $allHonor = true;
            for ($i = 0; $i < self::TYPES; $i++) { if ($cnt[$i] > 0 && !$isHonor($i)) { $allHonor = false; break; } }
            if ($allHonor) return ['list' => ['字一色'], 'han' => 13, 'is_yakuman' => true];
            $suits = self::suitsUsed($cnt);
            if ($suits['n_num_suits'] === 1 && !$suits['has_honor']) { $list[] = '清一色'; $han += 6; }
            elseif ($suits['n_num_suits'] === 1 && $suits['has_honor']) { $list[] = '混一色'; $han += 3; }
            if ($riichi) { $list[] = 'リーチ'; $han++; }
            return ['list' => $list, 'han' => $han, 'is_yakuman' => false];
        }

        // standard 4面子+雀頭
        $pair = $form['pair'];
        $melds = $form['melds']; // 各 ['kind'=>'kotsu'|'shuntsu','tile'=>t]
        $cnt = self::count34($hand14);

        // 役満チェック先
        // 大三大: 白 / 發 / 中 が 刻子
        $hakuKotsu  = self::hasKotsu($melds, self::T_HAKU);
        $hatsuKotsu = self::hasKotsu($melds, self::T_HATSU);
        $chunKotsu  = self::hasKotsu($melds, self::T_CHUN);
        if ($hakuKotsu && $hatsuKotsu && $chunKotsu) {
            return ['list' => ['大三元'], 'han' => 13, 'is_yakuman' => true];
        }
        // 四暗刻: 4 つの刻子 (門前清 + ツモなら確定、 ロンの場合 単騎以外は 三暗刻扱い → 簡略: 4 刻子なら 四暗刻)
        $kotsuCount = 0;
        foreach ($melds as $m) if ($m['kind'] === 'kotsu') $kotsuCount++;
        if ($kotsuCount === 4) {
            return ['list' => ['四暗刻'], 'han' => 13, 'is_yakuman' => true];
        }
        // 字一色
        $allHonorTiles = true;
        for ($i = 0; $i < self::TYPES; $i++) { if ($cnt[$i] > 0 && $i < 27) { $allHonorTiles = false; break; } }
        if ($allHonorTiles) return ['list' => ['字一色'], 'han' => 13, 'is_yakuman' => true];
        // 緑一色: 索子 2/3/4/6/8 + 發 のみ
        $green = [19, 20, 21, 23, 25, self::T_HATSU];
        $isGreen = true;
        for ($i = 0; $i < self::TYPES; $i++) { if ($cnt[$i] > 0 && !in_array($i, $green, true)) { $isGreen = false; break; } }
        if ($isGreen) return ['list' => ['緑一色'], 'han' => 13, 'is_yakuman' => true];

        // 通常役
        if ($riichi) { $list[] = 'リーチ'; $han++; }
        if ($isTsumo) { $list[] = '門前清自摸和'; $han++; }
        // タンヤオ
        $yaochuu = [0,8,9,17,18,26,27,28,29,30,31,32,33];
        $allSimple = true;
        for ($i = 0; $i < self::TYPES; $i++) { if ($cnt[$i] > 0 && in_array($i, $yaochuu, true)) { $allSimple = false; break; } }
        if ($allSimple) { $list[] = 'タンヤオ'; $han++; }
        // 役牌
        foreach ([self::T_HAKU, self::T_HATSU, self::T_CHUN] as $t) {
            if (self::hasKotsu($melds, $t)) {
                $name = ['白','發','中'][$t - self::T_HAKU];
                $list[] = '役牌(' . $name . ')'; $han++;
            }
        }
        if (self::hasKotsu($melds, $roundWind)) {
            $list[] = '役牌(場風)'; $han++;
        }
        if (self::hasKotsu($melds, $seatWind) && $seatWind !== $roundWind) {
            $list[] = '役牌(自風)'; $han++;
        }
        // 平和: 全 順子 + 雀頭が役牌でない + 待ちが両面 (簡略: 両面判定 skip → ほぼ平和)
        $allShuntsu = true;
        foreach ($melds as $m) if ($m['kind'] !== 'shuntsu') { $allShuntsu = false; break; }
        $pairIsYakuhai = ($pair === self::T_HAKU || $pair === self::T_HATSU || $pair === self::T_CHUN || $pair === $roundWind || $pair === $seatWind);
        if ($allShuntsu && !$pairIsYakuhai) { $list[] = '平和'; $han++; }
        // 一気通貫: 同色の 123/456/789 順子が揃う
        foreach ([0, 9, 18] as $base) {
            $hasA = false; $hasB = false; $hasC = false;
            foreach ($melds as $m) {
                if ($m['kind'] !== 'shuntsu') continue;
                if ($m['tile'] === $base) $hasA = true;
                if ($m['tile'] === $base + 3) $hasB = true;
                if ($m['tile'] === $base + 6) $hasC = true;
            }
            if ($hasA && $hasB && $hasC) { $list[] = '一気通貫'; $han += 2; break; }
        }
        // 三色同順: 同じ数字の順子が 萬筒索
        $shuntsuStarts = [];
        foreach ($melds as $m) if ($m['kind'] === 'shuntsu') $shuntsuStarts[] = $m['tile'];
        for ($n = 0; $n <= 6; $n++) {
            if (in_array($n, $shuntsuStarts, true) && in_array($n + 9, $shuntsuStarts, true) && in_array($n + 18, $shuntsuStarts, true)) {
                $list[] = '三色同順'; $han += 2; break;
            }
        }
        // 対々和: 全 刻子 + 雀頭
        $allKotsu = true;
        foreach ($melds as $m) if ($m['kind'] !== 'kotsu') { $allKotsu = false; break; }
        if ($allKotsu) { $list[] = '対々和'; $han += 2; }
        // 三暗刻: 3 刻子 (門前清なので全部暗刻)
        if ($kotsuCount === 3 && !$allKotsu) { $list[] = '三暗刻'; $han += 2; }
        // 混一色 / 清一色
        $suits = self::suitsUsed($cnt);
        if ($suits['n_num_suits'] === 1 && !$suits['has_honor']) { $list[] = '清一色'; $han += 6; }
        elseif ($suits['n_num_suits'] === 1 && $suits['has_honor']) { $list[] = '混一色'; $han += 3; }

        return ['list' => $list, 'han' => $han, 'is_yakuman' => false];
    }

    private static function hasKotsu(array $melds, int $tile): bool {
        foreach ($melds as $m) if ($m['kind'] === 'kotsu' && $m['tile'] === $tile) return true;
        return false;
    }

    private static function suitsUsed(array $cnt34): array {
        $numSuits = [false, false, false]; // 萬筒索
        $hasHonor = false;
        for ($i = 0; $i < self::TYPES; $i++) {
            if ($cnt34[$i] === 0) continue;
            if ($i < 9)       $numSuits[0] = true;
            elseif ($i < 18)  $numSuits[1] = true;
            elseif ($i < 27)  $numSuits[2] = true;
            else              $hasHonor = true;
        }
        $n = array_sum(array_map('intval', $numSuits));
        return ['n_num_suits' => $n, 'has_honor' => $hasHonor];
    }

    // 翻数 → 点数 (簡易、 親/子の区別あり、 ツモ/ロン区別)
    public static function calcScore(array $yaku, bool $isOya, bool $isTsumo): array {
        $han = $yaku['han'];
        $isYakuman = !empty($yaku['is_yakuman']);
        $base = 0; // 基本点
        if ($isYakuman) {
            $base = 8000; // 役満基本点
        } else {
            if ($han >= 13) $base = 8000;        // 数え役満
            elseif ($han >= 11) $base = 6000;    // 三倍満
            elseif ($han >= 8) $base = 4000;     // 倍満
            elseif ($han >= 6) $base = 3000;     // 跳満
            elseif ($han >= 5) $base = 2000;     // 満貫
            elseif ($han === 4) $base = 1500;
            elseif ($han === 3) $base = 1000;
            elseif ($han === 2) $base = 700;
            elseif ($han === 1) $base = 400;
        }
        // 親 ロン = base × 6, 子 ロン = base × 4
        // 親 ツモ = base × 2 を 全員から、 子 ツモ = base × 1 を 子 2 人 + base × 2 を 親 から
        if ($isOya) {
            if ($isTsumo) return ['from_all' => $base * 2, 'from_oya' => 0, 'total' => $base * 6];
            else          return ['from_loser' => $base * 6, 'total' => $base * 6];
        } else {
            if ($isTsumo) return ['from_others' => $base, 'from_oya' => $base * 2, 'total' => $base * 4];
            else          return ['from_loser' => $base * 4, 'total' => $base * 4];
        }
    }

    // 名前 (UI 用)
    public static function tileChar(int $t): string {
        // Unicode mahjong tiles
        // 萬子 1-9 = U+1F007 - U+1F00F
        if ($t < 9)   return mb_chr(0x1F007 + $t, 'UTF-8');
        // 筒子 1-9 = U+1F019 - U+1F021
        if ($t < 18)  return mb_chr(0x1F019 + ($t - 9), 'UTF-8');
        // 索子 1-9 = U+1F010 - U+1F018
        if ($t < 27)  return mb_chr(0x1F010 + ($t - 18), 'UTF-8');
        // 風牌 東南西北 = U+1F000 - U+1F003
        if ($t < 31)  return mb_chr(0x1F000 + ($t - 27), 'UTF-8');
        // 三元: 白 U+1F006、 發 U+1F005、 中 U+1F004
        if ($t === self::T_HAKU)  return mb_chr(0x1F006, 'UTF-8');
        if ($t === self::T_HATSU) return mb_chr(0x1F005, 'UTF-8');
        if ($t === self::T_CHUN)  return mb_chr(0x1F004, 'UTF-8');
        return '?';
    }
}
