// /#/research-notes — Cosense (nkmr-lab) の研究ノートをLabPay内で読み書き。
//   v830: 今日のセクションを丸ごとロード → textarea で編集 → 保存で差分のみコミット。
//   v831 予定: localStorage キャッシュでオフラインでも過去ぶんを見られるように。
import { get, post } from '../api.js';
import { escapeHtml } from '../router.js';
import { toast } from '../app.js';

export async function renderResearchNotes() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">📝 研究ノート (Cosense)</h2>
      <p class="hint" style="font-size:13px; margin-top:6px">
        nkmr-lab の 「YYYY.MM_研究ノート_<i>名前</i>」 ページから、今日と昨日の分を読み込んで表示します。
        Scrapbox の鍵 (Personal Access Token) を登録していれば、今日のセクションを丸ごとここで編集できます (差分のみコミット)。
      </p>
    </div>
    <div class="card" id="rn-status">
      <div class="muted">読み込み中…</div>
    </div>
    <div class="card" id="rn-today" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">📅 今日 (<span id="rn-today-date"></span>)</h3>
        <a id="rn-today-open" class="btn" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">↗ Scrapbox を開く</a>
      </div>
      <div id="rn-today-edit" hidden>
        <p class="hint-sm" style="margin:4px 0 6px">
          今日のセクション本文をまるごとロードしています。 自由に編集してください。 保存を押すと差分のみ Scrapbox にコミットされます。
          先頭の半角スペースは Scrapbox のインデント記法なので、 そのまま残してください。
        </p>
        <textarea id="rn-today-text" rows="10" maxlength="50000" placeholder=" 今日のメモを書く" style="width:100%; font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace; font-size:13px; line-height:1.6; box-sizing:border-box; padding:8px 10px; min-height:200px"></textarea>
        <div class="row" style="gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap">
          <button id="rn-today-save" class="primary">💾 保存 (差分コミット)</button>
          <button id="rn-today-reload" class="btn">🔄 ロードし直す</button>
          <span id="rn-today-stats" class="hint-sm" style="margin-left:auto"></span>
        </div>
      </div>
      <div id="rn-today-readonly" hidden>
        <div id="rn-today-body" class="muted"></div>
      </div>
      <div id="rn-today-write-disabled" class="hint-sm" hidden style="color:#dc2626">
        Scrapbox の鍵 (Personal Access Token) をまだ登録していないので、LabPay からはそのまま書き込めません。<br>
        ・ ひとまず「↗ Scrapbox を開く」をタップ → ブラウザの Scrapbox 側で書く<br>
        ・ または「設定」 → 「📝 Cosense (Scrapbox) 連携」で鍵を 1 回登録すれば、以降は LabPay からそのまま編集できるようになります (青と黄色のボックスに取り方の説明あり)
      </div>
    </div>
    <div class="card" id="rn-yesterday" hidden>
      <div class="row center" style="margin-bottom:6px">
        <h3 class="row-title" style="margin:0">🌗 昨日 (<span id="rn-yesterday-date"></span>)</h3>
        <a id="rn-yesterday-open" class="btn" style="font-size:12px; padding:3px 10px; margin-left:auto" target="_blank" rel="noopener">↗ Scrapbox を開く</a>
      </div>
      <div id="rn-yesterday-body" class="muted"></div>
    </div>
    <div class="card" id="rn-page-links" hidden>
      <h3 style="margin:0 0 6px">📂 今月 / 先月のページ</h3>
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
        <div class="bold" style="color:#dc2626">名前 (Scrapbox 上の表記) が未設定</div>
        <div style="font-size:13px; margin-top:6px">${escapeHtml(d.message || '')}</div>`;
      return;
    }
    if (!d.cookie_present) {
      statusEl.innerHTML = `
        <div class="bold" style="color:#dc2626">⚠ Scrapbox との連携がまだ設定されていません</div>
        <div style="font-size:13px; margin-top:6px">
          「設定」 → 「📝 Cosense (Scrapbox) 連携」 から、Scrapbox の鍵 (Personal Access Token) を登録してください。
        </div>`;
      return;
    }
    const source = d.cookie_source || 'none';
    const canWrite = !!d.can_write;
    const sourceLabel = source === 'self-pat' ? '✅ 自分の鍵 (本人)' :
                       source === 'self-cookie' ? '☑ 自分の cookie (本人)' :
                       source === 'shared-cookie' ? '⚙ 共有 cookie (中村名義、読み取りのみ)' : '?';
    statusEl.innerHTML = `
      <div style="font-size:13px">名前: <code>${escapeHtml(d.handle)}</code> ・ 認証: ${sourceLabel} ・ ${d.recent?.length || 0} 件の日付ブロックを取得</div>`;

    const pl = document.getElementById('rn-page-links');
    const plRoot = document.getElementById('rn-page-list');
    pl.hidden = false;
    plRoot.innerHTML = (d.pages || []).map(p => `
      <a class="list-item" href="${escapeHtml(p.page_url)}" target="_blank" rel="noopener" style="gap:8px; align-items:center">
        <div class="grow">
          <div class="bold">${escapeHtml(p.title)}</div>
          <div class="meta">HTTP ${p.status} ${p.has_text ? '・ 取得 OK' : '・ 空 or 未作成'}</div>
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
    setupTodayCard(todayKey, findByDate(todayKey), buildPageUrl(todayKey), canWrite);
    setupYesterdayCard(yKey, findByDate(yKey), buildPageUrl(yKey));
  } catch (e) {
    statusEl.innerHTML = `<div class="muted">取得失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function setupYesterdayCard(dateKey, section, pageUrl) {
  const card = document.getElementById('rn-yesterday');
  card.hidden = false;
  document.getElementById('rn-yesterday-date').textContent = dateKey;
  document.getElementById('rn-yesterday-open').href = pageUrl;
  const bodyEl = document.getElementById('rn-yesterday-body');
  if (section && section.body && section.body.trim() !== '') {
    bodyEl.classList.remove('muted');
    bodyEl.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit; margin:0; font-size:13px; line-height:1.6">${escapeHtml(section.body)}</pre>`;
  } else if (section) {
    bodyEl.classList.add('muted');
    bodyEl.textContent = '(日付ヘッダはあるが内容が空)';
  } else {
    bodyEl.classList.add('muted');
    bodyEl.textContent = '(まだ書かれていません)';
  }
}

