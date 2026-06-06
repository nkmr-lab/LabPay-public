// /#/feature-request, /#/bug-report — 機能要望 / バグ報告 のフォーム単独ページ。
// 旧: 設定 ページ下部にあった フォーム を 上部メニューから直接到達できる形に切り出した。
// 投稿は /api/feedback POST に統一 (kind を固定して送る)。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

function renderForm(kind) {
  const isBug = kind === 'bug';
  const title = isBug ? '🐛 バグ報告' : '✨ 機能要望';
  const placeholder = isBug
    ? '例: 〇〇画面で △△ するとボタンが反応しません。 端末: iPhone 15, Safari'
    : '例: 「行く場所マップ」 に 移動手段別の色分けが欲しいです';
  const intro = isBug
    ? 'バグや変な挙動を見つけたら 教えてください。 発生手順 (どこで何をしたら) も書いてもらえると助かります。'
    : 'こんな機能があったら / こうなってたら便利、 みたいなアイデアを 教えてください。';

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">${title}</h2>
      <p class="muted" style="font-size:13px; margin:4px 0 12px">${escapeHtml(intro)}</p>
      <textarea id="fu-body" maxlength="4000" rows="6" placeholder="${escapeHtml(placeholder)}"
                style="width:100%; box-sizing:border-box"></textarea>
      <div class="row" style="margin-top:8px; gap:6px; justify-content:flex-end">
        <button id="fu-send" class="primary">送る</button>
      </div>
      <p class="hint-sm" style="margin-top:10px">
        送信先は 管理者 (中村)。 返信があると 通知 タブに届きます。
      </p>
    </div>
  `;
  const sendBtn = document.getElementById('fu-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const body = document.getElementById('fu-body').value.trim();
      if (!body) { toast('内容を書いてください'); return; }
      // v465 二度押し 防止: ボタン を 即 disable + 送信中 ラベル に。
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      const orig = sendBtn.textContent;
      sendBtn.textContent = '送信中…';
      try {
        await post('/api/feedback', { kind, body, url: location.hash });
        toast('送信しました!');
        document.getElementById('fu-body').value = '';
      } catch (e) {
        toast('失敗: ' + e.message);
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = orig;
      }
    });
  }
}

export async function renderFeatureRequest() { renderForm('feature'); }
export async function renderBugReport()      { renderForm('bug'); }
