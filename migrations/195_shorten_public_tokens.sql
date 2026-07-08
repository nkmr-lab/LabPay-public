-- v945 公開URL の token を 短縮 (32 hex → 8 hex 前提)。 既存 値 も 動く よう VARCHAR に。
ALTER TABLE joint_events MODIFY COLUMN public_token VARCHAR(32) NOT NULL;
ALTER TABLE public_polls MODIFY COLUMN public_token VARCHAR(32) NOT NULL;
