// /#/translate — 画像 (メニュー / 看板 / 説明文 など) を 和訳。
// 写真 を 撮る or 選ぶ → /api/uploads で アップ → /api/ai/translate_image → 結果表示。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';
import { uploadImage } from '../upload.js';

export async function renderTranslate() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🌐 画像 和訳</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        メニュー、 看板、 説明文 などの 写真 を アップ → 日本語に 翻訳します。
        撮影 / アルバム どちらでも 可。 (gpt-4o-mini Vision)
      </p>
    </div>
    <div class="card">
      <label class="field"><span class="lbl">写真 (8MB まで)</span>
        <input type="file" id="tr-file" accept="image/*">
        <input type="hidden" id="tr-url" value="">
        <img id="tr-prev" alt="" hidden style="max-width:240px; max-height:240px; margin-top:6px; border-radius:8px; object-fit:contain; display:none; background:#f6f6f9">
        <span id="tr-up-st" class="hint-sm"></span>
      </label>
      <label class="field"><span class="lbl">補足 (任意): どんな 内容か メモ すると 精度が 上がります</span>
        <input type="text" id="tr-hint" maxlength="500" placeholder="例: 中華料理 メニュー / ベトナム の 駅 表示 / 公園の 注意書き">
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end">
        <button id="tr-go" class="primary" disabled>🌐 和訳する</button>
      </div>
    </div>
    <div class="card" id="tr-out-card" hidden>
      <h3 style="margin:0 0 6px">和訳結果 <button id="tr-copy" class="btn" style="padding:2px 10px; font-size:12px; margin-left:6px">📋 コピー</button></h3>
      <div id="tr-out" style="white-space:pre-wrap; line-height:1.6; font-size:14px"></div>
    </div>
  `;

  document.getElementById('tr-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const st = document.getElementById('tr-up-st');
    st.textContent = 'アップロード中…';
    try {
      const data = await uploadImage(f);
      document.getElementById('tr-url').value = data.url;
      const prev = document.getElementById('tr-prev');
      prev.src = data.url; prev.hidden = false; prev.style.display = 'block';
      st.textContent = '✓ アップロード 完了';
      document.getElementById('tr-go').disabled = false;
    } catch (e) {
      st.textContent = '失敗: ' + e.message;
    }
  });

  document.getElementById('tr-go').addEventListener('click', async () => {
    const url = document.getElementById('tr-url').value;
    const hint = document.getElementById('tr-hint').value.trim() || null;
    if (!url) { toast('先に 写真を 選んでください'); return; }
    const btn = document.getElementById('tr-go');
    const outCard = document.getElementById('tr-out-card');
    const outEl = document.getElementById('tr-out');
    btn.disabled = true; btn.textContent = '🌐 翻訳中…';
    outCard.hidden = false;
    outEl.textContent = '画像を 解析中… (5-20 秒)';
    try {
      const r = await post('/api/ai/translate_image', { image_url: url, hint });
      outEl.textContent = r.text || '(空の応答)';
    } catch (e) {
      outEl.innerHTML = `<span class="muted">失敗: ${escapeHtml(e.message)}</span>`;
    } finally {
      btn.disabled = false; btn.textContent = '🌐 和訳する';
    }
  });

  document.getElementById('tr-copy').addEventListener('click', async () => {
    const txt = document.getElementById('tr-out').textContent || '';
    try { await navigator.clipboard.writeText(txt); toast('コピーしました'); }
    catch (_) { toast('コピー 失敗'); }
  });
}
