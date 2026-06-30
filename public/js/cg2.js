// /js/cg2.js — 自作ゲーム v2 (cg2) runtime。
// 設計 → docs/CUSTOM_GAMES_V2.md
//
// 開発者が import で受け取る ambient なもの:
//   players, myID, isHost, sharedValues, localValues, notifyResult, host, p5

import { get, post } from './api.js';

// ── ambient state (framework が gameDidMount でセット) ──
const _state = {
  gameId: null,
  kindSlug: null,
  myID: 0,
  isHost: false,
  players: [],
  seq: 0,
  rawShared: {},     // server から来た値 (= 真値)
  hostHooks: { start: null, stop: null },
  pendingChanges: {},
  pendingTimer: null,
  pollTimer: null,
  finalized: false,
  onPlayersChanged: null,
};

// players は live (= framework が in-place 置換する)。
export const players = [];

// myID / isHost はライブ値取得用の Proxy で取り扱う ($state を参照)
export function _setMyID(v) { _state.myID = v; }
export function _getMyID()   { return _state.myID; }

// JS では `import { myID }` した瞬間の binding がライブ同期するのは export const のみ。
// なので _internal を通して関数経由で取れるようにもするが、 開発者体験用に
// const myID も export する (framework が _bootstrap で値を確定してから JS module を import するので OK)。
export let myID = 0;
export let isHost = false;

// sharedValues は deep Proxy で mutate を追跡 → server へ同期。 localValues は単純 object。
const _sharedRaw = {};
let _suppressDirty = false;
function _makeDeepProxy(target) {
  return new Proxy(target, {
    get(t, k) {
      const v = t[k];
      if (v && typeof v === 'object') return _makeDeepProxy(v);
      return v;
    },
    set(t, k, v) {
      t[k] = v;
      if (!_suppressDirty) _markDirty();
      return true;
    },
    deleteProperty(t, k) {
      delete t[k];
      if (!_suppressDirty) _markDirty();
      return true;
    },
  });
}
export const sharedValues = _makeDeepProxy(_sharedRaw);
export const localValues = {};

// host.start = () => {...}; host.stop = () => {...}; を受ける受け皿
export const host = { start: null, stop: null };

// 結果通知。 host.stop の中から呼ぶ。
export function notifyResult(text, opts) {
  if (_state.finalized) return;
  _state.finalized = true;
  return post(`/api/cg2/games/${_state.gameId}/finalize`, { text: String(text), opts: opts || {} });
}

// p5 instance は framework が import('/vendor/p5.min.js') したものを公開
export let p5 = null;
export function _setP5(p5lib) { p5 = p5lib; }

function _markDirty() {
  if (_state.pendingTimer) return;
  // 100ms debounce で server に flush
  _state.pendingTimer = setTimeout(async () => {
    _state.pendingTimer = null;
    try {
      // 全文を投げる (差分追跡がしんどいので)
      const r = await post(`/api/cg2/games/${_state.gameId}/shared`, {
        values: JSON.parse(JSON.stringify(_internalSharedRaw())),
        replace: true,
      });
      if (r && r.seq) _state.seq = r.seq;
    } catch (e) {
      console.warn('[cg2] flush failed', e);
    }
  }, 100);
}

function _internalSharedRaw() {
  // _sharedRaw を直接 dump (Proxy を通さない)
  return JSON.parse(JSON.stringify(_sharedRaw));
}

// ── 内部: server から値が降って来たときに sharedValues に merge ──
// _suppressDirty 中は Proxy の set が dirty を立てない (= server → client は ping-pong しない)
function _applyServerValues(values, seq) {
  _state.seq = seq;
  _suppressDirty = true;
  try {
    for (const k of Object.keys(_sharedRaw)) delete _sharedRaw[k];
    for (const k of Object.keys(values || {})) _sharedRaw[k] = values[k];
  } finally {
    _suppressDirty = false;
  }
  _state.rawShared = values || {};
}

// ── 起動 (framework が cg2_view.js から呼ぶ) ──
export async function _bootstrap({ gameId, kindSlug, gameData, kindData, p5lib }) {
  _state.gameId = gameId;
  _state.kindSlug = kindSlug;
  _state.myID = Number(gameData.me_id || 0);
  myID = _state.myID;
  _state.isHost = !!gameData.is_host;
  isHost = _state.isHost;
  // players を in-place 置換
  players.length = 0;
  for (const p of (gameData.players || [])) players.push(p);
  _state.players = players;
  _setP5(p5lib);

  // 動的 import: kind の JS body。 updated_at で cache busting
  const ver = encodeURIComponent(kindData.updated_at || '');
  const mod = await import(`/api/cg2/kinds/${encodeURIComponent(kindSlug)}/script.js?v=${ver}`);

  // host hooks を取得 (代入形式で開発者が host.start = ... と書く)
  _state.hostHooks.start = host.start;
  _state.hostHooks.stop  = host.stop;

  // host だったら host.start を呼んで初期 sharedValues を server へ
  if (_state.isHost && (gameData.shared_seq | 0) === 0) {
    if (typeof _state.hostHooks.start === 'function') {
      _suppressDirty = true;     // host.start 中の mutate は auto-flush しない (= 手動で 1 回 POST する)
      try { _state.hostHooks.start(); }
      catch (e) { console.error('[cg2] host.start failed', e); _suppressDirty = false; throw e; }
      _suppressDirty = false;
    }
    // sharedValues に入っているものを server に POST (replace モード)
    try {
      const r = await post(`/api/cg2/games/${gameId}/shared`, {
        values: _internalSharedRaw(),
        replace: true,
      });
      if (r && r.seq) _state.seq = r.seq;
    } catch (e) { console.error('[cg2] initial shared post failed', e); throw e; }
  } else {
    // non-host: server から取ってくる
    const r = await get(`/api/cg2/games/${gameId}/shared?since=0`);
    if (r && r.values) _applyServerValues(r.values, r.seq || 0);
  }

  // p5 sketch を mount
  const container = document.getElementById('cg2-canvas-host');
  if (container && mod.default) {
    new p5lib(mod.default, container);
  }

  // polling 開始 (500ms)
  _startPolling();
  return mod;
}

function _startPolling() {
  if (_state.pollTimer) clearInterval(_state.pollTimer);
  _state.pollTimer = setInterval(async () => {
    if (!document.getElementById('cg2-canvas-host')) {
      clearInterval(_state.pollTimer); _state.pollTimer = null;
      if (_state.pendingTimer) { clearTimeout(_state.pendingTimer); _state.pendingTimer = null; }
      return;
    }
    try {
      const r = await fetch(`/api/cg2/games/${_state.gameId}/shared?since=${_state.seq}`, {
        headers: { 'X-Requested-With': 'labpay' },
      });
      if (r.status === 304) return;  // 変更なし
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j.seq === 'number' && j.seq > _state.seq) {
        _applyServerValues(j.values || {}, j.seq);
      }
      // ended 検知 → host.stop を呼ぶ (host のみ)
      if (_state.isHost && !_state.finalized && sharedValues.ended === true) {
        if (typeof _state.hostHooks.stop === 'function') {
          try { _state.hostHooks.stop(); }
          catch (e) { console.error('[cg2] host.stop failed', e); }
        }
      }
    } catch (e) { /* skip */ }
  }, 500);
}

export function _cleanup() {
  if (_state.pollTimer) { clearInterval(_state.pollTimer); _state.pollTimer = null; }
  if (_state.pendingTimer) { clearTimeout(_state.pendingTimer); _state.pendingTimer = null; }
}
