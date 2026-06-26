-- v839 Cosense 連携を Personal Access Token (PAT) に一本化。
-- legacy connect.sid cookie 経路を廃止 (PAT があれば不要だったため)。
-- users.cosense_session_cookie 列を削除。

ALTER TABLE users DROP COLUMN cosense_session_cookie;
