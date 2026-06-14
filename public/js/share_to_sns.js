// v585 ワンボタンで らぼったー (SNS) に 投稿する 汎用 ヘルパ。
//   引数: title (投稿冒頭メッセージ) と hashUrl ('#/predictions/1' など)。
//   POST /api/posts で 「{title}\n\n{hashUrl}」 形式で 投げる。
//   既存の posts renderer (v562) が #/ で 始まる URL を 自動 リンク化 するので、
//   投稿された 文章中に URL を 書くと そのまま タップで 該当 ページに ジャンプ。
//   投稿前 に 確認 (簡易 prompt) し、 編集 を 許容。

import { post } from './api.js';
import { toast } from './app.js';

export async function shareToSns(title, hashUrl) {
  const url = hashUrl.startsWith('#') ? hashUrl : '#' + hashUrl;
  const defaultBody = `${title}\n\n${url}`;
  const body = prompt('らぼったーに 投稿します。 本文を 編集できます:', defaultBody);
  if (body === null || body.trim() === '') return false;
  try {
    await post('/api/posts', { body: body.trim() });
    toast('らぼったーに 投稿しました');
    return true;
  } catch (e) {
    toast('投稿失敗: ' + (e?.message || e));
    return false;
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
