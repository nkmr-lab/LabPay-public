// /#/network — social graph view.
//
// All vanilla JS, no library. Layout = hand-rolled Fruchterman-Reingold with
// node-radius collision detection. Rendering = SVG with curved quadratic edges
// (so bidirectional pairs don't overlap), drop shadow on nodes, avatar images
// clipped to circles, drag-to-rearrange, and click-to-highlight neighborhood.

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

const TAB_KEY = 'labpay-network-tab';
const LAYOUT_KEY = 'labpay-network-layout';
const W = 1000, H = 1000;

// Module-scope reference to the active graph data + render handle so drag /
// highlight handlers can mutate positions and re-render without re-fetching.
let GRAPH = null;

export async function renderNetwork() {
  const app = document.getElementById('app');
  const activeTab = localStorage.getItem(TAB_KEY) || 'purchases';
  const layoutMode = localStorage.getItem(LAYOUT_KEY) || 'force';
  app.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center">
        <h2 style="flex:1; margin:0">ネットワーク</h2>
      </div>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn ${activeTab==='purchases'?'primary':''}" data-tab="purchases">売買</button>
        <button class="btn ${activeTab==='tasks'?'primary':''}" data-tab="tasks">タスク</button>
        <span style="flex:1"></span>
        <select id="net-layout-mode" style="font-size:13px">
          <option value="force" ${layoutMode==='force'?'selected':''}>自動配置</option>
          <option value="circle" ${layoutMode==='circle'?'selected':''}>円形配置</option>
        </select>
        <button class="btn" id="net-relayout" title="配置をやり直す">⟳</button>
      </div>
      <p class="muted" style="font-size:12px; margin:8px 0 0">
        矢印は <span id="net-arrow-desc"></span>。タップで関連を強調 / ドラッグで移動。
      </p>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="net-canvas-wrap" style="position:relative; width:100%; height:75vh; background:#fbfafd">
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
  document.getElementById('net-layout-mode').addEventListener('change', (ev) => {
    localStorage.setItem(LAYOUT_KEY, ev.target.value);
    renderNetwork();
  });
  document.getElementById('net-relayout').addEventListener('click', () => {
    if (!GRAPH) return;
    if (GRAPH.layoutMode === 'circle') circleLayout(GRAPH.nodes);
    else layout(GRAPH.nodes, GRAPH.edges, true);
    drawSvg();
  });

  await loadAndRender(activeTab, layoutMode);
}

async function loadAndRender(tab, layoutMode) {
  document.getElementById('net-arrow-desc').textContent =
    tab === 'tasks' ? '依頼者 → 引き受けた人' : '売り手 → 買い手';
  try {
    const d = await get('/api/network/' + tab);
    const nodes = d.nodes || [];
    const edges = d.edges || [];
    if (!nodes.length) {
      document.getElementById('net-loading').textContent = 'データがまだありません';
      return;
    }
    const inDeg = new Map(), outDeg = new Map();
    edges.forEach(e => {
      inDeg.set(e.to,   (inDeg.get(e.to)   || 0) + e.count);
      outDeg.set(e.from,(outDeg.get(e.from)|| 0) + e.count);
    });
    const maxDeg = Math.max(1, ...nodes.map(n => (inDeg.get(n.id)||0)+(outDeg.get(n.id)||0)));
    nodes.forEach(n => {
      const deg = (inDeg.get(n.id)||0) + (outDeg.get(n.id)||0);
      n.deg = deg;
      n.r   = 22 + 26 * (deg / maxDeg);
    });
    // Curve bidirectional pairs in opposite directions so A<->B reads as two arcs.
    const pairKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
    const groups = new Map();
    edges.forEach(e => {
      const k = pairKey(e.from, e.to);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    });
    edges.forEach(e => {
      const g = groups.get(pairKey(e.from, e.to));
      e.curveSign = g.length > 1 ? (g[0] === e ? 1 : -1) : 0;
    });
    // Pre-compute neighbor sets so the label/highlight logic is O(1) per draw.
    const neighbors = new Map(nodes.map(n => [n.id, new Set([n.id])]));
    edges.forEach(e => { neighbors.get(e.from)?.add(e.to); neighbors.get(e.to)?.add(e.from); });

    GRAPH = { nodes, edges, tab, layoutMode, selectedId: null, inDeg, outDeg, neighbors };

    if (layoutMode === 'circle') circleLayout(nodes);
    else layout(nodes, edges, true);
    drawSvg();
  } catch (e) {
    document.getElementById('net-loading').textContent = '失敗: ' + e.message;
  }
}

