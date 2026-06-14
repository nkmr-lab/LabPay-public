-- v600 #231 ユーザ 誕生日。 月日 (mmdd 形式) を保存。 年は任意 (NULL なら年齢非公開)
ALTER TABLE users ADD COLUMN birthday_md CHAR(5) NULL COMMENT 'MM-DD JST';
ALTER TABLE users ADD COLUMN birthday_year SMALLINT NULL COMMENT '西暦 (任意)';
