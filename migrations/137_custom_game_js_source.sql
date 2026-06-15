-- v620 自作ゲームの JS module を DB に格納できるように。
--   js_source: アップロードされた JS ソース (LONGTEXT、 最大 500KB 想定)
--   js_size:   bytes
-- js_source があれば 配信エンドポイント /api/custom-games/kinds/:kind/script.js
-- で 返す。 無ければ 既存の js_module_url (静的ファイル) に フォールバック。
ALTER TABLE custom_game_kinds
  ADD COLUMN js_source LONGTEXT NULL AFTER js_module_url,
  ADD COLUMN js_size INT UNSIGNED NULL AFTER js_source;
