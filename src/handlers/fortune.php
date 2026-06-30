<?php
// v584 1 日 1 回占い。引いた占いはその日いっぱいホームのポイントウィジェットに表示。
//   GET /api/fortune/today    その日の占いを取得 (未引きなら新規に引く)
declare(strict_types=1);

// 引く時の選択肢 (運勢 + アイコン + 一言)。 30 件くらい用意 (重複 OK)。
// 結果は idx で保存されるので増減自由 (ただし過去 idx はその日の結果として残る)。
const FORTUNES = [
    ['name' => '大吉', 'icon' => '🌟', 'msg' => '今日動けば何でも当たる。思いついた1つを必ず実行。'],
    ['name' => '大吉', 'icon' => '🌅', 'msg' => '朝の一手が1日を決める。早めに取り掛かろう。'],
    ['name' => '大吉', 'icon' => '🎊', 'msg' => '思いがけない朗報が舞い込む。笑顔で受け取って。'],
    ['name' => '中吉', 'icon' => '✨', 'msg' => '小さな幸運が積み重なる日。周りに感謝を忘れずに。'],
    ['name' => '中吉', 'icon' => '🍀', 'msg' => '思い切って声をかけてみよう。良い縁が待ってる。'],
    ['name' => '中吉', 'icon' => '🌱', 'msg' => '今日蒔いた種は来週芽が出る。種まきの日。'],
    ['name' => '中吉', 'icon' => '🚀', 'msg' => '迷ったら進む方を選んで正解。'],
    ['name' => '小吉', 'icon' => '🍵', 'msg' => 'コーヒーや紅茶をじっくり飲む時間を作って。'],
    ['name' => '小吉', 'icon' => '📚', 'msg' => '気になっていた文献を一本読了すると運気アップ。'],
    ['name' => '小吉', 'icon' => '🎵', 'msg' => '好きな曲を一日一回聴くと流れが整う。'],
    ['name' => '小吉', 'icon' => '🚶', 'msg' => '昼休み散歩が吉。5分でも外の空気を。'],
    ['name' => '吉',   'icon' => '☕', 'msg' => 'いつものペースで進めばOK。焦らずじっくり。'],
    ['name' => '吉',   'icon' => '🧠', 'msg' => '考えるより先に手を動かすと良い1日。'],
    ['name' => '吉',   'icon' => '🗒', 'msg' => 'メモを取りながら動くと後で助かる。'],
    ['name' => '吉',   'icon' => '🤝', 'msg' => '隣の人に話しかけてみよう。思わぬ解が見つかる。'],
    ['name' => '末吉', 'icon' => '🌧', 'msg' => '雨でも気にしない。室内で集中タスク消化に向く日。'],
    ['name' => '末吉', 'icon' => '🛌', 'msg' => '少し疲れ気味。早めの就寝で整える。'],
    ['name' => '末吉', 'icon' => '🍱', 'msg' => 'いつもと違う昼食を選ぶと気分転換に良い。'],
    ['name' => '末吉', 'icon' => '🧹', 'msg' => 'デスクの整理が運気を呼ぶ。'],
    ['name' => '凶',   'icon' => '🌀', 'msg' => '今日は大胆な決断は避けて。明日改めて判断を。'],
    ['name' => '凶',   'icon' => '⚠️', 'msg' => '失くしものに注意。大事なものはポケットを確認。'],
    // ジョーク系
    ['name' => '神吉', 'icon' => '👑', 'msg' => '今日のあなたは無敵。でも調子に乗ると凶になる。'],
    ['name' => '猫吉', 'icon' => '🐱', 'msg' => '猫の動画を1本見ると集中力が戻る。'],
    ['name' => '麻吉', 'icon' => '🀄', 'msg' => '今日ロンを言うと当たる。麻雀でも議論でも。'],
    ['name' => '研吉', 'icon' => '🔬', 'msg' => '実験デザインに1つ工夫を入れると化ける。'],
    ['name' => '論吉', 'icon' => '📄', 'msg' => '紙原稿の一文を削ぎ落とすと引き締まる。'],
    ['name' => '読吉', 'icon' => '📖', 'msg' => '積読の1冊を開く日。'],
    ['name' => '飯吉', 'icon' => '🍜', 'msg' => '美味しい食事をちゃんと取ろう。食べある記に投稿で運気倍加。'],
    ['name' => '走吉', 'icon' => '🏃', 'msg' => '体を動かすと頭が軽くなる。散歩アプリを開いて。'],
    ['name' => '眠吉', 'icon' => '😴', 'msg' => '昼寝を15分。戻ってきた集中力で一気に。'],
];

