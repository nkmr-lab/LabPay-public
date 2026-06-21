<?php
// Achievements: derived from existing tables (no separate achievement-state storage).
// Compute per user on demand. Each category has 4 tiers; once a user's measured value
// crosses a tier threshold they have "earned" that tier. Higher tiers stack on top.

declare(strict_types=1);

class Achievements {
    // Each tier: ['count' => threshold, 'label' => display, 'medal' => icon].
    // 各カテゴリで 段位名は 「軽い」 → 「極端」 に エスカレートする。 medal は 段位の
    // 視覚的 強さを 統一 (🥉/🥈/🥇/💎) で 揃える。 ラベルだけ category 固有。
    public const DEFS = [
        'checkin_total' => [
            'title' => 'ラボイン マスター',
            'desc'  => '通算でラボインした日数',
            'unit'  => '日',
            'icon'  => '📅',
            'tiers' => [
                ['count' => 10,  'label' => 'お試し気分',     'medal' => '🥉'],
                ['count' => 50,  'label' => 'ラボの常連',     'medal' => '🥈'],
                ['count' => 150, 'label' => '住んでる人',     'medal' => '🥇'],
                ['count' => 365, 'label' => 'ラボに生まれた説','medal' => '💎'],
            ],
        ],
        'streak_best' => [
            'title' => '皆勤の鬼',
            'desc'  => '連続ラボインの最長記録',
            'unit'  => '日連続',
            'icon'  => '🔥',
            'tiers' => [
                ['count' => 5,  'label' => '三日坊主すれすれ', 'medal' => '🥉'],
                ['count' => 10, 'label' => '習慣化フェーズ',   'medal' => '🥈'],
                ['count' => 20, 'label' => 'もう体の一部',     'medal' => '🥇'],
                ['count' => 50, 'label' => 'ラボに溶けた',     'medal' => '💎'],
            ],
        ],
        'unique_listings' => [
            'title' => '品揃え自慢',
            'desc'  => '出品した異なる商品 (JAN) の種類',
            'unit'  => '種類',
            'icon'  => '📦',
            'tiers' => [
                ['count' => 3,  'label' => 'コンビニ気取り', 'medal' => '🥉'],
                ['count' => 10, 'label' => '謎の小売店',     'medal' => '🥈'],
                ['count' => 30, 'label' => '百貨店オーナー', 'medal' => '🥇'],
                ['count' => 70, 'label' => '商社マン',       'medal' => '💎'],
            ],
        ],
        'purchases_count' => [
            'title' => 'ショッピング常連',
            'desc'  => '購入した個数',
            'unit'  => '個',
            'icon'  => '🛒',
            'tiers' => [
                ['count' => 5,   'label' => '衝動買い癖',       'medal' => '🥉'],
                ['count' => 25,  'label' => 'カゴ大量買い',     'medal' => '🥈'],
                ['count' => 100, 'label' => '常連バイヤー',     'medal' => '🥇'],
                ['count' => 500, 'label' => 'ラボ経済を回す者', 'medal' => '💎'],
            ],
        ],
        'sales_count' => [
            'title' => '販売王',
            'desc'  => '売れた個数 (販売実績)',
            'unit'  => '個',
            'icon'  => '💰',
            'tiers' => [
                ['count' => 5,   'label' => 'フリマ初出店',   'medal' => '🥉'],
                ['count' => 25,  'label' => '内職副業',       'medal' => '🥈'],
                ['count' => 100, 'label' => '個人事業主',     'medal' => '🥇'],
                ['count' => 500, 'label' => 'ラボの大商人',   'medal' => '💎'],
            ],
        ],
        'turnover_spent' => [
            'title' => '太っ腹',
            'desc'  => '累計購入額',
            'unit'  => 'pt',
            'icon'  => '🎁',
            'tiers' => [
                ['count' => 500,   'label' => 'お金が逃げていく', 'medal' => '🥉'],
                ['count' => 2000,  'label' => '貢ぎ癖',           'medal' => '🥈'],
                ['count' => 10000, 'label' => 'ATM 人間',         'medal' => '🥇'],
                ['count' => 50000, 'label' => 'ラボ経済の供血者', 'medal' => '💎'],
            ],
        ],
        'turnover_earned' => [
            'title' => '名物バイヤー',
            'desc'  => '累計販売額 (手数料前)',
            'unit'  => 'pt',
            'icon'  => '🏪',
            'tiers' => [
                ['count' => 500,   'label' => 'お小遣い稼ぎ',     'medal' => '🥉'],
                ['count' => 2000,  'label' => '副収入族',         'medal' => '🥈'],
                ['count' => 10000, 'label' => 'お金が舞い込む',   'medal' => '🥇'],
                ['count' => 50000, 'label' => 'ラボの大富豪',     'medal' => '💎'],
            ],
        ],
        'tasks_completed' => [
            'title' => 'お助けマン',
            'desc'  => '承認されたタスクの数 (貢献度)',
            'unit'  => '件',
            'icon'  => '🤝',
            'tiers' => [
                ['count' => 3,   'label' => 'お手伝い見習い', 'medal' => '🥉'],
                ['count' => 15,  'label' => '便利屋',         'medal' => '🥈'],
                ['count' => 50,  'label' => '頼られる人',     'medal' => '🥇'],
                ['count' => 150, 'label' => 'ラボの救世主',   'medal' => '💎'],
            ],
        ],
        'scrapbox_days' => [
            'title' => 'メモ魔',
            'desc'  => 'Scrapbox を更新した累計日数',
            'unit'  => '日',
            'icon'  => '📝',
            'tiers' => [
                ['count' => 10,  'label' => '思いつきメモ魔', 'medal' => '🥉'],
                ['count' => 50,  'label' => '日記マニア',     'medal' => '🥈'],
                ['count' => 150, 'label' => '歴史家',         'medal' => '🥇'],
                ['count' => 365, 'label' => 'ラボの語り部',   'medal' => '💎'],
            ],
        ],
        'roulettes_spun' => [
            'title' => 'ルーレット主催',
            'desc'  => 'あなたが回したルーレットの回数',
            'unit'  => '回',
            'icon'  => '🎰',
            'tiers' => [
                ['count' => 3,   'label' => '運試し趣味',     'medal' => '🥉'],
                ['count' => 15,  'label' => '主催ジャンキー', 'medal' => '🥈'],
                ['count' => 50,  'label' => 'カジノオーナー', 'medal' => '🥇'],
                ['count' => 150, 'label' => '運命の主宰者',   'medal' => '💎'],
            ],
        ],
        'roulettes_won' => [
            'title' => '運命の人',
            'desc'  => 'ルーレットで選ばれた回数',
            'unit'  => '回',
            'icon'  => '🎯',
            'tiers' => [
                ['count' => 1,  'label' => 'ビギナーズラック',     'medal' => '🥉'],
                ['count' => 5,  'label' => '持ってる人',           'medal' => '🥈'],
                ['count' => 20, 'label' => '強運の塊',             'medal' => '🥇'],
                ['count' => 50, 'label' => '運命に愛された者',     'medal' => '💎'],
            ],
        ],
        // ── v351 追加 ──
        'night_use' => [
            'title' => '夜間ラボ族',
            'desc'  => '23:00〜25:00 に ラボにいた日数',
            'unit'  => '日',
            'icon'  => '🌙',
            'tiers' => [
                ['count' => 1,  'label' => 'たまの夜更かし',   'medal' => '🥉'],
                ['count' => 5,  'label' => '夜のラボ住民',     'medal' => '🥈'],
                ['count' => 20, 'label' => '闇属性',           'medal' => '🥇'],
                ['count' => 50, 'label' => '夜の支配者',       'medal' => '💎'],
            ],
        ],
        'early_bird' => [
            'title' => '早起きラボイン',
            'desc'  => '泊まりじゃなく 朝 7:00〜8:30 にラボにいた日数',
            'unit'  => '日',
            'icon'  => '🌅',
            'tiers' => [
                ['count' => 5,   'label' => 'ぼちぼち早起き',   'medal' => '🥉'],
                ['count' => 10,  'label' => '朝活上手',         'medal' => '🥈'],
                ['count' => 50,  'label' => '朝日と共に',       'medal' => '🥇'],
                ['count' => 100, 'label' => '朝の支配者',       'medal' => '💎'],
            ],
        ],
        'opener' => [
            'title' => 'ラボのオープナー',
            'desc'  => 'その日 最初にラボに入った日数 (前夜泊まりが居ない日に限る)',
            'unit'  => '日',
            'icon'  => '🔓',
            'tiers' => [
                ['count' => 2,  'label' => 'たまたま一番乗り',   'medal' => '🥉'],
                ['count' => 5,  'label' => '鍵開け人',           'medal' => '🥈'],
                ['count' => 20, 'label' => 'ラボの開門の番人',   'medal' => '🥇'],
                ['count' => 50, 'label' => 'ラボに朝を持ち込む者', 'medal' => '💎'],
            ],
        ],
        'closer' => [
            'title' => 'ラボのクローザー',
            'desc'  => 'その日 最後にラボを出た日数 (その夜の泊まりが居ない日に限る)',
            'unit'  => '日',
            'icon'  => '🌃',
            'tiers' => [
                ['count' => 2,  'label' => '最後にいた人',         'medal' => '🥉'],
                ['count' => 5,  'label' => '閉門の番人',           'medal' => '🥈'],
                ['count' => 20, 'label' => 'ラボに眠る者',         'medal' => '🥇'],
                ['count' => 50, 'label' => '闇に消えた最終者',     'medal' => '💎'],
            ],
        ],
        // v473 → v474 食べある記 (places アプリ) 関連 実績。 閾値 を 5/10/50/200 に。
        'places_added' => [
            'title' => '食べある記 投稿者',
            'desc'  => '食べある記 に 登録 した 店 の 数',
            'unit'  => '店',
            'icon'  => '🍴',
            'tiers' => [
                ['count' => 5,   'label' => '食べある記 デビュー', 'medal' => '🥉'],
                ['count' => 10,  'label' => 'グルメ リポーター',   'medal' => '🥈'],
                ['count' => 50,  'label' => '食通',                 'medal' => '🥇'],
                ['count' => 200, 'label' => '中野 食べ尽くし',     'medal' => '💎'],
            ],
        ],
        'places_reviewed' => [
            'title' => '口コミの 達人',
            'desc'  => '食べある記 で 書いた 口コミ の 数',
            'unit'  => '件',
            'icon'  => '💬',
            'tiers' => [
                ['count' => 5,   'label' => '口コミ 初心者',       'medal' => '🥉'],
                ['count' => 10,  'label' => 'マメな レビュアー',   'medal' => '🥈'],
                ['count' => 50,  'label' => 'グルメ評論家',         'medal' => '🥇'],
                ['count' => 200, 'label' => '食 の 賢者',           'medal' => '💎'],
            ],
        ],
        // v480 アクティビティ系 実績
        'rollcalls_created' => [
            'title' => '点呼隊長',
            'desc'  => '点呼 を 起案 した 回数',
            'unit'  => '回',
            'icon'  => '📣',
            'tiers' => [
                ['count' => 1,   'label' => 'みんな いる？',         'medal' => '🥉'],
                ['count' => 10,  'label' => '出席係',                 'medal' => '🥈'],
                ['count' => 50,  'label' => '点呼マスター',           'medal' => '🥇'],
                ['count' => 200, 'label' => 'ラボの 総監督',         'medal' => '💎'],
            ],
        ],
        'sns_posts' => [
            'title' => 'つぶやき魔',
            'desc'  => 'ラボ SNS に 投稿 した 数',
            'unit'  => '投稿',
            'icon'  => '💬',
            'tiers' => [
                ['count' => 5,   'label' => 'たまの 一言',           'medal' => '🥉'],
                ['count' => 30,  'label' => 'おしゃべり',             'medal' => '🥈'],
                ['count' => 100, 'label' => 'タイムライン の 主',     'medal' => '🥇'],
                ['count' => 500, 'label' => 'つぶやき 教祖',         'medal' => '💎'],
            ],
        ],
        'sns_reactions_received' => [
            'title' => 'ラボの 人気者',
            'desc'  => '自分の SNS 投稿 に つけられた リアクション 数',
            'unit'  => '個',
            'icon'  => '❤️',
            'tiers' => [
                ['count' => 5,   'label' => 'チラ見せ',               'medal' => '🥉'],
                ['count' => 30,  'label' => 'みんなの 注目',           'medal' => '🥈'],
                ['count' => 100, 'label' => 'ラボの 推し',             'medal' => '🥇'],
                ['count' => 500, 'label' => 'バズり師',                'medal' => '💎'],
            ],
        ],
        'auctions_won' => [
            'title' => '落札王',
            'desc'  => 'オークション で 落札 した 回数',
            'unit'  => '回',
            'icon'  => '🏷',
            'tiers' => [
                ['count' => 1,   'label' => '初 落札',                'medal' => '🥉'],
                ['count' => 5,   'label' => '入札 中毒',              'medal' => '🥈'],
                ['count' => 20,  'label' => '落札王',                 'medal' => '🥇'],
                ['count' => 50,  'label' => '競売 のドン',            'medal' => '💎'],
            ],
        ],
        'timers_created' => [
            'title' => '時間 管理人',
            'desc'  => 'タイマー を 起案 した 数 (= 学会発表 タイマー / ポモドーロ など)',
            'unit'  => '本',
            'icon'  => '⏱',
            'tiers' => [
                ['count' => 3,   'label' => 'たまの ポモドーロ',     'medal' => '🥉'],
                ['count' => 20,  'label' => 'タイム キーパー',       'medal' => '🥈'],
                ['count' => 80,  'label' => '時間 管理人',           'medal' => '🥇'],
                ['count' => 300, 'label' => '時を 操る 者',           'medal' => '💎'],
            ],
        ],
        'playlists_created' => [
            'title' => 'ラボ DJ',
            'desc'  => 'プレイリスト を 作成 した 数',
            'unit'  => '枚',
            'icon'  => '🎵',
            'tiers' => [
                ['count' => 1,   'label' => '初 プレイリスト',       'medal' => '🥉'],
                ['count' => 5,   'label' => '選曲家',                 'medal' => '🥈'],
                ['count' => 20,  'label' => 'ラボ DJ',                'medal' => '🥇'],
                ['count' => 50,  'label' => 'ヘッドホン 教祖',       'medal' => '💎'],
            ],
        ],
        // v622 ビンゴ 実績
        'bingo_lines_total' => [
            'title' => 'ビンゴ 職人',
            'desc'  => '通算 ビンゴ ライン数 (横 / 縦 / 斜め の 合計、 週 を またいで 加算)',
            'unit'  => 'ライン',
            'icon'  => '🎯',
            'tiers' => [
                ['count' => 1,   'label' => '初 ビンゴ',           'medal' => '🥉'],
                ['count' => 5,   'label' => '揃え上手',             'medal' => '🥈'],
                ['count' => 20,  'label' => 'ビンゴ 職人',          'medal' => '🥇'],
                ['count' => 50,  'label' => 'ビンゴ の 化身',       'medal' => '💎'],
            ],
        ],
        'bingo_weeks_won' => [
            'title' => '週末 ビンゴ ハンター',
            'desc'  => 'ビンゴ を 1 ライン以上 達成 した 週 の 数',
            'unit'  => '週',
            'icon'  => '🗓',
            'tiers' => [
                ['count' => 1,   'label' => 'ビンゴ デビュー',     'medal' => '🥉'],
                ['count' => 4,   'label' => '月イチ ビンゴ',       'medal' => '🥈'],
                ['count' => 12,  'label' => '3 ヶ月 ビンゴ',       'medal' => '🥇'],
                ['count' => 30,  'label' => '半年 級 ビンゴ',      'medal' => '💎'],
            ],
        ],
        // v741 #288 BingoFit (着回しビンゴ) 実績
        'bingofit_lines_total' => [
            'title' => '着回し ビンゴ 職人',
            'desc'  => '着回しビンゴ の 通算 ライン数',
            'unit'  => 'ライン',
            'icon'  => '👕',
            'tiers' => [
                ['count' => 1,   'label' => '初 着回しビンゴ',      'medal' => '🥉'],
                ['count' => 5,   'label' => '揃える ファッション', 'medal' => '🥈'],
                ['count' => 20,  'label' => '着回し マスター',      'medal' => '🥇'],
                ['count' => 50,  'label' => 'ワードローブ の 化身','medal' => '💎'],
            ],
        ],
        'bingofit_weeks_won' => [
            'title' => '着回し 週次 ハンター',
            'desc'  => '着回しビンゴ を 1 ライン以上 達成 した 週 の 数',
            'unit'  => '週',
            'icon'  => '🗓',
            'tiers' => [
                ['count' => 1,   'label' => '着回し デビュー',     'medal' => '🥉'],
                ['count' => 4,   'label' => '月イチ 着回し',       'medal' => '🥈'],
                ['count' => 12,  'label' => '3 ヶ月 着回し',       'medal' => '🥇'],
                ['count' => 30,  'label' => '半年 級 着回し',      'medal' => '💎'],
            ],
        ],
        'bingofit_full_houses' => [
            'title' => 'フルハウス キング',
            'desc'  => '着回しビンゴ で 25 マス すべて 開けた 週 の 数 (毎日 違う服)',
            'unit'  => '週',
            'icon'  => '🌟',
            'tiers' => [
                ['count' => 1,  'label' => '初 フルハウス',    'medal' => '🥉'],
                ['count' => 3,  'label' => 'フルハウス 常連',  'medal' => '🥈'],
                ['count' => 10, 'label' => 'フルハウス マスター', 'medal' => '🥇'],
                ['count' => 25, 'label' => 'クローゼット の 神','medal' => '💎'],
            ],
        ],
        'bingofit_items_active' => [
            'title' => 'クローゼット の 厚み',
            'desc'  => '着回しビンゴ に 登録 された アクティブ 衣類 数',
            'unit'  => '着',
            'icon'  => '🧥',
            'tiers' => [
                ['count' => 10, 'label' => 'ミニマリスト',     'medal' => '🥉'],
                ['count' => 25, 'label' => '盤 が 作れる ライン', 'medal' => '🥈'],
                ['count' => 40, 'label' => 'おしゃれ さん',    'medal' => '🥇'],
                ['count' => 50, 'label' => '満員 クローゼット','medal' => '💎'],
            ],
        ],
    ];

