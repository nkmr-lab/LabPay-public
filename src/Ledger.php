<?php
// Ledger: the truth of money. Append-only entries; balance is computed by aggregation.
// All movements go through Ledger::transfer() inside a transaction with FOR UPDATE locks.

declare(strict_types=1);

class Ledger {
    public const TYPES = [
        'initial','checkin','purchase','fee','reversal',
        'transfer','task_reward','deposit','refund','burn',
        'scrapbox_reward','app_open_reward',
        // v557 #211 #209 拡張: 査読課金 + 麻雀
        'paper_review',
        // v583 #225 レジュメ原稿チェック
        'resume_check',
        'mahjong_buyin','mahjong_payout','mahjong_refund','mahjong_rake','mahjong_ai_payout',
        // v587 地雷オセロ
        'othello_buyin','othello_payout','othello_refund',
        // v590 大富豪
        'daifugo_buyin','daifugo_payout','daifugo_refund',
        // v613 リライター (文字数 / 単語数制限)
        'rewriter',
        // v617 自作ゲーム フレームワーク (v620 場代 rake 追加)
        'custom_game_buyin','custom_game_payout','custom_game_refund','custom_game_rake',
    ];

    // Resolve account id by user id. Caller must have started a transaction if locking.
    public static function accountIdForUser(PDO $pdo, int $userId, bool $forUpdate = false): int {
        $sql = 'SELECT id FROM accounts WHERE owner_user_id=?' . ($forUpdate ? ' FOR UPDATE' : '');
        $st = $pdo->prepare($sql);
        $st->execute([$userId]);
        $id = $st->fetchColumn();
        if ($id === false) throw new RuntimeException("no account for user_id=$userId");
        return (int)$id;
    }

    public static function accountIdByCode(PDO $pdo, string $code, bool $forUpdate = false): int {
        $sql = 'SELECT id FROM accounts WHERE code=?' . ($forUpdate ? ' FOR UPDATE' : '');
        $st = $pdo->prepare($sql);
        $st->execute([$code]);
        $id = $st->fetchColumn();
        if ($id === false) throw new RuntimeException("no special account: $code");
        return (int)$id;
    }

    public static function accountKind(PDO $pdo, int $accountId): string {
        $st = $pdo->prepare('SELECT kind FROM accounts WHERE id=?');
        $st->execute([$accountId]);
        $k = $st->fetchColumn();
        if ($k === false) throw new RuntimeException("no account id=$accountId");
        return (string)$k;
    }

    // Sum of credits − debits. Human accounts must stay >= 0.
    public static function balanceOf(PDO $pdo, int $accountId): int {
        $st = $pdo->prepare(
            'SELECT
                COALESCE((SELECT SUM(amount) FROM ledger WHERE to_account_id=?), 0)
              - COALESCE((SELECT SUM(amount) FROM ledger WHERE from_account_id=?), 0) AS bal'
        );
        $st->execute([$accountId, $accountId]);
        return (int)$st->fetchColumn();
    }

    public static function balanceOfUser(PDO $pdo, int $userId): int {
        return self::balanceOf($pdo, self::accountIdForUser($pdo, $userId));
    }

    // The single source of truth for moving points. Caller must hold a transaction.
    // Returns the new ledger.id.
    public static function transfer(
        PDO $pdo,
        int $fromAccountId,
        int $toAccountId,
        int $amount,
        string $type,
        ?string $refType = null,
        ?int $refId = null,
        ?string $memo = null,
        ?int $reversedOf = null
    ): int {
        if ($amount <= 0) throw new InvalidArgumentException('amount must be > 0');
        if (!in_array($type, self::TYPES, true)) throw new InvalidArgumentException("bad type: $type");
        if ($fromAccountId === $toAccountId) throw new InvalidArgumentException('from == to');

        // Lock both account rows (deterministic order to avoid deadlock).
        $ids = [$fromAccountId, $toAccountId];
        sort($ids);
        $st = $pdo->prepare('SELECT id, kind FROM accounts WHERE id IN (?,?) FOR UPDATE');
        $st->execute($ids);
        $rows = $st->fetchAll();
        if (count($rows) < 2) throw new RuntimeException('account row missing');

        $kinds = [];
        foreach ($rows as $r) $kinds[(int)$r['id']] = $r['kind'];

        // Human accounts cannot go negative. System/escrow may.
        if (($kinds[$fromAccountId] ?? null) === 'user') {
            $bal = self::balanceOf($pdo, $fromAccountId);
            if ($bal < $amount) {
                throw new ApiException('insufficient_funds',
                    "balance $bal < amount $amount", 402,
                    ['balance' => $bal, 'required' => $amount]);
            }
        }

        $ins = $pdo->prepare(
            'INSERT INTO ledger (from_account_id,to_account_id,amount,type,ref_type,ref_id,memo,reversed_of)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $ins->execute([$fromAccountId, $toAccountId, $amount, $type, $refType, $refId, $memo, $reversedOf]);
        return (int)$pdo->lastInsertId();
    }

    // Create a user account if absent. Returns account_id.
    public static function ensureUserAccount(PDO $pdo, int $userId): int {
        $st = $pdo->prepare('SELECT id FROM accounts WHERE owner_user_id=?');
        $st->execute([$userId]);
        $id = $st->fetchColumn();
        if ($id !== false) return (int)$id;
        $ins = $pdo->prepare('INSERT INTO accounts (owner_user_id, kind) VALUES (?, "user")');
        $ins->execute([$userId]);
        return (int)$pdo->lastInsertId();
    }

    // Reverse a single ledger row by writing its mirror. Caller manages transaction.
    public static function reverse(PDO $pdo, int $ledgerId, ?string $memo = null): int {
        $st = $pdo->prepare('SELECT * FROM ledger WHERE id=? FOR UPDATE');
        $st->execute([$ledgerId]);
        $row = $st->fetch();
        if (!$row) throw new ApiException('not_found', "ledger $ledgerId not found", 404);
        if ($row['type'] === 'reversal') {
            throw new ApiException('already_reversal', "ledger $ledgerId is itself a reversal", 409);
        }
        // Prevent double-reversal of the same original
        $chk = $pdo->prepare('SELECT id FROM ledger WHERE reversed_of=?');
        $chk->execute([$ledgerId]);
        if ($chk->fetchColumn() !== false) {
            throw new ApiException('already_reversed', "ledger $ledgerId already reversed", 409);
        }
        return self::transfer(
            $pdo,
            (int)$row['to_account_id'],   // mirror
            (int)$row['from_account_id'],
            (int)$row['amount'],
            'reversal',
            $row['ref_type'],
            $row['ref_id'] !== null ? (int)$row['ref_id'] : null,
            $memo ?? ('reversal of #' . $ledgerId),
            $ledgerId
        );
    }
}
