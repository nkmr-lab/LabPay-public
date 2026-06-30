// v620 自作ゲームの汎用ディスパッチャ。 ユーザ登録した kind を /#/cg/:kind で受ける。
//   - /api/custom-games/list から kind のメタ (js_module_url) を取得
//   - ES module を動的 import して renderList / renderDetail を呼び出す
//   - kind の JS module 側は任意の export 名で OK (例: renderTicTacToe) だが、
//     v620 から推奨は renderList(ctx) / renderDetail(ctx)
//   - フォールバックとして render{KindCamel} / render{KindCamel}Detail も探す

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

const moduleCache = new Map(); // kind -> Promise<module>

async function loadKindModule(kind) {
  if (moduleCache.has(kind)) return moduleCache.get(kind);
  const p = (async () => {
    const list = await get('/api/custom-games/list');
    const meta = (list.items || []).find(k => k.kind === kind);
    if (!meta) throw new Error(`unknown kind: ${kind}`);
    const url = meta.has_js_source
      ? `/api/custom-games/kinds/${encodeURIComponent(kind)}/script.js`
      : meta.js_module_url;
    // 動的 import (相対 URL でも絶対 URL でも OK)
    const mod = await import(/* @vite-ignore */ url);
    return { meta, mod };
  })();
  moduleCache.set(kind, p);
  return p;
}

function camel(s) {
  return s.replace(/(^|[-_])([a-z])/g, (_, __, c) => c.toUpperCase());
}

function pickRender(mod, kind, suffix) {
  // renderList / renderDetail を優先、 なければ render{KindCamel}{Suffix} を試す
  const key = (suffix === 'List') ? 'renderList' : 'renderDetail';
  if (typeof mod[key] === 'function') return mod[key];
  const fallback = 'render' + camel(kind) + (suffix === 'List' ? '' : 'Detail');
  if (typeof mod[fallback] === 'function') return mod[fallback];
  return null;
}

async function renderError(msg) {
  document.getElementById('app').innerHTML =
    `<div class="card"><div class="hint">${escapeHtml(msg)}</div></div>`;
}

export async function renderCustomGameList(ctx) {
  const kind = ctx?.params?.kind;
  if (!kind) return renderError('kind 未指定');
  try {
    const { mod } = await loadKindModule(kind);
    const fn = pickRender(mod, kind, 'List');
    if (!fn) return renderError(`${kind} に renderList がありません`);
    await fn(ctx);
  } catch (e) {
    renderError(`ゲーム読み込み失敗: ${e?.message || e}`);
  }
}

export async function renderCustomGameDetail(ctx) {
  const kind = ctx?.params?.kind;
  if (!kind) return renderError('kind 未指定');
  try {
    const { mod } = await loadKindModule(kind);
    const fn = pickRender(mod, kind, 'Detail');
    if (!fn) return renderError(`${kind} に renderDetail がありません`);
    await fn(ctx);
  } catch (e) {
    renderError(`ゲーム読み込み失敗: ${e?.message || e}`);
  }
}
