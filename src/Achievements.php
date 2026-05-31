<?php
// Achievements: derived from existing tables (no separate achievement-state storage).
// Compute per user on demand. Each category has 4 tiers; once a user's measured value
// crosses a tier threshold they have "earned" that tier. Higher tiers stack on top.

declare(strict_types=1);

class Achievements {
    // Each tier: ['count' => threshold, 'label' => display, 'medal' => icon].
    public const DEFS = [
        'checkin_total' => [
            'title' => '来室マスター',
            'desc'  => '通算で来室した日数',
            'unit'  => '日',
            'tiers' => [
                ['count' => 10,  'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 50,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 150, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 365, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'streak_best' => [
            'title' => '皆勤の鬼',
            'desc'  => '連続来室の最長記録',
            'unit'  => '日連続',
            'tiers' => [
                ['count' => 5,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 10,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 30,  'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 100, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'unique_listings' => [
            'title' => '品揃え自慢',
            'desc'  => '出品した異なる商品 (JAN) の種類',
            'unit'  => '種類',
            'tiers' => [
                ['count' => 3,  'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 10, 'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 30, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 70, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'purchases_count' => [
            'title' => 'ショッピング常連',
            'desc'  => '購入した個数',
            'unit'  => '個',
            'tiers' => [
                ['count' => 5,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 25,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 100, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 500, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'sales_count' => [
            'title' => '販売王',
            'desc'  => '売れた個数 (販売実績)',
            'unit'  => '個',
            'tiers' => [
                ['count' => 5,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 25,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 100, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 500, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'turnover_spent' => [
            'title' => '太っ腹',
            'desc'  => '累計購入額',
            'unit'  => 'pt',
            'tiers' => [
                ['count' => 500,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 2000,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 10000, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 50000, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'turnover_earned' => [
            'title' => '名物バイヤー',
            'desc'  => '累計販売額 (手数料前)',
            'unit'  => 'pt',
            'tiers' => [
                ['count' => 500,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 2000,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 10000, 'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 50000, 'label' => 'プラチナ',   'medal' => '💎'],
            ],
        ],
        'tasks_completed' => [
            'title' => 'お助けマン',
            'desc'  => '承認されたタスクの数 (貢献度)',
            'unit'  => '件',
            'tiers' => [
                ['count' => 3,   'label' => 'ブロンズ',   'medal' => '🥉'],
                ['count' => 15,  'label' => 'シルバー',   'medal' => '🥈'],
                ['count' => 50,  'label' => 'ゴールド',   'medal' => '🥇'],
                ['count' => 150, 'label' => 'プラチナ',   'medal' => '💎'],
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
}
