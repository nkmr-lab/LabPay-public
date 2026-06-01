import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderAchievements() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>実績</h2>
      <p class="muted" style="font-size:13px">9カテゴリ × 4段階。リアルタイムに集計しています。</p>
    </div>
    <div id="ach-list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/me/achievements');
    document.getElementById('ach-list').innerHTML = d.items.map(renderOne).join('');
  } catch (e) {
    document.getElementById('ach-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function renderOne(a) {
  const earnedIdx = a.earned_tier; // 0..N
  const tiersHtml = a.tiers.map((t, i) => {
    const owned = (i + 1) <= earnedIdx;
    const cur = a.next && (i + 1) === earnedIdx + 1;
    let style = 'opacity:.4';
    if (owned)     style = 'opacity:1; background:var(--primary-soft); border-color:var(--primary)';
    else if (cur)  style = 'opacity:1';
    return `
      <div class="ach-tier" style="${style}">
        <div style="font-size:24px; line-height:1">${t.medal}</div>
        <div class="bold" style="font-size:12px">${escapeHtml(t.label)}</div>
        <div class="muted" style="font-size:11px">${t.count}${escapeHtml(a.unit)}</div>
      </div>`;
  }).join('');

  const progress = a.next
    ? `<div style="margin-top:6px">
         <div class="meta" style="font-size:12px">次まで: ${a.value} / ${a.next.count} ${escapeHtml(a.unit)} (${escapeHtml(a.next.label)})</div>
         <div style="height:6px; background:var(--line); border-radius:99px; overflow:hidden">
           <div style="height:100%; width:${Math.round((a.next_progress || 0) * 100)}%; background:var(--primary)"></div>
         </div>
       </div>`
    : `<div class="meta" style="font-size:12px; margin-top:6px; color:var(--primary); font-weight:700">最高ランク到達 🎉</div>`;

  return `
    <div class="card">
      <div class="row" style="align-items:baseline">
        <h3 style="margin:0; flex:1">${escapeHtml(a.title)}</h3>
        <div class="bold" style="color:var(--primary)">${a.value.toLocaleString()} ${escapeHtml(a.unit)}</div>
      </div>
      <div class="muted" style="font-size:12px; margin-bottom:8px">${escapeHtml(a.desc)}</div>
      <div class="ach-tiers">${tiersHtml}</div>
      ${progress}
    </div>`;
}
