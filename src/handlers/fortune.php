<?php
// v584 1 日 1 回 占い。 引いた占いは その日いっぱい ホームの ポイント ウィジェット に表示。
//   GET /api/fortune/today    その日の占いを 取得 (未引きなら 新規に 引く)
declare(strict_types=1);

// 引く時の選択肢 (運勢 + アイコン + 一言)。 30 件くらい用意 (重複 OK)。
// 結果は idx で保存されるので 増減 自由 (ただし 過去 idx は その日の結果として 残る)。
const FORTUNES = [
    ['name' => '大吉', 'icon' => '🌟', 'msg' => '今日 動けば 何でも 当たる。 思いついた 1 つ を 必ず 実行。'],
    ['name' => '大吉', 'icon' => '🌅', 'msg' => '朝の 一手 が 1 日 を 決める。 早めに 取り掛かろう。'],
    ['name' => '大吉', 'icon' => '🎊', 'msg' => '思いがけない 朗報 が 舞い込む。 笑顔で 受け取って。'],
    ['name' => '中吉', 'icon' => '✨', 'msg' => '小さな 幸運 が 積み重なる 日。 周りに 感謝を 忘れずに。'],
    ['name' => '中吉', 'icon' => '🍀', 'msg' => '思い切って 声を かけてみよう。 良い 縁が 待ってる。'],
    ['name' => '中吉', 'icon' => '🌱', 'msg' => '今日 蒔いた 種は 来週 芽が出る。 種まきの日。'],
    ['name' => '中吉', 'icon' => '🚀', 'msg' => '迷ったら 進む方を 選んで 正解。'],
    ['name' => '小吉', 'icon' => '🍵', 'msg' => 'コーヒー or 紅茶 を じっくり 飲む 時間 を 作って。'],
    ['name' => '小吉', 'icon' => '📚', 'msg' => '気になっていた 文献 を 一本 読了 すると 運気アップ。'],
    ['name' => '小吉', 'icon' => '🎵', 'msg' => '好きな 曲 を 一日 一回 聴くと 流れが 整う。'],
    ['name' => '小吉', 'icon' => '🚶', 'msg' => '昼休み 散歩 が 吉。 5 分 でも 外の 空気 を。'],
    ['name' => '吉',   'icon' => '☕', 'msg' => 'いつもの ペース で 進めば OK。 焦らず じっくり。'],
    ['name' => '吉',   'icon' => '🧠', 'msg' => '考えるより 先に 手を動かす と 良い 1 日。'],
    ['name' => '吉',   'icon' => '🗒', 'msg' => 'メモを 取りながら 動くと 後で 助かる。'],
    ['name' => '吉',   'icon' => '🤝', 'msg' => '隣の人 に 話しかけてみよう。 思わぬ 解が 見つかる。'],
    ['name' => '末吉', 'icon' => '🌧', 'msg' => '雨でも 気にしない。 室内で 集中 タスク 消化 に 向く 日。'],
    ['name' => '末吉', 'icon' => '🛌', 'msg' => '少し 疲れ気味。 早めの 就寝 で 整える。'],
    ['name' => '末吉', 'icon' => '🍱', 'msg' => 'いつもと 違う 昼食 を 選ぶと 気分転換 に 良い。'],
    ['name' => '末吉', 'icon' => '🧹', 'msg' => 'デスクの 整理 が 運気を 呼ぶ。'],
    ['name' => '凶',   'icon' => '🌀', 'msg' => '今日は 大胆な 決断は 避けて。 明日 改めて 判断を。'],
    ['name' => '凶',   'icon' => '⚠️', 'msg' => '失くしもの に 注意。 大事なものは ポケットを 確認。'],
    // ジョーク 系
    ['name' => '神吉', 'icon' => '👑', 'msg' => '今日の あなた は 無敵。 でも 調子 に 乗ると 凶 に なる。'],
    ['name' => '猫吉', 'icon' => '🐱', 'msg' => '猫の 動画 を 1 本 見ると 集中力 が 戻る。'],
    ['name' => '麻吉', 'icon' => '🀄', 'msg' => '今日 ロン を 言うと 当たる。 麻雀でも 議論でも。'],
    ['name' => '研吉', 'icon' => '🔬', 'msg' => '実験 デザイン に 1 つ 工夫 を 入れると 化ける。'],
    ['name' => '論吉', 'icon' => '📄', 'msg' => '紙原稿 の 一文 を 削ぎ落とすと 引き締まる。'],
    ['name' => '読吉', 'icon' => '📖', 'msg' => '積読 の 1 冊 を 開く 日。'],
    ['name' => '飯吉', 'icon' => '🍜', 'msg' => '美味しい 食事 を ちゃんと 取ろう。 食べある記 に 投稿 で 運気 倍 加。'],
    ['name' => '走吉', 'icon' => '🏃', 'msg' => '体を 動かすと 頭が 軽くなる。 散歩 アプリ を 開いて。'],
    ['name' => '眠吉', 'icon' => '😴', 'msg' => '昼寝 を 15 分。 戻ってきた 集中力 で 一気に。'],
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
