<?php
// Db: thin PDO wrapper. No ORM — just safe defaults.

declare(strict_types=1);

class Db {
    private PDO $pdo;

    public function __construct(array $cfg) {
        $this->pdo = new PDO(
            $cfg['dsn'],
            $cfg['user'],
            $cfg['pass'],
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
            ]
        );
    }

    public function pdo(): PDO { return $this->pdo; }
}
