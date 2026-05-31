import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { refreshMe, toast } from '../app.js';

export async function renderLogin() {
  // Hide the logged-in chrome regardless of how we got here (boot / 401 redirect / direct nav).
  document.getElementById('topbar').hidden = true;
  document.getElementById('tabs').hidden   = true;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>LabPay にログイン</h2>
      <p class="muted">研究室メンバーのみ利用できます (許可リスト方式)。</p>
      <div style="margin-top:12px">
        <button class="btn primary" id="oauth-btn">Google でログイン</button>
      </div>
      <div class="sep"></div>
      <details>
        <summary class="muted">dev ログイン (検証用)</summary>
        <div style="margin-top:8px">
          <label class="field">
            <span class="lbl">メールアドレス (許可リストにあるもの)</span>
            <input type="email" id="dev-email" placeholder="you@example.ac.jp" autocomplete="email">
          </label>
          <button class="btn" id="dev-btn">dev ログイン</button>
        </div>
      </details>
    </div>
  `;
  document.getElementById('oauth-btn').addEventListener('click', () => {
    location.href = '/api/auth/login';
  });
  document.getElementById('dev-btn').addEventListener('click', async () => {
    const email = document.getElementById('dev-email').value.trim();
    if (!email) return;
    try {
      const res = await post('/api/auth/dev-login', { email });
      await refreshMe();
      if (res.first_login && res.initial_points) {
        toast(`ようこそ! 初期 ${res.initial_points}pt を配布しました`);
      }
      navigate('#/');
    } catch (e) {
      toast(`ログイン失敗: ${e.message}`);
    }
  });
}