function route_fortune(PDO $pdo, array $cfg, string $method, array $seg): void {
    $u = Auth::requireUser($pdo, $cfg);
    $uid = (int)$u['id'];
    $sub = $seg[1] ?? '';
    if ($sub === 'today' && $method === 'GET') {
        fortune_today($pdo, $uid);
        return;
    }
    json_error('not_found', "no fortune route for $method $sub", 404);
}

// v814 #408 西洋占星術 (12 星座) を生年月日 (users.birthday_md, MM-DD) から引き、 1 日 1 件
//   メッセージを deterministic に選ぶ。占い本体と並べて表示する。
// v817 #412 これは「太陽星座を元にした簡易西洋占星術」であって、 natal chart
//   (出生時刻 + 出生地から月 / 上昇宮 / 各惑星配置を計算する本格ホロスコープ) では
//   ありません。守護星 / エレメント / 性格 / 当日相性星座まで出します。
const ZODIAC_SIGNS = [
    ['key'=>'capricorn',   'name'=>'山羊座', 'icon'=>'♑', 'start'=>'12-22', 'end'=>'01-19', 'element'=>'土', 'modality'=>'活動', 'ruler'=>'土星',     'strengths'=>'責任感 / 努力 / 現実的', 'weaknesses'=>'頑固 / 真面目すぎる'],
    ['key'=>'aquarius',    'name'=>'水瓶座', 'icon'=>'♒', 'start'=>'01-20', 'end'=>'02-18', 'element'=>'風', 'modality'=>'不動', 'ruler'=>'天王星',   'strengths'=>'革新的 / 知的 / 自由で独創的', 'weaknesses'=>'距離感 / 気まぐれ'],
    ['key'=>'pisces',      'name'=>'魚座',   'icon'=>'♓', 'start'=>'02-19', 'end'=>'03-20', 'element'=>'水', 'modality'=>'柔軟', 'ruler'=>'海王星',   'strengths'=>'共感 / 想像力 / 優しさ', 'weaknesses'=>'流されやすい / 現実逃避'],
    ['key'=>'aries',       'name'=>'牡羊座', 'icon'=>'♈', 'start'=>'03-21', 'end'=>'04-19', 'element'=>'火', 'modality'=>'活動', 'ruler'=>'火星',     'strengths'=>'行動力 / 情熱 / リーダー気質', 'weaknesses'=>'短気 / 衝動的'],
    ['key'=>'taurus',      'name'=>'牡牛座', 'icon'=>'♉', 'start'=>'04-20', 'end'=>'05-20', 'element'=>'土', 'modality'=>'不動', 'ruler'=>'金星',     'strengths'=>'落ち着き / 美的感覚 / 持続力', 'weaknesses'=>'頑固 / 保守的'],
    ['key'=>'gemini',      'name'=>'双子座', 'icon'=>'♊', 'start'=>'05-21', 'end'=>'06-21', 'element'=>'風', 'modality'=>'柔軟', 'ruler'=>'水星',     'strengths'=>'多才 / コミュ力 / 好奇心', 'weaknesses'=>'飽きっぽい / 二面性'],
    ['key'=>'cancer',      'name'=>'蟹座',   'icon'=>'♋', 'start'=>'06-22', 'end'=>'07-22', 'element'=>'水', 'modality'=>'活動', 'ruler'=>'月',       'strengths'=>'共感力 / 家庭的 / 直感的', 'weaknesses'=>'感情的 / 内にこもりがち'],
    ['key'=>'leo',         'name'=>'獅子座', 'icon'=>'♌', 'start'=>'07-23', 'end'=>'08-22', 'element'=>'火', 'modality'=>'不動', 'ruler'=>'太陽',     'strengths'=>'自信 / カリスマ / 創造的', 'weaknesses'=>'プライド / 目立ちたがり'],
    ['key'=>'virgo',       'name'=>'乙女座', 'icon'=>'♍', 'start'=>'08-23', 'end'=>'09-22', 'element'=>'土', 'modality'=>'柔軟', 'ruler'=>'水星',     'strengths'=>'几帳面 / 分析的 / 観察力', 'weaknesses'=>'神経質 / 完璧主義'],
    ['key'=>'libra',       'name'=>'天秤座', 'icon'=>'♎', 'start'=>'09-23', 'end'=>'10-23', 'element'=>'風', 'modality'=>'活動', 'ruler'=>'金星',     'strengths'=>'調和 / 美的 / 外交的', 'weaknesses'=>'優柔不断 / 八方美人'],
    ['key'=>'scorpio',     'name'=>'蠍座',   'icon'=>'♏', 'start'=>'10-24', 'end'=>'11-22', 'element'=>'水', 'modality'=>'不動', 'ruler'=>'冥王星',   'strengths'=>'情熱 / 洞察 / 集中力', 'weaknesses'=>'嫉妬 / 執着心'],
    ['key'=>'sagittarius', 'name'=>'射手座', 'icon'=>'♐', 'start'=>'11-23', 'end'=>'12-21', 'element'=>'火', 'modality'=>'柔軟', 'ruler'=>'木星',     'strengths'=>'自由 / 楽観 / 哲学的', 'weaknesses'=>'飽きっぽい / 大ざっぱ'],
];

