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
        <div style="padding:20px 14px; background:linear-gradient(135deg, #fdf4ff, #f3e8ff); border-radius:12px">
          <div style="text-align:center">
            <div style="font-size:60px; line-height:1; margin-bottom:6px">${escapeHtml(z.icon || '')}</div>
            <div style="font-size:22px; font-weight:700; color:#6b21a8">${escapeHtml(z.name || '')}</div>
            <div style="font-size:12.5px; color:#9333ea; margin-top:2px">
              ${escapeHtml(z.element || '')} の ${escapeHtml(z.modality || '')} 宮 ・ 守護 星: ${escapeHtml(z.ruler || '')}
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0; font-size:12.5px">
            <div style="background:#fff; padding:8px 10px; border-radius:8px">
              <div class="bold" style="color:#16a34a; font-size:11.5px; margin-bottom:2px">💪 得意 / 強み</div>
              <div>${escapeHtml(z.strengths || '')}</div>
            </div>
            <div style="background:#fff; padding:8px 10px; border-radius:8px">
              <div class="bold" style="color:#dc2626; font-size:11.5px; margin-bottom:2px">⚠ 苦手 / 弱み</div>
              <div>${escapeHtml(z.weaknesses || '')}</div>
            </div>
          </div>
          <div style="background:#fff; padding:10px 12px; border-radius:8px; font-size:14px; color:#581c87; line-height:1.7">
            <span class="bold" style="font-size:12px; color:#7c3aed">📅 ${escapeHtml(String(f.date || ''))} の メッセージ</span><br>
            ${escapeHtml(z.msg || '')}
          </div>
          <div style="display:flex; justify-content:space-around; gap:8px; flex-wrap:wrap; margin-top:12px; font-size:12.5px; color:#6b21a8; text-align:center">
            <div>🎨<br><b>${escapeHtml(z.lucky_color || '')}</b><br><span style="font-size:10px">カラー</span></div>
            <div>🍀<br><b>${escapeHtml(z.lucky_item || '')}</b><br><span style="font-size:10px">アイテム</span></div>
            <div>🔢<br><b>${escapeHtml(String(z.lucky_number ?? ''))}</b><br><span style="font-size:10px">ナンバー</span></div>
            ${z.compat_today ? `<div>💞<br><b>${escapeHtml(z.compat_today.icon)} ${escapeHtml(z.compat_today.name)}</b><br><span style="font-size:10px">相性</span></div>` : ''}
          </div>
          ${z.note ? `<div class="muted" style="font-size:10.5px; margin-top:10px; text-align:center">${escapeHtml(z.note)}</div>` : ''}
        </div>
      `;
    } else if (f.has_birthday === false) {
      zCard.hidden = false;
      zCard.innerHTML = `
        <div style="text-align:center; padding:24px 14px; background:linear-gradient(135deg, #fdf4ff, #f3e8ff); border-radius:12px">
          <div style="font-size:42px; line-height:1; margin-bottom:8px">♈♉♊♋♌♍<br>♎♏♐♑♒♓</div>
          <div class="bold" style="font-size:15px; color:#6b21a8; margin-bottom:6px">♈ 西洋占星術 を 適用 する に は</div>
          <div style="font-size:13.5px; color:#581c87; line-height:1.7">
            生年月日 (誕生日) を 入力 して ください。<br>
            設定 → プロフィール で 「誕生日 (MM-DD)」 を 登録 する と<br>
            12 星座 の 性格 + 当日 メッセージ + ラッキー 情報 が 出ます。
          </div>
          <a href="#/settings?focus=profile" class="btn primary" style="margin-top:14px; display:inline-block; font-size:13px; padding:8px 18px">⚙ 設定 で 誕生日 を 登録</a>
          <div class="muted" style="font-size:10.5px; margin-top:10px">
            ※ 太陽星座 を 元 に した 簡易 西洋占星術 です (本格 natal chart は 出生 時刻 + 出生 地 が 必要)
          </div>
        </div>
      `;
    }
  } catch (e) {
    document.getElementById('fortune-card').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
