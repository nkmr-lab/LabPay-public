// /#/help — LabPay 操作ガイド AI アシスタント。
// 「○○ したいんだけど どう操作する?」 に 答える Q&A チャット。
// 会話履歴は localStorage に保存 (端末ローカル)、 サーバには 都度送信。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const HIST_KEY = 'labpay-help-history';
const HIST_MAX = 20;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHistory(arr) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(-HIST_MAX))); } catch {}
}

export async function renderHelp() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🤖 操作ガイド AI</h2>
      <p class="card-subtitle" style="margin:6px 0 0">
        「○○ したいんだけど どこから?」 等 LabPay の 使い方 を 聞いてください。
        ユーザー本人の データ (残高 / 履歴 等) は 見えない ので、 操作手順 案内のみ。
      </p>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="help-log" style="padding:10px; max-height:60vh; min-height:240px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; background:#f6f6f9">
      </div>
      <div style="padding:8px; background:#fff; border-top:1px solid var(--line)">
        <div class="row" style="gap:6px; align-items:flex-end">
          <textarea id="help-input" rows="1" maxlength="2000"
            placeholder="例: グループの 地図モード って どこから 開く?"
            style="flex:1; resize:none; min-height:36px; max-height:120px; font-size:14px"></textarea>
          <button id="help-send" class="primary" style="padding:6px 14px">送信</button>
        </div>
        <div class="row" style="gap:6px; margin-top:4px; align-items:center; flex-wrap:wrap">
          <button id="help-clear" class="btn" style="padding:2px 8px; font-size:11px">履歴をクリア</button>
          <span class="hint-sm" style="margin-left:auto">Enter で送信 / Shift+Enter で改行</span>
        </div>
      </div>
    </div>
  `;
  const log = document.getElementById('help-log');
  const input = document.getElementById('help-input');
  const sendBtn = document.getElementById('help-send');

  let history = loadHistory();

  // 例示 質問: 履歴ゼロ なら 出す。
  const examples = [
    'グループの 地図モード って どこから 開く?',
    '画像 翻訳 って どこ?',
    'タイマー の ベルを 3 回 鳴らしたい',
    '行きたい場所 を 追加するには?',
    '残高 を 確認するには?',
  ];

  const renderLog = () => {
    if (history.length === 0) {
      log.innerHTML = `
        <div class="hint" style="font-size:12px; color:#555">こんなことが 聞けます ↓</div>
        <div class="row" style="gap:4px; flex-wrap:wrap">
          ${examples.map((q, i) => `<button data-ex-q="${i}" class="btn" style="padding:2px 8px; font-size:11px">${escapeHtml(q)}</button>`).join('')}
        </div>`;
      log.querySelectorAll('[data-ex-q]').forEach(b => {
        b.addEventListener('click', () => {
          input.value = examples[Number(b.dataset.exQ)];
          input.focus();
        });
      });
      return;
    }
    log.innerHTML = history.map(m => {
      const isUser = m.role === 'user';
      return `
        <div style="display:flex; ${isUser ? 'justify-content:flex-end' : 'justify-content:flex-start'}">
          <div style="max-width:80%; padding:8px 12px; border-radius:12px; background:${isUser ? 'var(--primary)' : '#fff'}; color:${isUser ? '#fff' : 'inherit'}; box-shadow:0 1px 2px rgba(0,0,0,0.05); font-size:14px; white-space:pre-wrap; line-height:1.5">
            ${escapeHtml(m.content)}
          </div>
        </div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  };

  const onSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;
    history.push({ role: 'user', content: text });
    saveHistory(history);
    renderLog();
    // 「考え中…」 プレースホルダ
    history.push({ role: 'assistant', content: '…考え中' });
    renderLog();
    try {
      const r = await post('/api/ai/assistant', {
        message: text,
        history: history.slice(0, -2),  // 最後 2 件 (user 質問 + 考え中) を 除く
      });
      history[history.length - 1] = { role: 'assistant', content: r.text || '(空応答)' };
      saveHistory(history);
      renderLog();
    } catch (e) {
      history[history.length - 1] = { role: 'assistant', content: '失敗: ' + (e.message || e) };
      renderLog();
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };

  sendBtn.addEventListener('click', onSend);
  input.addEventListener('keydown', (ev) => {
    // v463 IME 変換確定 の Enter (keyCode=229 / isComposing=true) を 除外。
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      onSend();
    }
  });
  document.getElementById('help-clear').addEventListener('click', () => {
    if (!confirm('会話履歴を 消しますか?')) return;
    history = [];
    saveHistory(history);
    renderLog();
  });

  renderLog();
  input.focus();
}
