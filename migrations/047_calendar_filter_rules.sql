-- 今日の予定 (Google Calendar) で非表示にする個人ルールを users 単位で保存。
-- JSON 配列で、各要素は {pattern, regex?: true}。
-- regex 未指定 → タイトル部分一致 (mb_stripos)、regex=true → preg_match。
-- どれか 1 つにマッチすればその予定を hide (OR)。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendar_filter_rules TEXT NULL
    COMMENT 'JSON array of {pattern, regex?}; events whose title matches any rule are hidden';
