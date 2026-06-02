-- Google Calendar 連携: incremental authorization で calendar.readonly を取得し、
-- token を users に保存。複数 calendar を持つ人向けに、表示対象を JSON で持つ
-- (NULL = primary のみ、JSON 配列 = ID リスト)。
-- 注意: access_token / refresh_token は機密。アプリ層で読み出し時に必ず
-- セッションユーザーと一致するチェックを通す。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendar_access_token       VARCHAR(2048) NULL,
  ADD COLUMN IF NOT EXISTS calendar_refresh_token      VARCHAR(2048) NULL,
  ADD COLUMN IF NOT EXISTS calendar_token_expires_at   DATETIME NULL,
  ADD COLUMN IF NOT EXISTS calendar_selected_ids       TEXT NULL COMMENT 'JSON array of calendar IDs the user wants visible',
  ADD COLUMN IF NOT EXISTS calendar_connected_at       DATETIME NULL;
