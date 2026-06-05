-- 募集 (invitations) 詳細画面の 「ショートカット」 アプリ群を 募集ごとに
-- ON/OFF できるように。 NULL = 全 ON (後方互換)、 配列 = その ID のみ ON。
-- ID は groups の feat_actions と 同じ規約 (roulette / nomikai / polls /
-- rollcalls / timers / meetups)。 受取側で 不明 ID は 無視。
ALTER TABLE invitations
  ADD COLUMN feat_actions JSON NULL AFTER capacity;
