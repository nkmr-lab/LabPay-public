// /#/fortune — 1 日 1 回占い単独ページ (v671 #250)。
// /api/fortune/today を引いて大きく表示。同じ日は同じ結果 (= server 側で固定)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderFortune() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔮 今日の占い ＋ ♈ 西洋占星術</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        1 日 1 回だけ引ける運勢。同じ日は同じ結果。翌日 0:00 を過ぎると新しい 1 つが引けます。
        設定 → プロフィールで誕生日を登録すると 12 星座占い (ラッキーカラー/アイテム/ナンバー付き) も出ます。
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
              ${escapeHtml(z.element || '')}の${escapeHtml(z.modality || '')}宮・守護星: ${escapeHtml(z.ruler || '')}
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0; font-size:12.5px">
            <div style="background:#fff; padding:8px 10px; border-radius:8px">
              <div class="bold" style="color:#16a34a; font-size:11.5px; margin-bottom:2px">💪 得意/強み</div>
              <div>${escapeHtml(z.strengths || '')}</div>
            </div>
            <div style="background:#fff; padding:8px 10px; border-radius:8px">
              <div class="bold" style="color:#dc2626; font-size:11.5px; margin-bottom:2px">⚠ 苦手/弱み</div>
              <div>${escapeHtml(z.weaknesses || '')}</div>
            </div>
          </div>
          <div style="background:#fff; padding:10px 12px; border-radius:8px; font-size:14px; color:#581c87; line-height:1.7">
            <span class="bold" style="font-size:12px; color:#7c3aed">📅 ${escapeHtml(String(f.date || ''))} のメッセージ</span><br>
            ${escapeHtml(z.msg || '')}
          </div>
          <div style="display:flex; justify-content:space-around; gap:8px; flex-wrap:wrap; margin-top:12px; font-size:12.5px; color:#6b21a8; text-align:center">
            <div>🎨<br><b>${escapeHtml(z.lucky_color || '')}</b><br><span style="font-size:10px">カラー</span></div>
            <div>🍀<br><b>${escapeHtml(z.lucky_item || '')}</b><br><span style="font-size:10px">アイテム</span></div>
            <div>🔢<br><b>${escapeHtml(String(z.lucky_number ?? ''))}</b><br><span style="font-size:10px">ナンバー</span></div>
            ${z.compat_today ? `<div>💞<br><b>${escapeHtml(z.compat_today.icon)} ${escapeHtml(z.compat_today.name)}</b><br><span style="font-size:10px">相性</span></div>` : ''}
            ${z.lucky_direction ? `<div>${escapeHtml(z.lucky_direction.icon)}<br><b>${escapeHtml(z.lucky_direction.name)}</b><br><span style="font-size:10px" title="${escapeHtml(z.lucky_direction.place)} 由来">出生地から</span></div>` : ''}
          </div>
          ${!z.lucky_direction ? `<div class="hint-sm" style="font-size:11px; text-align:center; margin-top:8px; color:#9333ea">
            📍 <a href="#/settings?focus=profile" style="color:#7c3aed">出生地を登録</a> すると「ラッキー方位」も出ます (出生時刻は不要)
          </div>` : ''}
          ${z.note ? `<div class="muted" style="font-size:10.5px; margin-top:10px; text-align:center">${escapeHtml(z.note)}</div>` : ''}
        </div>
      `;
    } else if (f.has_birthday === false) {
      zCard.hidden = false;
      zCard.innerHTML = `
        <div style="text-align:center; padding:24px 14px; background:linear-gradient(135deg, #fdf4ff, #f3e8ff); border-radius:12px">
          <div style="font-size:42px; line-height:1; margin-bottom:8px">♈♉♊♋♌♍<br>♎♏♐♑♒♓</div>
          <div class="bold" style="font-size:15px; color:#6b21a8; margin-bottom:6px">♈ 西洋占星術を適用するには</div>
          <div style="font-size:13.5px; color:#581c87; line-height:1.7">
            生年月日 (誕生日) を入力してください。<br>
            設定 → プロフィールで「誕生日 (MM-DD)」を登録すると<br>
            12 星座の性格+当日メッセージ+ラッキー情報が出ます。
          </div>
          <a href="#/settings?focus=profile" class="btn primary" style="margin-top:14px; display:inline-block; font-size:13px; padding:8px 18px">⚙ 設定で誕生日を登録</a>
          <div class="muted" style="font-size:10.5px; margin-top:10px">
            ※ 太陽星座をもとにした簡易西洋占星術です (本格 natal chart は出生時刻+出生地が必要)
          </div>
        </div>
      `;
    }
  } catch (e) {
    document.getElementById('fortune-card').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}
