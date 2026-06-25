// /#/fortune — 1 日 1 回 占い 単独 ページ (v671 #250)。
// /api/fortune/today を 引いて 大きく 表示。 同じ 日 は 同じ 結果 (= server 側 で 固定)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderFortune() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔮 今日 の 占い ＋ ♈ 西洋占星術</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        1 日 1 回 だけ 引ける 運勢。 同じ 日 は 同じ 結果。 翌日 0:00 を 過ぎる と 新しい 1 つ が 引けます。
        設定 → プロフィール で 誕生日 を 登録 する と 12 星座 占い (ラッキー カラー / アイテム / ナンバー 付き) も 出ます。
      </p>
    </div>
    <div class="card" id="fortune-card">
      <div class="muted">読み込み中…</div>
    </div>
    <div class="card" id="zodiac-card" hidden>
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
    const z = f.zodiac;
    const zCard = document.getElementById('zodiac-card');
    if (z) {
      zCard.hidden = false;
      zCard.innerHTML = `
        <div style="text-align:center; padding:24px 12px; background:linear-gradient(135deg, #fdf4ff, #f3e8ff); border-radius:12px">
          <div style="font-size:64px; line-height:1; margin-bottom:8px">${escapeHtml(z.icon || '')}</div>
          <div style="font-size:24px; font-weight:700; color:#6b21a8; margin-bottom:4px">${escapeHtml(z.name || '')} <span style="font-size:14px; font-weight:400; color:#9333ea">(${escapeHtml(z.element || '')})</span></div>
          <div style="font-size:14.5px; color:#581c87; line-height:1.7; margin:12px 0">${escapeHtml(z.msg || '')}</div>
          <div style="display:flex; justify-content:center; gap:18px; flex-wrap:wrap; margin-top:14px; font-size:13px; color:#6b21a8">
            <span>🎨 <b>ラッキー カラー</b><br>${escapeHtml(z.lucky_color || '')}</span>
            <span>🍀 <b>ラッキー アイテム</b><br>${escapeHtml(z.lucky_item || '')}</span>
            <span>🔢 <b>ラッキー ナンバー</b><br>${escapeHtml(String(z.lucky_number ?? ''))}</span>
          </div>
        </div>
      `;
    } else if (f.has_birthday === false) {
      zCard.hidden = false;
      zCard.innerHTML = `
        <div style="text-align:center; padding:20px 12px; background:#fdf4ff; border-radius:12px">
          <div style="font-size:36px; margin-bottom:8px">♈♉♊♋♌♍</div>
          <div style="font-size:14px; color:#6b21a8; line-height:1.6">
            西洋占星術 (12 星座) を 表示 する に は<br>
            設定 → プロフィール で 誕生日 (MM-DD) を 登録 して ください
          </div>
          <a href="#/settings?focus=profile" class="btn primary" style="margin-top:12px; display:inline-block">⚙ 設定 を 開く</a>
        </div>
      `;
    }
  } catch (e) {
    document.getElementById('fortune-card').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
