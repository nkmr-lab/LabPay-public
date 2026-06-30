#!/usr/bin/env python3
# v886 LabPay Overleaf project tracker — periodic snapshot collector.
#
# 役割:
#   pyoverleaf で教員 Overleaf アカウント (cookie 認証) に login →
#   全共有プロジェクト一覧 + 各 .tex ファイル取得 → 文字数を集計 →
#   labpay の MariaDB の overleaf_* テーブルに snapshot として投入。
#
# セットアップ (production = pay.nkmr.io):
#   1) venv を用意:
#        sudo mkdir -p /var/www/labpay/.venv-overleaf
#        sudo chown apache:apache /var/www/labpay/.venv-overleaf
#        sudo -u apache python3 -m venv /var/www/labpay/.venv-overleaf
#        sudo -u apache /var/www/labpay/.venv-overleaf/bin/pip install pyoverleaf pymysql
#   2) cookie 設定 — /var/www/labpay/config/config.php に overleaf.olauth_cookie を追加:
#        'overleaf' => [
#          'olauth_cookie' => '<長い hex 文字列>',  // ブラウザ DevTools > Cookies > overleaf.com > overleaf_session の値
#        ],
#      cookie 取得手順:
#        - chrome で overleaf.com に login (中村アカウント)
#        - DevTools > Application > Cookies > https://www.overleaf.com
#        - 「overleaf_session」 の Value をコピー (s%3A... で始まる長い文字列)
#   3) 初回手動実行:
#        sudo -u apache /var/www/labpay/.venv-overleaf/bin/python /var/www/labpay/scripts/overleaf_collector.py
#   4) systemd timer (/etc/systemd/system/labpay-overleaf.service + .timer) で 1 時間おきに自動実行:
#        --- labpay-overleaf.service ---
#        [Unit]
#        Description=LabPay Overleaf project snapshot collector
#        [Service]
#        Type=oneshot
#        User=apache
#        ExecStart=/var/www/labpay/.venv-overleaf/bin/python /var/www/labpay/scripts/overleaf_collector.py
#        --- labpay-overleaf.timer ---
#        [Unit]
#        Description=Run LabPay Overleaf collector hourly
#        [Timer]
#        OnCalendar=hourly
#        Persistent=true
#        [Install]
#        WantedBy=timers.target
#        ---
#        sudo systemctl daemon-reload
#        sudo systemctl enable --now labpay-overleaf.timer
#
# 文字数カウント方式:
#   - total_char_count: ファイルの文字数 (mb 単位、 改行込み)
#   - total_char_body : % コメント行と \\command{} 引数を簡易除いた本文文字数
#   - total_jp_char_count: 漢字 (一-鿿) + ひらがな (぀-ゟ) + カタカナ (゠-ヿ) のみ
#   - total_word_count: 空白区切り word 数 (本文文字列から)

import os
import re
import sys
import json
import traceback
from datetime import datetime, timezone

# ---- config ロード ----
LABPAY_ROOT = '/var/www/labpay'
CONFIG_PATH = os.path.join(LABPAY_ROOT, 'config', 'config.php')

def parse_labpay_config(path):
    """config.php を簡易 PHP パース (return [...] 形式限定)。 必要なキーだけ取り出す。"""
    # PHP を起動して JSON で吐かせるのが一番確実。
    import subprocess
    php_snippet = (
        "<?php $c = require '%s'; "
        "echo json_encode(['db' => $c['db'] ?? null, 'overleaf' => $c['overleaf'] ?? null]);"
    ) % path
    r = subprocess.run(['php', '-r', php_snippet], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

# ---- 文字数カウンタ ----
RE_COMMENT  = re.compile(r'(?<!\\)%[^\n]*')          # 行末までの % コメント (\\% はエスケープ)
RE_TEX_CMD  = re.compile(r'\\[a-zA-Z@]+\*?')         # \section, \emph 等 (引数は残す)
RE_BRACKETS = re.compile(r'\[[^\]\n]*\]')            # [optional] 引数
RE_JP       = re.compile(r'[一-鿿぀-ゟ゠-ヿ]')
RE_WS       = re.compile(r'\s+')

def count_chars(content: str) -> dict:
    total = len(content)
    # body = comment 除去 + cmd 名除去 + [optional] 除去したものの文字数
    no_comment = RE_COMMENT.sub('', content)
    no_cmd     = RE_TEX_CMD.sub('', no_comment)
    no_opt     = RE_BRACKETS.sub('', no_cmd)
    # 中の '{' '}' は残すが、 視覚的ノイズが多いので落とす
    body = no_opt.replace('{', '').replace('}', '').replace('$', '')
    body_chars = sum(1 for ch in body if not ch.isspace())
    jp_chars = len(RE_JP.findall(body))
    words = len(RE_WS.split(body.strip())) if body.strip() else 0
    return {
        'total': total,
        'body':  body_chars,
        'jp':    jp_chars,
        'word':  words,
    }

# ---- main ----
def main():
    cfg = parse_labpay_config(CONFIG_PATH)
    db_cfg = cfg.get('db') or {}
    ovl_cfg = cfg.get('overleaf') or {}
    cookie = ovl_cfg.get('olauth_cookie') or os.environ.get('OVERLEAF_OLAUTH_COOKIE')
    if not cookie:
        print("ERROR: overleaf.olauth_cookie が config.php に未設定 (or env OVERLEAF_OLAUTH_COOKIE)", file=sys.stderr)
        sys.exit(2)

    # DB 接続
    import pymysql
    dsn = db_cfg.get('dsn') or ''
    # dsn 例: 'mysql:host=localhost;dbname=labpay;charset=utf8mb4'
    parts = dict(kv.split('=') for kv in dsn.replace('mysql:', '').split(';') if '=' in kv)
    conn = pymysql.connect(
        host=parts.get('host', 'localhost'),
        user=db_cfg['user'],
        password=db_cfg['pass'],
        db=parts.get('dbname'),
        charset='utf8mb4',
        autocommit=False,
    )

    # collector_run row を先に作って進捗を残す
    with conn.cursor() as cur:
        cur.execute("INSERT INTO overleaf_collector_runs (started_at) VALUES (NOW())")
        run_id = cur.lastrowid
        conn.commit()

    err_msg = None
    projects_seen = 0
    ok = False
    try:
        import pyoverleaf
        api = pyoverleaf.Api()
        api.login_from_cookies({'overleaf_session': cookie})
        projects = api.list_projects()
        for p in projects:
            try:
                proj_id = _upsert_project(conn, p)
                _take_snapshot(conn, api, p, proj_id)
                projects_seen += 1
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"  ! project {p.id} ({p.name}): {e}", file=sys.stderr)
        ok = True
    except Exception as e:
        err_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()[:500]}"
        print("FATAL:", err_msg, file=sys.stderr)
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE overleaf_collector_runs SET finished_at=NOW(), ok=%s, projects_seen=%s, error_msg=%s WHERE id=%s",
                (1 if ok else 0, projects_seen, err_msg, run_id))
            conn.commit()
        conn.close()
    if not ok:
        sys.exit(1)
    print(f"✓ done: {projects_seen} projects")

