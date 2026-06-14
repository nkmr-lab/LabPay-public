<?php
// v577 2026 W杯 候補 を Wikipedia 出場 48 か国 で 上書き。
//   ja.wikipedia.org/wiki/2026_FIFAワールドカップ 出場48か国 (2026-06-14 時点) から。
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';
global $PDO;

$candidates = [
    // 開催国 (CONCACAF 3)
    ['id' => 'mx', 'name' => 'メキシコ',         'flag' => '🇲🇽'],
    ['id' => 'ca', 'name' => 'カナダ',           'flag' => '🇨🇦'],
    ['id' => 'us', 'name' => 'アメリカ合衆国',   'flag' => '🇺🇸'],
    // CONCACAF (3 / ホスト除く)
    ['id' => 'pa', 'name' => 'パナマ',           'flag' => '🇵🇦'],
    ['id' => 'cw', 'name' => 'キュラソー',       'flag' => '🇨🇼'],
    ['id' => 'ht', 'name' => 'ハイチ',           'flag' => '🇭🇹'],
    // UEFA 16
    ['id' => 'de', 'name' => 'ドイツ',           'flag' => '🇩🇪'],
    ['id' => 'ch', 'name' => 'スイス',           'flag' => '🇨🇭'],
    ['id' => 'gb-sct', 'name' => 'スコットランド', 'flag' => '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    ['id' => 'fr', 'name' => 'フランス',         'flag' => '🇫🇷'],
    ['id' => 'es', 'name' => 'スペイン',         'flag' => '🇪🇸'],
    ['id' => 'pt', 'name' => 'ポルトガル',       'flag' => '🇵🇹'],
    ['id' => 'nl', 'name' => 'オランダ',         'flag' => '🇳🇱'],
    ['id' => 'at', 'name' => 'オーストリア',     'flag' => '🇦🇹'],
    ['id' => 'no', 'name' => 'ノルウェー',       'flag' => '🇳🇴'],
    ['id' => 'be', 'name' => 'ベルギー',         'flag' => '🇧🇪'],
    ['id' => 'gb-eng', 'name' => 'イングランド', 'flag' => '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ['id' => 'hr', 'name' => 'クロアチア',       'flag' => '🇭🇷'],
    ['id' => 'ba', 'name' => 'ボスニア・ヘルツェゴビナ', 'flag' => '🇧🇦'],
    ['id' => 'se', 'name' => 'スウェーデン',     'flag' => '🇸🇪'],
    ['id' => 'tr', 'name' => 'トルコ',           'flag' => '🇹🇷'],
    ['id' => 'cz', 'name' => 'チェコ',           'flag' => '🇨🇿'],
    // CONMEBOL 6
    ['id' => 'ar', 'name' => 'アルゼンチン',     'flag' => '🇦🇷'],
    ['id' => 'ec', 'name' => 'エクアドル',       'flag' => '🇪🇨'],
    ['id' => 'co', 'name' => 'コロンビア',       'flag' => '🇨🇴'],
    ['id' => 'uy', 'name' => 'ウルグアイ',       'flag' => '🇺🇾'],
    ['id' => 'br', 'name' => 'ブラジル',         'flag' => '🇧🇷'],
    ['id' => 'py', 'name' => 'パラグアイ',       'flag' => '🇵🇾'],
    // AFC 8
    ['id' => 'ir', 'name' => 'イラン',           'flag' => '🇮🇷'],
    ['id' => 'uz', 'name' => 'ウズベキスタン',   'flag' => '🇺🇿'],
    ['id' => 'kr', 'name' => '韓国',             'flag' => '🇰🇷'],
    ['id' => 'jo', 'name' => 'ヨルダン',         'flag' => '🇯🇴'],
    ['id' => 'jp', 'name' => '日本',             'flag' => '🇯🇵'],
    ['id' => 'au', 'name' => 'オーストラリア',   'flag' => '🇦🇺'],
    ['id' => 'qa', 'name' => 'カタール',         'flag' => '🇶🇦'],
    ['id' => 'sa', 'name' => 'サウジアラビア',   'flag' => '🇸🇦'],
    // CAF 9
    ['id' => 'eg', 'name' => 'エジプト',         'flag' => '🇪🇬'],
    ['id' => 'sn', 'name' => 'セネガル',         'flag' => '🇸🇳'],
    ['id' => 'za', 'name' => '南アフリカ共和国', 'flag' => '🇿🇦'],
    ['id' => 'cv', 'name' => 'カーボベルデ',     'flag' => '🇨🇻'],
    ['id' => 'ma', 'name' => 'モロッコ',         'flag' => '🇲🇦'],
    ['id' => 'ci', 'name' => 'コートジボワール', 'flag' => '🇨🇮'],
    ['id' => 'dz', 'name' => 'アルジェリア',     'flag' => '🇩🇿'],
    ['id' => 'tn', 'name' => 'チュニジア',       'flag' => '🇹🇳'],
    ['id' => 'gh', 'name' => 'ガーナ',           'flag' => '🇬🇭'],
    // OFC 1
    ['id' => 'nz', 'name' => 'ニュージーランド', 'flag' => '🇳🇿'],
    // 大陸間 プレーオフ 勝者 2
    ['id' => 'cd', 'name' => 'コンゴ民主共和国', 'flag' => '🇨🇩'],
    ['id' => 'iq', 'name' => 'イラク',           'flag' => '🇮🇶'],
];

if (count($candidates) !== 48) {
    fwrite(STDERR, "WARN: expected 48 candidates, got " . count($candidates) . "\n");
}

$st = $PDO->prepare("UPDATE predictions_games SET candidates_json = ? WHERE title = '2026 ワールドカップ 優勝予想' AND status = 'open'");
$st->execute([json_encode($candidates, JSON_UNESCAPED_UNICODE)]);
echo "Updated rows: " . $st->rowCount() . "\n";
echo "候補数: " . count($candidates) . " か国\n";
