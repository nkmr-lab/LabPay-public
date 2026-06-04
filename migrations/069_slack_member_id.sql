-- ユーザが自身の Slack member ID を登録できるように。 設定済みの場合のみ、
-- アプリ内通知と同じ内容を Slack DM (chat.postMessage) でも届ける。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS slack_member_id VARCHAR(40) NULL;
