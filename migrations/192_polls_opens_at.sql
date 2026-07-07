-- v940 投票 の 公開タイミング 予約。
-- opens_at NULL = 従来通り 即公開、 未来日時 = その時刻 まで status='scheduled' で 隠す。
-- sweep で opens_at <= NOW() を open へ 遷移。 起案者 だけ scheduled も 見え、
-- 対象 voter や 他ユーザ には 一覧 / 詳細 とも 露出させない。

ALTER TABLE polls ADD COLUMN opens_at DATETIME NULL AFTER deadline_at;
ALTER TABLE polls MODIFY COLUMN status ENUM('scheduled','open','closed') NOT NULL DEFAULT 'open';
ALTER TABLE polls ADD KEY idx_scheduled_opens (status, opens_at);
