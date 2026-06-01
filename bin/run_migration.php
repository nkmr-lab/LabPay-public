<?php
// Apply a single migration SQL file using the app's own DB config.
// Usage (as the apache user, since config is mode 0640 apache:apache):
//   sudo -u apache php bin/run_migration.php migrations/010_streak_security_messages.sql
//
// The file is executed as a single multi-statement query against the configured DB.
// MariaDB / PHP-PDO accepts multi-statements when there is no bound parameter array.

declare(strict_types=1);

if ($argc < 2) {
    fwrite(STDERR, "usage: php bin/run_migration.php <path/to/migration.sql>\n");
    exit(2);
}
$path = $argv[1];
if (!is_file($path) || !is_readable($path)) {
    fwrite(STDERR, "cannot read: $path\n");
    exit(2);
}

$cfg = require __DIR__ . '/../config/config.php';
$pdo = new PDO(
    $cfg['db']['dsn'],
    $cfg['db']['user'],
    $cfg['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$sql = file_get_contents($path);
if ($sql === false || trim($sql) === '') {
    fwrite(STDERR, "empty SQL\n");
    exit(2);
}

try {
    $pdo->exec($sql);
    fwrite(STDOUT, "applied: $path\n");
} catch (Throwable $e) {
    fwrite(STDERR, "FAILED: " . $e->getMessage() . "\n");
    exit(1);
}
