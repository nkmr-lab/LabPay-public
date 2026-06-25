-- v823 #cosense Phase B 各 ユーザ の Cosense PAT (Personal Access Token) 列。
-- v2 API (`x-personal-access-token` ヘッダ) で 読み取り + 書き込み を 本人 名義 で 行う ため。
-- Phase A で 入れた cosense_session_cookie は 残し ますが、 PAT が 優先 されます。
ALTER TABLE users
  ADD COLUMN cosense_pat VARCHAR(200) NULL AFTER cosense_session_cookie;
