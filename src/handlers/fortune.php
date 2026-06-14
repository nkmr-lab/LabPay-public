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
    json_response([
        'date'     => $today,
        'name'     => $f['name'],
        'icon'     => $f['icon'],
        'msg'      => $f['msg'],
        'drawn_at' => $drawnAt,
    ]);
}
