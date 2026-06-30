<?php
// v571 リファクタ: ゲーム共通の預託 / プレイフィー / 返金ロジックをまとめる。
//   mahjong / ito / jinrou が同じパターン (起案 → 参加 → buy_in 預託 → 開始 → ... →
//   終了 or cancel) を持っているので、残高チェック / Ledger 送金 / pot 更新を 1 か所に。
//
//   特性別の 2 モデル:
//     A. プール型 (mahjong): 預託 → 終了時に順位別 payout で戻る (一部は場代)
//     B. フィー型 (ito / jinrou): 預託 → 終了時に戻さない (lobby 中の cancel/leave のみ返金)
//
//   どちらも lobby 中の leave/cancel は全額返金。
declare(strict_types=1);

final class GameLobby {
    // 残高チェック (Ledger ベース)
    public static function assertBalance(PDO $pdo, int $uid, int $amount): void {
        $bal = Ledger::balanceOfUser($pdo, $uid);
        if ($bal < $amount) {
            throw new ApiException('insufficient_balance', sprintf('ポイント不足 (要 %d、現在 %d)', $amount, $bal), 400);
        }
    }

    // 預託 / フィー支払い: user → system に転送 + pot_total を加算
    //   $potTable: 加算対象テーブル名 ('mahjong_games' / 'ito_games' / 'jinrou_games')
    //   $potCol: 通常 'pot_total'
    //   $type: Ledger type (例: 'mahjong_buyin')
    //   $refType: 'mahjong' / 'ito' / 'jinrou'
    public static function depositToPot(PDO $pdo, int $gid, int $uid, int $amount, string $type, string $refType, string $potTable, string $memo): void {
        Ledger::transfer($pdo, $uid, 1, $amount, $type, $refType, $gid, $memo);
        $pdo->prepare("UPDATE {$potTable} SET pot_total = pot_total + ? WHERE id = ?")
            ->execute([$amount, $gid]);
    }

    // 返金: system → user に転送 + pot_total を減算
    public static function refundFromPot(PDO $pdo, int $gid, int $uid, int $amount, string $refType, string $potTable, string $memo): void {
        Ledger::transfer($pdo, 1, $uid, $amount, 'mahjong_refund', $refType, $gid, $memo);
        $pdo->prepare("UPDATE {$potTable} SET pot_total = pot_total - ? WHERE id = ?")
            ->execute([$amount, $gid]);
    }

    // pot からの payout (ゲーム終了時の順位別配分など)
    public static function payoutFromPot(PDO $pdo, int $gid, int $uid, int $amount, string $type, string $refType, string $memo): void {
        if ($amount <= 0) return;
        Ledger::transfer($pdo, 1, $uid, $amount, $type, $refType, $gid, $memo);
    }

    // 順位 → 配分 % テーブルから、 pot を 1 位から順に分配して payouts[rank] = amount を返す。
    //   例: $pot=200, $rakePct=5, $rankPcts=[1=>50, 2=>30, 3=>15, 4=>0]
    //   → 場代 10pt + 1位 100pt / 2位 60pt / 3位 30pt / 4位 0pt = 190pt 配分
    //   端数は 1 位に上乗せ。
    public static function calcRankPayouts(int $pot, int $rakePct, array $rankPcts): array {
        $rake = (int)floor($pot * $rakePct / 100);
        $payouts = [];
        $allocated = 0;
        $rankPctsSorted = $rankPcts;
        ksort($rankPctsSorted);
        $ranks = array_keys($rankPctsSorted);
        foreach ($ranks as $rank) {
            if ($rank === reset($ranks)) continue; // 1 位は後で端数調整
            $share = (int)floor($pot * $rankPctsSorted[$rank] / 100);
            $payouts[$rank] = $share;
            $allocated += $share;
        }
        $payouts[reset($ranks)] = $pot - $rake - $allocated;
        return ['payouts' => $payouts, 'rake' => $rake];
    }
}
