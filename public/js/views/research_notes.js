// /#/research-notes — Cosense (nkmr-lab) の 「YYYY.MM_研究ノート_<handle>」 ページ を 読み込み、
//   今日 / 昨日 の 日付 セクション を 表示。 PAT 登録 済 み なら LabPay 内 で 直接 書き込み (v2 API)。
//   v823 Phase B: PAT 経由 で の preview → submit 書き込み を 実装。

import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderResearchNotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 研究 ノート (Cosense)</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        「YYYY.MM_研究ノート_<i>handle</i>」 ページ を 取得 し、 直近 の 日付 セクション を 表示 し ます。
        書き込み は <b>PAT 登録 済 み</b> の 場合 LabPay 内 で 直接 (preview → submit)、 未 登録 の 場合 は Cosense を 開いて 編集。
      </p>
    </div>
    <div class="card" id="rn-status">
      <div class="muted">読み込み 中…</div>
    </div>
    <div class="card" id="rn-today" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">📅 今日 (<span id="rn-today-date"></span>)</h3>
        <a id="rn-today-open" class="btn" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">↗ Cosense を 開く</a>
      </div>
      <div id="rn-today-body" class="muted" style="margin-bottom:10px"></div>
      <div id="rn-today-write" class="rn-write" hidden>
        <textarea id="rn-today-text" rows="4" maxlength="20000" placeholder="今日 の 研究 ノート を 書く" style="width:100%; font-family:inherit; font-size:13.5px; box-sizing:border-box; padding:6px 8px"></textarea>
        <div class="row" style="gap:6px; margin-top:6px; align-items:center">
          <button id="rn-today-submit" class="primary">📝 LabPay 内 から 追記</button>
          <span class="hint-sm">先頭 半角 スペース が 自動 で 付き ます (Scrapbox の インデント 記法)</span>
        </div>
      </div>
      <div id="rn-today-write-disabled" class="hint-sm" hidden style="color:#dc2626">
        PAT 未 登録 の ため LabPay 内 書き込み は 無効。 「↗ Cosense を 開く」 で 編集 する か、 設定 → Cosense 連携 で PAT を 登録 して ください。
      </div>
    </div>
    <div class="card" id="rn-yesterday" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">🌗 昨日 (<span id="rn-yesterday-date"></span>)</h3>
        <a id="rn-yesterday-open" class="btn" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">↗ Cosense を 開く</a>
      </div>
      <div id="rn-yesterday-body" class="muted"></div>
    </div>
    <div class="card" id="rn-page-links" hidden>
      <h3 style="margin:0 0 6px">📂 今月 / 先月 の ページ</h3>
      <div id="rn-page-list" class="list"></div>
    </div>
  `;
  await load();
}

let lastDays = null; // 全体 state 保持

async function load() {
  const statusEl = document.getElementById('rn-status');
  try {
    const d = await get('/api/cosense/research-note/days?count=2');
    lastDays = d;
    if (d.has_handle === false) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">Scrapbox handle が 未 登録</div>
        <div style="font-size:13px; margin-top:6px">${escapeHtml(d.message || '')}</div>`;
      return;
    }
    if (!d.cookie_present) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">⚠ Cosense 認証 が 未 設定</div>
        <div style="font-size:13px; margin-top:6px">
          設定 → Cosense 連携 で <b>PAT</b> を 登録 して ください (推奨)。
        </div>`;
      return;
    }
    const source = d.cookie_source || 'none';
    const canWrite = !!d.can_write;
    const sourceLabel = source === 'self-pat' ? '✅ PAT (本人)' :
                       source === 'self-cookie' ? '☑ cookie (本人)' :
                       source === 'shared-cookie' ? '⚙ 共有 cookie (中村 名義)' : '?';
    statusEl.innerHTML = `
      <div style="font-size:13px">handle: <code>${escapeHtml(d.handle)}</code> ・ 認証: ${sourceLabel} ・ ${d.recent?.length || 0} 件 の 日付 セクション 抽出</div>`;

    // ページ リンク
    const pl = document.getElementById('rn-page-links');
    const plRoot = document.getElementById('rn-page-list');
    pl.hidden = false;
    plRoot.innerHTML = (d.pages || []).map(p => `
      <a class="list-item" href="${escapeHtml(p.page_url)}" target="_blank" rel="noopener" style="gap:8px; align-items:center">
        <div class="grow">
          <div class="bold">${escapeHtml(p.title)}</div>
          <div class="meta">HTTP ${p.status} ${p.has_text ? '・ 取得 OK' : '・ 空 or 未 作成'}</div>
        </div>
        <span style="font-size:18px">↗</span>
      </a>`).join('');

    const todayKey = d.today, yKey = d.yesterday;
    const findByDate = (k) => (d.recent || []).find(s => s.date === k);
    const buildPageUrl = (dateKey) => {
      const ym = dateKey.slice(0, 7);
      const title = `${ym}_研究ノート_${d.handle}`;
      return `https://scrapbox.io/nkmr-lab/${encodeURIComponent(title)}`;
    };
    paintSection('rn-today', todayKey, findByDate(todayKey), buildPageUrl(todayKey), canWrite);
    paintSection('rn-yesterday', yKey, findByDate(yKey), buildPageUrl(yKey), false);
  } catch (e) {
    statusEl.innerHTML = `<div class="muted">取得 失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function paintSection(cardId, dateKey, section, pageUrl, allowWrite) {
  const card = document.getElementById(cardId);
  const dateEl = document.getElementById(cardId + '-date');
  const bodyEl = document.getElementById(cardId + '-body');
  const openEl = document.getElementById(cardId + '-open');
  if (!card) return;
  card.hidden = false;
  if (dateEl) dateEl.textContent = dateKey;
  if (openEl) openEl.href = pageUrl;
  if (section && section.body && section.body.trim() !== '') {
    bodyEl.classList.remove('muted');
    bodyEl.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit; margin:0; font-size:13px; line-height:1.6">${escapeHtml(section.body)}</pre>`;
  } else if (section) {
    bodyEl.classList.add('muted');
    bodyEl.textContent = '(日付 ヘッダ は ある が 内容 が 空)';
  } else {
    bodyEl.classList.add('muted');
    bodyEl.textContent = '(まだ 書か れて いません)';
  }

  // 書き込み UI (今日 のみ)
  if (cardId === 'rn-today') {
    const writeBox = document.getElementById('rn-today-write');
    const disabled = document.getElementById('rn-today-write-disabled');
    if (allowWrite) {
      writeBox.hidden = false;
      if (disabled) disabled.hidden = true;
      const ta = document.getElementById('rn-today-text');
      const btn = document.getElementById('rn-today-submit');
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', async () => {
          const text = ta.value.trim();
          if (!text) { toast('内容 を 入れて ください'); return; }
          btn.disabled = true;
          const old = btn.textContent;
          btn.textContent = '送信 中…';
          try {
            const r = await post('/api/cosense/research-note/append', { date: dateKey, text });
            if (r.ok) {
              ta.value = '';
              toast('✅ Cosense に 書き込み ました (' + (r.inserted_lines || 0) + ' 行)');
              await load();
            } else {
              toast('失敗: ' + (r.reason || r.body || ('HTTP ' + r.status)));
            }
          } catch (e) {
            toast('失敗: ' + (e?.message || e));
          } finally {
            btn.disabled = false;
            btn.textContent = old;
          }
        });
      }
    } else {
      writeBox.hidden = true;
      if (disabled) disabled.hidden = false;
    }
  }
}
