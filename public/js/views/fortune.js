// /#/fortune — 1 日 1 回 占い 単独 ページ (v671 #250)。
// /api/fortune/today を 引いて 大きく 表示。 同じ 日 は 同じ 結果 (= server 側 で 固定)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderFortune() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔮 今日 の 占い</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        1 日 1 回 だけ 引ける 運勢。 同じ 日 は 同じ 結果。 翌日 0:00 を 過ぎる と 新しい 1 つ が 引けます。
      </p>
    </div>
    <div class="card" id="fortune-card">
      <div class="muted">読み込み中…</div>
    </div>
  `;
  try {
    const f = await get('/api/fortune/today');
    document.getElementById('fortune-card').innerHTML = `
      <div style="text-align:center; padding:24px 12px; background:linear-gradient(135deg, #fef3c7, #fff5d4); border-radius:12px">
        <div style="font-size:64px; line-height:1; margin-bottom:8px">${escapeHtml(f.icon || '🔮')}</div>
        <div style="font-size:24px; font-weight:700; color:#92400e; margin-bottom:8px">${escapeHtml(f.name || '')}</div>
        <div style="font-size:14px; color:#7c2d12; line-height:1.6">${escapeHtml(f.msg || '')}</div>
      </div>
    `;
  } catch (e) {
    document.getElementById('fortune-card').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