    // Returns the user's current measured value for each achievement category.
    public static function valuesFor(PDO $pdo, int $userId): array {
        $out = [];

        $st = $pdo->prepare('SELECT COUNT(*) FROM checkins WHERE user_id=?');
        $st->execute([$userId]);
        $out['checkin_total'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT longest_streak FROM streaks WHERE user_id=?');
        $st->execute([$userId]);
        $row = $st->fetchColumn();
        $out['streak_best'] = $row === false ? 0 : (int)$row;

        $st = $pdo->prepare('SELECT COUNT(DISTINCT jan) FROM listings WHERE seller_user_id=?');
        $st->execute([$userId]);
        $out['unique_listings'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COALESCE(SUM(qty),0) FROM purchases WHERE buyer_user_id=?');
        $st->execute([$userId]);
        $out['purchases_count'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COALESCE(SUM(qty),0) FROM purchases WHERE seller_user_id=?');
        $st->execute([$userId]);
        $out['sales_count'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COALESCE(SUM(unit_price * qty),0) FROM purchases WHERE buyer_user_id=?');
        $st->execute([$userId]);
        $out['turnover_spent'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COALESCE(SUM(unit_price * qty),0) FROM purchases WHERE seller_user_id=?');
        $st->execute([$userId]);
        $out['turnover_earned'] = (int)$st->fetchColumn();

        $st = $pdo->prepare("SELECT COUNT(*) FROM task_claims WHERE user_id=? AND status='approved'");
        $st->execute([$userId]);
        $out['tasks_completed'] = (int)$st->fetchColumn();

        // Distinct days the user contributed to Scrapbox. scrapbox_awards has
        // (award_date, user_id) as its PK so a plain COUNT(*) is the day count.
        // Rewards consistency over bursts: 30 writes in one day = 1 day.
        $st = $pdo->prepare('SELECT COUNT(*) FROM scrapbox_awards WHERE user_id=?');
        $st->execute([$userId]);
        $out['scrapbox_days'] = (int)$st->fetchColumn();

        // Roulettes the user spun. dry-run spins never get a row, so the count
        // is naturally limited to real ones.
        $st = $pdo->prepare('SELECT COUNT(*) FROM roulettes WHERE creator_user_id=?');
        $st->execute([$userId]);
        $out['roulettes_spun'] = (int)$st->fetchColumn();

        // Times the user was selected as the winner.
        $st = $pdo->prepare('SELECT COUNT(*) FROM roulettes WHERE winner_user_id=?');
        $st->execute([$userId]);
        $out['roulettes_won'] = (int)$st->fetchColumn();

        // ── v351 (v356 で SQL 修正) ──
        // 夜間ラボ族: 夜 N (= 日付 N の 23:00 〜 N+1 の 01:00) に
        // ユーザの session が overlap する 夜 N の数。
        // MariaDB は INTERVAL の単位混合不可 (INTERVAL 8 HOUR + INTERVAL 30 MINUTE NG) →
        // 全部 INTERVAL N MINUTE に統一。 23h=1380, 25h=1500, 08:30=510, 07h=420, 02h=120, 05h=300。
        $st = $pdo->prepare("
            SELECT COUNT(DISTINCT d) FROM (
              SELECT DATE(ps.started_at) AS d FROM presence_sessions ps
               WHERE ps.user_id = ?
                 AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 1500 MINUTE)
                 AND ps.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 1380 MINUTE)
              UNION
              SELECT DATE_SUB(DATE(ps.started_at), INTERVAL 1 DAY) AS d FROM presence_sessions ps
               WHERE ps.user_id = ?
                 AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 60 MINUTE)
                 AND ps.ended_at   > DATE(ps.started_at)
            ) AS x");
        $st->execute([$userId, $userId]);
        $out['night_use'] = (int)$st->fetchColumn();

        // 早起き: D 07:00〜D 08:30 に presence あり AND D 02:00〜D 05:00 に presence なし
        // (= 泊まりじゃなく 朝来た日)。 全部 INTERVAL N MINUTE。
        $st = $pdo->prepare("
            SELECT COUNT(DISTINCT d) FROM (
              SELECT DATE(ps.started_at) AS d FROM presence_sessions ps
               WHERE ps.user_id = ?
                 AND ps.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 510 MINUTE)
                 AND ps.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 420 MINUTE)
                 AND NOT EXISTS (
                   SELECT 1 FROM presence_sessions ps2
                    WHERE ps2.user_id = ?
                      AND DATE(ps2.started_at) = DATE(ps.started_at)
                      AND ps2.started_at < DATE_ADD(DATE(ps.started_at), INTERVAL 300 MINUTE)
                      AND ps2.ended_at   > DATE_ADD(DATE(ps.started_at), INTERVAL 120 MINUTE)
                 )
            ) AS x");
        $st->execute([$userId, $userId]);
        $out['early_bird'] = (int)$st->fetchColumn();

        // オープナー: DATE(start) D について min(start) を取る user が 自分 AND 自分が
        // その日 0:00 を またぐセッションを 持っていない (= 自分が泊まりでなく 朝来た)。
        // v390 旧版は presence_sessions (閉じた) だけ見ていたが、 まだラボに居る人
        //      (今朝来て まだ session が閉じてない人) は presence_seen に open で
        //      残っていて 拾えなかった → UNION で 両方見るように。
        //      presence_seen の session_start_at を s、 last_seen_at を e として 扱う。
        $allSessionsSql = "
            SELECT user_id, started_at AS s, ended_at AS e
              FROM presence_sessions WHERE user_id IS NOT NULL
            UNION ALL
            SELECT pd.user_id, ps.session_start_at AS s, ps.last_seen_at AS e
              FROM presence_seen ps
              JOIN presence_devices pd ON pd.mac = ps.mac
             WHERE ps.session_start_at IS NOT NULL";

        $st = $pdo->prepare("
            SELECT COUNT(DISTINCT days.d) FROM (
              SELECT DATE(s) AS d, MIN(s) AS m FROM ({$allSessionsSql}) AS a1
              GROUP BY DATE(s)
            ) days
            JOIN ({$allSessionsSql}) AS me
              ON DATE(me.s) = days.d AND me.s = days.m AND me.user_id = ?
           WHERE NOT EXISTS (
             SELECT 1 FROM ({$allSessionsSql}) AS own
              WHERE own.user_id = ? AND own.s < days.d AND own.e > days.d
           )");
        $st->execute([$userId, $userId]);
        $out['opener'] = (int)$st->fetchColumn();

        // クローザー: DATE(end) D について max(end) を 取る user が 自分 AND 自分が
        // その夜 (D+1 00:00:00) を またぐセッションを 持っていない (= 自分が
        // 泊まりでなく 退社した)。 max(end) は 「閉じた end / 開きの last_seen」 を 両方 見る。
        $st = $pdo->prepare("
            SELECT COUNT(DISTINCT days.d) FROM (
              SELECT DATE(e) AS d, MAX(e) AS m FROM ({$allSessionsSql}) AS a2
              GROUP BY DATE(e)
            ) days
            JOIN ({$allSessionsSql}) AS me
              ON DATE(me.e) = days.d AND me.e = days.m AND me.user_id = ?
           WHERE NOT EXISTS (
             SELECT 1 FROM ({$allSessionsSql}) AS own
              WHERE own.user_id = ?
                AND own.s < DATE_ADD(days.d, INTERVAL 1 DAY)
                AND own.e > DATE_ADD(days.d, INTERVAL 1 DAY)
           )");
        $st->execute([$userId, $userId]);
        $out['closer'] = (int)$st->fetchColumn();

        // v473 食べある記 関連
        $st = $pdo->prepare('SELECT COUNT(*) FROM places WHERE creator_user_id = ?');
        $st->execute([$userId]);
        $out['places_added'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COUNT(*) FROM place_comments WHERE user_id = ?');
        $st->execute([$userId]);
        $out['places_reviewed'] = (int)$st->fetchColumn();

        // v480 アクティビティ系
        $st = $pdo->prepare('SELECT COUNT(*) FROM roll_calls WHERE creator_user_id = ? AND deleted_at IS NULL');
        $st->execute([$userId]);
        $out['rollcalls_created'] = (int)$st->fetchColumn();

        $st = $pdo->prepare("SELECT COUNT(*) FROM posts p JOIN users u ON u.id = p.user_id
                              WHERE p.user_id = ? AND u.kind = 'human'");
        $st->execute([$userId]);
        $out['sns_posts'] = (int)$st->fetchColumn();

        $st = $pdo->prepare("SELECT COUNT(*) FROM post_likes l
                              JOIN posts p ON p.id = l.post_id
                             WHERE p.user_id = ? AND l.user_id <> ?");
        $st->execute([$userId, $userId]);
        $out['sns_reactions_received'] = (int)$st->fetchColumn();

        // 落札 — auctions テーブル に winner_user_id 列 が ある と 仮定。 列が 無い 場合 は 0。
        try {
            $st = $pdo->prepare('SELECT COUNT(*) FROM auctions WHERE winner_user_id = ?');
            $st->execute([$userId]);
            $out['auctions_won'] = (int)$st->fetchColumn();
        } catch (Throwable $_) { $out['auctions_won'] = 0; }

        $st = $pdo->prepare('SELECT COUNT(*) FROM timers WHERE creator_user_id = ? AND deleted_at IS NULL');
        $st->execute([$userId]);
        $out['timers_created'] = (int)$st->fetchColumn();

        $st = $pdo->prepare('SELECT COUNT(*) FROM playlists WHERE creator_user_id = ?');
        $st->execute([$userId]);
        $out['playlists_created'] = (int)$st->fetchColumn();

        // v622 ビンゴ — 通算ライン数 + ビンゴ達成週数
        try {
            $st = $pdo->prepare('SELECT COALESCE(SUM(bingo_lines),0) FROM bingo_cards WHERE user_id=?');
            $st->execute([$userId]);
            $out['bingo_lines_total'] = (int)$st->fetchColumn();
            $st = $pdo->prepare('SELECT COUNT(*) FROM bingo_cards WHERE user_id=? AND bingo_lines >= 1');
            $st->execute([$userId]);
            $out['bingo_weeks_won'] = (int)$st->fetchColumn();
        } catch (Throwable $_) {
            $out['bingo_lines_total'] = 0;
            $out['bingo_weeks_won']   = 0;
        }

        // v741 #288 着回しビンゴ (BingoFit) 実績。 ライン数は cells_json/cell_opens から
        //   都度計算 (専用カラムは持たない)。
        $out['bingofit_lines_total']  = 0;
        $out['bingofit_weeks_won']    = 0;
        $out['bingofit_full_houses']  = 0;
        $out['bingofit_items_active'] = 0;
        try {
            $st = $pdo->prepare("SELECT COUNT(*) FROM bingofit_items WHERE user_id=? AND archived_at IS NULL");
            $st->execute([$userId]);
            $out['bingofit_items_active'] = (int)$st->fetchColumn();

            $st = $pdo->prepare("SELECT b.id, (SELECT COUNT(*) FROM bingofit_cell_opens o WHERE o.board_id=b.id) AS oc
                                   FROM bingofit_boards b WHERE b.user_id=?");
            $st->execute([$userId]);
            $linesSum = 0; $weeksWon = 0; $fullHouses = 0;
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $b) {
                $oc = (int)$b['oc'];
                if ($oc === 0) continue;
                $stO = $pdo->prepare("SELECT cell_index FROM bingofit_cell_opens WHERE board_id=?");
                $stO->execute([(int)$b['id']]);
                $opened = array_map('intval', $stO->fetchAll(PDO::FETCH_COLUMN));
                $lines = bingofit_count_lines($opened);
                $linesSum += $lines;
                if ($lines >= 1) $weeksWon++;
                if ($oc >= 25) $fullHouses++;
            }
            $out['bingofit_lines_total'] = $linesSum;
            $out['bingofit_weeks_won']   = $weeksWon;
            $out['bingofit_full_houses'] = $fullHouses;
        } catch (Throwable $_) { /* swallow — テーブル無い 環境 で 0 のまま */ }

        return $out;
    }

    // Augments values with per-achievement context: earned tier, next tier, progress percent.
    public static function reportFor(PDO $pdo, int $userId): array {
        $vals = self::valuesFor($pdo, $userId);
        $out = [];
        foreach (self::DEFS as $key => $def) {
            $value = $vals[$key] ?? 0;
            $earnedIdx = -1;     // -1 = none earned yet
            $nextIdx = null;
            foreach ($def['tiers'] as $i => $tier) {
                if ($value >= $tier['count']) {
                    $earnedIdx = $i;
                } elseif ($nextIdx === null) {
                    $nextIdx = $i;
                }
            }
            $earnedTier = $earnedIdx >= 0 ? $def['tiers'][$earnedIdx] : null;
            $nextTier   = $nextIdx !== null ? $def['tiers'][$nextIdx] : null;

            // Progress toward the next tier
            $progress = null;
            if ($nextTier) {
                $base = $earnedTier ? $earnedTier['count'] : 0;
                $span = max(1, $nextTier['count'] - $base);
                $progress = max(0.0, min(1.0, ($value - $base) / $span));
            }

            $out[] = [
                'key'         => $key,
                'title'       => $def['title'],
                'desc'        => $def['desc'],
                'unit'        => $def['unit'],
                'icon'        => $def['icon'] ?? '🏅',
                'value'       => $value,
                'tiers'       => $def['tiers'],
                'earned_tier' => $earnedIdx >= 0 ? $earnedIdx + 1 : 0,   // 1..N (0 = none)
                'earned'      => $earnedTier,
                'next'        => $nextTier,
                'next_progress' => $progress,
                'is_maxed'    => $nextTier === null,
            ];
        }
        return $out;
    }

    // v483 #76 AI 称号 生成 用。 現在 獲得 中 の tier ラベル を 1 行 ずつ 並べ
    //   ハッシュ + プロンプト 用 テキスト を 返す。
    public static function earnedSummary(PDO $pdo, int $userId): array {
        $report = self::reportFor($pdo, $userId);
        $lines = [];
        $hashItems = [];
        foreach ($report as $r) {
            if (!$r['earned']) continue;
            $cat = $r['title'];
            $tierLabel = $r['earned']['label'] ?? '';
            $medal = $r['earned']['medal'] ?? '';
            $lines[] = "- {$medal} 「{$tierLabel}」 ({$cat}, 通算 {$r['value']} {$r['unit']})";
            $hashItems[] = $r['key'] . ':' . $r['earned_tier'];
        }
        sort($hashItems);
        return [
            'lines' => $lines,
            'count' => count($lines),
            'hash'  => hash('sha1', implode('|', $hashItems)),
        ];
    }
}
