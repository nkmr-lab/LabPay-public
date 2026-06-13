<?php
// v555 #209 麻雀 Phase 2 (フル機能) — 4人 / 鳴き有り / 半荘 / ドラ+赤+裏ドラ /
//   連荘 / テンパイ料 / リーチ棒持ち越し / 平和両面待ち判定。
//
//   牌コード: 0-8=萬1-9、 9-17=筒1-9、 18-26=索1-9、 27=東 28=南 29=西 30=北、 31=白 32=發 33=中
//   赤ドラは 別 flag 配列 で 管理 (各プレイヤーの hand + 副露 に対して 赤フラグを別管理)
//   状態は state_json で 1 セル保存、 state_ver で楽観ロック (polling)。
declare(strict_types=1);

final class MahjongEngine {
    const SEATS = 4;
    const TILES_PER_TYPE = 4;
    const TYPES = 34;
    const TOTAL_TILES = 136;
    const HAND_SIZE = 13;
    const WANPAI = 14;
    const RIICHI_BO = 1000;
    const TENPAI_POT = 3000; // 流局時 ノーテン罰符 (分配)

    const T_E = 27; const T_S = 28; const T_W = 29; const T_N = 30;
    const T_HAKU = 31; const T_HATSU = 32; const T_CHUN = 33;

    public static function newGame(array $playerUids, ?array $carryScores = null, int $startOya = 0, int $roundWind = self::T_E, int $roundIndex = 0, int $honba = 0, int $riichiPot = 0): array {
        // 全牌 0-33 を各 4 枚 = 136 個。 シャッフル → 山。 赤5 は man=4, pin=4, sou=4 の位置に
        //   赤フラグを付与 (1 枚ずつ)
        $deck = [];
        for ($i = 0; $i < self::TYPES; $i++) {
            for ($k = 0; $k < self::TILES_PER_TYPE; $k++) $deck[] = $i;
        }
        shuffle($deck);
        // 赤ドラ: 5m=4, 5p=13, 5s=22 のそれぞれ 1 枚を red 化
        $redIndices = self::pickRedIndices($deck);

        // 配牌: 各家 13 枚 (idx 0..51)
        $players = [];
        $pos = 0;
        foreach ($playerUids as $idx => $uid) {
            $handIdx = []; // deck の index 配列
            for ($k = 0; $k < self::HAND_SIZE; $k++) {
                $handIdx[] = $pos++;
            }
            $hand = array_map(fn($i) => $deck[$i], $handIdx);
            sort($hand);
            $players[] = [
                'user_id'    => (int)$uid,
                'hand'       => $hand,
                'hand_reds'  => self::countRedsInIndices($handIdx, $redIndices),
                'discards'   => [],
                'discard_reds' => 0,
                'melds'      => [],         // 副露 (鳴き)
                'riichi'     => false,
                'ippatsu'    => false,      // 一発 (リーチ後の 一巡内、 鳴き無し)
                'double_riichi' => false,
                'score'      => $carryScores ? (int)$carryScores[$idx] : 25000,
                'declared'   => false,
            ];
        }
        $wallPointer = $pos; // 次のツモ位置 (= 52)
        $wanpaiStart = self::TOTAL_TILES - self::WANPAI; // 122
        // ドラ表示は王牌の 5 枚目 (慣習: 山の末尾から逆順、 王牌 5 枚目 = wanpaiStart + 4)
        $doraIndicators    = [$deck[$wanpaiStart + 4]];
        $uradoraIndicators = [$deck[$wanpaiStart + 9]]; // リーチ和了時にのみ公開

        return [
            'phase'              => 'play',
            'round_wind'         => $roundWind,
            'round_index'        => $roundIndex, // 0..7 for 東1〜南4
            'oya'                => $startOya,
            'honba'              => $honba,
            'riichi_pot'         => $riichiPot, // 場のリーチ棒 (持ち越し含む)
            'turn'               => $startOya,
            'deck'               => $deck,
            'red_indices'        => $redIndices, // [deck_idx, ...]
            'wall_pointer'       => $wallPointer,
            'wanpai_start'       => $wanpaiStart,
            'dora_indicators'    => $doraIndicators,
            'uradora_indicators' => $uradoraIndicators,
            'kan_count'          => 0,
            'players'            => $players,
            'last_discarded'     => null,
            'awaiting'           => 'discard',     // 'discard' | 'naki_window' | 'ankan_window' | 'kakan_window' (簡略)
            'naki_chances'       => [],            // [{seat, type, ...}, ...] 現在受付可能な naki
            'naki_passed'        => [],            // [seat, ...] 既にパスした seat
            'log'                => [],
            'game_winners'       => [],
            'is_first_round'     => true,           // 一巡目 (国士無双 / 天和 などの判定に必要)
            'is_player_first_turn' => array_fill(0, self::SEATS, true),
        ];
    }

    public static function pickRedIndices(array $deck): array {
        $picks = [];
        foreach ([4, 13, 22] as $target) {
            for ($i = 0; $i < count($deck); $i++) {
                if ($deck[$i] === $target) { $picks[] = $i; break; }
            }
        }
        return $picks;
    }

    public static function countRedsInIndices(array $handDeckIndices, array $redIndices): int {
        $c = 0;
        foreach ($handDeckIndices as $i) if (in_array($i, $redIndices, true)) $c++;
        return $c;
    }

