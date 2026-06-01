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
  //   bot_token: Bot User OAuth Token (xoxb-) for READING channel history. Needed only
  //     for the Scrapbox-via-Slack contribution counter. Scopes: channels:history
  //     (public) or groups:history (private). Bot must be /invite-d to the channel.
  //   scrapbox_channel_id: Cxxxxxxxxxx — the channel where Scrapbox edit notifications
  //     are posted. Leave empty to disable the Scrapbox bridge.
  // Leave any field empty to disable the corresponding feature.
  'slack' => [
    'webhook_url'         => '',
    'bot_token'           => '',
    'scrapbox_channel_id' => '',
  ],

  // Feature flags (used by require_exposure() guards in handlers).
  'exposure' => [
    'public_read'    => true,
    'listings_write' => true,
    'purchase'       => true,
  ],
];
