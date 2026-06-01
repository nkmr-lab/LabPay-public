// /#/network — social graph view.
//
// Renders the buyer<->seller and requester<->worker graphs as a force-directed
// SVG. The layout uses a hand-rolled Fruchterman-Reingold-ish simulation (~150
// iterations on render) so we don't need d3 or a network lib.

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

const TAB_KEY = 'labpay-network-tab';

export async function renderNetwork() {
  const app = document.getElementById('app');
  const activeTab = localStorage.getItem(TAB_KEY) || 'purchases';
  app.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center">
        <h2 style="flex:1; margin:0">ネットワーク</h2>
      </div>
      <div class="row" style="gap:6px; margin-top:8px">
        <button class="btn ${activeTab==='purchases'?'primary':''}" data-tab="purchases">売買</button>
        <button class="btn ${activeTab==='tasks'?'primary':''}" data-tab="tasks">タスク</button>
      </div>
      <p class="muted" style="font-size:13px; margin:8px 0 0">
        矢印は <span id="net-arrow-desc"></span>。線の太さは取引回数、ノードはタップで詳細。
      </p>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="net-canvas-wrap" style="position:relative; width:100%; aspect-ratio:1/1; max-height:80vh; background:#faf8fc">
        <div id="net-loading" class="muted" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center">読み込み中…</div>
      </div>
    </div>
    <div class="card" id="net-detail" hidden></div>
  `;

  document.querySelectorAll('[data-tab]').forEach(b => {
    b.addEventListener('click', () => {
      const tab = b.dataset.tab;
      localStorage.setItem(TAB_KEY, tab);
      renderNetwork();
    });
  });

  await loadAndRender(activeTab);
}

async function loadAndRender(tab) {
  const arrowDesc = document.getElementById('net-arrow-desc');
  arrowDesc.textContent = tab === 'tasks' ? '依頼者 → 引き受けた人' : '売り手 → 買い手';
  try {
    const d = await get('/api/network/' + tab);
    const nodes = d.nodes || [];
    const edges = d.edges || [];
    if (!nodes.length) {
      document.getElementById('net-loading').textContent = 'データがまだありません';
      return;
    }
    layout(nodes, edges);
    draw(nodes, edges, tab);
  } catch (e) {
    document.getElementById('net-loading').textContent = '失敗: ' + e.message;
  }
}

// Fruchterman-Reingold force simulation. Coordinates are in [0,1] space; draw()
// scales to the actual viewBox.
function layout(nodes, edges) {
  const N = nodes.length;
  // Seed positions on a circle so disconnected components don't all start at center.
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    n.x = 0.5 + 0.35 * Math.cos(a);
    n.y = 0.5 + 0.35 * Math.sin(a);
    n.vx = 0; n.vy = 0;
  });
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const eIdx = edges.map(e => [idIndex.get(e.from), idIndex.get(e.to), e.count])
                    .filter(([a, b]) => a !== undefined && b !== undefined);

  const k = Math.sqrt(1 / Math.max(1, N));   // ideal edge length
  let temp = 0.1;                            // cooling temperature
  const ITERATIONS = 250;
  for (let it = 0; it < ITERATIONS; it++) {
    // Repulsive: every pair pushes apart, inverse square.
    for (let i = 0; i < N; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d2 = dx * dx + dy * dy + 1e-4;
        const f = (k * k) / d2;
        fx += dx * f;
        fy += dy * f;
      }
      // Slight centering pull so disconnected pieces don't drift off-screen.
      fx += (0.5 - nodes[i].x) * 0.02;
      fy += (0.5 - nodes[i].y) * 0.02;
      nodes[i].vx = fx;
      nodes[i].vy = fy;
    }
    // Attractive: edges pull endpoints together; weighted by edge count.
    for (const [a, b, c] of eIdx) {
      const dx = nodes[a].x - nodes[b].x;
      const dy = nodes[a].y - nodes[b].y;
      const d  = Math.sqrt(dx * dx + dy * dy) + 1e-4;
      const f  = (d * d / k) * Math.log(1 + c);
      const ux = dx / d, uy = dy / d;
      nodes[a].vx -= ux * f;
      nodes[a].vy -= uy * f;
      nodes[b].vx += ux * f;
      nodes[b].vy += uy * f;
    }
    // Apply with simulated annealing.
    for (let i = 0; i < N; i++) {
      const mag = Math.sqrt(nodes[i].vx * nodes[i].vx + nodes[i].vy * nodes[i].vy) + 1e-4;
      const step = Math.min(mag, temp);
      nodes[i].x += (nodes[i].vx / mag) * step;
      nodes[i].y += (nodes[i].vy / mag) * step;
      nodes[i].x = Math.max(0.04, Math.min(0.96, nodes[i].x));
      nodes[i].y = Math.max(0.04, Math.min(0.96, nodes[i].y));
    }
    temp *= 0.98;
  }
}

function draw(nodes, edges, tab) {
  const wrap = document.getElementById('net-canvas-wrap');
  document.getElementById('net-loading')?.remove();
  const W = 1000, H = 1000;
  const maxCount = Math.max(1, ...edges.map(e => e.count));

  // Pre-compute incoming/outgoing degree for node sizing.
  const inDeg = new Map(), outDeg = new Map();
  edges.forEach(e => {
    inDeg.set(e.to,   (inDeg.get(e.to)   || 0) + e.count);
    outDeg.set(e.from,(outDeg.get(e.from)|| 0) + e.count);
  });
  const maxDeg = Math.max(1, ...nodes.map(n => (inDeg.get(n.id)||0)+(outDeg.get(n.id)||0)));

  // Build SVG.
  const svg = `
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="display:block">
    <defs>
      <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a106d" opacity="0.55"/>
      </marker>
    </defs>
    ${edges.map(e => {
      const a = nodes.find(n => n.id === e.from);
      const b = nodes.find(n => n.id === e.to);
      if (!a || !b) return '';
      const sw = 0.5 + 4 * (e.count / maxCount);
      const op = 0.18 + 0.7 * (e.count / maxCount);
      // Shorten the line a bit so the arrowhead doesn't bury into the target node.
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      const shrink = 0.025 / Math.max(len, 0.01);
      const x1 = (a.x + dx * shrink) * W;
      const y1 = (a.y + dy * shrink) * H;
      const x2 = (b.x - dx * shrink) * W;
      const y2 = (b.y - dy * shrink) * H;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
                    x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
                    stroke="#4a106d" stroke-opacity="${op.toFixed(2)}"
                    stroke-width="${sw.toFixed(2)}" marker-end="url(#net-arrow)" />`;
    }).join('')}
    ${nodes.map(n => {
      const deg = (inDeg.get(n.id)||0) + (outDeg.get(n.id)||0);
      const r = 14 + 18 * (deg / maxDeg);
      const cx = n.x * W;
      const cy = n.y * H;
      const initial = (n.name || '?').trim().charAt(0).toUpperCase();
      return `
        <g data-node="${n.id}" style="cursor:pointer">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                  fill="#ede4f3" stroke="#4a106d" stroke-width="2"/>
          <text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}"
                text-anchor="middle" font-size="14" font-weight="700"
                fill="#4a106d">${escapeHtml(initial)}</text>
          <text x="${cx.toFixed(1)}" y="${(cy + r + 12).toFixed(1)}"
                text-anchor="middle" font-size="11" fill="#3a2a4a">${escapeHtml(n.name || '')}</text>
        </g>`;
    }).join('')}
  </svg>`;
  wrap.innerHTML = svg;

  wrap.querySelectorAll('[data-node]').forEach(g => {
    g.addEventListener('click', () => showNodeDetail(Number(g.dataset.node), nodes, edges, tab));
  });
}

function showNodeDetail(userId, nodes, edges, tab) {
  const me = nodes.find(n => n.id === userId);
  const out = edges.filter(e => e.from === userId);
  const inn = edges.filter(e => e.to === userId);
  const direction = tab === 'tasks'
    ? { out: '依頼してやってもらった相手', in: '依頼を引き受けてくれた相手' }
    : { out: '買った相手 (この人から)',    in: '売った相手 (この人へ)' };
  const lineFor = e => {
    const other = nodes.find(n => n.id === (e.from === userId ? e.to : e.from));
    return `<div class="list-item">
      <div>${escapeHtml(other?.name || '?')}</div>
      <div class="meta">${e.count}回 / ${e.total.toLocaleString()} pt</div>
    </div>`;
  };
  const card = document.getElementById('net-detail');
  card.hidden = false;
  card.innerHTML = `
    <h3 style="margin:0 0 6px">${escapeHtml(me.name)}</h3>
    <div class="meta" style="margin-bottom:8px">送り出し ${out.length}人 / 受け入れ ${inn.length}人</div>
    <h4 style="margin:8px 0 4px; font-size:13px">${direction.out}</h4>
    ${out.length ? `<div class="list">${out.sort((a,b)=>b.count-a.count).map(lineFor).join('')}</div>` : '<div class="muted">なし</div>'}
    <h4 style="margin:14px 0 4px; font-size:13px">${direction.in}</h4>
    ${inn.length ? `<div class="list">${inn.sort((a,b)=>b.count-a.count).map(lineFor).join('')}</div>` : '<div class="muted">なし</div>'}
  `;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