// Pure circular layout: sort nodes by degree DESC, place evenly on a perimeter
// circle. Lightweight, deterministic, very readable for small N.
function circleLayout(nodes) {
  const sorted = nodes.slice().sort((a, b) => (b.deg||0) - (a.deg||0));
  const N = sorted.length;
  const R = Math.min(W, H) * 0.40;
  sorted.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    n.x = W / 2 + R * Math.cos(a);
    n.y = H / 2 + R * Math.sin(a);
  });
}

// Fruchterman-Reingold + node-radius collision. Coordinates in SVG units.
function layout(nodes, edges, seedCircle) {
  const N = nodes.length;
  if (seedCircle) {
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2;
      n.x = W / 2 + (Math.min(W, H) * 0.3) * Math.cos(a);
      n.y = H / 2 + (Math.min(W, H) * 0.3) * Math.sin(a);
    });
  }
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const eIdx = edges.map(e => [idIndex.get(e.from), idIndex.get(e.to), e.count])
                    .filter(([a, b]) => a !== undefined && b !== undefined);
  const ideal = Math.sqrt((W * H) / N) * 0.65; // ideal edge length
  let temp = Math.min(W, H) * 0.12;
  const ITERATIONS = 280;
  for (let it = 0; it < ITERATIONS; it++) {
    // Reset accumulated displacement.
    nodes.forEach(n => { n.dx = 0; n.dy = 0; });
    // Repulsive forces between all pairs (FR core).
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d  = Math.sqrt(dx*dx + dy*dy) || 0.01;
        const f = (ideal * ideal) / d;
        dx /= d; dy /= d;
        a.dx += dx * f; a.dy += dy * f;
        b.dx -= dx * f; b.dy -= dy * f;
      }
    }
    // Attractive forces along edges (weighted by log(count+1)).
    for (const [ai, bi, c] of eIdx) {
      const a = nodes[ai], b = nodes[bi];
      let dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.sqrt(dx*dx + dy*dy) || 0.01;
      const f = (d * d / ideal) * Math.log(1 + c);
      dx /= d; dy /= d;
      a.dx -= dx * f; a.dy -= dy * f;
      b.dx += dx * f; b.dy += dy * f;
    }
    // Centering pull so isolated components don't drift off-canvas.
    for (const n of nodes) {
      n.dx += (W / 2 - n.x) * 0.015;
      n.dy += (H / 2 - n.y) * 0.015;
    }
    // Apply with cooling.
    for (const n of nodes) {
      const mag = Math.sqrt(n.dx*n.dx + n.dy*n.dy) || 0.01;
      const step = Math.min(mag, temp);
      n.x += (n.dx / mag) * step;
      n.y += (n.dy / mag) * step;
    }
    // Collision: push apart nodes whose circles overlap. Run a couple of relax passes.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = nodes[i], b = nodes[j];
          const minD = a.r + b.r + 6;
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 0.01;
          if (d < minD) {
            const overlap = (minD - d) / 2;
            dx /= d; dy /= d;
            a.x -= dx * overlap; a.y -= dy * overlap;
            b.x += dx * overlap; b.y += dy * overlap;
          }
        }
      }
    }
    // Keep inside canvas.
    for (const n of nodes) {
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
    }
    temp *= 0.985;
  }
}

