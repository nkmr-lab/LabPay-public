// 自作 widget サンプル: 🕐 時計 (1 秒 更新)。
// widget センター (#/widgets) で 新規 → JS コード 欄 に この 中身 を 貼り 付け、 有効化 して 保存。

import { me, html } from '/js/widgets_api.js';

export const meta = {
  name: '🕐 時計',
  description: '現在 時刻 を 表示',
  refreshSec: 1,    // 1 秒 ごと に render 呼び 直し
};

export function render(root) {
  const now = new Date();
  root.innerHTML = `
    <div style="text-align:center; padding:8px">
      <div style="font-size:36px; font-family:monospace; font-weight:700">
        ${now.toLocaleTimeString('ja-JP')}
      </div>
      <div class="hint-sm" style="font-size:13px">
        ${now.toLocaleDateString('ja-JP', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <div class="hint-sm" style="font-size:11px; margin-top:4px">こんにちは、 ${html(me.name)} さん</div>
    </div>
  `;
}
