-- v340 グループの ON/OFF 対象を拡張。
--   * feat_wari: ワリカ (立替 → 精算) を 使うか。
--   * feat_actions: アクションボタン群 (レシート / 支出 / ルーレット / 飲み会割り勘 /
--     投票 / 点呼 / タイマー / 待ち合わせ) の有効リスト JSON。 NULL の時は全 ON
--     (後方互換)。
ALTER TABLE adhoc_groups
  ADD COLUMN feat_wari    TINYINT(1) NOT NULL DEFAULT 1 AFTER feat_flight,
  ADD COLUMN feat_actions JSON       NULL              AFTER feat_wari;
