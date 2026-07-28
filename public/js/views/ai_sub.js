// v1251 AI サブスク 管理 画面。 1 週間 500pt、 自動更新、 chai.nkmr.io / file.nkmr.io
//   等 の 外部 サービス で 契約状況 を 参照 して 機能 を 制御 (契約 中 は フル、 未 だと 制限)。
//
// route: #/ai-sub
// API: /api/ai-sub (status) / /api/ai-sub/subscribe / /cancel / /resume / /check (外部)

import { get, post } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const STATUS_META = {
  active:   { emoji: '✅', label: '契約 中',           color: '#059669', bg: '#f0fdf4' },
  graceful: { emoji: '⏳', label: '解約 予約 (期限まで 有効)', color: '#a16207', bg: '#fefce8' },
  expired:  { emoji: '❌', label: '期限 切れ',         color: '#dc2626', bg: '#fef2f2' },
  never:    { emoji: '➖', label: '未 契約',           color: '#6b7280', bg: '#f9fafb' },
};

function fmtYmdHm(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return String(s);
  return `${m[1]}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}

export async function renderAiSub() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🤖 AI サブスク</h2>
      <div class="hint-sm" style="margin-top:4px">
        1 週間 500pt の 自動更新 サブスク。 契約 中 は 下記 が 全部 使い放題 に なります:<br>
        ・ LabPay 内 の AI 機能 (📑 論文要約 / 📑 全訳 / 📄 査読 / 🔎 Deep Research /
        🧪 実験計画書 チェック / 📝 原稿 チェック / ✂️ リライター) が <b>全部 無料</b><br>
        ・ <b>chai.nkmr.io</b> (ChatGPT / Claude 風) / <b>file.nkmr.io</b> (ファイル ブラウザ AI) 等 の
        <b>*.nkmr.io</b> 系 サービス で フル 機能<br>
        残高 が 500pt を 切ると 自動 解約 されます。
      </div>
    </div>
    <div id="as-body"><div class="card"><div class="hint-sm">読み込み中…</div></div></div>
    <div class="card" style="margin-top:8px">
      <h3 style="margin:0 0 6px; font-size:14px">🔗 対応 サービス</h3>
      <div class="hint-sm" style="line-height:1.6">
        <b>LabPay 内 (契約中 は 全部 無料)</b>:<br>
        📑 論文要約 (#/paper-summary) / 📑 全訳 (#/paper-translate-full) / 📄 論文査読 (#/paper-review)<br>
        🔎 Deep Research (#/deep-research) / 🧪 実験計画書 チェック (#/exp-plan) / 📝 原稿 チェック (#/resume-check)<br>
        ✂️ 文字数 リライター (#/rewriter)<br>
        <b>外部 サービス (契約中 は フル 機能)</b>:<br>
        📁 <a href="https://file.nkmr.io" target="_blank" rel="noopener">file.nkmr.io</a> — ファイル ブラウザ<br>
        💬 <a href="https://chai.nkmr.io" target="_blank" rel="noopener">chai.nkmr.io</a> — ChatGPT / Claude 風 チャット<br>
        <span style="color:#9ca3af">(順次 追加 予定)</span>
      </div>
    </div>
    <div class="card" style="margin-top:8px">
      <details>
        <summary style="cursor:pointer; font-weight:600; font-size:13px">💡 開発者 向け: サービス 側 で 契約状況 を 参照 する 方法</summary>
        <pre style="margin-top:8px; font-size:11px; background:#f9fafb; padding:8px; border-radius:4px; overflow-x:auto">// nkmr-SSO cookie 共有 な の で credentials で 通る
const r = await fetch('https://pay.nkmr.io/api/ai-sub/check',
                      { credentials: 'include' });
const j = await r.json();
// j = { ok, active, status, expires_at, days_left, user_id }
if (j.active) enableFullFeatures();
else          showSubscribePrompt();</pre>
        <div class="hint-sm" style="margin-top:6px">CORS は <code>*.nkmr.io</code> 全部 許可 済み。 401 未 ログイン は JSON で 返るので、 <code>login</code> フィールド で 誘導 可能。</div>
      </details>
    </div>
  `;
  await loadAndRender();
}

async function loadAndRender() {
  const body = document.getElementById('as-body');
  if (!body) return;
  try {
    const d = await get('/api/ai-sub');
    body.innerHTML = renderStatusCard(d);
    wireButtons();
  } catch (e) {
    body.innerHTML = `<div class="card" style="color:#dc2626">読み込み失敗: ${escapeHtml(e?.message || String(e))}</div>`;
  }
}

