-- Zoom 連携: User-managed OAuth 2.0 で各ユーザの Zoom アカウントへの代理権限を
-- 預かり、 LabPay から meetings.create を叩いて Zoom MTG を生成する。
-- access_token は 1 時間、 refresh_token は 90 日 (操作で延びる) が Zoom の規約。
-- expires_at は早めに切らして refresh するため UTC で持つ。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zoom_access_token       VARCHAR(2000) NULL,
  ADD COLUMN IF NOT EXISTS zoom_refresh_token      VARCHAR(2000) NULL,
  ADD COLUMN IF NOT EXISTS zoom_token_expires_at   DATETIME      NULL,
  ADD COLUMN IF NOT EXISTS zoom_user_id            VARCHAR(64)   NULL,
  ADD COLUMN IF NOT EXISTS zoom_email              VARCHAR(255)  NULL;
