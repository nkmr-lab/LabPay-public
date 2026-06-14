<?php
// v576b 既存の 2026 ワールドカップ 起案 (id=1) の 候補リストを 48 か国版で 上書き。
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO;

$candidates = [
    // 開催国
    ['id' => 'us', 'name' => 'アメリカ',         'flag' => '🇺🇸'],
    ['id' => 'mx', 'name' => 'メキシコ',         'flag' => '🇲🇽'],
    ['id' => 'ca', 'name' => 'カナダ',           'flag' => '🇨🇦'],
    // UEFA 16
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
    // CONMEBOL 6
    ['id' => 'br', 'name' => 'ブラジル',         'flag' => '🇧🇷'],
    ['id' => 'ar', 'name' => 'アルゼンチン',     'flag' => '🇦🇷'],
    ['id' => 'uy', 'name' => 'ウルグアイ',       'flag' => '🇺🇾'],
    ['id' => 'co', 'name' => 'コロンビア',       'flag' => '🇨🇴'],
    ['id' => 'ec', 'name' => 'エクアドル',       'flag' => '🇪🇨'],
    ['id' => 'py', 'name' => 'パラグアイ',       'flag' => '🇵🇾'],
    // AFC 8
    ['id' => 'jp', 'name' => '日本',             'flag' => '🇯🇵'],
    ['id' => 'kr', 'name' => '韓国',             'flag' => '🇰🇷'],
    ['id' => 'ir', 'name' => 'イラン',           'flag' => '🇮🇷'],
    ['id' => 'au', 'name' => 'オーストラリア',   'flag' => '🇦🇺'],
    ['id' => 'sa', 'name' => 'サウジアラビア',   'flag' => '🇸🇦'],
    ['id' => 'uz', 'name' => 'ウズベキスタン',   'flag' => '🇺🇿'],
    ['id' => 'qa', 'name' => 'カタール',         'flag' => '🇶🇦'],
    ['id' => 'jo', 'name' => 'ヨルダン',         'flag' => '🇯🇴'],
    // CAF 9
    ['id' => 'ma', 'name' => 'モロッコ',         'flag' => '🇲🇦'],
    ['id' => 'sn', 'name' => 'セネガル',         'flag' => '🇸🇳'],
    ['id' => 'eg', 'name' => 'エジプト',         'flag' => '🇪🇬'],
    ['id' => 'tn', 'name' => 'チュニジア',       'flag' => '🇹🇳'],
    ['id' => 'dz', 'name' => 'アルジェリア',     'flag' => '🇩🇿'],
    ['id' => 'ci', 'name' => 'コートジボワール', 'flag' => '🇨🇮'],
    ['id' => 'cm', 'name' => 'カメルーン',       'flag' => '🇨🇲'],
    ['id' => 'gh', 'name' => 'ガーナ',           'flag' => '🇬🇭'],
    ['id' => 'ng', 'name' => 'ナイジェリア',     'flag' => '🇳🇬'],
    // CONCACAF 3 (ホスト除く)
    ['id' => 'pa', 'name' => 'パナマ',           'flag' => '🇵🇦'],
    ['id' => 'cr', 'name' => 'コスタリカ',       'flag' => '🇨🇷'],
    ['id' => 'jm', 'name' => 'ジャマイカ',       'flag' => '🇯🇲'],
    // OFC 1
    ['id' => 'nz', 'name' => 'ニュージーランド', 'flag' => '🇳🇿'],
    // 大陸間 プレーオフ 勝者 2 (想定)
    ['id' => 'bo', 'name' => 'ボリビア',         'flag' => '🇧🇴'],
    ['id' => 'cd', 'name' => 'コンゴ民主共和国', 'flag' => '🇨🇩'],
];

if (count($candidates) !== 48) {
    echo "WARN: expected 48 candidates, got " . count($candidates) . "\n";
}

$st = $PDO->prepare("UPDATE predictions_games SET candidates_json = ? WHERE title = '2026 ワールドカップ 優勝予想' AND status = 'open'");
$st->execute([json_encode($candidates, JSON_UNESCAPED_UNICODE)]);
echo "Updated rows: " . $st->rowCount() . "\n";
echo "候補数: " . count($candidates) . " か国\n";
