<?php
// LabPay configuration sample.
// Copy to config/config.php and edit. config/config.php is gitignored.

return [
  'db' => [
    'dsn'  => 'mysql:host=127.0.0.1;dbname=labpay;charset=utf8mb4',
    'user' => 'labpay',
    'pass' => 'CHANGE_ME',
  ],

  'app' => [
    // No trailing slash. Used to build OAuth redirect URI.
    'base_url'        => 'https://pay.example.ac.jp',
    'cookie_name'     => 'labpay_sid',
    'cookie_secure'   => true,                  // HTTPS required in production
    'cookie_samesite' => 'Lax',
    'timezone'        => 'Asia/Tokyo',
  ],

  'auth' => [
    // Google OAuth credentials (see https://console.cloud.google.com/apis/credentials).
    // Add `<base_url>/api/auth/callback` to "Authorized redirect URIs".
    'google_oauth_enabled' => false,
    'google_client_id'     => 'YOUR_CLIENT_ID.apps.googleusercontent.com',
    'google_client_secret' => 'YOUR_CLIENT_SECRET',
    // Dev login uses the allowlist directly — fine for testing, MUST be false in production.
    'dev_login_enabled'    => false,
    // Bootstrap admin: auto-added to allowlist with role=admin on first request.
    'bootstrap_admin_email' => 'you@example.com',
    // auth.nkmr.io ホストされた profile store。 Slack Member ID / Cosense PAT 等の
    // 「アプリ横断で共有したいユーザ設定」を LabPay ではなく auth.nkmr.io 側に集約する。
    //   base_url    : auth サービスの URL (通常 https://auth.nkmr.io)
    //   service_key : auth 側 /etc/nkmrauth/profile_services.php で 'labpay' に紐づけた共有シークレット
    //                 → 未設定なら AuthProfile 経由の呼び出しは 401/403 で失敗する。
    'base_url'    => 'https://auth.nkmr.io',
    'service_key' => '',
  ],

  'mail' => [
    'enabled' => false,
    'from'    => 'LabPay <no-reply@example.ac.jp>',
  ],

  // Rakuten Ichiba Item Search API (used to auto-fill product name/image from JAN).
  // Register at https://webservice.rakuten.co.jp/app/create as "API バックエンドサービス"
  // and allowlist the server's egress IP. Leave keys empty to disable (manual entry only).
  'rakuten' => [
    'application_id' => '',
    'access_key'     => '',
  ],

  // Slack integration.
  //   webhook_url: Incoming webhook for outbound notifications (商品入荷, タスク追加など).
  //     Create at https://api.slack.com/apps -> Incoming Webhooks -> Add to channel.
  //   bot_token: Bot User OAuth Token (xoxb-) for the notification/DM bot. Used by
  //     Notifier::notify slack DM, slack_notify, etc. Scopes typically chat:write 等。
  //   scrapbox_bot_token: (v794) Optional separate Bot User token used ONLY for
  //     reading the Scrapbox channel history (= conversations.history). When the
  //     reader is a separate Slack App (e.g. "LabPay scrapbox reader") whose only
  //     scope is channels:history, set it here and leave the main bot_token as the
  //     notifications bot. Falls back to bot_token if empty.
  //   scrapbox_channel_id: Cxxxxxxxxxx — the channel where Scrapbox edit notifications
  //     are posted. Leave empty to disable the Scrapbox bridge.
  // Leave any field empty to disable the corresponding feature.
  'slack' => [
    'webhook_url'         => '',
    'bot_token'           => '',
    'scrapbox_bot_token'  => '',  // v794 reader 専用 (channels:history のみ の 別 アプリ)
    'scrapbox_channel_id' => '',
  ],

  // OpenAI (used by /api/ai/* — フリーフォームの 予定テキスト 展開 など)。
  // 空文字 で 機能ごと 無効。
  'openai' => [
    'api_key' => '',
    'model'   => 'gpt-4o-mini',
  ],

  // Feature flags (used by require_exposure() guards in handlers).
  'exposure' => [
    'public_read'    => true,
    'listings_write' => true,
    'purchase'       => true,
  ],
];
