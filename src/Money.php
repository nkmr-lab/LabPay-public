<?php
// Money: integer-only point arithmetic. Fee = floor(price * rate), seller pays.

declare(strict_types=1);

class Money {
    // Returns [fee, seller_take, buyer_pay].
    // Invariant: buyer_pay == seller_take + fee. No rounding loss.
    public static function split(int $price, float $rate): array {
        if ($price <= 0) throw new InvalidArgumentException('price must be > 0');
        if ($rate < 0 || $rate >= 1) throw new InvalidArgumentException('rate out of range');
        $fee = (int)floor($price * $rate);
        $seller_take = $price - $fee;
        $buyer_pay   = $price;
        return [$fee, $seller_take, $buyer_pay];
    }

    public static function feeRate(PDO $pdo): float {
        $v = cfg_get($pdo, 'fee_rate', '0.05');
        $f = (float)$v;
        if ($f < 0 || $f >= 1) $f = 0.05;
        return $f;
    }
}