function setupTodayCard(dateKey, section, pageUrl, canWrite) {
  const card = document.getElementById('rn-today');
  card.hidden = false;
  document.getElementById('rn-today-date').textContent = dateKey;
  document.getElementById('rn-today-open').href = pageUrl;

  const editBox = document.getElementById('rn-today-edit');
  const roBox = document.getElementById('rn-today-readonly');
  const disabledBox = document.getElementById('rn-today-write-disabled');

  if (!canWrite) {
    // 鍵未登録 — 読み取りオンリー表示
    editBox.hidden = true;
    roBox.hidden = false;
    disabledBox.hidden = false;
    const bodyEl = document.getElementById('rn-today-body');
    if (section && section.body && section.body.trim() !== '') {
      bodyEl.classList.remove('muted');
      bodyEl.innerHTML = `<pre style="white-space:pre-wrap; font-family:inherit; margin:0; font-size:13px; line-height:1.6">${escapeHtml(section.body)}</pre>`;
    } else if (section) {
      bodyEl.classList.add('muted');
      bodyEl.textContent = '(日付ヘッダはあるが内容が空)';
    } else {
      bodyEl.classList.add('muted');
      bodyEl.textContent = '(まだ書かれていません)';
    }
    return;
  }

  // 鍵あり — 編集モード
  editBox.hidden = false;
  roBox.hidden = true;
  disabledBox.hidden = true;
  loadEditable(dateKey);
  const saveBtn = document.getElementById('rn-today-save');
  const reloadBtn = document.getElementById('rn-today-reload');
  const statsEl = document.getElementById('rn-today-stats');
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = '1';
    saveBtn.addEventListener('click', async () => {
      const ta = document.getElementById('rn-today-text');
      const text = ta.value;
      saveBtn.disabled = true;
      const old = saveBtn.textContent;
      saveBtn.textContent = '保存中…';
      try {
        const r = await post('/api/cosense/research-note/replace-section', { date: dateKey, text });
        if (r.ok) {
          if (r.noop) {
            toast('変更なし');
          } else {
            const s = r.stats || {};
            const parts = [];
            if (s.header_created) parts.push('ヘッダ作成');
            if (s.inserts) parts.push(s.inserts + '行追加');
            if (s.updates) parts.push(s.updates + '行修正');
            if (s.deletes) parts.push(s.deletes + '行削除');
            toast('✅ 保存しました (' + (parts.join('+') || (r.change_count + '件')) + ')', 5000);
            statsEl.textContent = '直前の保存: ' + (parts.join('+') || (r.change_count + '件'));
          }
          await loadEditable(dateKey);
        } else {
          toast('失敗: ' + (r.body || ('HTTP ' + r.status)));
        }
      } catch (e) {
        toast('失敗: ' + e.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = old;
      }
    });
  }
  if (reloadBtn && !reloadBtn.dataset.bound) {
    reloadBtn.dataset.bound = '1';
    reloadBtn.addEventListener('click', () => loadEditable(dateKey));
  }
}

async function loadEditable(dateKey) {
  const ta = document.getElementById('rn-today-text');
  if (!ta) return;
  ta.disabled = true;
  ta.placeholder = '読み込み中…';
  try {
    const s = await get('/api/cosense/research-note/section?date=' + encodeURIComponent(dateKey));
    ta.value = s.body_text || '';
    ta.placeholder = ' 今日のメモを書く (1 行の頭に半角スペースで Scrapbox のインデント)';
  } catch (e) {
    toast('セクションのロード失敗: ' + e.message);
  } finally {
    ta.disabled = false;
  }
}