function drawSvg() {
  const { nodes, edges, selectedId, neighbors } = GRAPH;
  const wrap = document.getElementById('net-canvas-wrap');
  document.getElementById('net-loading')?.remove();
  const maxCount = Math.max(1, ...edges.map(e => e.count));

  const isHi    = (id) => selectedId === null || neighbors.get(selectedId)?.has(id);
  const edgeHi  = (e) => selectedId === null || e.from === selectedId || e.to === selectedId;
  // Labels appear only on selected node + direct neighbors (and on everything when
  // nothing is selected and there are <= 12 nodes — small graphs read fine with all
  // labels). Big graphs without selection: labels hidden = no clutter.
  const showLbl = (id) =>
    selectedId !== null
      ? neighbors.get(selectedId)?.has(id)
      : nodes.length <= 12;

  const edgesHtml = edges.map(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (!a || !b) return '';
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const sx = a.x + (dx / len) * a.r;
    const sy = a.y + (dy / len) * a.r;
    const ex = b.x - (dx / len) * (b.r + 4);
    const ey = b.y - (dy / len) * (b.r + 4);
    const bend = e.curveSign * 0.18 * len;
    const mx = (sx + ex) / 2 - (dy / len) * bend;
    const my = (sy + ey) / 2 + (dx / len) * bend;
    const sw = 0.6 + 4 * (e.count / maxCount);
    // Edges are deliberately faint by default — emphasis is on nodes and selection.
    const baseOp = 0.10 + 0.35 * (e.count / maxCount);
    const op = edgeHi(e) ? baseOp + 0.4 : baseOp * 0.35;
    return `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"
                   fill="none" stroke="#4a106d" stroke-opacity="${op.toFixed(2)}"
                   stroke-width="${sw.toFixed(2)}" marker-end="url(#net-arrow)"/>`;
  }).join('');

  const nodesHtml = nodes.map(n => {
    const hi = isHi(n.id);
    const op = hi ? 1 : 0.22;
    const r = n.r;
    const cx = n.x, cy = n.y;
    const img = n.avatar
      ? `<image href="${escapeHtml(n.avatar)}" x="${(cx-r).toFixed(1)}" y="${(cy-r).toFixed(1)}"
            width="${(r*2).toFixed(1)}" height="${(r*2).toFixed(1)}"
            clip-path="circle(${r.toFixed(1)}px at ${cx.toFixed(1)} ${cy.toFixed(1)})"
            preserveAspectRatio="xMidYMid slice"/>`
      : '';
    const initial = (n.name || '?').trim().charAt(0).toUpperCase();
    const sel = n.id === selectedId;
    const label = showLbl(n.id)
      ? `<text x="${cx.toFixed(1)}" y="${(cy + r + 16).toFixed(1)}"
               text-anchor="middle" font-size="13" font-weight="700"
               fill="#1b1820" paint-order="stroke" stroke="#fbfafd" stroke-width="4"
              >${escapeHtml(n.name || '')}</text>`
      : '';
    return `
      <g data-node="${n.id}" style="cursor:pointer; opacity:${op.toFixed(2)}">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                fill="#ede4f3" stroke="${sel?'#f2c700':'#4a106d'}" stroke-width="${sel?4:2}"
                filter="url(#net-shadow)"/>
        ${img}
        ${n.avatar ? '' :
          `<text x="${cx.toFixed(1)}" y="${(cy+r*0.18).toFixed(1)}"
                 text-anchor="middle" font-size="${(r*0.85).toFixed(1)}" font-weight="700"
                 fill="#4a106d">${escapeHtml(initial)}</text>`}
        ${label}
      </g>`;
  }).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%"
         preserveAspectRatio="xMidYMid meet" style="display:block; touch-action:none">
      <defs>
        <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a106d" opacity="0.75"/>
        </marker>
        <filter id="net-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.15"/>
        </filter>
      </defs>
      ${edgesHtml}
      ${nodesHtml}
    </svg>`;

  // --- interactions ---
  const svg = wrap.querySelector('svg');
  svg.querySelectorAll('[data-node]').forEach(g => {
    const id = Number(g.dataset.node);
    g.addEventListener('pointerdown', (ev) => startDrag(ev, id, svg));
  });
  // Background tap clears selection.
  svg.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-node]')) return;
    GRAPH.selectedId = null;
    document.getElementById('net-detail').hidden = true;
    drawSvg();
  });
}

// Drag a node by pointer; tiny moves are treated as a click (selection).
function startDrag(ev, id, svg) {
  ev.preventDefault();
  const n = GRAPH.nodes.find(x => x.id === id);
  if (!n) return;
  const startX = ev.clientX, startY = ev.clientY;
  const origX = n.x, origY = n.y;
  let moved = false;
  const move = (e) => {
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    const pt = svgPoint(svg, e);
    const pt0 = svgPoint(svg, { clientX: startX, clientY: startY });
    n.x = origX + (pt.x - pt0.x);
    n.y = origY + (pt.y - pt0.y);
    n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
    n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
    drawSvg();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) {
      GRAPH.selectedId = (GRAPH.selectedId === id) ? null : id;
      drawSvg();
      if (GRAPH.selectedId !== null) showNodeDetail(id);
      else document.getElementById('net-detail').hidden = true;
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function svgPoint(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function showNodeDetail(userId) {
  const { nodes, edges, tab } = GRAPH;
  const me = nodes.find(n => n.id === userId);
  const out = edges.filter(e => e.from === userId);
  const inn = edges.filter(e => e.to === userId);
  const dir = tab === 'tasks'
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
    <h4 style="margin:8px 0 4px; font-size:13px">${dir.out}</h4>
    ${out.length ? `<div class="list">${out.sort((a,b)=>b.count-a.count).map(lineFor).join('')}</div>` : '<div class="muted">なし</div>'}
    <h4 style="margin:14px 0 4px; font-size:13px">${dir.in}</h4>
    ${inn.length ? `<div class="list">${inn.sort((a,b)=>b.count-a.count).map(lineFor).join('')}</div>` : '<div class="muted">なし</div>'}
  `;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