const ZODIAC_MOODS = [
    '今日は心が軽くなる出会いがあります。笑顔を大事に。',
    'コミュニケーションがスムーズな日。言葉を惜しまないで。',
    '直感が冴える日。第一印象を信じて OK。',
    '小さな達成を積み重ねると大きく化ける日。',
    '人から学ぶことが多い日。素直に質問を。',
    '計画を練り直すと思わぬショートカットが見える。',
    'ひと息入れる時間を大事に。焦りは禁物。',
    '創造性が高まる日。アイデアはメモに残して。',
    '体を動かすと気分が整います。軽い散歩を。',
    '新しいことに挑戦すると運気が上向き。',
    '感情が揺れやすい日。まず深呼吸を 3 回。',
    '丁寧さが評価される日。細部にこだわって。',
    '人を助けることが巡り巡って自分の助けに。',
    '懐かしい友人から連絡が来るかも。返事を大事に。',
    'お金まわりでラッキーがある日。領収書は大切に。',
    '思考がクリアな日。難しい判断は今日中に。',
    '寄り道が吉を呼ぶ。普段通らない道を選んで。',
    'ご縁が動く日。出会いに心を開いて。',
    '読書や勉強がはかどる日。本を 1 冊開いて。',
    'お洒落を一つプラスすると気分も 1.5 倍。',
];

const ZODIAC_LUCK_COLORS = ['赤','橙','黄','緑','水色','青','藍','紫','桃','白','黒','金'];
const ZODIAC_LUCK_ITEMS = ['コーヒー','本','花','チョコレート','ノート','ハンカチ','音楽','緑茶','イヤホン','腕時計','メガネ','ペン','ぬいぐるみ','傘'];

// MM-DD 形式 (例 "07-15") の誕生日から 12 星座 idx を返す。 NULL / 形式不正は -1。
function zodiac_sign_for(?string $birthdayMd): int {
    if (!$birthdayMd || !preg_match('/^(\d{2})-(\d{2})$/', $birthdayMd, $m)) return -1;
    $key = sprintf('%02d-%02d', (int)$m[1], (int)$m[2]);
    foreach (ZODIAC_SIGNS as $idx => $z) {
        // 山羊座は年をまたぐので別処理
        if ($z['start'] <= $z['end']) {
            if ($key >= $z['start'] && $key <= $z['end']) return $idx;
        } else {
            if ($key >= $z['start'] || $key <= $z['end']) return $idx;
        }
    }
    return -1;
}

