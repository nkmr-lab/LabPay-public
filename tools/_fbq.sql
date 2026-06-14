SELECT id, user_id, kind, body, url, created_at FROM feedback WHERE claude_status = 'approved' ORDER BY id ASC LIMIT 5\G
