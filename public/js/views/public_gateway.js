// /#/public — 公開機能 の 短縮 コード ゲートウェイ (v941)。
// 4-8 桁 の 数字 を 入力 → /api/public-codes/{code} で 対応 する 公開 URL を 引いて 飛ぶ。
// 未認証 で 開ける (auth の allowlist に 追加済)。

import { escapeHtml } from '../router.js';

export async function renderPublicGateway() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card" style="text-align:center; max-width:500px; margin:20px auto">
      <h1 style="color:#4a106d; font-size:24px; margin:12px 0 4px">🌐 公開機能</h1>
      <p style="color:#6b7280; font-size:13px; margin:4px 0 20px">
        受け取った 4 桁の コードを 入力してください
      </p>
      <input type="text" id="pg-code" maxlength="8" pattern="[0-9]*" inputmode="numeric"
             placeholder="1234"
             style="font-size:28px; text-align:center; letter-spacing:6px; padding:12px;
                    width:200px; border:2px solid #d1d5db; border-radius:8px;
                    font-family:ui-monospace,monospace">
      <div style="margin-top:14px">
        <button id="pg-go" class="primary" style="font-size:15px; padding:10px 24px">開く</button>
      </div>
      <div id="pg-msg" style="margin-top:16px; font-size:13px; min-height:18px"></div>
    </div>
  `;

  const input = document.getElementById('pg-code');
  const msg   = document.getElementById('pg-msg');
  const go = async () => {
    const code = input.value.trim();
    msg.textContent = '';
    msg.style.color = '#6b7280';
    if (!/^[0-9]{4,8}$/.test(code)) {
      msg.textContent = '4-8 桁の数字を入力してください';
      msg.style.color = '#dc2626';
      return;
    }
    msg.textContent = '検索中…';
    try {
      const res = await fetch('/api/public-codes/' + encodeURIComponent(code), { credentials: 'same-origin' });
      if (!res.ok) {
        if (res.status === 404) throw new Error('コードが見つかりません');
        throw new Error('HTTP ' + res.status);
      }
      const d = await res.json();
      const path = String(d.target_path || '');
      msg.textContent = '移動中…';
      msg.style.color = '#059669';
      // target_path が # で 始まったら SPA route、 それ以外は 通常 URL。
      if (path.startsWith('#')) {
        location.hash = path.slice(1); // '#/xxx' の '#' を落として hash 代入
      } else {
        location.href = path;
      }
    } catch (e) {
      msg.textContent = '失敗: ' + e.message;
      msg.style.color = '#dc2626';
    }
  };
  document.getElementById('pg-go').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  input.focus();
}
