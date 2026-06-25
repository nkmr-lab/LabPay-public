<?php
// v584 1 日 1 回 占い。 引いた占いは その日いっぱい ホームの ポイント ウィジェット に表示。
//   GET /api/fortune/today    その日の占いを 取得 (未引きなら 新規に 引く)
declare(strict_types=1);

// 引く時の選択肢 (運勢 + アイコン + 一言)。 30 件くらい用意 (重複 OK)。
// 結果は idx で保存されるので 増減 自由 (ただし 過去 idx は その日の結果として 残る)。
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

// v814 #408 西洋占星術 (12 星座) を 生年月日 (users.birthday_md, MM-DD) から 引き、 1 日 1 件
//   メッセージ を deterministic に 選ぶ。 占い 本体 と 並べて 表示 する。
// v817 #412 これ は 「太陽星座 を 元 に した 簡易 西洋占星術」 で あって、 natal chart
//   (出生時刻 + 出生地 から 月 / 上昇 宮 / 各 惑星 配置 を 計算 する 本格 ホロスコープ) で は
//   ありません。 守護 星 / エレメント / 性格 / 当日 相性 星座 まで 出します。
const ZODIAC_SIGNS = [
    ['key'=>'capricorn',   'name'=>'山羊座', 'icon'=>'♑', 'start'=>'12-22', 'end'=>'01-19', 'element'=>'土', 'modality'=>'活動', 'ruler'=>'土星',     'strengths'=>'責任感 / 努力 / 現実 的', 'weaknesses'=>'頑固 / 真面目 過ぎる'],
    ['key'=>'aquarius',    'name'=>'水瓶座', 'icon'=>'♒', 'start'=>'01-20', 'end'=>'02-18', 'element'=>'風', 'modality'=>'不動', 'ruler'=>'天王星',   'strengths'=>'革新 的 / 知的 / 自由 で 独創 的', 'weaknesses'=>'距離 感 / 気まぐれ'],
    ['key'=>'pisces',      'name'=>'魚座',   'icon'=>'♓', 'start'=>'02-19', 'end'=>'03-20', 'element'=>'水', 'modality'=>'柔軟', 'ruler'=>'海王星',   'strengths'=>'共感 / 想像力 / 優しさ', 'weaknesses'=>'流され やすい / 現実 逃避'],
    ['key'=>'aries',       'name'=>'牡羊座', 'icon'=>'♈', 'start'=>'03-21', 'end'=>'04-19', 'element'=>'火', 'modality'=>'活動', 'ruler'=>'火星',     'strengths'=>'行動 力 / 情熱 / リーダー 気質', 'weaknesses'=>'短気 / 衝動 的'],
    ['key'=>'taurus',      'name'=>'牡牛座', 'icon'=>'♉', 'start'=>'04-20', 'end'=>'05-20', 'element'=>'土', 'modality'=>'不動', 'ruler'=>'金星',     'strengths'=>'落ち着き / 美的 感覚 / 持続 力', 'weaknesses'=>'頑固 / 保守 的'],
    ['key'=>'gemini',      'name'=>'双子座', 'icon'=>'♊', 'start'=>'05-21', 'end'=>'06-21', 'element'=>'風', 'modality'=>'柔軟', 'ruler'=>'水星',     'strengths'=>'多才 / コミュ 力 / 好奇心', 'weaknesses'=>'飽きっぽい / 二面 性'],
    ['key'=>'cancer',      'name'=>'蟹座',   'icon'=>'♋', 'start'=>'06-22', 'end'=>'07-22', 'element'=>'水', 'modality'=>'活動', 'ruler'=>'月',       'strengths'=>'共感 力 / 家庭 的 / 直感 的', 'weaknesses'=>'感情 的 / 内 こもり 気味'],
    ['key'=>'leo',         'name'=>'獅子座', 'icon'=>'♌', 'start'=>'07-23', 'end'=>'08-22', 'element'=>'火', 'modality'=>'不動', 'ruler'=>'太陽',     'strengths'=>'自信 / カリスマ / 創造 的', 'weaknesses'=>'プライド / 目立ち たがり'],
    ['key'=>'virgo',       'name'=>'乙女座', 'icon'=>'♍', 'start'=>'08-23', 'end'=>'09-22', 'element'=>'土', 'modality'=>'柔軟', 'ruler'=>'水星',     'strengths'=>'几帳面 / 分析 的 / 観察 力', 'weaknesses'=>'神経質 / 完璧 主義'],
    ['key'=>'libra',       'name'=>'天秤座', 'icon'=>'♎', 'start'=>'09-23', 'end'=>'10-23', 'element'=>'風', 'modality'=>'活動', 'ruler'=>'金星',     'strengths'=>'調和 / 美的 / 外交 的', 'weaknesses'=>'優柔不断 / 八方 美人'],
    ['key'=>'scorpio',     'name'=>'蠍座',   'icon'=>'♏', 'start'=>'10-24', 'end'=>'11-22', 'element'=>'水', 'modality'=>'不動', 'ruler'=>'冥王星',   'strengths'=>'情熱 / 洞察 / 集中 力', 'weaknesses'=>'嫉妬 / 執着 心'],
    ['key'=>'sagittarius', 'name'=>'射手座', 'icon'=>'♐', 'start'=>'11-23', 'end'=>'12-21', 'element'=>'火', 'modality'=>'柔軟', 'ruler'=>'木星',     'strengths'=>'自由 / 楽観 / 哲学 的', 'weaknesses'=>'飽きっぽい / 大ざっぱ'],
];

