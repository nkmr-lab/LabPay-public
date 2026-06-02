// /#/network — social graph view.
//
// Uses d3-force for the simulation (lazy-loaded from /vendor/d3.min.js — only
// when this view is actually opened, so the rest of the app stays library-free).
// Rendering is still our own SVG so we keep the LabPay look (drop shadow +
// avatar clip + curved bidirectional edges).

import { get } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';

const TAB_KEY = 'labpay-network-tab';
const LAYOUT_KEY = 'labpay-network-layout';
const WEIGHT_KEY = 'labpay-network-weight';   // 'count' (件数) or 'total' (総額)
const W = 1000, H = 1000;

// Lazy local-vendor loader for d3 v7. Cached so multiple openings of the network
// tab don't re-add the script tag.
let _d3Promise = null;
function loadD3() {
  if (window.d3) return Promise.resolve(window.d3);
  if (_d3Promise) return _d3Promise;
  _d3Promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/d3.min.js';
    s.async = true;
    s.onload  = () => resolve(window.d3);
    s.onerror = () => reject(new Error('failed to load /vendor/d3.min.js'));
    document.head.appendChild(s);
  });
  return _d3Promise;
}

// Module-scope reference to the active graph data + render handle so drag /
// highlight handlers can mutate positions and re-render without re-fetching.
let GRAPH = null;

export async function renderNetwork() {
  const app = document.getElementById('app');
  const activeTab = localStorage.getItem(TAB_KEY) || 'purchases';
  const layoutMode = localStorage.getItem(LAYOUT_KEY) || 'force';
  const weightMode = localStorage.getItem(WEIGHT_KEY) || 'count';
  app.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center">
        <a href="#/apps" class="muted" style="font-size:13px">← アプリ</a>
      </div>
      <h2 style="margin:6px 0 0">関係性グラフ</h2>
      <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
        <button class="btn ${activeTab==='purchases'?'primary':''}" data-tab="purchases">売買</button>
        <button class="btn ${activeTab==='tasks'?'primary':''}" data-tab="tasks">タスク</button>
        <button class="btn ${activeTab==='combined'?'primary':''}" data-tab="combined">統合</button>
      </div>
      <div style="display:flex; gap:6px; margin-top:6px; align-items:center; flex-wrap:nowrap">
        <select id="net-weight-mode" style="font-size:13px; flex:1; min-width:0" title="線の重み">
          <option value="count" ${weightMode==='count'?'selected':''}>件数</option>
          <option value="total" ${weightMode==='total'?'selected':''}>総額</option>
        </select>
        <select id="net-layout-mode" style="font-size:13px; flex:1; min-width:0">
          <option value="force" ${layoutMode==='force'?'selected':''}>自動配置</option>
          <option value="circle" ${layoutMode==='circle'?'selected':''}>円形配置</option>
        </select>
        <button class="btn" id="net-relayout" title="配置をやり直す" style="flex:0 0 auto">⟳</button>
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
  document.getElementById('net-weight-mode').addEventListener('change', (ev) => {
    localStorage.setItem(WEIGHT_KEY, ev.target.value);
    renderNetwork();
  });
  document.getElementById('net-relayout').addEventListener('click', () => {
    if (!GRAPH) return;
    if (GRAPH.layoutMode === 'circle') circleLayout(GRAPH.nodes);
    else d3Layout(GRAPH.nodes, GRAPH.edges);
    drawSvg();
  });

  await loadAndRender(activeTab, layoutMode, weightMode);
}

