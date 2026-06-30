// /#/chat — 汎用多言語対話 / 翻訳チャット (主に海外出張用)。
// 履歴は localStorage に保存 (端末ローカル / 直近 50 件)。

import { post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

const HIST_KEY = 'labpay-chat-history';
const HIST_MAX = 50;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHistory(arr) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(-HIST_MAX))); } catch {}
}

// 入力欄にプリセット文を流し込む 「クイックボタン」。
const QUICKS = [
  { label: '🇨🇳 中国語に',  prefix: 'これを中国語(簡体字)で: ' },
  { label: '🇮🇹 伊語に',    prefix: 'これをイタリア語で: ' },
  { label: '🇬🇧 英語に',    prefix: 'これを英語で: ' },
  { label: '🇰🇷 韓国語に',  prefix: 'これを韓国語で: ' },
  { label: '🇫🇷 仏語に',    prefix: 'これをフランス語で: ' },
  { label: '🇪🇸 西語に',    prefix: 'これをスペイン語で: ' },
  { label: '🌐 自動翻訳',   prefix: '翻訳して: ' },
  { label: '🍽 注文したい', prefix: '注文する時のフレーズ: ' },
];

// Markdown を軽く描画 (太字 / 改行のみ。 安全のため innerHTML は escapeHtml 後の文字列に対して限定的に置換)。
function renderMarkdownSafe(s) {
  // まず HTML エスケープ → 太字 → 改行
  let html = escapeHtml(s);
  // **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // *italic* (single *)
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // `code`
  html = html.replace(/`([^`\n]+)`/g, '<code style="background:#f0f0f5; padding:1px 4px; border-radius:3px; font-size:0.9em">$1</code>');
  return html;
}

export async function renderChat() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">💬 AI 対話 / 翻訳</h2>
    </div>
    <div class="card" style="padding:6px 8px; margin:6px 0">
      <div class="row" style="gap:4px; flex-wrap:wrap">
        ${QUICKS.map((q, i) => `<button data-q="${i}" class="btn" style="padding:2px 8px; font-size:11px">${escapeHtml(q.label)}</button>`).join('')}
      </div>
    </div>
    <div class="card" style="padding:0; overflow:hidden">
      <div id="chat-log" style="padding:10px; max-height:60vh; min-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; background:#f6f6f9">
      </div>
      <div style="padding:8px; background:#fff; border-top:1px solid var(--line)">
        <div class="row" style="gap:6px; align-items:flex-end">
          <textarea id="chat-input" rows="2" maxlength="4000"
            placeholder="日本語 / 外国語どちらでも。 例: 「すみません、トイレはどこですか？を中国語で」"
            style="flex:1; resize:none; min-height:48px; max-height:200px; font-size:14px"></textarea>
          <button id="chat-send" class="primary" style="padding:8px 16px">送信</button>
        </div>
        <div class="row" style="gap:6px; margin-top:4px; align-items:center; flex-wrap:wrap">
          <button id="chat-clear" class="btn" style="padding:2px 8px; font-size:11px">履歴クリア</button>
          <span class="hint-sm" style="margin-left:auto">Enter で送信 / Shift+Enter で改行</span>
        </div>
      </div>
    </div>
  `;
  const log = document.getElementById('chat-log');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  let history = loadHistory();

  const renderLog = () => {
    if (!history.length) {
      log.innerHTML = `
        <div class="hint" style="font-size:12px; color:#555">↓ 上のクイックボタンで始めるか、 自由に入力してください</div>`;
      return;
    }
    log.innerHTML = history.map(m => {
      const isUser = m.role === 'user';
      const body = isUser
        ? `<div style="white-space:pre-wrap">${escapeHtml(m.content)}</div>`
        : `<div style="line-height:1.55">${renderMarkdownSafe(m.content).replace(/\n/g, '<br>')}</div>`;
      return `
        <div style="display:flex; ${isUser ? 'justify-content:flex-end' : 'justify-content:flex-start'}">
          <div style="max-width:88%; padding:8px 12px; border-radius:12px; background:${isUser ? 'var(--primary)' : '#fff'}; color:${isUser ? '#fff' : 'inherit'}; box-shadow:0 1px 2px rgba(0,0,0,0.05); font-size:14px">
            ${body}
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
    history.push({ role: 'assistant', content: '…考え中' });
    renderLog();
    try {
      const r = await post('/api/ai/chat', {
        message: text,
        history: history.slice(0, -2),
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
    // v463 IME 変換確定の Enter は keyCode=229 / isComposing=true。 これらを除外
    // しないと日本語入力で変換確定するたびに送信されてしまう。
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      onSend();
    }
  });
  document.getElementById('chat-clear').addEventListener('click', () => {
    if (!confirm('会話履歴を消しますか?')) return;
    history = [];
    saveHistory(history);
    renderLog();
  });
  document.querySelectorAll('[data-q]').forEach(b => {
    b.addEventListener('click', () => {
      const q = QUICKS[Number(b.dataset.q)];
      const cur = input.value.trim();
      input.value = q.prefix + cur;
      input.focus();
      // カーソルを末尾へ
      try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
    });
  });

  renderLog();
  input.focus();
}