const ZODIAC_MOODS = [
    '今日 は 心 が 軽く なる 出会い が あり ます。 笑顔 を 大事 に。',
    'コミュニケーション が スムーズ な 日。 言葉 を 惜しま ない で。',
    '直感 が 冴える 日。 第一 印象 を 信じて OK。',
    '小さな 達成 を 積み 重ねる と 大きく 化ける 日。',
    '人 から 学ぶ こと が 多い 日。 素直 に 質問 を。',
    '計画 を 練り 直す と 思わぬ ショート カット が 見える。',
    'ひと 息 入れる 時間 を 大事 に。 焦り は 禁物。',
    '創造性 が 高まる 日。 アイデア は メモ に 残して。',
    '体 を 動かす と 気分 が 整い ます。 軽い 散歩 を。',
    '新しい こと に 挑戦 する と 運気 が 上向き。',
    '感情 が 揺れ やすい 日。 まず 深呼吸 を 3 回。',
    '丁寧 さ が 評価 さ れる 日。 細部 に こだわって。',
    '人 を 助ける こと が 巡り 巡って 自分 の 助け に。',
    '懐かしい 友人 から 連絡 が 来る かも。 返事 を 大事 に。',
    'お金 まわり で ラッキー が ある 日。 領収書 は 大切 に。',
    '思考 が クリア な 日。 難しい 判断 は 今日 中 に。',
    '寄り 道 が 吉 を 呼ぶ。 普段 通ら ない 道 を 選んで。',
    'ご 縁 が 動く 日。 出会い に 心 を 開いて。',
    '読書 や 勉強 が はかどる 日。 本 を 一 冊 開いて。',
    'お洒落 を 一つ プラス すると 気分 も 1.5 倍。',
];

const ZODIAC_LUCK_COLORS = ['赤','橙','黄','緑','水色','青','藍','紫','桃','白','黒','金'];
const ZODIAC_LUCK_ITEMS = ['コーヒー','本','花','チョコレート','ノート','ハンカチ','音楽','緑茶','イヤホン','腕時計','メガネ','ペン','ぬいぐるみ','傘'];

// MM-DD 形式 (例 "07-15") の 誕生日 から 12 星座 idx を 返す。 NULL / 形式 不正 は -1。
function zodiac_sign_for(?string $birthdayMd): int {
    if (!$birthdayMd || !preg_match('/^(\d{2})-(\d{2})$/', $birthdayMd, $m)) return -1;
    $key = sprintf('%02d-%02d', (int)$m[1], (int)$m[2]);
    foreach (ZODIAC_SIGNS as $idx => $z) {
        // 山羊座 は 年 を またぐ ので 別 処理
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
        // RACE 対策: INSERT IGNORE で 競合した場合は 既存値を SELECT し直す
        $st->execute([$uid, $today]);
        $row2 = $st->fetch(PDO::FETCH_ASSOC);
        if ($row2 !== false) {
            $idx = (int)$row2['fortune_idx'];
            $drawnAt = $row2['drawn_at'];
        }
    }
    $f = FORTUNES[$idx] ?? FORTUNES[0];

    // v814 #408 西洋占星術 (生年月日 が 設定 されて いれば)
    $zodiac = null;
    $bSt = $pdo->prepare("SELECT birthday_md FROM users WHERE id=?");
    $bSt->execute([$uid]);
    $birthdayMd = (string)($bSt->fetchColumn() ?: '');
    $zIdx = zodiac_sign_for($birthdayMd ?: null);
    if ($zIdx >= 0) {
        $z = ZODIAC_SIGNS[$zIdx];
        $epochDay = (int)floor(strtotime($today) / 86400);
        // 1 日 1 個、 星座 ごと に 違う メッセージ を deterministic に 選ぶ
        $moodIdx = ($epochDay * 12 + $zIdx) % count(ZODIAC_MOODS);
        $colorIdx = ($epochDay + $zIdx * 7) % count(ZODIAC_LUCK_COLORS);
        $itemIdx = ($epochDay + $zIdx * 5 + 3) % count(ZODIAC_LUCK_ITEMS);
        $luckyNum = 1 + (($epochDay * 17 + $zIdx * 23) % 40);
        // v817 #412 当日 の 相性 が 良い 星座 (= エレメント の 相性: 火↔風 / 土↔水)。
        //   毎日 同じ にしない ため、 同 グループ 内 で 1 つ を 日替わり で 選ぶ。
        $compatGroup = [];
        if ($z['element'] === '火' || $z['element'] === '風') {
            foreach (ZODIAC_SIGNS as $i => $zz) if ($zz['element'] === '火' || $zz['element'] === '風') if ($i !== $zIdx) $compatGroup[] = $i;
        } else {
            foreach (ZODIAC_SIGNS as $i => $zz) if ($zz['element'] === '土' || $zz['element'] === '水') if ($i !== $zIdx) $compatGroup[] = $i;
        }
        $compatIdx = $compatGroup[$epochDay % max(1, count($compatGroup))] ?? null;
        $compat = $compatIdx !== null ? ZODIAC_SIGNS[$compatIdx] : null;
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
            'note'        => '※ 太陽星座 を 元 に した 簡易 西洋占星術 です (本格 ホロスコープ は 出生 時刻 + 出生 地 が 必要)',
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