async function loadAndRender(tab, layoutMode, weightMode) {
  const desc = document.getElementById('net-arrow-desc');
  if (tab === 'tasks')          desc.textContent = '依頼者 → 引き受けた人';
  else if (tab === 'combined')  desc.innerHTML = '<span style="color:#4a106d">紫=売り手→買い手</span> / <span style="color:#0e7c63">緑=依頼者→引き受けた人</span>';
  else                          desc.textContent = '売り手 → 買い手';
  try {
    // d3 is needed for the force simulation; circle mode could skip it but a
    // single load on first open is fine and keeps the code path simple.
    await loadD3();
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

    // Pre-compute the weight per edge based on the chosen metric so the layout and
    // the renderer both honor the same scale ('count' = number of transactions,
    // 'total' = sum of pt amounts).
    const wKey = weightMode === 'total' ? 'total' : 'count';
    edges.forEach(e => { e.weight = Math.max(0, e[wKey] || 0); });

    GRAPH = { nodes, edges, tab, layoutMode, weightMode, selectedId: null, inDeg, outDeg, neighbors };

    if (layoutMode === 'circle') circleLayout(nodes);
    else d3Layout(nodes, edges);
    drawSvg();
  } catch (e) {
    document.getElementById('net-loading').textContent = '失敗: ' + e.message;
  }
}

// d3.forceSimulation tuned for ~30-node lab graphs. We tick synchronously
// (no animation) and let the renderer take over; manual drag still updates
// node coordinates directly afterwards.
function d3Layout(nodes, edges) {
  const d3 = window.d3;
  if (!d3) return;
  // Clear stale fixed positions from a previous run.
  nodes.forEach(n => { n.fx = null; n.fy = null; n.x = W/2; n.y = H/2; });
  const links = edges.map(e => ({ source: e.from, target: e.to, value: e.weight || e.count }));
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id)
        .distance(d => 110 + 30 / Math.log(2 + d.value))
        .strength(d => Math.min(1, 0.15 + Math.log(1 + d.value) / 4)))
    .force('charge', d3.forceManyBody().strength(-520).distanceMax(W * 0.6))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide().radius(d => d.r + 6).iterations(2))
    .force('x', d3.forceX(W / 2).strength(0.04))
    .force('y', d3.forceY(H / 2).strength(0.04))
    .stop();
  // Run enough iterations to settle. d3 docs recommend log(alphaMin)/log(1-alphaDecay)
  // ≈ 300 by default; we use 350 for a bit more polish on noisy small graphs.
  for (let i = 0; i < 350; i++) sim.tick();
  // Clamp inside canvas so nothing drifts past the frame.
  nodes.forEach(n => {
    n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
    n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y));
  });
}

// Pure circular layout: sort nodes by degree DESC, place evenly on a perimeter
// circle. Doesn't need d3.
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

