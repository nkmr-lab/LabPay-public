<?php
// v576 サンプル 2026 ワールドカップ 優勝予想 を 起案 (admin 名義)。
//   既に同じ title で open があれば skip。
//   実行: ssh nakamura@pay.nkmr.io 'cd /var/www/labpay && php tools/seed_wc2026_prediction.php'

declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO;

$title = '2026 ワールドカップ 優勝予想';
$st = $PDO->prepare("SELECT id FROM predictions_games WHERE title = ? AND status IN ('open','closed','finished') LIMIT 1");
$st->execute([$title]);
$existing = $st->fetchColumn();
if ($existing) {
    echo "既に存在 (id={$existing}) — skip\n";
    exit(0);
}

$candidates = [
    ['id' => 'br', 'name' => 'ブラジル',         'flag' => '🇧🇷'],
    ['id' => 'ar', 'name' => 'アルゼンチン',     'flag' => '🇦🇷'],
    ['id' => 'fr', 'name' => 'フランス',         'flag' => '🇫🇷'],
    ['id' => 'de', 'name' => 'ドイツ',           'flag' => '🇩🇪'],
    ['id' => 'es', 'name' => 'スペイン',         'flag' => '🇪🇸'],
    ['id' => 'gb-eng', 'name' => 'イングランド', 'flag' => '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ['id' => 'pt', 'name' => 'ポルトガル',       'flag' => '🇵🇹'],
    ['id' => 'nl', 'name' => 'オランダ',         'flag' => '🇳🇱'],
    ['id' => 'be', 'name' => 'ベルギー',         'flag' => '🇧🇪'],
    ['id' => 'it', 'name' => 'イタリア',         'flag' => '🇮🇹'],
    ['id' => 'hr', 'name' => 'クロアチア',       'flag' => '🇭🇷'],
    ['id' => 'uy', 'name' => 'ウルグアイ',       'flag' => '🇺🇾'],
    ['id' => 'jp', 'name' => '日本',             'flag' => '🇯🇵'],
    ['id' => 'kr', 'name' => '韓国',             'flag' => '🇰🇷'],
    ['id' => 'mx', 'name' => 'メキシコ',         'flag' => '🇲🇽'],
    ['id' => 'us', 'name' => 'アメリカ',         'flag' => '🇺🇸'],
    ['id' => 'ca', 'name' => 'カナダ',           'flag' => '🇨🇦'],
    ['id' => 'ma', 'name' => 'モロッコ',         'flag' => '🇲🇦'],
    ['id' => 'sn', 'name' => 'セネガル',         'flag' => '🇸🇳'],
    ['id' => 'au', 'name' => 'オーストラリア',   'flag' => '🇦🇺'],
];

$desc = "北中米 (米国 / カナダ / メキシコ) 開催。 1-4位を予想 してください。\n"
      . "参加フィー 50pt、 締切は 開幕日 (2026-06-11) の前日まで。\n"
      . "スコア = 順位重み (1位=4, 2位=3, 3位=2, 4位=1) の合計、 山分け配分。";

// admin 名義 (id=1)
$creatorId = 1;
$deadline = '2026-06-10 23:59:59';

$PDO->prepare("INSERT INTO predictions_games (creator_user_id, title, description, fee, predict_count, candidates_json, deadline_at)
               VALUES (?,?,?,?,?,?,?)")
    ->execute([$creatorId, $title, $desc, 50, 4,
               json_encode($candidates, JSON_UNESCAPED_UNICODE), $deadline]);
$gid = $PDO->lastInsertId();
echo "Created predictions_games id={$gid}\n";
echo "URL: https://pay.nkmr.io/#/predictions/{$gid}\n";
