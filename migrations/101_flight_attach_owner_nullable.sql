-- v459 航空券 添付ファイル の owner_user_id を NULL 許可 に。
-- 「まず PDF を D&D で 何枚か アップ → 後で 「これは 〇〇さん の」 と 紐付け」
-- の フロー に 対応 する ため。 NULL = 未割当 (フロント で 「未割当」 セクションに 表示)。
ALTER TABLE adhoc_group_flight_attachments
  MODIFY COLUMN owner_user_id BIGINT NULL;