function drawSvg() {
  const { nodes, edges, selectedId, neighbors } = GRAPH;
  const wrap = document.getElementById('net-canvas-wrap');
  document.getElementById('net-loading')?.remove();
  // Use the active weight metric (count or total pt) for stroke thickness.
  const maxWeight = Math.max(1, ...edges.map(e => e.weight || 0));

  const isHi    = (id) => selectedId === null || neighbors.get(selectedId)?.has(id);
  const edgeHi  = (e) => selectedId === null || e.from === selectedId || e.to === selectedId;
  // Labels appear only on selected node + direct neighbors (and on everything when
  // nothing is selected and there are <= 12 nodes — small graphs read fine with all
  // labels). Big graphs without selection: labels hidden = no clutter.
  const showLbl = (id) =>
    selectedId !== null
      ? neighbors.get(selectedId)?.has(id)
      : nodes.length <= 12;

  // In combined mode, edges have a `type` field (purchase / task). Color accordingly
  // so purple+green strands are visually distinguishable when they overlap a pair.
  const colorFor = (e) => e.type === 'task' ? '#0e7c63' : '#4a106d';
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
    const w = e.weight || 0;
    const sw = 0.6 + 4 * (w / maxWeight);
    const baseOp = 0.10 + 0.35 * (w / maxWeight);
    const op = edgeHi(e) ? baseOp + 0.4 : baseOp * 0.35;
    const color = colorFor(e);
    // In combined mode, the arrowhead also needs to be colored; we have a per-type
    // marker for that. Single-mode tabs reuse the default purple marker.
    const marker = e.type === 'task' ? 'url(#net-arrow-task)' : 'url(#net-arrow)';
    return `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"
                   fill="none" stroke="${color}" stroke-opacity="${op.toFixed(2)}"
                   stroke-width="${sw.toFixed(2)}" marker-end="${marker}"/>`;
  }).join('');

  // Build a <clipPath> per node that has an avatar so the image is clipped to a circle.
  // Using the SVG element form (vs. the CSS basic-shape attribute form) is bullet-
  // proof across browsers.
  const clipDefs = nodes.filter(n => n.avatar).map(n =>
    `<clipPath id="net-clip-${n.id}">
       <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}"/>
     </clipPath>`
  ).join('');

  const nodesHtml = nodes.map(n => {
    const hi = isHi(n.id);
    const op = hi ? 1 : 0.22;
    const r = n.r;
    const cx = n.x, cy = n.y;
    // SVG 2 uses href, SVG 1.1 used xlink:href. Some older renderers and a few
    // PWA/in-app browsers still need xlink:href, so include both.
    const url = escapeHtml(n.avatar || '');
    const img = n.avatar
      ? `<image href="${url}" xlink:href="${url}"
                x="${(cx-r).toFixed(1)}" y="${(cy-r).toFixed(1)}"
                width="${(r*2).toFixed(1)}" height="${(r*2).toFixed(1)}"
                clip-path="url(#net-clip-${n.id})"
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
    // For avatar nodes we draw the image and then a stroked-only ring on top so the
    // border sits cleanly over the photo. No-avatar nodes get the filled circle +
    // initial as before.
    return `
      <g data-node="${n.id}" style="cursor:pointer; opacity:${op.toFixed(2)}">
        ${n.avatar
          ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                     fill="#ede4f3" filter="url(#net-shadow)"/>
             ${img}
             <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                     fill="none" stroke="${sel?'#f2c700':'#4a106d'}" stroke-width="${sel?4:2}"/>`
          : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
                     fill="#ede4f3" stroke="${sel?'#f2c700':'#4a106d'}" stroke-width="${sel?4:2}"
                     filter="url(#net-shadow)"/>
             <text x="${cx.toFixed(1)}" y="${(cy+r*0.18).toFixed(1)}"
                   text-anchor="middle" font-size="${(r*0.85).toFixed(1)}" font-weight="700"
                   fill="#4a106d">${escapeHtml(initial)}</text>`}
        ${label}
      </g>`;
  }).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%"
         xmlns="http://www.w3.org/2000/svg"
         xmlns:xlink="http://www.w3.org/1999/xlink"
         preserveAspectRatio="xMidYMid meet" style="display:block; touch-action:none">
      <defs>
        <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a106d" opacity="0.75"/>
        </marker>
        <marker id="net-arrow-task" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#0e7c63" opacity="0.75"/>
        </marker>
        <filter id="net-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.15"/>
        </filter>
        ${clipDefs}
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
    : tab === 'combined'
      ? { out: '送り出した相手 (買った / 依頼した)', in: '受け取った相手 (売った / 引き受けた)' }
      : { out: '買った相手 (この人から)', in: '売った相手 (この人へ)' };
  const typeBadge = (t) => {
    if (t === 'task')     return ' <span class="tag" style="background:#0e7c63; color:white; font-size:10px">タスク</span>';
    if (t === 'purchase') return ' <span class="tag" style="background:#4a106d; color:white; font-size:10px">売買</span>';
    return '';
  };
  const lineFor = e => {
    const other = nodes.find(n => n.id === (e.from === userId ? e.to : e.from));
    return `<div class="list-item">
      <div>${escapeHtml(other?.name || '?')}${tab === 'combined' ? typeBadge(e.type) : ''}</div>
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
