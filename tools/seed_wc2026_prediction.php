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

// 2026 ワールドカップ は 48 か国出場 (32 → 48 へ拡大)。
//   AFC 8 + CAF 9 + CONCACAF 6 (うち 3 ホスト) + CONMEBOL 6 + OFC 1 + UEFA 16 + 大陸間PO 2。
//   現時点 (2026-01 時点 の 知識) で 出場が ほぼ確定/最有力 の 国を 列挙。
$candidates = [
    // 開催国
    ['id' => 'us', 'name' => 'アメリカ',         'flag' => '🇺🇸'],
    ['id' => 'mx', 'name' => 'メキシコ',         'flag' => '🇲🇽'],
    ['id' => 'ca', 'name' => 'カナダ',           'flag' => '🇨🇦'],
    // UEFA (欧州)
    ['id' => 'fr', 'name' => 'フランス',         'flag' => '🇫🇷'],
    ['id' => 'de', 'name' => 'ドイツ',           'flag' => '🇩🇪'],
    ['id' => 'es', 'name' => 'スペイン',         'flag' => '🇪🇸'],
    ['id' => 'gb-eng', 'name' => 'イングランド', 'flag' => '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ['id' => 'it', 'name' => 'イタリア',         'flag' => '🇮🇹'],
    ['id' => 'pt', 'name' => 'ポルトガル',       'flag' => '🇵🇹'],
    ['id' => 'nl', 'name' => 'オランダ',         'flag' => '🇳🇱'],
    ['id' => 'be', 'name' => 'ベルギー',         'flag' => '🇧🇪'],
    ['id' => 'hr', 'name' => 'クロアチア',       'flag' => '🇭🇷'],
    ['id' => 'ch', 'name' => 'スイス',           'flag' => '🇨🇭'],
    ['id' => 'at', 'name' => 'オーストリア',     'flag' => '🇦🇹'],
    ['id' => 'dk', 'name' => 'デンマーク',       'flag' => '🇩🇰'],
    ['id' => 'no', 'name' => 'ノルウェー',       'flag' => '🇳🇴'],
    ['id' => 'pl', 'name' => 'ポーランド',       'flag' => '🇵🇱'],
    ['id' => 'cz', 'name' => 'チェコ',           'flag' => '🇨🇿'],
    ['id' => 'rs', 'name' => 'セルビア',         'flag' => '🇷🇸'],
    // CONMEBOL (南米)
    ['id' => 'br', 'name' => 'ブラジル',         'flag' => '🇧🇷'],
    ['id' => 'ar', 'name' => 'アルゼンチン',     'flag' => '🇦🇷'],
    ['id' => 'uy', 'name' => 'ウルグアイ',       'flag' => '🇺🇾'],
    ['id' => 'co', 'name' => 'コロンビア',       'flag' => '🇨🇴'],
    ['id' => 'ec', 'name' => 'エクアドル',       'flag' => '🇪🇨'],
    ['id' => 'py', 'name' => 'パラグアイ',       'flag' => '🇵🇾'],
    // AFC (アジア)
    ['id' => 'jp', 'name' => '日本',             'flag' => '🇯🇵'],
    ['id' => 'kr', 'name' => '韓国',             'flag' => '🇰🇷'],
    ['id' => 'ir', 'name' => 'イラン',           'flag' => '🇮🇷'],
    ['id' => 'au', 'name' => 'オーストラリア',   'flag' => '🇦🇺'],
    ['id' => 'sa', 'name' => 'サウジアラビア',   'flag' => '🇸🇦'],
    ['id' => 'uz', 'name' => 'ウズベキスタン',   'flag' => '🇺🇿'],
    ['id' => 'qa', 'name' => 'カタール',         'flag' => '🇶🇦'],
    ['id' => 'jo', 'name' => 'ヨルダン',         'flag' => '🇯🇴'],
    // CAF (アフリカ)
    ['id' => 'ma', 'name' => 'モロッコ',         'flag' => '🇲🇦'],
    ['id' => 'sn', 'name' => 'セネガル',         'flag' => '🇸🇳'],
    ['id' => 'eg', 'name' => 'エジプト',         'flag' => '🇪🇬'],
    ['id' => 'tn', 'name' => 'チュニジア',       'flag' => '🇹🇳'],
    ['id' => 'dz', 'name' => 'アルジェリア',     'flag' => '🇩🇿'],
    ['id' => 'ci', 'name' => 'コートジボワール', 'flag' => '🇨🇮'],
    ['id' => 'cm', 'name' => 'カメルーン',       'flag' => '🇨🇲'],
    ['id' => 'gh', 'name' => 'ガーナ',           'flag' => '🇬🇭'],
    ['id' => 'ng', 'name' => 'ナイジェリア',     'flag' => '🇳🇬'],
    // CONCACAF (北中米カリブ、 ホスト除く)
    ['id' => 'pa', 'name' => 'パナマ',           'flag' => '🇵🇦'],
    ['id' => 'cr', 'name' => 'コスタリカ',       'flag' => '🇨🇷'],
    ['id' => 'jm', 'name' => 'ジャマイカ',       'flag' => '🇯🇲'],
    // OFC
    ['id' => 'nz', 'name' => 'ニュージーランド', 'flag' => '🇳🇿'],
    // 大陸間 プレーオフ 勝者 (2 枠 — 想定)
    ['id' => 'bo', 'name' => 'ボリビア',         'flag' => '🇧🇴'],
    ['id' => 'cd', 'name' => 'コンゴ民主共和国', 'flag' => '🇨🇩'],
];

$desc = "北中米 (米国 / カナダ / メキシコ) 開催。 1-4位を予想 してください。\n"
      . "参加フィー 50pt、 締切は 2026-06-18 23:59。\n"
      . "配分: 1位 を 的中させた人で 山分け (場代 5% を 差し引いた後)。\n"
      . "ランキング表示用スコア: 1位=5 / 2位=3 / 3位=2 / 4位=1 の 一致した分の合計。";

// admin 名義 (id=1)
$creatorId = 1;
$deadline = '2026-06-18 23:59:59';

$PDO->prepare("INSERT INTO predictions_games (creator_user_id, title, description, fee, predict_count, candidates_json, deadline_at)
               VALUES (?,?,?,?,?,?,?)")
    ->execute([$creatorId, $title, $desc, 50, 4,
               json_encode($candidates, JSON_UNESCAPED_UNICODE), $deadline]);
$gid = $PDO->lastInsertId();
echo "Created predictions_games id={$gid}\n";
echo "URL: https://pay.nkmr.io/#/predictions/{$gid}\n";
