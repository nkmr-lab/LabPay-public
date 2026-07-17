<?php
// LabPay front controller. Apache rewrites /api/* to this file.

declare(strict_types=1);

require_once __DIR__ . '/../../src/bootstrap.php';
// $CFG, $PDO, helpers, and handlers are all available.

// Wall clock for activity_log duration_ms.
$reqStart = microtime(true);

// Parse request
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/';

// Strip leading /api
$prefix = '/api';
if (strpos($uri, $prefix) === 0) {
    $path = substr($uri, strlen($prefix));
} else {
    $path = $uri;
}
if ($path === '' || $path === false) $path = '/';
$seg = path_segments($path);

// v932 CORS: `*.nkmr.io` (と例外で明示リスト) は許可。中村さんの完全コントロール下のドメインのみ。
//   preflight (OPTIONS) は認証前に早期返却する必要があるのでこの位置。
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOriginRe = '#^https://[a-z0-9][a-z0-9-]*\.nkmr\.io$#i';
if ($origin !== '' && preg_match($allowedOriginRe, $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization');
    header('Access-Control-Max-Age: 600');   // preflight を 10 分キャッシュ
    header('Vary: Origin');                  // CDN / 中間キャッシュ汚染防止
    if ($method === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// Always JSON (OPTIONS より後、通常 dispatch より前)。
header('Content-Type: application/json; charset=utf-8');

// Dispatch table — URL 第1セグメント → route_* 関数。新しいリソースは
// ここに 1 行追加するだけで生える。複雑な権限/前処理が要るときは route_*
// 関数の中で済ませる方針 (front controller には残さない)。
$routes = [
    'auth'           => 'route_auth',
    'me'             => 'route_me',
    'users'          => 'route_users',           // me.php に居る軽い一覧
    'products'       => 'route_products',
    'listings'       => 'route_listings',
    'purchases'      => 'route_purchases',
    'checkins'       => 'route_checkins',
    'sellers'        => 'route_sellers',
    'notifications'  => 'route_notifications',
    'admin'          => 'route_admin',
    'presence'       => 'route_presence',
    'uploads'        => 'route_uploads',
    'tasks'          => 'route_tasks',
    'transfers'      => 'route_transfers',
    'network'        => 'route_network',
    'feedback'       => 'route_feedback',
    'wishlist'       => 'route_wishlist',
    'invitations'    => 'route_invitations',
    'roulettes'      => 'route_roulettes',
    'nomikai'        => 'route_nomikai',
    'groups'         => 'route_groups',          // ad-hoc groups
    'scrapbox'       => 'route_scrapbox',
    'cosense'        => 'route_cosense',          // v821 Cosense (旧 Scrapbox) 直接連携
    'fx'             => 'route_fx',
    'random-groups'  => 'route_random_groups',
    'orderings'      => 'route_orderings',
    'regions'        => 'route_regions',
    'health'         => 'route_health',
    'workouts'       => 'route_workouts',
    'walk'           => 'route_walk',
    'shiritori'      => 'route_shiritori',
    'tierlists'      => 'route_tierlists',
    'mahjong'        => 'route_mahjong',
    'ito'            => 'route_ito',
    'jinrou'         => 'route_jinrou',
    'money-requests' => 'route_money_requests',
    'bait'           => 'route_bait',
    'custom-widgets' => 'route_custom_widgets',
    'cg2'            => 'route_cg2',
    'chat'           => 'route_chat',
    'conf-deadlines' => 'route_conf_deadlines',
    'news'           => 'route_news',
    'screen-shares'  => 'route_screen_shares',
    'file-transfers' => 'route_file_transfers',
    'polls'          => 'route_polls',
    'rollcalls'      => 'route_rollcalls',
    'timers'         => 'route_timers',
    'notices'        => 'route_notices',
    'meetups'        => 'route_meetups',
    'places'         => 'route_places',
    'refs'           => 'route_refs',        // v925 文献管理
    'kanban'         => 'route_kanban',      // v934 かんばんボード
    'buy-requests'   => 'route_buy_requests',// v1080 購入依頼 (#want_to_buy 後継)
    'joint-events'   => 'route_joint_events',// v941 合同研究会用投票
    'public-codes'   => 'route_public_codes',// v941 公開機能の 4 桁短縮コード
    'public-polls'   => 'route_public_polls',// v942 公開投票 (誰でも投票)
    'album-thumbs'   => 'route_album_thumbs',// v964 Google Photos アルバムサムネキャッシュ
    'nkmr-albums'    => 'route_nkmr_albums', // v970 中村研アルバム DB CRUD
    'expenses'       => 'route_expenses',    // v1002 個人家計簿
    'authors'        => 'route_authors',     // v1004 著者ページ
    'power'          => 'route_power',       // v1026 サンプルサイズ / 検定力の保存 + 共有
    'posts'          => 'route_posts',
    'todos'          => 'route_todos',
    'sounds'         => 'route_sounds',
    'auctions'       => 'route_auctions',
    'exercise'       => 'route_exercise',
    'playlists'      => 'route_playlists',
    'stopwatches'    => 'route_stopwatches',
    'ai'             => 'route_ai',
    'predictions'    => 'route_predictions',
    'fortune'        => 'route_fortune',
    'othello'        => 'route_othello',
    'bingo'          => 'route_bingo',
    'bingofit'       => 'route_bingofit',
    'daifugo'        => 'route_daifugo',
    'score_predictions' => 'route_score_predictions',
    'custom-games'   => 'route_custom_games',
    'drafts'         => 'route_drafts',
    'quizzes'        => 'route_quizzes',
    'quotes'         => 'route_quotes',     // v804 名言
    'zemi-videos'    => 'route_zemi_videos', // v843 #426 ゼミ動画 (YouTube limited)
    'share'          => 'route_share',       // v853 タイトル+URL をメンバーに共有
    'conquest'       => 'route_conquest',    // v860 #445 制覇リスト (ユーザ作成)
    'habits'         => 'route_habits',      // v870 #452 Habit Tracker
    'buzzer'         => 'route_buzzer',      // v872 #454 早押しクイズ
    'overleaf'       => 'route_overleaf',    // v886 Overleaf プロジェクト追跡
    'miro'           => 'route_miro',        // v1100 Miro 的な共同ポストイット空間
    'tomorrow-lab'   => 'route_tomorrow_lab', // v1119 明日、研究室に一緒に行こう
    'pres-order'     => 'route_pres_order',   // v1120 発表順オークション
    'trading-cards'  => 'route_trading_cards', // v1121 ゼミ人トレカ + ガチャ
    'tickets'        => 'route_tickets',       // v1122 チケット生成アプリ
    'labo-eats'      => 'route_labo_eats',     // v1123 ラーボーイーツ (研究室版 UBER EATS)
    'profile-book'   => 'route_profile_book',  // v1124 プロフ帳 (平成デザ)
    'research-ai'    => 'route_research_ai',   // v1125 研究特化 AI サブスク
    'setlog'         => 'route_setlog',        // v1126 setlog (LabPay 版 Vlog)
    'bokete'         => 'route_bokete',        // v1147 bokete (画像大喜利)
];

try {
    // CSRF guard for state-changing methods (skipped on OAuth callback because Google redirects via GET).
    require_csrf_header($method);

    $first = $seg[0] ?? '';
    if (isset($routes[$first])) {
        $routes[$first]($PDO, $CFG, $method, $seg);
        return;
    }

    throw new ApiException('not_found', "no route for $method $path", 404);

} catch (ApiException $e) {
    json_error($e->errCode, $e->getMessage(), $e->httpStatus, $e->details);
} catch (Throwable $e) {
    // Hide internals from clients; logs still get the real message.
    error_log('[labpay] ' . $e::class . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    json_error('server_error', 'internal server error', 500);
} finally {
    // Activity log — written after the response is dispatched so a slow insert
    // never blocks the user. Failures are swallowed (logging must never break
    // the API).
    try {
        activity_log_write($PDO, $CFG, $method, $path, http_response_code() ?: 200,
            (int)round((microtime(true) - $reqStart) * 1000));
    } catch (Throwable $_) { /* swallow */ }
}