function fortune_today(PDO $pdo, int $uid): void {
    $today = date('Y-m-d');
    $st = $pdo->prepare("SELECT fortune_idx, drawn_at FROM user_daily_fortunes WHERE user_id = ? AND date_jst = ?");
    $st->execute([$uid, $today]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row !== false) {
        $idx = (int)$row['fortune_idx'];
        $drawnAt = $row['drawn_at'];
    } else {
        $idx = mt_rand(0, count(FORTUNES) - 1);
        $pdo->prepare("INSERT IGNORE INTO user_daily_fortunes (user_id, date_jst, fortune_idx) VALUES (?,?,?)")
            ->execute([$uid, $today, $idx]);
        $drawnAt = date('Y-m-d H:i:s');
        // RACE 対策: INSERT IGNORE で競合した場合は既存値を SELECT し直す
        $st->execute([$uid, $today]);
        $row2 = $st->fetch(PDO::FETCH_ASSOC);
        if ($row2 !== false) {
            $idx = (int)$row2['fortune_idx'];
            $drawnAt = $row2['drawn_at'];
        }
    }
    $f = FORTUNES[$idx] ?? FORTUNES[0];

    // v814 #408 西洋占星術 (生年月日が設定されていれば)
    // v852 #439 出生地も一緒に取って、ラッキー方位を計算
    $zodiac = null;
    $bSt = $pdo->prepare("SELECT birthday_md, birth_place FROM users WHERE id=?");
    $bSt->execute([$uid]);
    $bRow = $bSt->fetch(PDO::FETCH_ASSOC) ?: [];
    $birthdayMd = (string)($bRow['birthday_md'] ?? '');
    $birthPlace = trim((string)($bRow['birth_place'] ?? ''));
    $zIdx = zodiac_sign_for($birthdayMd ?: null);
    if ($zIdx >= 0) {
        $z = ZODIAC_SIGNS[$zIdx];
        $epochDay = (int)floor(strtotime($today) / 86400);
        // 1 日 1 個、星座ごとに違うメッセージを deterministic に選ぶ
        $moodIdx = ($epochDay * 12 + $zIdx) % count(ZODIAC_MOODS);
        $colorIdx = ($epochDay + $zIdx * 7) % count(ZODIAC_LUCK_COLORS);
        $itemIdx = ($epochDay + $zIdx * 5 + 3) % count(ZODIAC_LUCK_ITEMS);
        $luckyNum = 1 + (($epochDay * 17 + $zIdx * 23) % 40);
        // v817 #412 当日の相性が良い星座 (= エレメントの相性: 火↔風 / 土↔水)。
        //   毎日同じにしないため、同グループ内で 1 つを日替わりで選ぶ。
        $compatGroup = [];
        if ($z['element'] === '火' || $z['element'] === '風') {
            foreach (ZODIAC_SIGNS as $i => $zz) if ($zz['element'] === '火' || $zz['element'] === '風') if ($i !== $zIdx) $compatGroup[] = $i;
        } else {
            foreach (ZODIAC_SIGNS as $i => $zz) if ($zz['element'] === '土' || $zz['element'] === '水') if ($i !== $zIdx) $compatGroup[] = $i;
        }
        $compatIdx = $compatGroup[$epochDay % max(1, count($compatGroup))] ?? null;
        $compat = $compatIdx !== null ? ZODIAC_SIGNS[$compatIdx] : null;
        // v852 #439 出生地 + 当日 + 星座からラッキー方位を deterministic に決定。
        //   出生時刻がない場合でも出生地があれば「あなたの土地に縁のある方位」という
        //   占星術的解釈ができる。 8 方位 (北 / 北東 / 東 / 南東 / 南 / 南西 / 西 / 北西)。
        $luckyDir = null;
        if ($birthPlace !== '') {
            $h = crc32($birthPlace . '|' . $today . '|' . $zIdx);
            $dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
            $dirIcons = ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'];
            $di = $h % 8;
            $luckyDir = ['name' => $dirs[$di], 'icon' => $dirIcons[$di], 'place' => $birthPlace];
        }
        $zodiac = [
            'key'         => $z['key'],
            'name'        => $z['name'],
            'icon'        => $z['icon'],
            'element'     => $z['element'],
            'modality'    => $z['modality'],
            'ruler'       => $z['ruler'],
            'strengths'   => $z['strengths'],
            'weaknesses'  => $z['weaknesses'],
            'msg'         => ZODIAC_MOODS[$moodIdx],
            'lucky_color' => ZODIAC_LUCK_COLORS[$colorIdx],
            'lucky_item'  => ZODIAC_LUCK_ITEMS[$itemIdx],
            'lucky_number'=> $luckyNum,
            'compat_today'=> $compat ? [
                'name' => $compat['name'],
                'icon' => $compat['icon'],
            ] : null,
            'lucky_direction' => $luckyDir,
            'note'        => '※ 太陽星座をもとにした簡易西洋占星術です (本格ホロスコープは出生時刻+出生地が必要)',
        ];
    }

    json_response([
        'date'     => $today,
        'name'     => $f['name'],
        'icon'     => $f['icon'],
        'msg'      => $f['msg'],
        'drawn_at' => $drawnAt,
        'zodiac'   => $zodiac,
        'has_birthday' => $birthdayMd !== '',
    ]);
}