function renderStatusCard(d) {
  const s = d.subscription || {};
  const meta = STATUS_META[s.status] || STATUS_META.never;
  const canSubscribe = d.can_subscribe;
  const balance = d.balance;

  // 状態別 の 主 アクション ボタン
  let actions = '';
  if (s.status === 'active') {
    actions = `<button class="btn" id="as-cancel">✋ 自動更新 を 停止 (期限まで は 使える)</button>`;
  } else if (s.status === 'graceful') {
    actions = `<button class="btn primary" id="as-resume">▶ 自動更新 を 再開</button>`;
  } else if (s.status === 'expired' || s.status === 'never') {
    if (canSubscribe) {
      actions = `<button class="btn primary" id="as-subscribe">🟢 契約 する (500pt / 週)</button>`;
    } else {
      actions = `<div class="hint-sm" style="color:#dc2626">残高 不足 (要 500pt / 現在 ${balance}pt)、 チェックイン等 で 稼いで から どうぞ</div>
                 <button class="btn" disabled>🟢 契約 する (500pt / 週)</button>`;
    }
  }

  // 詳細 (契約中 or 解約予約 の 場合)
  let detail = '';
  if (s.status === 'active' || s.status === 'graceful') {
    detail = `
      <div class="hint-sm" style="margin-top:8px; line-height:1.7">
        📅 期限: <b>${escapeHtml(fmtYmdHm(s.current_period_end))}</b> (あと ${s.days_left} 日)<br>
        ${s.auto_renew ? '🔄 自動更新: <b style="color:#059669">ON</b> (期限 到達 で 自動 500pt 引き落し)' : '⏸ 自動更新: <b style="color:#a16207">OFF</b> (期限 で 自動 解約)'}<br>
        🎫 サイクル 数: ${s.cycle_count} / 累積 支払: ${s.total_paid} pt<br>
        ${s.last_charged_at ? `💰 直近 引き落し: ${escapeHtml(fmtYmdHm(s.last_charged_at))}<br>` : ''}
      </div>
    `;
  } else if (s.status === 'expired') {
    detail = `
      <div class="hint-sm" style="margin-top:8px">
        ${s.last_charge_failed_at
          ? `⚠ 直近 自動更新 が 残高 不足 で 失敗 しました (${escapeHtml(fmtYmdHm(s.last_charge_failed_at))})。 再契約 して ください。`
          : '期限 が 切れています。 再契約 で また 使えます。'}
      </div>
    `;
  }

  return `
    <div class="card" style="border-left:4px solid ${meta.color}; background:${meta.bg}44">
      <div class="row" style="align-items:center; gap:8px">
        <span style="font-size:24px">${meta.emoji}</span>
        <div style="flex:1">
          <div style="font-weight:700; font-size:16px; color:${meta.color}">${escapeHtml(meta.label)}</div>
          <div class="hint-sm" style="font-size:11px">現在 の 残高: ${balance} pt</div>
        </div>
      </div>
      ${detail}
      <div class="row" style="gap:6px; margin-top:12px; flex-wrap:wrap; justify-content:flex-end">
        ${actions}
      </div>
    </div>
  `;
}

function wireButtons() {
  document.getElementById('as-subscribe')?.addEventListener('click', async (e) => {
    if (!confirm('AI サブスク を 契約 しますか?\n\n500pt が 即時 引き落し されます (1 週間 有効)。\n以後 1 週間 毎 に 自動更新 (500pt) されます。\n残高 不足 で 自動 解約 されます。')) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '契約 中…';
    try {
      const r = await post('/api/ai-sub/subscribe', {});
      toast(r.resumed ? '自動更新 を 再開 しました' : '契約 しました 🎉');
      await loadAndRender();
    } catch (e2) {
      toast('失敗: ' + (e2?.message || e2));
      btn.disabled = false;
    }
  });
  document.getElementById('as-cancel')?.addEventListener('click', async (e) => {
    if (!confirm('自動更新 を 停止 しますか?\n\n現在 の 期限まで は 使えます。 期限 で 自動 解約 されます。')) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '停止 中…';
    try {
      await post('/api/ai-sub/cancel', {});
      toast('自動更新 を 停止 しました');
      await loadAndRender();
    } catch (e2) {
      toast('失敗: ' + (e2?.message || e2));
      btn.disabled = false;
    }
  });
  document.getElementById('as-resume')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '再開 中…';
    try {
      await post('/api/ai-sub/resume', {});
      toast('自動更新 を 再開 しました');
      await loadAndRender();
    } catch (e2) {
      toast('失敗: ' + (e2?.message || e2));
      btn.disabled = false;
    }
  });
}
