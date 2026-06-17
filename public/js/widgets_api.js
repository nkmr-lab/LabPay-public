// /js/widgets_api.js — 自作 ウィジェット が import する 共通 API。
//
// 開発者 は こう 書く:
//
//   import { me, get, post, html } from '/js/widgets_api.js';
//
//   export const meta = {
//     name: '🕐 時計',
//     description: '現在 時刻 を 表示',
//     refreshSec: 1,      // 何 秒 おき に render を 呼び直すか (default 60)
//   };
//
//   export function render(root) {
//     const now = new Date();
//     root.innerHTML = `<div style="text-align:center; font-size:32px">
//       ${now.toLocaleTimeString('ja-JP')}
//     </div>`;
//   }
//
// framework が やる こと:
//   - render(root) を refreshSec 秒 ごと に 呼ぶ
//   - root は ホーム の カード 内 の div (= 開発者 が 中身 を 自由 に いじって OK)
//   - me, get, post, html を import で 提供

import { state } from './app.js';
import { get as apiGet, post as apiPost, patch as apiPatch, del as apiDel } from './api.js';
import { escapeHtml } from './router.js';

// 自分 の 情報。 widget 内 から me.id / me.name 等 を 直接 参照。
export const me = new Proxy({}, {
  get(_, k) {
    if (k === 'id')   return Number(state.me?.id) || 0;
    if (k === 'name') return state.me?.display_name || '';
    if (k === 'role') return state.me?.role || 'user';
    return state.me?.[k];
  },
});

// LabPay の API を 呼ぶ ラッパ。 /api/* を 自由 に 叩ける。
export const get   = (path)        => apiGet(path);
export const post  = (path, body)  => apiPost(path, body);
export const patch = (path, body)  => apiPatch(path, body);
export const del   = (path)        => apiDel(path);

// XSS 防止 用 escape。 HTML を テンプレ で 書く なら 必ず 通す。
export const html = escapeHtml;
