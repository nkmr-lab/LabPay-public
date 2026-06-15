-- v620 自作ゲームの 場代 を ゲーム提供者 (kind 登録者) に 入れられるように。
--   provider_share_pct: pot のうち 提供者に 渡す 割合 (%)。 0-50。
--   勝者 確定時のみ rake される (引分 / cancel は 通常通り 返金)。
--   provider が プレイヤー (creator or opponent) の場合も 同じく rake (= 提供者特権)。
--   provider が 未設定 (created_by_user_id IS NULL = 古い admin 登録) なら rake せず。
ALTER TABLE custom_game_kinds
  ADD COLUMN provider_share_pct TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER fee;
