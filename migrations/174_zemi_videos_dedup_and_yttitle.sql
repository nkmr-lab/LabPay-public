-- v849 #435 #436 ゼミ動画の整理。
--   (1) YouTube タイトル を 別カラム (youtube_title) で保持できるように
--   (2) 既存の重複登録 (同じ youtube_id が複数行) を 最古の 1 行に絞り込む
--   (3) youtube_id に UNIQUE 制約を追加 (今後の重複防止)

ALTER TABLE zemi_videos ADD COLUMN youtube_title VARCHAR(300) NULL AFTER title;
ALTER TABLE zemi_videos ADD COLUMN youtube_author VARCHAR(200) NULL AFTER youtube_title;

-- 重複削除: 各 youtube_id について 最小 id 以外を消す
DELETE FROM zemi_videos
 WHERE id NOT IN (
   SELECT keep_id FROM (
     SELECT MIN(id) AS keep_id FROM zemi_videos GROUP BY youtube_id
   ) AS t
 );

-- UNIQUE 制約
ALTER TABLE zemi_videos ADD UNIQUE KEY uq_youtube_id (youtube_id);
