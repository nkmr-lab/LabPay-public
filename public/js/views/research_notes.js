// /#/research-notes — Cosense (nkmr-lab) 上 の 「YYYY.MM_研究ノート_<handle>」 ページ を 読み込み、
//   今日 / 昨日 の 日付 セクション を 抽出 して 表示。 書く 時 は Cosense の edit URL を 開く。
//   v821 #cosense Cosense REST API 直接 連携 (config.cosense.session_cookie 必須)。
import { get } from '../api.js';
import { escapeHtml } from '../router.js';

export async function renderResearchNotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 研究 ノート (Cosense)</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        nkmr-lab の 「YYYY.MM_研究ノート_<i>handle</i>」 ページ を ロード し、 直近 の 日付
        セクション を 抽出 して 表示 します。 書く 時 は Cosense を 開いて 直接 編集 し ます。
      </p>
    </div>
    <div class="card" id="rn-status">
      <div class="muted">読み込み中…</div>
    </div>
    <div class="card" id="rn-today" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">📅 今日 (<span id="rn-today-date"></span>)</h3>
        <a id="rn-today-edit" class="btn primary" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">✏️ Cosense で 書く</a>
      </div>
      <div id="rn-today-body" class="muted"></div>
    </div>
    <div class="card" id="rn-yesterday" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">🌗 昨日 (<span id="rn-yesterday-date"></span>)</h3>
        <a id="rn-yesterday-edit" class="btn" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">✏️ Cosense で 書く</a>
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

async function load() {
  const statusEl = document.getElementById('rn-status');
  try {
    const d = await get('/api/cosense/research-note/days?count=2');
    if (d.has_handle === false) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">Scrapbox handle が 未 登録</div>
        <div style="font-size:13px; margin-top:6px">${escapeHtml(d.message || '')}</div>`;
      return;
    }
    if (!d.cookie_present) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">⚠ Cosense session cookie が 未 設定</div>
        <div style="font-size:13px; margin-top:6px; line-height:1.6">
          admin が config.php の <code>cosense.session_cookie</code> に connect.sid 値 を 設定 する 必要 が あります。<br>
          取得 方法: Cosense (scrapbox.io) に ログイン → DevTools → Application → Cookies → connect.sid 値 (s%3A... で 始まる 長い 文字列) を コピー。
        </div>`;
      return;
    }
    // ページ リンク (今月 + 先月)
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

    const recent = d.recent || [];
    const todayKey = d.today;       // YYYY.MM.DD
    const yesterdayKey = d.yesterday;
    const findByDate = (k) => recent.find(s => s.date === k);
    const handle = d.handle;
    const buildEditUrl = (dateKey, sectionBody) => {
      // YYYY.MM.DD → YYYY.MM の ページ に 日付 ヘッダ を 追加 する URL を 生成
      const [y, m, day] = dateKey.split('.');
      const ym = `${y}.${m}`;
      const title = `${ym}_研究ノート_${handle}`;
      // section が 既に ある なら そのまま 開く、 ない なら 日付 ヘッダ を body 付与 で 新規 追加
      const proj = 'nkmr-lab';
      const baseUrl = `https://scrapbox.io/${encodeURIComponent(proj)}/${encodeURIComponent(title)}`;
      if (sectionBody) return baseUrl; // 既存 セクション に スクロール (Cosense 上 で)
      // 新規 セクション を 追加 する body
      const wday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(Number(y), Number(m)-1, Number(day)).getDay()];
      const header = `[*( ${dateKey} ${wday} )]`;
      return baseUrl + '?body=' + encodeURIComponent('\n' + header + '\n');
    };
    statusEl.innerHTML = `
      <div class="bold">Scrapbox handle: <code>${escapeHtml(handle)}</code></div>
      <div class="meta" style="font-size:12px">${recent.length} 件 の 日付 セクション を 抽出 (直近 2 日 分)</div>`;

    const today = findByDate(todayKey);
    const yest = findByDate(yesterdayKey);
    paintSection('rn-today', todayKey, today, buildEditUrl(todayKey, today?.body));
    paintSection('rn-yesterday', yesterdayKey, yest, buildEditUrl(yesterdayKey, yest?.body));
  } catch (e) {
    statusEl.innerHTML = `<div class="muted">取得 失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function paintSection(cardId, dateKey, section, editUrl) {
  const card = document.getElementById(cardId);
  const dateEl = document.getElementById(cardId + '-date');
  const bodyEl = document.getElementById(cardId + '-body');
  const editEl = document.getElementById(cardId + '-edit');
  if (!card) return;
  card.hidden = false;
  if (dateEl) dateEl.textContent = dateKey;
  if (editEl) editEl.href = editUrl;
  if (section && section.body !== undefined) {
    const body = section.body;
    if (body && body.trim() !== '') {
      bodyEl.classList.remove('muted');
      bodyEl.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit; margin:0; font-size:13px; line-height:1.6">${escapeHtml(body)}</pre>`;
    } else {
      bodyEl.classList.add('muted');
      bodyEl.textContent = '(日付 ヘッダ は ある が 内容 が 空)';
    }
  } else {
    bodyEl.classList.add('muted');
    bodyEl.textContent = '(まだ 書か れて いません) ' + (editEl ? '→ 「✏️ Cosense で 書く」 を タップ' : '');
  }
}