def _upsert_project(conn, p):
    """overleaf_projects に upsert して project_id を返す。"""
    last_remote = getattr(p, 'last_updated', None) or getattr(p, 'lastUpdated', None)
    if isinstance(last_remote, datetime):
        last_remote = last_remote.strftime('%Y-%m-%d %H:%M:%S')
    owner_email = None
    owner_name  = None
    owner = getattr(p, 'owner', None)
    if owner:
        owner_email = getattr(owner, 'email', None) or (owner.get('email') if isinstance(owner, dict) else None)
        first = getattr(owner, 'first_name', None) or (owner.get('first_name') if isinstance(owner, dict) else '') or ''
        last  = getattr(owner, 'last_name', None) or (owner.get('last_name') if isinstance(owner, dict) else '') or ''
        owner_name = (f"{first} {last}").strip() or None

    is_archived = 1 if getattr(p, 'archived', False) else 0
    is_trashed  = 1 if getattr(p, 'trashed',  False) else 0
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO overleaf_projects
              (overleaf_id, name, owner_email, owner_name, last_remote_updated_at, is_archived, is_trashed)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              owner_email = VALUES(owner_email),
              owner_name = VALUES(owner_name),
              last_remote_updated_at = VALUES(last_remote_updated_at),
              is_archived = VALUES(is_archived),
              is_trashed = VALUES(is_trashed)
        """, (p.id, p.name, owner_email, owner_name, last_remote, is_archived, is_trashed))
        cur.execute("SELECT id FROM overleaf_projects WHERE overleaf_id = %s", (p.id,))
        return cur.fetchone()[0]

def _take_snapshot(conn, api, p, proj_id):
    """1 project の全 .tex を取得して snapshot を 1 件作成。"""
    # ファイルツリーを取得 — pyoverleaf API 経由で project の files を列挙。
    project_io = api.project(p.id) if hasattr(api, 'project') else None
    file_entries = []
    if project_io and hasattr(project_io, 'walk_files'):
        for f in project_io.walk_files():
            path = getattr(f, 'path', None) or '/'.join(getattr(f, 'folder_path', []) + [f.name])
            if path.endswith('.tex'):
                file_entries.append((f, path))
    elif hasattr(api, 'project_files'):
        for path in api.project_files(p.id):
            if path.endswith('.tex'):
                file_entries.append((path, path))
    else:
        raise RuntimeError("pyoverleaf API に walk_files / project_files が見つかりません — version 違いかも")

    if not file_entries:
        return  # 本文 .tex 無し → snapshot しない

    with conn.cursor() as cur:
        cur.execute("INSERT INTO overleaf_snapshots (project_id, file_count) VALUES (%s, %s)",
                    (proj_id, len(file_entries)))
        snap_id = cur.lastrowid

        tot = {'total': 0, 'body': 0, 'jp': 0, 'word': 0}
        for fobj, path in file_entries:
            try:
                if hasattr(fobj, 'get_content'):
                    raw = fobj.get_content()
                elif hasattr(api, 'project_file_content'):
                    raw = api.project_file_content(p.id, path)
                else:
                    continue
                content = raw.decode('utf-8', errors='replace') if isinstance(raw, (bytes, bytearray)) else str(raw)
            except Exception as e:
                print(f"  ! {p.name}::{path}: {e}", file=sys.stderr)
                continue
            c = count_chars(content)
            tot['total'] += c['total']; tot['body'] += c['body']; tot['jp'] += c['jp']; tot['word'] += c['word']
            cur.execute("""
                INSERT INTO overleaf_file_snapshots
                  (snapshot_id, file_path, char_count_total, char_count_body, jp_char_count, word_count)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (snap_id, path[:500], c['total'], c['body'], c['jp'], c['word']))
        cur.execute("""
            UPDATE overleaf_snapshots
            SET total_char_count=%s, total_char_body=%s, total_jp_char_count=%s, total_word_count=%s
            WHERE id=%s
        """, (tot['total'], tot['body'], tot['jp'], tot['word'], snap_id))

if __name__ == '__main__':
    main()
