// /#/feedback (旧 /#/feature-request, /#/bug-report) — 機能要望 / バグ報告
// 統合フォーム単独ページ。
// v517 #146 「要望と報告は分ける必要ないかな。 1つのページにまとめて、 そのどちらかを
//   選択する」 形に統合。 旧 /#/feature-request, /#/bug-report は同じ画面に転送して、
//   どちらにアクセスしても同じフォームが出るようにする (radio で 「✨ 機能要望 / 🐛
//   バグ報告」 を切替)。 デフォルトは機能要望 (一番多いので)。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

function renderForm(initialKind) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">フィードバック</h2>
      <div class="row" style="gap:14px; margin:8px 0 10px">
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer">
          <input type="radio" name="fu-kind" value="feature" ${initialKind === 'feature' ? 'checked' : ''}>
          <span>✨ 機能要望</span>
        </label>
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer">
          <input type="radio" name="fu-kind" value="bug" ${initialKind === 'bug' ? 'checked' : ''}>
          <span>🐛 バグ報告</span>
        </label>
      </div>
      <p class="muted" id="fu-intro" style="font-size:13px; margin:4px 0 12px"></p>
      <textarea id="fu-body" maxlength="4000" rows="6" placeholder=""
                style="width:100%; box-sizing:border-box"></textarea>
      <div class="row" style="margin-top:8px; gap:6px; justify-content:flex-end">
        <button id="fu-send" class="primary">送る</button>
      </div>
      <p class="hint-sm" style="margin-top:10px">
        送信先は管理者 (中村)。 返信があると通知タブに届きます。
      </p>
    </div>
  `;
  const introEl = document.getElementById('fu-intro');
  const textArea = document.getElementById('fu-body');
  function applyKind(kind) {
    const isBug = kind === 'bug';
    introEl.textContent = isBug
      ? 'バグや変な挙動を見つけたら教えてください。 発生手順 (どこで何をしたら) も書いてもらえると助かります。'
      : 'こんな機能があったら / こうなってたら便利、 みたいなアイデアを教えてください。';
    textArea.placeholder = isBug
      ? '例: 〇〇画面で △△ するとボタンが反応しません。 端末: iPhone 15, Safari'
      : '例: 「行く場所マップ」 に移動手段別の色分けが欲しいです';
  }
  applyKind(initialKind);
  document.querySelectorAll('input[name="fu-kind"]').forEach(r => {
    r.addEventListener('change', () => applyKind(r.value));
  });

  const sendBtn = document.getElementById('fu-send');
  sendBtn.addEventListener('click', async () => {
    // v513 #137 ページ遷移中に発火するレースで textarea が null になり
    //   「Cannot read properties of null (reading 'value')」が出ていたケース対応。
    const ta = document.getElementById('fu-body');
    const body = (ta?.value || '').trim();
    if (!body) { toast('内容を書いてください'); return; }
    if (sendBtn.disabled) return;
    sendBtn.disabled = true;
    const orig = sendBtn.textContent;
    sendBtn.textContent = '送信中…';
    try {
      const kindEl = document.querySelector('input[name="fu-kind"]:checked');
      const kind = kindEl ? kindEl.value : 'feature';
      await post('/api/feedback', { kind, body, url: location.hash });
      toast('送信しました!');
      const ta2 = document.getElementById('fu-body');
      if (ta2) ta2.value = '';
    } catch (e) {
      toast('失敗: ' + e.message);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = orig;
    }
  });
}

// 旧経路の互換: /#/feature-request → 機能要望が初期選択 / /#/bug-report → バグ報告初期選択
export async function renderFeatureRequest() { renderForm('feature'); }
export async function renderBugReport()      { renderForm('bug'); }
// 新統合 URL: /#/feedback (デフォルト機能要望)
export async function renderFeedbackForm()   { renderForm('feature'); }
