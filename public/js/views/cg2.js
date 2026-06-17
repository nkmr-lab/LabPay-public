// /#/cg2 — cg2 (自作 ゲーム v2) 一覧 / 詳細。

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { state, toast } from '../app.js';

// p5.js lazy load (vendor)
let _p5Promise = null;
async function loadP5() {
  if (_p5Promise) return _p5Promise;
  _p5Promise = new Promise((resolve, reject) => {
    if (window.p5) return resolve(window.p5);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/p5@1.11.2/lib/p5.min.js';
    s.onload = () => resolve(window.p5);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _p5Promise;
}

// ─── 一覧 (kinds) ──────────────────────────────
export async function renderCg2() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🎮 自作 ゲーム v2 (cg2)</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        p5.js で 描画 する 准 リアルタイム multiplayer の framework。
        詳細 → <a href="https://github.com/nkmr-lab/LabPay/blob/main/docs/CUSTOM_GAMES_V2.md" target="_blank">CUSTOM_GAMES_V2.md</a>
      </p>
    </div>
    <div class="card">
      <h3>登録 済 ゲーム</h3>
      <div id="cg2-kinds" class="list"><div class="muted">読み込み中…</div></div>
    </div>
  `;
  try {
    const d = await get('/api/cg2/kinds');
    const items = d.items || [];
    const root = document.getElementById('cg2-kinds');
    if (!items.length) { root.innerHTML = '<div class="empty">まだ ゲーム は ありません</div>'; return; }
    root.innerHTML = items.map(k => `
      <a class="list-item" href="#/cg2/${escapeHtml(k.slug)}" style="gap:8px; align-items:center">
        <span style="font-size:28px; flex:none">${escapeHtml(k.icon || '🎮')}</span>
        <div class="grow" style="min-width:0">
          <div class="bold">${escapeHtml(k.name)} <span class="hint-sm">(${k.min_players}-${k.max_players} 人 ・ ${k.fee} pt)</span></div>
          ${k.description ? `<div class="meta">${escapeHtml(k.description)}</div>` : ''}
          <div class="meta">提供: ${escapeHtml(k.provider_name || 'SYSTEM')}</div>
        </div>
        <div class="hint">→</div>
      </a>
    `).join('');
  } catch (e) {
    document.getElementById('cg2-kinds').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─── kind 別 ゲーム 一覧 ──────────────────────
export async function renderCg2Kind({ params }) {
  const slug = params.slug;
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/cg2" class="hint">← 自作 ゲーム v2</a>
      <div id="cg2-kind-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <h3>卓 一覧</h3>
      <button id="cg2-new" class="btn primary" style="margin-bottom:8px">＋ 新規 卓</button>
      <div id="cg2-games" class="list"></div>
    </div>
  `;
  try {
    const d = await get(`/api/cg2/kinds/${encodeURIComponent(slug)}/games`);
    const k = d.kind;
    document.getElementById('cg2-kind-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(k.icon || '🎮')} ${escapeHtml(k.name)}</h2>
      <div class="meta">${k.min_players}-${k.max_players} 人 ・ 場代 ${k.fee} pt ・ 提供 ${escapeHtml(d.kind.provider_name || 'SYSTEM')}</div>
      ${k.description ? `<div style="margin-top:6px; white-space:pre-wrap">${escapeHtml(k.description)}</div>` : ''}
    `;
    const root = document.getElementById('cg2-games');
    const items = d.items || [];
    if (!items.length) {
      root.innerHTML = '<div class="empty">卓 が ありません。 「＋ 新規 卓」 で 開始</div>';
    } else {
      root.innerHTML = items.map(g => {
        const players = JSON.parse(g.players_json || '[]');
        return `
          <a class="list-item" href="#/cg2/${escapeHtml(slug)}/${g.id}" style="gap:8px; align-items:center">
            <div class="grow" style="min-width:0">
              <div class="bold">#${g.id}
                <span class="tag" style="background:${statusBg(g.status)}">${statusLabel(g.status)}</span>
              </div>
              <div class="meta">host: ${escapeHtml(g.host_name)} ・ 参加 ${players.length}/${k.max_players}</div>
              ${g.result_text ? `<div class="meta">${escapeHtml(g.result_text)}</div>` : ''}
            </div>
            <div class="hint">→</div>
          </a>`;
      }).join('');
    }
    document.getElementById('cg2-new').addEventListener('click', async () => {
      try {
        const r = await post(`/api/cg2/kinds/${encodeURIComponent(slug)}/games`, {});
        navigate(`#/cg2/${slug}/${r.id}`);
      } catch (e) { toast('失敗: ' + e.message); }
    });
  } catch (e) {
    document.getElementById('cg2-kind-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ─── 詳細 (= 実際 に ゲーム を プレイ) ───────────
let _cleanupFn = null;
export async function renderCg2Game({ params }) {
  const slug = params.slug;
  const gid = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/cg2/${escapeHtml(slug)}" class="hint">← 卓 一覧</a>
      <div id="cg2-head" class="muted" style="margin-top:6px">読み込み中…</div>
    </div>
    <div class="card">
      <div id="cg2-canvas-host" style="display:flex; justify-content:center"></div>
      <div id="cg2-controls" style="margin-top:8px; text-align:center"></div>
    </div>
  `;
  if (_cleanupFn) { try { _cleanupFn(); } catch (_) {} _cleanupFn = null; }
  try {
    const d = await get(`/api/cg2/games/${gid}`);
    const g = d.game;
    const k = d.kind;
    const isHost = d.is_host;
    const players = JSON.parse(g.players_json || '[]');
    document.getElementById('cg2-head').innerHTML = `
      <h2 style="margin:6px 0 0">${escapeHtml(k.icon || '🎮')} ${escapeHtml(k.name)} #${g.id}</h2>
      <div class="meta">
        <span class="tag" style="background:${statusBg(g.status)}">${statusLabel(g.status)}</span>
        ・ 参加 ${players.length}/${k.max_players}
        ${g.result_text ? ' ・ ' + escapeHtml(g.result_text) : ''}
      </div>
      <div class="meta">${players.map(p => `${p.is_ai ? '🤖' : ''}${escapeHtml(p.name)}`).join(', ')}</div>
    `;
    const ctrl = document.getElementById('cg2-controls');
    if (g.status === 'waiting') {
      const am = players.find(p => Number(p.uid) === Number(state.me?.id));
      const buttons = [];
      if (!am) buttons.push('<button id="cg2-join" class="btn primary">参加 する</button>');
      if (isHost) {
        if (players.length < k.max_players) buttons.push('<button id="cg2-addai" class="btn">＋ AI を 追加</button>');
        if (players.length >= k.min_players) buttons.push(`<button id="cg2-start" class="btn primary">開始 (${k.fee} pt)</button>`);
        buttons.push('<button id="cg2-cancel" class="danger">キャンセル</button>');
      }
      ctrl.innerHTML = buttons.join(' ');
      document.getElementById('cg2-join')?.addEventListener('click', async () => {
        try { await post(`/api/cg2/games/${gid}/join`, {}); renderCg2Game({ params }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('cg2-addai')?.addEventListener('click', async () => {
        try { await post(`/api/cg2/games/${gid}/add-ai`, {}); renderCg2Game({ params }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('cg2-start')?.addEventListener('click', async () => {
        try { await post(`/api/cg2/games/${gid}/start`, {}); renderCg2Game({ params }); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      document.getElementById('cg2-cancel')?.addEventListener('click', async () => {
        if (!confirm('この 卓 を キャンセル しますか?')) return;
        try { await post(`/api/cg2/games/${gid}/cancel`, {}); navigate(`#/cg2/${slug}`); }
        catch (e) { toast('失敗: ' + e.message); }
      });
      // 募集 中 polling で 状態 更新
      const poll = setInterval(async () => {
        if (!document.getElementById('cg2-head')) { clearInterval(poll); return; }
        try {
          const d2 = await get(`/api/cg2/games/${gid}`);
          if (d2.game.status !== 'waiting' || JSON.stringify(d2.game.players_json) !== JSON.stringify(g.players_json)) {
            clearInterval(poll);
            renderCg2Game({ params });
          }
        } catch (_) {}
      }, 2000);
      _cleanupFn = () => clearInterval(poll);
    } else if (g.status === 'playing') {
      ctrl.innerHTML = '';
      // p5 load + cg2 runtime _bootstrap で sketch 起動
      const p5lib = await loadP5();
      const rt = await import('/js/cg2.js');
      // gameData に me_id を 追加 (server 由来 では ない ので client で 補う)
      const gameData = {
        ...g,
        me_id: Number(state.me?.id),
        is_host: isHost,
        players,
      };
      await rt._bootstrap({
        gameId: gid,
        kindSlug: slug,
        gameData,
        kindData: k,
        p5lib,
      });
      _cleanupFn = () => { try { rt._cleanup(); } catch (_) {} };
    } else {
      // finished / cancelled
      ctrl.innerHTML = '<a class="btn" href="#/cg2/' + escapeHtml(slug) + '">卓 一覧 へ</a>';
    }
  } catch (e) {
    document.getElementById('cg2-head').innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

function statusLabel(s) {
  return { waiting: '募集中', playing: 'プレイ 中', finished: '終了', cancelled: 'キャンセル' }[s] || s;
}
function statusBg(s) {
  return { waiting: '#fef3c7', playing: '#dbeafe', finished: '#d1fae5', cancelled: '#fee2e2' }[s] || '#e5e7eb';
}
