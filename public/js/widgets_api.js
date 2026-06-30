// /js/widgets_api.js — 自作ウィジェットが import する共通 API。
//
// 開発者はこう書く:
//
//   import { me, get, post, html } from '/js/widgets_api.js';
//
//   export const meta = {
//     name: '🕐 時計',
//     description: '現在時刻を表示',
//     refreshSec: 1,      // 何秒おきに render を呼び直すか (default 60)
//   };
//
//   export function render(root) {
//     const now = new Date();
//     root.innerHTML = `<div style="text-align:center; font-size:32px">
//       ${now.toLocaleTimeString('ja-JP')}
//     </div>`;
//   }
//
// framework がやること:
//   - render(root) を refreshSec 秒ごとに呼ぶ
//   - root はホームのカード内の div (= 開発者が中身を自由にいじって OK)
//   - me, get, post, html を import で提供

import { state } from './app.js';
import { get as apiGet, post as apiPost, patch as apiPatch, del as apiDel } from './api.js';
import { escapeHtml } from './router.js';

// 自分の情報。 widget 内から me.id / me.name 等を直接参照。
export const me = new Proxy({}, {
  get(_, k) {
    if (k === 'id')   return Number(state.me?.id) || 0;
    if (k === 'name') return state.me?.display_name || '';
    if (k === 'role') return state.me?.role || 'user';
    return state.me?.[k];
  },
});

// LabPay の API を呼ぶラッパ。 /api/* を自由に叩ける。
export const get   = (path)        => apiGet(path);
export const post  = (path, body)  => apiPost(path, body);
export const patch = (path, body)  => apiPatch(path, body);
export const del   = (path)        => apiDel(path);

// XSS 防止用 escape。 HTML をテンプレで書くなら必ず通す。
export const html = escapeHtml;
