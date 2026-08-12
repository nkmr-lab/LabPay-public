// v1288 最長連続ラボイン ランキング (#/streak-ranking)。
//   歴代 longest_streak 順、 継続中 は 🔥 バッジ 表示。 誰でも 閲覧可 (要ログイン)。
import { get } from '../api.js';
import { escapeHtml } from '../router.js';

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
      const flame = r.is_ongoing
        ? '<span style="color:#e64; font-weight:600; margin-left:6px">🔥 継続中</span>'
        : '';
      const av = r.avatar_url
        ? `<img src="${escapeHtml(r.avatar_url)}" alt="" style="width:32px; height:32px; border-radius:50%; object-fit:cover">`
        : '<div style="width:32px; height:32px; border-radius:50%; background:#eee"></div>';
      return `
        <a href="#/users/${r.user_id}" class="row center"
           style="gap:10px; padding:8px 4px; border-bottom:1px solid var(--line);
                  text-decoration:none; color:inherit">
          <span style="min-width:36px; font-weight:600; color:#666">${medal}</span>
          ${av}
          <div style="flex:1; min-width:0">
            <div style="font-weight:500">${escapeHtml(r.display_name)}</div>
            <div class="muted" style="font-size:11px">
              現在 ${r.current_streak} 日${flame}
            </div>
          </div>
          <div style="text-align:right; min-width:56px">
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
