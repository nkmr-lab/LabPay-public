// v1288 最長連続ラボイン ランキング (#/streak-ranking)。
//   歴代 longest_streak 順、 継続中 は 🔥 バッジ 表示。 誰でも 閲覧可 (要ログイン)。
// v1289 (a) アバター が flex コンテナ内 で 潰れて 横長 になる バグ修正 (flex-shrink:0)、
//   (b) 「歴代最長 の 期間」 と 「継続中 の 開始日」 を 表示 (checkin 履歴 から 再構築)。
import { get } from '../api.js';
import { escapeHtml } from '../router.js';

// '2026-08-12' → '2026/8/12' (前ゼロなし、コンパクト表示)
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

export async function renderStreakRanking() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin:6px 0">🏆 最長連続ラボイン ランキング</h2>
      <div class="hint-sm" style="color:#666; margin-bottom:8px">
        歴代 最長 の 連続ラボイン 日数 順 (上位 50 名)。 🔥 は いま も 継続中。
      </div>
      <div id="sr-list">読み込み中…</div>
    </div>
  `;
  try {
    const d = await get('/api/checkins/streak-ranking');
    const list = document.getElementById('sr-list');
    if (!d.ranking?.length) {
      list.innerHTML = '<div class="muted">まだ 誰も 記録なし</div>';
      return;
    }
    list.innerHTML = d.ranking.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      // 期間: 継続中 かつ 最長 window の 開始 == 継続中 window の 開始 なら
      //   「YYYY/M/D 〜 継続中 🔥」に統合。 それ以外 は 最長期間 と 継続中 を 別行 で。
      let periodHtml = '';
      const longestSame = r.longest_start && r.current_start && r.longest_start === r.current_start;
      if (longestSame) {
        periodHtml = `<div class="muted" style="font-size:11px">
          ${fmtDate(r.longest_start)} 〜 <span style="color:#e64; font-weight:600">継続中 🔥</span>
          (現在 ${r.current_streak} 日)
        </div>`;
      } else {
        const lineLongest = r.longest_start && r.longest_end
          ? `<div class="muted" style="font-size:11px">
               記録期間: ${fmtDate(r.longest_start)} 〜 ${fmtDate(r.longest_end)}
             </div>`
          : '';
        const lineOngoing = r.is_ongoing
          ? `<div class="muted" style="font-size:11px">
               <span style="color:#e64; font-weight:600">🔥 継続中</span>
               ${r.current_start ? fmtDate(r.current_start) + ' 〜 ' : ''}(現在 ${r.current_streak} 日)
             </div>`
          : '';
        periodHtml = lineLongest + lineOngoing;
      }
      const av = r.avatar_url
        ? `<img src="${escapeHtml(r.avatar_url)}" alt=""
             style="width:36px; height:36px; border-radius:50%; object-fit:cover;
                    flex-shrink:0; display:block">`
        : `<div style="width:36px; height:36px; border-radius:50%; background:#eee;
                       flex-shrink:0"></div>`;
      return `
        <a href="#/users/${r.user_id}" class="row center"
           style="gap:10px; padding:10px 4px; border-bottom:1px solid var(--line);
                  text-decoration:none; color:inherit">
          <span style="min-width:36px; flex-shrink:0; font-weight:600; color:#666">${medal}</span>
          ${av}
          <div style="flex:1; min-width:0">
            <div style="font-weight:500">${escapeHtml(r.display_name)}</div>
            ${periodHtml}
          </div>
          <div style="text-align:right; min-width:56px; flex-shrink:0">
            <div style="font-size:22px; font-weight:700; color:#7b3fa0; line-height:1">
              ${r.longest_streak}<span style="font-size:11px; color:#666; font-weight:400"> 日</span>
            </div>
          </div>
        </a>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('sr-list').innerHTML =
      `<div class="muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}
