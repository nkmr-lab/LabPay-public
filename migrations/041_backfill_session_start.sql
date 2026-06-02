-- migration 015 以前から残ってる presence_seen 行は session_start_at が
-- NULL のままになっている (= 滞在時間が "-" 表示)。scanner の ON DUPLICATE
-- KEY UPDATE は NULL なら埋めるはずだが、なぜか 中村 (id=3) で残って
-- いるケースがある。手で一括埋めておく:
--   session_start_at: 取れるなら first_seen_at, それも NULL なら last_seen_at
UPDATE presence_seen
   SET session_start_at = COALESCE(first_seen_at, last_seen_at)
 WHERE session_start_at IS NULL;

-- first_seen_at の NULL も last_seen_at で埋めておく (migration 005 で
-- 一度埋めているが、その後に古い構造でレコードができた可能性に備える)。
UPDATE presence_seen
   SET first_seen_at = last_seen_at
 WHERE first_seen_at IS NULL;
