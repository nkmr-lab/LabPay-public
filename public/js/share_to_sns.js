// v585 ワンボタンで らぼったー (SNS) に 投稿する 汎用 ヘルパ。
//   引数: title (投稿冒頭メッセージ) と hashUrl ('#/predictions/1' など)。
//   POST /api/posts で 「{title}\n\n{hashUrl}」 形式で 投げる。
//   既存の posts renderer (v562) が #/ で 始まる URL を 自動 リンク化 するので、
//   投稿された 文章中に URL を 書くと そのまま タップで 該当 ページに ジャンプ。
//
// v616 #237 prompt() ベース から モーダル UI に 改修。
//   テキスト編集 textarea + 「現在地添付」 チェック + 「らぼったーに投稿」/「キャンセル」 ボタン。

import { post } from './api.js';
import { toast } from './app.js';
import { escapeHtml } from './router.js';

export async function shareToSns(title, hashUrl) {
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const defaultBody = `${title}\n\n${url}`;
  return new Promise((resolve) => {
    document.getElementById('share-sns-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'share-sns-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:flex-start; justify-content:center; padding:60px 16px';
    overlay.innerHTML = `
      <div style="background:#fff; border-radius:12px; max-width:520px; width:100%; box-shadow:0 10px 40px rgba(0,0,0,0.3); display:flex; flex-direction:column; overflow:hidden">
        <div style="padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center">
          <h3 style="margin:0; flex:1; font-size:15px">💬 らぼったーに投稿</h3>
          <button id="ssm-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
        </div>
        <div style="padding:14px 16px; display:flex; flex-direction:column; gap:10px">
          <textarea id="ssm-body" maxlength="2000" rows="6"
            style="width:100%; box-sizing:border-box; resize:vertical; min-height:120px; font-size:14px; line-height:1.6">${escapeHtml(defaultBody)}</textarea>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px">
            <input type="checkbox" id="ssm-loc"> 📍 現在地を添付
          </label>
          <div class="hint-sm" style="font-size:11px">
            #/ で始まる URL は タップで該当ページにジャンプ できます (例: ${escapeHtml(url)})
          </div>
        </div>
        <div style="padding:12px 16px; border-top:1px solid #eee; display:flex; gap:8px; justify-content:flex-end">
          <button id="ssm-cancel" class="btn">キャンセル</button>
          <button id="ssm-post" class="btn primary">投稿する</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const closeModal = (ok) => { overlay.remove(); resolve(!!ok); };
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(false); });
    document.getElementById('ssm-close').addEventListener('click', () => closeModal(false));
    document.getElementById('ssm-cancel').addEventListener('click', () => closeModal(false));
    document.getElementById('ssm-post').addEventListener('click', async () => {
      const body = document.getElementById('ssm-body').value.trim();
      if (!body) { toast('本文を入力してください'); return; }
      const useLoc = document.getElementById('ssm-loc').checked;
      const btn = document.getElementById('ssm-post');
      btn.disabled = true; btn.textContent = '送信中…';
      const payload = { body };
      if (useLoc && 'geolocation' in navigator) {
        try {
          const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
          payload.lat = p.coords.latitude;
          payload.lng = p.coords.longitude;
        } catch (_) {}
      }
      try {
        await post('/api/posts', payload);
        toast('らぼったーに投稿しました');
        closeModal(true);
      } catch (e) {
        toast('投稿失敗: ' + (e?.message || e));
        btn.disabled = false; btn.textContent = '投稿する';
      }
    });
    setTimeout(() => document.getElementById('ssm-body')?.focus(), 50);
  });
}

// v709 #301 ラボ 全体 で 共有 する 用 (Slack / DM 等 LabPay 外 へ 貼れる) の
//   絶対 URL を クリップボード に コピー する。 base = location.origin (例:
//   https://pay.nkmr.io)、 hashUrl は '#/invitations/123' / '#/tasks/45' 形式。
//   失敗 (HTTPS 外 / 権限 拒否 等) は textarea fallback で 救う。
export async function copyShareUrl(hashUrl) {
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const fullUrl = location.origin + '/' + url;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullUrl);
    } else {
      const ta = document.createElement('textarea');
      ta.value = fullUrl;
      ta.style.cssText = 'position:fixed; top:-1000px; left:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('URL を コピー しました: ' + fullUrl);
  } catch (e) {
    toast('コピー 失敗: ' + (e?.message || e));
  }
}

// 既存 view から シェア ボタンを 簡単に 生成 する ヘルパ。
//   ボタン要素を 親に append し、 クリックで shareToSns を 呼ぶ。
export function makeShareButton(title, hashUrl, label = '💬 らぼったーで共有') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.style.cssText = 'font-size:12px; padding:4px 8px';
  btn.textContent = label;
  btn.addEventListener('click', () => shareToSns(title, hashUrl));
  return btn;
}
