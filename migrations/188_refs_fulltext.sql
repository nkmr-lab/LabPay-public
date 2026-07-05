-- v930 refs: PDF 全文 検索 用 に fulltext 列 を 追加。
-- MariaDB の FULLTEXT INDEX は 日本語 ngram 非対応 なので LIKE 検索 に フォールバック
-- (ラボ 規模 なら 数千 refs でも 実用速度)。
ALTER TABLE refs ADD COLUMN `fulltext` MEDIUMTEXT NULL AFTER extra_json;
