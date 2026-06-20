// /#/news — IT ニュース 一覧 (履歴 付き)。 v705 #297
//   過去 30 日 分 の 記事 を 初出 日付 ごと に グループ で 表示。
//   各 記事 に GPT 要約 (日本語) が ある なら 併記。

import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderNews() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📰 IT ニュース</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        過去 30 日 分 の IT 記事 を 初出 日付 ごと に。 各 記事 に GPT 要約 (日本語) が 付くと
        中身 を 開かなくて も 概要 が わかります。 タップ で 元 記事 へ。
      </p>
    </div>
    <div class="card">
      <div id="news-list"><div class="hint">読み込み中…</div></div>
    </div>
  `;
  await load();
}

async function load() {
  const root = document.getElementById('news-list');
  try {
    const d = await get('/api/news/history', { limit: 200 });
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">まだ 記事 が 蓄積 されて いません</div>';
      return;
    }
    // 日付 ごと に group
    const groups = new Map();
    for (const it of items) {
      const day = String(it.first_seen_at || '').slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(it);
    }
    // 日付 を 新 → 旧 で 並べる
    const days = [...groups.keys()].sort((a, b) => b.localeCompare(a));
    root.innerHTML = days.map(day => {
      const list = groups.get(day) || [];
      return `
        <div style="margin-top:10px">
          <div class="bold" style="font-size:13px; color:#4a106d; border-bottom:1px solid var(--line); padding-bottom:2px">
            ${escapeHtml(fmtDay(day))} <span class="hint-sm" style="font-weight:normal">(${list.length} 件)</span>
          </div>
          ${list.map((it, idx) => {
            const itemId = `news-${day}-${idx}`;
            return `
            <div class="list-item" style="padding:6px 0; flex-direction:column; align-items:flex-start; gap:0; line-height:1.4">
              <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener" style="display:flex; width:100%; gap:6px; align-items:baseline; color:inherit; text-decoration:none">
                <span class="bold" style="font-size:13px; flex:1; min-width:0; overflow-wrap:anywhere">${escapeHtml(it.title)}</span>
                <span class="hint-sm" style="font-size:10px; opacity:0.6; flex:none">${escapeHtml(it.source || '')}</span>
              </a>
              <div id="sum-${itemId}" style="width:100%; margin-top:2px">
                ${it.summary_jp
                  ? `<div style="font-size:12px; line-height:1.5; color:#444; overflow-wrap:anywhere">${escapeHtml(it.summary_jp)}</div>`
                  : `<button class="btn news-load-sum" data-url="${escapeHtml(it.url)}" data-title="${escapeHtml(it.title)}" data-target="sum-${itemId}" style="font-size:11px; padding:2px 8px; color:#4a106d">🔄 要約 を 取得</button>`}
              </div>
            </div>`;
          }).join('')}
        </div>`;
    }).join('');
    // v706 #298 「要約 を 取得」 ボタン: 個別 に POST して 即時 生成、 in-place で 置換。
    root.querySelectorAll('.news-load-sum').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '生成 中…';
        try {
          const r = await post('/api/news/summarize', { url: btn.dataset.url, title: btn.dataset.title });
          const tgt = document.getElementById(btn.dataset.target);
          if (tgt && r.summary_jp) {
            tgt.innerHTML = `<div style="font-size:12px; line-height:1.5; color:#444; overflow-wrap:anywhere">${escapeHtml(r.summary_jp)}</div>`;
          }
        } catch (e) {
          btn.disabled = false; btn.textContent = '🔄 要約 を 取得';
          toast('失敗: ' + e.message);
        }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">読み込み 失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function fmtDay(s) {
  if (!s || s.length < 10) return s;
  const dt = new Date(s + 'T00:00:00');
  if (isNaN(dt.getTime())) return s;
  const wk = ['日','月','火','水','木','金','土'][dt.getDay()];
  return `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()} (${wk})`;
}
