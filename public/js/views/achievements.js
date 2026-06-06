import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderAchievements() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <p class="card-subtitle" style="margin:0">15 カテゴリ × 4 段階。 リアルタイムに集計しています。</p>
      <p class="card-subtitle" style="margin:6px 0 0; font-size:12px">
        ✨ 段位名 (「お試し気分」 「ラボに溶けた」 「闇属性」 など) は <b>LabPay が命名しました!</b>
      </p>
    </div>
    <!-- v483 #76 AI 称号 (実績 の 組み合わせ から AI が 命名) -->
    <div class="card" id="ach-title-card" style="text-align:center" hidden>
      <div class="muted" style="font-size:11px; margin-bottom:4px">✨ あなた の 称号 (AI 命名)</div>
      <div id="ach-title-text" style="font-size:22px; font-weight:700; line-height:1.4; color:var(--primary)"></div>
      <div class="hint" id="ach-title-meta" style="font-size:11px; margin-top:6px"></div>
      <div style="margin-top:8px">
        <button id="ach-title-gen" class="btn">✨ 称号 を 生成</button>
      </div>
    </div>
    <div id="ach-list"><div class="muted">読み込み中…</div></div>
  `;
  renderAchievementsTitle().catch(() => {});
  try {
    const d = await get('/api/me/achievements');
    document.getElementById('ach-list').innerHTML = d.items.map(renderOne).join('');
  } catch (e) {
    document.getElementById('ach-list').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function renderAchievementsTitle() {
  const card = document.getElementById('ach-title-card');
  const txt  = document.getElementById('ach-title-text');
  const meta = document.getElementById('ach-title-meta');
  const btn  = document.getElementById('ach-title-gen');
  if (!card) return;
  try {
    const d = await get('/api/me/achievements_title');
    if (!d.has_achievements) { card.hidden = true; return; }
    card.hidden = false;
    if (d.title) {
      txt.textContent = d.title;
      meta.textContent = (d.is_stale
        ? `※ 実績 が 増えました — 「再生成」 で 更新できます  (前回 ${d.generated_at || '?'})`
        : `${d.generated_at || ''}`);
      btn.textContent = d.is_stale ? '🔄 再生成' : '🔄 再生成';
    } else {
      txt.textContent = '— 称号 を 生成 してね —';
      meta.textContent = '実績 を 元 に AI が 称号 を 命名 します。';
      btn.textContent = '✨ 称号 を 生成';
    }
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '⏳ 生成 中…';
      try {
        const r = await post('/api/me/achievements_title', {});
        txt.textContent = r.title;
        meta.textContent = '✨ 生成 しました';
        toast('称号 を 生成 しました');
      } catch (e) {
        toast('失敗: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 再生成';
      }
    };
  } catch (_) { card.hidden = true; }
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
        <div class=" bold text-primary">${a.value.toLocaleString()} ${escapeHtml(a.unit)}</div>
      </div>
      <div class="muted" style="font-size:12px; margin-bottom:8px">${escapeHtml(a.desc)}</div>
      <div class="ach-tiers">${tiersHtml}</div>
      ${progress}
    </div>`;
}