    public static function wallRemaining(array $st): int {
        return $st['wanpai_start'] - $st['wall_pointer'];
    }

    public static function drawForTurn(array &$st): bool {
        if ($st['wall_pointer'] >= $st['wanpai_start']) {
            $st['phase'] = 'draw';
            return false;
        }
        $tileIdx = $st['wall_pointer'];
        $tile = $st['deck'][$tileIdx];
        $st['wall_pointer']++;
        $p =& $st['players'][$st['turn']];
        $p['hand'][] = $tile;
        if (in_array($tileIdx, $st['red_indices'], true)) $p['hand_reds']++;
        sort($p['hand']);
        $st['awaiting'] = 'discard';
        return true;
    }

    public static function discard(array &$st, int $playerIdx, int $tile): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今は打牌できません'];
        $hand =& $st['players'][$playerIdx]['hand'];
        $key = array_search($tile, $hand, true);
        if ($key === false) return ['ok' => false, 'msg' => 'その牌は手にありません'];
        // リーチ後は自摸切りのみ (簡略: 任意切り可能にしておく)
        array_splice($hand, $key, 1);
        $st['players'][$playerIdx]['discards'][] = $tile;
        $st['last_discarded'] = ['by' => $playerIdx, 'tile' => $tile];
        // 一発フラグを消す (他家の打牌 = 即消える)
        foreach ($st['players'] as &$p) $p['ippatsu'] = false;
        unset($p);
        // 副露の可能性チェック
        $chances = self::findNakiChances($st, $playerIdx, $tile);
        $st['naki_chances'] = $chances;
        $st['naki_passed'] = [];
        $st['is_player_first_turn'][$playerIdx] = false;
        if (count(array_filter($st['is_player_first_turn'])) === 0) $st['is_first_round'] = false;
        if ($chances) {
            $st['awaiting'] = 'naki_window';
        } else {
            $st['awaiting'] = 'ron_chance'; // 即 ロン受付 (全 seat 任意)
        }
        $st['log'][] = ['type' => 'discard', 'by' => $playerIdx, 'tile' => $tile];
        return ['ok' => true];
    }

    // 副露受付可能性チェック (ポン / チー / 大明カン / ロン)
    private static function findNakiChances(array $st, int $discarderIdx, int $tile): array {
        $chances = [];
        for ($s = 0; $s < self::SEATS; $s++) {
            if ($s === $discarderIdx) continue;
            $p = $st['players'][$s];
            $hand = $p['hand'];
            // リーチ中は鳴かない (簡略)
            if ($p['riichi']) {
                continue;
            }
            $cnt = self::count34($hand);
            // ポン: 同じ牌 2 枚
            if ($cnt[$tile] >= 2) $chances[] = ['seat' => $s, 'type' => 'pon', 'tile' => $tile];
            // 大明カン: 同じ牌 3 枚
            if ($cnt[$tile] >= 3) $chances[] = ['seat' => $s, 'type' => 'minkan', 'tile' => $tile];
            // チー: 直前の seat = (discarder+1) % 4 だけ可能、 数牌のみ
            if ($s === ($discarderIdx + 1) % self::SEATS && $tile < 27) {
                $r = $tile % 9;
                $opts = [];
                if ($r >= 2 && $cnt[$tile - 2] >= 1 && $cnt[$tile - 1] >= 1) $opts[] = [$tile - 2, $tile - 1];
                if ($r >= 1 && $r <= 7 && $cnt[$tile - 1] >= 1 && $cnt[$tile + 1] >= 1) $opts[] = [$tile - 1, $tile + 1];
                if ($r <= 6 && $cnt[$tile + 1] >= 1 && $cnt[$tile + 2] >= 1) $opts[] = [$tile + 1, $tile + 2];
                foreach ($opts as $pair) {
                    $chances[] = ['seat' => $s, 'type' => 'chi', 'tile' => $tile, 'with' => $pair];
                }
            }
        }
        return $chances;
    }

    // 鳴き実行
    public static function declareNaki(array &$st, int $playerIdx, string $type, array $extra = []): array {
        if ($st['awaiting'] !== 'naki_window') return ['ok' => false, 'msg' => '鳴ける状況ではありません'];
        $match = null;
        foreach ($st['naki_chances'] as $c) {
            if ($c['seat'] !== $playerIdx || $c['type'] !== $type) continue;
            if ($type === 'chi' && !empty($extra['with'])) {
                if ($c['with'] !== $extra['with']) continue;
            }
            $match = $c; break;
        }
        if (!$match) return ['ok' => false, 'msg' => 'その鳴きは選択できません'];
        $tile = $match['tile'];
        $p =& $st['players'][$playerIdx];
        $hand =& $p['hand'];
        $used = [];
        if ($type === 'pon') {
            $needed = 2; $i = 0;
            while ($i < count($hand) && $needed > 0) {
                if ($hand[$i] === $tile) { $used[] = $hand[$i]; array_splice($hand, $i, 1); $needed--; } else $i++;
            }
            $meld = ['type' => 'pon', 'tile' => $tile, 'tiles' => [$tile, $tile, $tile], 'from' => $st['last_discarded']['by']];
        } else if ($type === 'minkan') {
            $needed = 3; $i = 0;
            while ($i < count($hand) && $needed > 0) {
                if ($hand[$i] === $tile) { $used[] = $hand[$i]; array_splice($hand, $i, 1); $needed--; } else $i++;
            }
            $meld = ['type' => 'minkan', 'tile' => $tile, 'tiles' => [$tile, $tile, $tile, $tile], 'from' => $st['last_discarded']['by']];
            $st['kan_count']++;
            // ドラ追加
            self::addKanDora($st);
        } else if ($type === 'chi') {
            $with = $match['with'];
            $needed = $with;
            foreach ($needed as $nt) {
                $i = array_search($nt, $hand, true);
                if ($i !== false) { array_splice($hand, $i, 1); }
            }
            $tiles = array_merge($needed, [$tile]); sort($tiles);
            $meld = ['type' => 'chi', 'tile' => $tile, 'tiles' => $tiles, 'from' => $st['last_discarded']['by']];
        } else {
            return ['ok' => false, 'msg' => '不明な鳴き'];
        }
        $p['melds'][] = $meld;
        // 直前の捨牌を捨てた人の河から「鳴かれた」マークを付ける (UIで判別、 簡略: discards はそのまま)
        $st['log'][] = ['type' => 'naki', 'by' => $playerIdx, 'naki' => $type, 'tile' => $tile];
        // 鳴いた人が turn になり、 即打牌フェーズへ
        $st['turn'] = $playerIdx;
        $st['awaiting'] = $type === 'minkan' ? 'kan_draw' : 'discard';
        $st['naki_chances'] = [];
        $st['naki_passed'] = [];
        $st['last_discarded'] = null;
        // 一発フラグ消去 (鳴きが入った瞬間、 全員)
        foreach ($st['players'] as &$pp) $pp['ippatsu'] = false;
        unset($pp);
        if ($type === 'minkan') {
            // 嶺上開花のため 王牌から 1 枚補充
            self::drawFromDeadWall($st, $playerIdx);
            $st['awaiting'] = 'discard';
        }
        return ['ok' => true];
    }

    // 暗カン (自分の手から 4 枚)
    public static function declareAnkan(array &$st, int $playerIdx, int $tile): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はカンできません'];
        $p =& $st['players'][$playerIdx];
        $hand =& $p['hand'];
        $cnt = self::count34($hand);
        if ($cnt[$tile] < 4) return ['ok' => false, 'msg' => '同じ牌 4 枚必要です'];
        // 削除
        $rm = 4; $i = 0;
        while ($i < count($hand) && $rm > 0) {
            if ($hand[$i] === $tile) { array_splice($hand, $i, 1); $rm--; } else $i++;
        }
        $p['melds'][] = ['type' => 'ankan', 'tile' => $tile, 'tiles' => [$tile, $tile, $tile, $tile], 'from' => null];
        $st['kan_count']++;
        self::addKanDora($st);
        // 嶺上補充
        self::drawFromDeadWall($st, $playerIdx);
        $st['log'][] = ['type' => 'naki', 'by' => $playerIdx, 'naki' => 'ankan', 'tile' => $tile];
        $st['awaiting'] = 'discard';
        return ['ok' => true];
    }

    // 加カン (既存のポンに 4 枚目追加)
    public static function declareKakan(array &$st, int $playerIdx, int $tile): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はカンできません'];
        $p =& $st['players'][$playerIdx];
        $foundMeld = -1;
        foreach ($p['melds'] as $mi => $m) {
            if ($m['type'] === 'pon' && $m['tile'] === $tile) { $foundMeld = $mi; break; }
        }
        if ($foundMeld === -1) return ['ok' => false, 'msg' => 'その牌のポンがありません'];
        $hand =& $p['hand'];
        $hi = array_search($tile, $hand, true);
        if ($hi === false) return ['ok' => false, 'msg' => 'その牌が手にありません'];
        array_splice($hand, $hi, 1);
        $p['melds'][$foundMeld]['type'] = 'kakan';
        $p['melds'][$foundMeld]['tiles'][] = $tile;
        $st['kan_count']++;
        self::addKanDora($st);
        self::drawFromDeadWall($st, $playerIdx);
        $st['log'][] = ['type' => 'naki', 'by' => $playerIdx, 'naki' => 'kakan', 'tile' => $tile];
        $st['awaiting'] = 'discard';
        return ['ok' => true];
    }

    private static function addKanDora(array &$st): void {
        $idx = $st['wanpai_start'] + 4 - count($st['dora_indicators']);
        if ($idx >= 0 && $idx < count($st['deck'])) {
            $st['dora_indicators'][] = $st['deck'][$idx];
            $st['uradora_indicators'][] = $st['deck'][$idx + 5];
        }
    }

    private static function drawFromDeadWall(array &$st, int $playerIdx): void {
        // 嶺上牌は王牌の末尾 (簡略: ライブ山末尾から借りる代わりに、 wanpai 後ろから取る)
        $idx = $st['wanpai_start'] + 13 - $st['kan_count']; // 王牌末尾から逆方向に
        if ($idx < 0 || $idx >= count($st['deck'])) return;
        $tile = $st['deck'][$idx];
        $p =& $st['players'][$playerIdx];
        $p['hand'][] = $tile;
        if (in_array($idx, $st['red_indices'], true)) $p['hand_reds']++;
        sort($p['hand']);
        // ライブ山 1 牌減 (簡略: wanpaiStart を 1 進める = wall_pointer は触らず wanpai 範囲を縮める)
        // 実装簡略のため、 wallpaiStart-- (山の上限を 1 減らす)
        $st['wanpai_start']--;
    }

    public static function nakiPass(array &$st, int $playerIdx): array {
        if ($st['awaiting'] !== 'naki_window' && $st['awaiting'] !== 'ron_chance') return ['ok' => false, 'msg' => '今は pass できません'];
        if (!in_array($playerIdx, $st['naki_passed'], true)) $st['naki_passed'][] = $playerIdx;
        // 全 3 家 (打牌者以外) が pass したら turn を進める
        $discarder = $st['last_discarded']['by'] ?? null;
        if ($discarder === null) {
            // already advanced
            return ['ok' => true];
        }
        $needPass = [];
        for ($s = 0; $s < self::SEATS; $s++) {
            if ($s !== $discarder) $needPass[] = $s;
        }
        $allPassed = !array_diff($needPass, $st['naki_passed']);
        if ($allPassed) {
            $next = ($discarder + 1) % self::SEATS;
            $st['turn'] = $next;
            $st['last_discarded'] = null;
            $st['naki_chances'] = [];
            $st['naki_passed'] = [];
            $ok = self::drawForTurn($st);
            return ['ok' => true, 'advanced' => true, 'in_play' => $ok];
        }
        return ['ok' => true];
    }

    public static function declareRiichi(array &$st, int $playerIdx): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はリーチできません'];
        $p =& $st['players'][$playerIdx];
        if ($p['riichi']) return ['ok' => false, 'msg' => '既にリーチ済'];
        if (!self::isMenzen($p)) return ['ok' => false, 'msg' => '門前 (鳴き無し) でないとリーチ不可'];
        if ($p['score'] < self::RIICHI_BO) return ['ok' => false, 'msg' => '1000 点未満ではリーチ不可'];
        if (self::wallRemaining($st) < 4) return ['ok' => false, 'msg' => '残り山 4 枚未満 でリーチ不可'];
        if (!self::isTenpai($p['hand'], $p['melds'])) return ['ok' => false, 'msg' => 'テンパイしていません'];
        $p['riichi'] = true;
        $p['ippatsu'] = true;
        $p['score'] -= self::RIICHI_BO;
        $st['riichi_pot'] += self::RIICHI_BO;
        $st['log'][] = ['type' => 'riichi', 'by' => $playerIdx];
        // ダブルリーチ判定
        if ($st['is_first_round']) $p['double_riichi'] = true;
        return ['ok' => true];
    }

    public static function tryTsumo(array &$st, int $playerIdx): array {
        if ($st['turn'] !== $playerIdx) return ['ok' => false, 'msg' => 'あなたの番ではありません'];
        if ($st['awaiting'] !== 'discard') return ['ok' => false, 'msg' => '今はツモ宣言できません'];
        $p = $st['players'][$playerIdx];
        $totalTiles = count($p['hand']) + array_sum(array_map(fn($m) => count($m['tiles']) === 4 ? 3 : count($m['tiles']), $p['melds'])); // 各副露は実質 3 牌相当
        // 14 枚 (手 + 副露 × 3) でないと不可 (簡略チェック)
        if (count($p['hand']) % 3 !== 2) return ['ok' => false, 'msg' => '形が和了に達していません'];
        $yaku = self::detectYaku($p, true, $st, $playerIdx, null);
        if (empty($yaku['list'])) return ['ok' => false, 'msg' => '役がありません'];
        return ['ok' => true, 'win_type' => 'tsumo', 'yaku' => $yaku];
    }

    public static function tryRon(array &$st, int $playerIdx): array {
        if ($st['awaiting'] !== 'naki_window' && $st['awaiting'] !== 'ron_chance') return ['ok' => false, 'msg' => '今はロン宣言できません'];
        if (!$st['last_discarded']) return ['ok' => false, 'msg' => '直前の捨牌がありません'];
        if ($st['last_discarded']['by'] === $playerIdx) return ['ok' => false, 'msg' => '自分の捨牌にはロンできません'];
        $p = $st['players'][$playerIdx];
        $testP = $p;
        $testP['hand'] = array_merge($p['hand'], [$st['last_discarded']['tile']]);
        sort($testP['hand']);
        $yaku = self::detectYaku($testP, false, $st, $playerIdx, $st['last_discarded']['tile']);
        if (empty($yaku['list'])) return ['ok' => false, 'msg' => '役がありません'];
        return ['ok' => true, 'win_type' => 'ron', 'yaku' => $yaku, 'from' => $st['last_discarded']['by'], 'tile' => $st['last_discarded']['tile']];
    }

    public static function isMenzen(array $p): bool {
        foreach ($p['melds'] as $m) {
            if ($m['type'] !== 'ankan') return false; // ankan は門前扱い
        }
        return true;
    }

    public static function isTenpai(array $hand, array $melds): bool {
        $hcount = count($hand);
        if ($hcount % 3 !== 1) return false; // 副露あり時の hand 数 = 13 - 3*n
        for ($t = 0; $t < self::TYPES; $t++) {
            $test = $hand; $test[] = $t; sort($test);
            if (self::findWinForms($test, count($melds))) return true;
        }
        return false;
    }

    public static function findWinForms(array $hand14, int $meldCount = 0): array {
        $forms = [];
        // 七対子 / 国士は 完全門前 (副露 0) のみ
        if ($meldCount === 0) {
            if (self::isChiitoitsu($hand14)) $forms[] = ['kind' => 'chiitoitsu'];
            if (self::isKokushi($hand14)) $forms[] = ['kind' => 'kokushi'];
        }
        // 4 面子 + 1 雀頭 = 副露 n 個 + 手から (4-n) 面子 + 雀頭
        $cnt = self::count34($hand14);
        for ($t = 0; $t < self::TYPES; $t++) {
            if ($cnt[$t] >= 2) {
                $c2 = $cnt; $c2[$t] -= 2;
                $melds = self::extractMelds($c2, 0);
                if ($melds !== null) {
                    if (count($melds) === 4 - $meldCount) {
                        $forms[] = ['kind' => 'standard', 'pair' => $t, 'melds' => $melds];
                    }
                }
            }
        }
        return $forms;
    }

    private static function extractMelds(array $cnt, int $start): ?array {
        for ($t = $start; $t < self::TYPES; $t++) {
            if ($cnt[$t] === 0) continue;
            if ($cnt[$t] >= 3) {
                $c2 = $cnt; $c2[$t] -= 3;
                $rest = self::extractMelds($c2, $t);
                if ($rest !== null) return array_merge([['kind' => 'kotsu', 'tile' => $t]], $rest);
            }
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
        foreach ($cnt as $c) { if ($c === 2) $pairs++; elseif ($c !== 0) return false; }
        return $pairs === 7;
    }

    private static function isKokushi(array $hand14): bool {
        $yaochuu = [0,8,9,17,18,26,27,28,29,30,31,32,33];
        $cnt = self::count34($hand14);
        $has = 0; $pair = false;
        foreach ($yaochuu as $t) { if ($cnt[$t] >= 1) $has++; if ($cnt[$t] === 2) $pair = true; }
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

    public static function seatWind(int $playerIdx, int $oya): int {
        return self::T_E + (($playerIdx - $oya + self::SEATS) % self::SEATS);
    }

    // 役判定 + ドラ加算 + 翻数集計
    public static function detectYaku(array $p, bool $isTsumo, array $st, int $playerIdx, ?int $winTile): array {
        $hand = $p['hand'];
        $melds = $p['melds'];
        $meldCount = count($melds);
        $isMenzen = self::isMenzen($p);
        $roundWind = $st['round_wind'];
        $seatWind = self::seatWind($playerIdx, $st['oya']);
        $forms = self::findWinForms($hand, $meldCount);
        if (!$forms) return ['list' => [], 'han' => 0];
        $best = ['list' => [], 'han' => 0, 'is_yakuman' => false, 'dora' => 0, 'aka' => 0, 'uradora' => 0];
        foreach ($forms as $form) {
            $y = self::yakuOfForm($form, $hand, $melds, $isMenzen, $isTsumo, $st, $playerIdx, $winTile, $roundWind, $seatWind);
            $score = $y['han'] + ($y['is_yakuman'] ? 1000 : 0);
            $bs = $best['han'] + ($best['is_yakuman'] ? 1000 : 0);
            if ($score > $bs) $best = $y;
        }
        // ドラ加算 (役満なら加算なし)
        if (!$best['is_yakuman'] && !empty($best['list'])) {
            $dora = self::countDora($p, $st);
            $aka = $p['hand_reds'] + array_sum(array_map(fn($m) => self::redsInMeld($m, $st), $melds));
            $uradora = $p['riichi'] ? self::countUradora($p, $st) : 0;
            $best['dora'] = $dora;
            $best['aka'] = $aka;
            $best['uradora'] = $uradora;
            $best['han'] += $dora + $aka + $uradora;
            if ($dora > 0) $best['list'][] = "ドラ$dora";
            if ($aka > 0) $best['list'][] = "赤$aka";
            if ($uradora > 0) $best['list'][] = "裏ドラ$uradora";
        }
        return $best;
    }

    private static function countDora(array $p, array $st): int {
        $tiles = array_merge($p['hand'], ...array_map(fn($m) => $m['tiles'], $p['melds']));
        $cnt = self::count34($tiles);
        $dora = 0;
        foreach ($st['dora_indicators'] as $ind) {
            $doraTile = self::nextTile($ind);
            $dora += $cnt[$doraTile];
        }
        return $dora;
    }
    private static function countUradora(array $p, array $st): int {
        $tiles = array_merge($p['hand'], ...array_map(fn($m) => $m['tiles'], $p['melds']));
        $cnt = self::count34($tiles);
        $dora = 0;
        foreach ($st['uradora_indicators'] as $ind) {
            $doraTile = self::nextTile($ind);
            $dora += $cnt[$doraTile];
        }
        return $dora;
    }
    private static function nextTile(int $t): int {
        if ($t < 9)  return ($t === 8)  ? 0  : $t + 1;
        if ($t < 18) return ($t === 17) ? 9  : $t + 1;
        if ($t < 27) return ($t === 26) ? 18 : $t + 1;
        if ($t < 31) return self::T_E + (($t - self::T_E + 1) % 4);
        // 三元: 白→發→中→白
        $order = [self::T_HAKU, self::T_HATSU, self::T_CHUN];
        $idx = array_search($t, $order, true);
        return $order[($idx + 1) % 3];
    }
    private static function redsInMeld(array $m, array $st): int {
        // 副露時の赤ドラ判定は省略 (簡略: 0 として扱う)。 自摸 / 鳴き時の deck index を保持していないため。
        return 0;
    }

    private static function yakuOfForm(array $form, array $hand14, array $melds, bool $isMenzen, bool $isTsumo, array $st, int $playerIdx, ?int $winTile, int $roundWind, int $seatWind): array {
        $list = []; $han = 0;
        $p = $st['players'][$playerIdx];

        if ($form['kind'] === 'kokushi') {
            // 国士無双 13面待ち判定 (winTile が pair になっているかで簡易判別)
            return ['list' => ['国士無双'], 'han' => 13, 'is_yakuman' => true];
        }
        if ($form['kind'] === 'chiitoitsu') {
            if (!$isMenzen) return ['list' => [], 'han' => 0, 'is_yakuman' => false]; // 七対子は門前のみ
            $list[] = '七対子'; $han += 2;
            $cnt = self::count34($hand14);
            $tanyao = true;
            foreach ([0,8,9,17,18,26,27,28,29,30,31,32,33] as $i) if ($cnt[$i] > 0) { $tanyao = false; break; }
            if ($tanyao) { $list[] = 'タンヤオ'; $han++; }
            $allHonor = true;
            for ($i = 0; $i < self::TYPES; $i++) if ($cnt[$i] > 0 && $i < 27) { $allHonor = false; break; }
            if ($allHonor) return ['list' => ['字一色'], 'han' => 13, 'is_yakuman' => true];
            $suits = self::suitsUsed($cnt);
            if ($suits['n_num_suits'] === 1 && !$suits['has_honor']) { $list[] = '清一色'; $han += 6; }
            elseif ($suits['n_num_suits'] === 1 && $suits['has_honor']) { $list[] = '混一色'; $han += 3; }
            if ($p['riichi']) {
                $list[] = $p['double_riichi'] ? 'ダブルリーチ' : 'リーチ';
                $han += $p['double_riichi'] ? 2 : 1;
                if ($p['ippatsu']) { $list[] = '一発'; $han++; }
            }
            if ($isTsumo) { $list[] = '門前清自摸和'; $han++; }
            return ['list' => $list, 'han' => $han, 'is_yakuman' => false];
        }

        $pair = $form['pair'];
        $formMelds = $form['melds'];
        $allMelds = array_merge($formMelds, array_map(fn($m) => [
            'kind' => $m['type'] === 'chi' ? 'shuntsu' : 'kotsu',
            'tile' => $m['type'] === 'chi' ? min($m['tiles']) : $m['tile'],
            'open' => true,
        ], $melds));
        $cnt = self::count34(array_merge($hand14, ...array_map(fn($m) => $m['tiles'], $melds)));

        // 役満チェック
        $hakuK = self::meldsHasKotsu($allMelds, self::T_HAKU);
        $hatsuK = self::meldsHasKotsu($allMelds, self::T_HATSU);
        $chunK = self::meldsHasKotsu($allMelds, self::T_CHUN);
        if ($hakuK && $hatsuK && $chunK) return ['list' => ['大三元'], 'han' => 13, 'is_yakuman' => true];
        // 小三元: 雀頭 + 三元のうち 2 つ刻子 / 残り 1 つ刻子 → 大三元優先
        $eastK = self::meldsHasKotsu($allMelds, self::T_E);
        $southK = self::meldsHasKotsu($allMelds, self::T_S);
        $westK = self::meldsHasKotsu($allMelds, self::T_W);
        $northK = self::meldsHasKotsu($allMelds, self::T_N);
        $kazeKCount = (int)$eastK + (int)$southK + (int)$westK + (int)$northK;
        if ($kazeKCount === 4) return ['list' => ['大四喜'], 'han' => 26, 'is_yakuman' => true];
        // 字一色
        $allHonorTiles = true;
        for ($i = 0; $i < self::TYPES; $i++) if ($cnt[$i] > 0 && $i < 27) { $allHonorTiles = false; break; }
        if ($allHonorTiles) return ['list' => ['字一色'], 'han' => 13, 'is_yakuman' => true];
        // 緑一色
        $green = [19,20,21,23,25, self::T_HATSU];
        $isGreen = true;
        for ($i = 0; $i < self::TYPES; $i++) if ($cnt[$i] > 0 && !in_array($i, $green, true)) { $isGreen = false; break; }
        if ($isGreen) return ['list' => ['緑一色'], 'han' => 13, 'is_yakuman' => true];
        // 四暗刻 (門前のみ)
        if ($isMenzen) {
            $allConcealedKotsu = true;
            foreach ($formMelds as $m) if ($m['kind'] !== 'kotsu') { $allConcealedKotsu = false; break; }
            $openKotsuCount = 0;
            foreach ($melds as $m) if (in_array($m['type'], ['ankan'], true)) $openKotsuCount++;
            $totalKotsu = 0;
            foreach ($formMelds as $m) if ($m['kind'] === 'kotsu') $totalKotsu++;
            $totalKotsu += $openKotsuCount;
            if ($isMenzen && $totalKotsu === 4) return ['list' => ['四暗刻'], 'han' => 13, 'is_yakuman' => true];
        }
        // 九蓮宝燈 (門前清一色 1112345678999 待ち)
        if ($isMenzen) {
            $suit = self::suitsUsed($cnt);
            if ($suit['n_num_suits'] === 1 && !$suit['has_honor']) {
                $base = 0;
                if ($cnt[9]  > 0) $base = 9;
                elseif ($cnt[18] > 0) $base = 18;
                $pattern = [3,1,1,1,1,1,1,1,3];
                $matches = true;
                for ($i = 0; $i < 9; $i++) if ($cnt[$base + $i] < $pattern[$i]) { $matches = false; break; }
                if ($matches) return ['list' => ['九蓮宝燈'], 'han' => 13, 'is_yakuman' => true];
            }
        }

        // 通常役 (役満以外)
        if ($p['riichi']) {
            $list[] = $p['double_riichi'] ? 'ダブルリーチ' : 'リーチ';
            $han += $p['double_riichi'] ? 2 : 1;
            if ($p['ippatsu']) { $list[] = '一発'; $han++; }
        }
        if ($isMenzen && $isTsumo) { $list[] = '門前清自摸和'; $han++; }
        // タンヤオ
        $allSimple = true;
        foreach ([0,8,9,17,18,26,27,28,29,30,31,32,33] as $yt) if ($cnt[$yt] > 0) { $allSimple = false; break; }
        if ($allSimple) { $list[] = 'タンヤオ'; $han++; }
        // 役牌
        foreach ([self::T_HAKU => '白', self::T_HATSU => '發', self::T_CHUN => '中'] as $tt => $name) {
            if (self::meldsHasKotsu($allMelds, $tt)) { $list[] = "役牌($name)"; $han++; }
        }
        if (self::meldsHasKotsu($allMelds, $roundWind)) {
            $list[] = '役牌(場風)'; $han++;
        }
        if (self::meldsHasKotsu($allMelds, $seatWind) && $seatWind !== $roundWind) {
            $list[] = '役牌(自風)'; $han++;
        }
        // 平和 (門前 + 全順子 + 役牌でない雀頭 + 両面待ち)
        if ($isMenzen && self::isPinfu($form, $melds, $roundWind, $seatWind, $winTile)) {
            $list[] = '平和'; $han++;
        }
        // 一気通貫
        foreach ([0, 9, 18] as $base) {
            $hasA = false; $hasB = false; $hasC = false;
            foreach ($allMelds as $m) {
                if ($m['kind'] !== 'shuntsu') continue;
                if ($m['tile'] === $base) $hasA = true;
                if ($m['tile'] === $base + 3) $hasB = true;
                if ($m['tile'] === $base + 6) $hasC = true;
            }
            if ($hasA && $hasB && $hasC) {
                $list[] = '一気通貫'; $han += $isMenzen ? 2 : 1; break;
            }
        }
        // 三色同順
        $sStarts = []; foreach ($allMelds as $m) if ($m['kind'] === 'shuntsu') $sStarts[] = $m['tile'];
        for ($n = 0; $n <= 6; $n++) {
            if (in_array($n, $sStarts, true) && in_array($n + 9, $sStarts, true) && in_array($n + 18, $sStarts, true)) {
                $list[] = '三色同順'; $han += $isMenzen ? 2 : 1; break;
            }
        }
        // 三色同刻
        $kStarts = []; foreach ($allMelds as $m) if ($m['kind'] === 'kotsu') $kStarts[] = $m['tile'];
        for ($n = 0; $n <= 8; $n++) {
            if (in_array($n, $kStarts, true) && in_array($n + 9, $kStarts, true) && in_array($n + 18, $kStarts, true)) {
                $list[] = '三色同刻'; $han += 2; break;
            }
        }
        // 対々和: 全 刻子
        $allKotsu = true;
        foreach ($allMelds as $m) if ($m['kind'] !== 'kotsu') { $allKotsu = false; break; }
        if ($allKotsu) { $list[] = '対々和'; $han += 2; }
        // 三暗刻 (form 内の刻子で 暗刻 数)
        $ankoCount = 0;
        foreach ($formMelds as $m) if ($m['kind'] === 'kotsu') $ankoCount++;
        foreach ($melds as $m) if ($m['type'] === 'ankan') $ankoCount++;
        if ($ankoCount === 3) { $list[] = '三暗刻'; $han += 2; }
        // 三色同順は上で計上済
        // 混一色 / 清一色
        $suits = self::suitsUsed($cnt);
        if ($suits['n_num_suits'] === 1 && !$suits['has_honor']) { $list[] = '清一色'; $han += $isMenzen ? 6 : 5; }
        elseif ($suits['n_num_suits'] === 1 && $suits['has_honor']) { $list[] = '混一色'; $han += $isMenzen ? 3 : 2; }
        // 混老頭: 全 yaochuu
        $allYaochuu = true;
        foreach ([0,8,9,17,18,26,27,28,29,30,31,32,33] as $yt) {
            // 全 tiles が yaochuu のみ で構成されている?
        }
        $onlyYaochuu = true;
        for ($i = 0; $i < self::TYPES; $i++) {
            if ($cnt[$i] > 0 && !in_array($i, [0,8,9,17,18,26,27,28,29,30,31,32,33], true)) { $onlyYaochuu = false; break; }
        }
        if ($onlyYaochuu) { $list[] = '混老頭'; $han += 2; }
        // 純全帯么九 / 混全帯么九 簡略 skip

        return ['list' => $list, 'han' => $han, 'is_yakuman' => false];
    }

    private static function isPinfu(array $form, array $exposedMelds, int $roundWind, int $seatWind, ?int $winTile): bool {
        // 門前 + 全 順子 + 役牌でない雀頭 + 両面待ち
        if (count($exposedMelds) > 0) return false;
        $pair = $form['pair'];
        if (in_array($pair, [self::T_HAKU, self::T_HATSU, self::T_CHUN, $roundWind, $seatWind], true)) return false;
        foreach ($form['melds'] as $m) if ($m['kind'] !== 'shuntsu') return false;
        // 両面待ち: winTile が 順子のどれかの端 (n, n+1 → n+2 か n-1 を引いた) かつ 端でない
        if ($winTile === null) return true; // ツモなら tsumo 計算なので両面待ちは省略 (簡略)
        foreach ($form['melds'] as $m) {
            $base = $m['tile'];
            // 順子 [base, base+1, base+2]
            if ($winTile === $base + 2 && ($base % 9) <= 5) return true; // 上端待ち (両面)
            if ($winTile === $base && ($base % 9) >= 1) return true; // 下端待ち (両面)
        }
        return false;
    }

    private static function meldsHasKotsu(array $melds, int $tile): bool {
        foreach ($melds as $m) if ($m['kind'] === 'kotsu' && $m['tile'] === $tile) return true;
        return false;
    }

    private static function suitsUsed(array $cnt34): array {
        $numSuits = [false, false, false];
        $hasHonor = false;
        for ($i = 0; $i < self::TYPES; $i++) {
            if ($cnt34[$i] === 0) continue;
            if ($i < 9) $numSuits[0] = true;
            elseif ($i < 18) $numSuits[1] = true;
            elseif ($i < 27) $numSuits[2] = true;
            else $hasHonor = true;
        }
        $n = array_sum(array_map('intval', $numSuits));
        return ['n_num_suits' => $n, 'has_honor' => $hasHonor];
    }

    public static function calcScore(array $yaku, bool $isOya, bool $isTsumo, int $honba = 0): array {
        $han = $yaku['han'];
        $isYakuman = !empty($yaku['is_yakuman']);
        $base = 0;
        if ($isYakuman) {
            $base = 8000 * (int)max(1, ceil(($han) / 13));
            $base = min($base, 8000 * 4); // 役満複合は ×4 まで
        } else {
            if ($han >= 13) $base = 8000;
            elseif ($han >= 11) $base = 6000;
            elseif ($han >= 8) $base = 4000;
            elseif ($han >= 6) $base = 3000;
            elseif ($han >= 5) $base = 2000;
            elseif ($han === 4) $base = 1500;
            elseif ($han === 3) $base = 1000;
            elseif ($han === 2) $base = 700;
            elseif ($han === 1) $base = 400;
        }
        $honbaBonus = 300 * $honba;
        if ($isOya) {
            if ($isTsumo) return ['from_all' => self::ceil100($base * 2 + $honbaBonus / 3), 'total' => self::ceil100($base * 2) * 3 + $honbaBonus];
            else          return ['from_loser' => self::ceil100($base * 6) + $honbaBonus, 'total' => self::ceil100($base * 6) + $honbaBonus];
        } else {
            if ($isTsumo) return ['from_oya' => self::ceil100($base * 2 + $honbaBonus / 3), 'from_others' => self::ceil100($base + $honbaBonus / 3), 'total' => self::ceil100($base * 2) + self::ceil100($base) * 2 + $honbaBonus];
            else          return ['from_loser' => self::ceil100($base * 4) + $honbaBonus, 'total' => self::ceil100($base * 4) + $honbaBonus];
        }
    }
    private static function ceil100($x): int {
        return (int)(ceil($x / 100) * 100);
    }

    public static function tileChar(int $t): string {
        if ($t < 9)   return mb_chr(0x1F007 + $t, 'UTF-8');
        if ($t < 18)  return mb_chr(0x1F019 + ($t - 9), 'UTF-8');
        if ($t < 27)  return mb_chr(0x1F010 + ($t - 18), 'UTF-8');
        if ($t < 31)  return mb_chr(0x1F000 + ($t - 27), 'UTF-8');
        if ($t === self::T_HAKU)  return mb_chr(0x1F006, 'UTF-8');
        if ($t === self::T_HATSU) return mb_chr(0x1F005, 'UTF-8');
        if ($t === self::T_CHUN)  return mb_chr(0x1F004, 'UTF-8');
        return '?';
    }

    // 半荘判定: 東1〜南4 = round_index 0..7
    public static function isHanchanEnd(array $st): bool {
        return $st['round_index'] >= 8;
    }

    // 流局時テンパイ料分配
    public static function ryukyokuPayout(array &$st): void {
        $tenpai = [];
        $noten = [];
        foreach ($st['players'] as $i => $p) {
            if (self::isTenpai($p['hand'], $p['melds'])) $tenpai[] = $i;
            else $noten[] = $i;
        }
        if (count($tenpai) > 0 && count($noten) > 0) {
            $total = self::TENPAI_POT;
            $perNoten = $total / count($noten);
            $perTenpai = $total / count($tenpai);
            foreach ($noten as $i) $st['players'][$i]['score'] -= (int)$perNoten;
            foreach ($tenpai as $i) $st['players'][$i]['score'] += (int)$perTenpai;
        }
        $st['log'][] = ['type' => 'ryukyoku', 'tenpai' => $tenpai, 'noten' => $noten];
        $st['phase'] = 'kyoku_end';
        $st['ryukyoku_tenpai_oya'] = in_array($st['oya'], $tenpai, true);
    }
}
