-- v741 BingoFit Phase 2: 「最近着てない服」 サジェスト 用 に items.last_worn_at を denormalize。
--   cell_open のたびに cells_json[idx] を 引いて 該当 item の last_worn_at = NOW() に。
--   そうしないと 毎回 全 board の JSON を 走査する 羽目 に なる。

ALTER TABLE bingofit_items
    ADD COLUMN last_worn_at DATETIME DEFAULT NULL,
    ADD KEY idx_user_last_worn (user_id, last_worn_at);
