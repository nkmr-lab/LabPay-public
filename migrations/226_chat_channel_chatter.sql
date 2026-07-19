-- v1163 中村さん要望「重要、連絡、相談、雑談の 4 つにするかな」
-- 4 つ目の チャンネル として 雑談 (chatter) を追加。 3-pane から 4-pane に切り替え。
INSERT INTO chat_channels (slug, name, icon, description, sort_order)
VALUES ('chatter', '雑談', '☕', '軽い雑談 / つぶやき / 独り言 OK な場所', 4)
ON DUPLICATE KEY UPDATE name=VALUES(name), icon=VALUES(icon), description=VALUES(description), sort_order=VALUES(sort_order);
