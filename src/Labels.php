<?php
// Labels: PHP 側で散らかってた小さな enum→表示文字列の辞書を 1 箇所に集約。
// JS 側 (public/js/views/*.js) は別途 const KIND_LBL / METHOD_LABEL を持つが、
// 値が 3-4 個と少なくサーバ↔クライアント往復させるほどではないので二重管理
// のまま許容している。新しい label を追加するときは両側を同時に更新する。

declare(strict_types=1);

class Labels {
    // /api/feedback の kind フィールド。投稿者/admin への通知本文に埋める。
    public const FEEDBACK_KIND = [
        'bug'     => '🐛 バグ報告',
        'feature' => '✨ 機能要望',
        'other'   => '💬 フィードバック',
    ];

    // /api/money-requests と /api/nomikai の paid_method。
    // 「{name} から ¥{amt} ({method}) 支払い済」みたいな通知に使う。
    public const PAYMENT_METHOD = [
        'cash'   => '現金',
        'paypay' => 'PayPay',
        'bank'   => '銀行振込',
        'proxy'  => '立替',
    ];

    public static function feedbackKind(string $k): string {
        return self::FEEDBACK_KIND[$k] ?? 'フィードバック';
    }

    public static function paymentMethod(string $m): string {
        return self::PAYMENT_METHOD[$m] ?? $m;
    }
}
