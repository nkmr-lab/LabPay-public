<?php
// /api/public-codes — 公開機能 の 短縮 コード (v941)。
// pay.nkmr.io/#/public に 4 桁 数字 を 入力 → 対応 する 公開 URL に 飛ぶ。
// 現時点 で 使う のは joint-events だけ だが、 将来 public-timer や public-poll
// も 同じ テーブル に 相乗り できる 汎用 設計。

declare(strict_types=1);

function route_public_codes(PDO $pdo, array $cfg, string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    if ($sub !== '' && $method === 'GET') {
        public_codes_lookup($pdo, $cfg, $sub); return;
    }
    throw new ApiException('not_found', "no public-codes route for $method $sub", 404);
}

// 未認証で叩ける。 4 桁 コード → target_path を返す。
function public_codes_lookup(PDO $pdo, array $cfg, string $code): void {
    if (!preg_match('/^[0-9]{4,8}$/', $code)) {
        throw new ApiException('bad_request', '4-8 桁 の 数字', 400);
    }
    $st = $pdo->prepare("SELECT code, kind, ref_id, target_path FROM public_codes WHERE code = ?");
    $st->execute([$code]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new ApiException('not_found', 'コード が 見つかりません', 404);
    json_response($row);
}

// joint.php や 他 の 起案系 から 呼ぶ ヘルパ。 未使用 の 4 桁 コード を 割り当てて 挿入。
function public_codes_allocate(PDO $pdo, string $kind, int $refId, string $targetPath, int $userId): string {
    // 4 桁 数字 (1000-9999) を ランダム 生成。 衝突 したら 5 桁 → 6 桁 に 拡張。
    for ($digits = 4; $digits <= 8; $digits++) {
        $min = (int)str_pad('1', $digits, '0');            // 1000, 10000, ...
        $max = (int)str_pad('9', $digits, '9');
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $code = (string)random_int($min, $max);
            try {
                $ins = $pdo->prepare("INSERT INTO public_codes
                    (code, kind, ref_id, target_path, created_by_user_id) VALUES (?, ?, ?, ?, ?)");
                $ins->execute([$code, $kind, $refId, $targetPath, $userId]);
                return $code;
            } catch (PDOException $e) {
                // duplicate key = 別の code で リトライ
                if ((int)$e->errorInfo[1] !== 1062) throw $e;
            }
        }
        // 20 回 埋まってたら 桁数 拡張
    }
    throw new ApiException('server_error', 'コード 生成 失敗', 500);
}

// 既存の (kind, ref_id) 用 コード を 返す (無ければ null)。
function public_codes_lookup_by_ref(PDO $pdo, string $kind, int $refId): ?string {
    $st = $pdo->prepare("SELECT code FROM public_codes WHERE kind = ? AND ref_id = ? ORDER BY code LIMIT 1");
    $st->execute([$kind, $refId]);
    $c = $st->fetchColumn();
    return $c === false ? null : (string)$c;
}
