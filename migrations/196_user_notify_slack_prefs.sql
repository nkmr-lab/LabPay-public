-- v959 fb#476 通知の Slack 配信 を カテゴリ 別 に ON/OFF 設定 できる ように。
--   LabPay 内 の 通知 は 常に ON、 Slack DM だけ カテゴリ で 制御。
--   category は money / action / social / utility / game / reward / admin。
--   row が 無ければ default ON (= 従来 通り)。 UI で OFF に した もの だけ 明示 row。

CREATE TABLE user_notify_slack_prefs (
    user_id      INT         NOT NULL,
    category     VARCHAR(20) NOT NULL,     -- 'money' / 'action' / etc
    enabled      TINYINT(1)  NOT NULL DEFAULT 1,
    updated_at   DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, category)
    -- FK は 型 不一致 で MariaDB が 弾く 場合 が あった ので 省略。
    --   user が 削除 された 際 の 掃除 は 別途 script で。
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
