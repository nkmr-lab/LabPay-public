// /#/public-polls — 公開投票 (v942)。
// 起案者 SPA。 title + 選択肢 (複数行 テキスト) + 締切 で 作り、 公開 URL + 4 桁 コード を 共有。
// 外部 参加者 (未 login) は /public/public_polls.html?t=xxx で 匿名 投票。

import { get, post, patch, del } from '../api.js';
import { escapeHtml, navigate } from '../router.js';
import { toast } from '../app.js';

const VIS_LABEL = {
  after_deadline: '締切後に集計を公開',
  open:           '常に集計を公開',
  creator:        '起案者のみ集計を見る',
};

// ---------- 一覧 ----------

export async function renderPublicPollsList() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center">
        <h2 style="margin:0">🗳 公開投票</h2>
        <a href="#/public-polls/new" class="btn primary">＋ 新規</a>
      </div>
      <p class="hint-sm" style="margin:8px 0 0">
        公開 URL または 4 桁コードで 誰でも投票できる汎用アンケート。
        SNS シェアや外部イベントで使えます。 (合同研究会のセッション別投票は
        <a href="#/joint-events">こちら</a>)
      </p>
    </div>
    <div id="pl-list"><div class="muted">読み込み中…</div></div>
  `;
  try {
    const d = await get('/api/public-polls');
    const items = d.items || [];
    if (!items.length) {
      document.getElementById('pl-list').innerHTML =
        '<div class="card muted">まだ投票がありません。 「＋ 新規」 から作ってください。</div>';
      return;
    }
    document.getElementById('pl-list').innerHTML = items.map(p => {
      const closed = p.status === 'closed';
      const scheduled = p.status === 'scheduled';
      const tag = scheduled ? '<span class="tag" style="background:#e0f2fe; color:#0369a1">🕒 公開予定</span>'
                : closed    ? '<span class="tag" style="background:#f3f4f6; color:#4b5563">締切済</span>'
                :             '<span class="tag" style="background:#dbeafe; color:#1e40af">受付中</span>';
      return `
        <a class="list-item" href="#/public-polls/${p.id}" style="text-decoration:none; color:inherit">
          <div class="grow" style="min-width:0">
            <div class="bold" style="font-size:15px">${escapeHtml(p.title)}</div>
            <div class="meta">
              ${tag} · 締切 ${escapeHtml(String(p.deadline_at).slice(0, 16))}
              ${p.multi_select ? ' · 複数選択可' : ''}
            </div>
            <div class="meta">${p.option_count} 選択肢 · ${p.voter_count} 人が投票 (${p.vote_count} 票)</div>
          </div>
        </a>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('pl-list').innerHTML =
      `<div class="muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- 新規 ----------

export async function renderPublicPollNew() {
  const app = document.getElementById('app');
  // 締切 デフォルト: 明日 18:00
  const def = new Date(); def.setDate(def.getDate() + 1); def.setHours(18, 0, 0, 0);
  const p = n => String(n).padStart(2, '0');
  const defDeadline = `${def.getFullYear()}-${p(def.getMonth()+1)}-${p(def.getDate())}T${p(def.getHours())}:${p(def.getMinutes())}`;

  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 10px">🗳 公開投票を作成</h2>
      <label class="field"><span class="lbl">タイトル</span>
        <input type="text" id="pp-title" maxlength="300" placeholder="例: 忘年会いつにする?">
      </label>
      <label class="field"><span class="lbl">本文 (任意)</span>
        <textarea id="pp-body" rows="2" maxlength="5000" placeholder="補足説明"></textarea>
      </label>
      <label class="field"><span class="lbl">締切</span>
        <input type="datetime-local" id="pp-deadline" value="${defDeadline}">
      </label>
      <label class="field"><span class="lbl">公開開始 (省略で今すぐ)</span>
        <input type="datetime-local" id="pp-opens">
        <div class="hint-sm">未来日時を入れると、その時刻まで公開 URL からアクセスしても投票できません</div>
      </label>
      <label class="field"><span class="lbl">選択肢 (1 行に 1 つ、 2〜50 個)</span>
        <textarea id="pp-options" rows="6" placeholder="例:&#10;12/20 (金)&#10;12/21 (土)&#10;12/22 (日)"></textarea>
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0">
        <span class="switch"><input type="checkbox" id="pp-multi"><span class="slider"></span></span>
        <span>複数選択可</span>
      </label>
      <label style="display:flex; align-items:center; gap:10px; margin:4px 0" id="pp-ft-row" hidden>
        <span class="switch"><input type="checkbox" id="pp-ft"><span class="slider"></span></span>
        <span>自由記述も受ける <span class="hint-sm">— 候補にないときに文章で回答 (複数選択 ON 時のみ)</span></span>
      </label>
      <label class="field"><span class="lbl">集計の見え方</span>
        <select id="pp-vis">
          <option value="after_deadline">${VIS_LABEL.after_deadline}</option>
          <option value="open">${VIS_LABEL.open}</option>
          <option value="creator">${VIS_LABEL.creator}</option>
        </select>
      </label>
      <div class="row" style="gap:6px; justify-content:flex-end; margin-top:8px">
        <a href="#/public-polls" class="btn">キャンセル</a>
        <button id="pp-save" class="primary">作成</button>
      </div>
    </div>
  `;

  const multiEl = document.getElementById('pp-multi');
  const ftRow = document.getElementById('pp-ft-row');
  const syncFt = () => {
    ftRow.hidden = !multiEl.checked;
    if (!multiEl.checked) document.getElementById('pp-ft').checked = false;
  };
  multiEl.addEventListener('change', syncFt);
  syncFt();

  document.getElementById('pp-save').addEventListener('click', async () => {
    const title = document.getElementById('pp-title').value.trim();
    const body  = document.getElementById('pp-body').value.trim();
    const deadline = document.getElementById('pp-deadline').value;
    const opens = document.getElementById('pp-opens').value || null;
    const optsRaw = document.getElementById('pp-options').value;
    const options = optsRaw.split(/\r?\n/).map(s => s.trim()).filter(s => s.length).slice(0, 50);
    const multi = multiEl.checked;
    const allowFt = document.getElementById('pp-ft').checked;
    const vis = document.getElementById('pp-vis').value;
    if (!title) return toast('タイトル必須');
    if (!deadline) return toast('締切必須');
    if (options.length < 2) return toast('選択肢を 2 つ以上');
    if (opens && opens >= deadline) return toast('公開開始は締切より前に');
    try {
      const d = await post('/api/public-polls', {
        title, body, deadline_at: deadline, opens_at: opens,
        options, multi_select: multi, allow_free_text: allowFt,
        visibility: vis,
      });
      toast('作成しました');
      navigate('#/public-polls/' + d.id);
    } catch (e) { toast('失敗: ' + e.message); }
  });
}

// ---------- 詳細 ----------

export async function renderPublicPollDetail({ params }) {
  const id = Number(params.id);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card muted">読み込み中…</div>`;
  try {
    const d = await get('/api/public-polls/' + id);
    renderDetailInto(app, id, d);
  } catch (e) {
    app.innerHTML = `<div class="card muted">読み込み失敗: ${escapeHtml(e.message)}</div>`;
  }
}

function renderDetailInto(app, id, d) {
  const p = d.poll;
  const closed = p.status === 'closed';
  const scheduled = p.status === 'scheduled';
  const publicUrl = `${location.origin}/public/public_polls.html?t=${p.public_token}`;
  const totalCnt = Object.values(d.tallies || {}).reduce((a, b) => a + b, 0);

  const optsHtml = (d.options || []).map(o => {
    const cnt = d.tallies[o.id] || 0;
    const pct = totalCnt > 0 ? Math.round((cnt / totalCnt) * 100) : 0;
    return `
      <div class="row" style="gap:8px; padding:6px 0; border-top:1px solid #f3f4f6">
        <div class="grow">${escapeHtml(o.label)}</div>
        <div style="font-family:ui-monospace,monospace; color:#7b3fa0; font-weight:600">${cnt} 票 (${pct}%)</div>
        <div style="width:80px; height:6px; background:#f3f4f6; border-radius:3px; align-self:center; position:relative">
          <span style="position:absolute; left:0; top:0; height:100%; width:${pct}%; background:#a855f7; border-radius:3px"></span>
        </div>
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:8px">
        <div class="grow">
          <h2 style="margin:0">🗳 ${escapeHtml(p.title)}</h2>
          <div class="meta">
            ${scheduled ? '🕒 公開予定' : closed ? '締切済' : '受付中'} · 締切 ${escapeHtml(String(p.deadline_at).slice(0, 16))}
            ${p.multi_select ? ' · 複数選択可' : ''} · ${escapeHtml(VIS_LABEL[p.visibility] || p.visibility)}
          </div>
        </div>
        <div class="row" style="gap:4px">
          ${closed ? '' : `<button id="pd-close" class="btn" style="font-size:12px; padding:4px 8px">🔒 締める</button>`}
          <button id="pd-delete" class="btn" style="font-size:12px; padding:4px 8px; color:#dc2626">🗑</button>
        </div>
      </div>
      ${p.body ? `<div style="margin-top:8px; white-space:pre-wrap">${escapeHtml(p.body)}</div>` : ''}
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">📢 共有</div>
      ${d.public_code ? `
        <div style="background:#fef3c7; padding:10px 14px; border-radius:6px; margin-bottom:8px">
          <div style="font-size:12px; color:#92400e">4 桁コード (pay.nkmr.io/#/public で入力)</div>
          <div style="font-family:ui-monospace,monospace; font-size:32px; letter-spacing:8px; font-weight:700; color:#92400e">${escapeHtml(d.public_code)}</div>
        </div>
      ` : ''}
      <div class="meta">直接 URL</div>
      <div class="row" style="gap:6px">
        <input type="text" id="pd-url" readonly value="${escapeHtml(publicUrl)}"
               style="flex:1; padding:6px 10px; font-size:12px; font-family:ui-monospace,monospace;
                      background:#f9fafb; border:1px solid #d1d5db; border-radius:4px">
        <button id="pd-copy" class="btn" style="font-size:12px; padding:4px 10px">📋</button>
      </div>
      <div class="hint-sm" style="margin-top:6px">QR コードは v943 で 対応予定。</div>
    </div>

    <div class="card">
      <div class="bold" style="margin-bottom:6px">📊 集計 (${d.total_voters} 人が投票)</div>
      ${optsHtml || '<div class="muted">まだ投票がありません</div>'}
    </div>

    ${d.free_texts && d.free_texts.length ? `
      <div class="card">
        <div class="bold" style="margin-bottom:6px">📝 自由記述 (${d.free_texts.length})</div>
        ${d.free_texts.map(ft => `
          <div style="border-top:1px solid #f3f4f6; padding:6px 0; font-size:13px">
            ${ft.voter_name ? `<div style="font-weight:600; color:#7b3fa0">${escapeHtml(ft.voter_name)}</div>` : ''}
            <div style="white-space:pre-wrap">${escapeHtml(ft.free_text)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  document.getElementById('pd-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(publicUrl); toast('コピーしました'); }
    catch { toast('コピー失敗'); }
  });
  document.getElementById('pd-delete').addEventListener('click', async () => {
    if (!confirm('この投票を削除しますか? (集計・自由記述も消えます)')) return;
    try { await del('/api/public-polls/' + id); toast('削除'); navigate('#/public-polls'); }
    catch (e) { toast('失敗: ' + e.message); }
  });
  const closeBtn = document.getElementById('pd-close');
  if (closeBtn) closeBtn.addEventListener('click', async () => {
    if (!confirm('この投票を締めますか? (これ以降 投票不可)')) return;
    try {
      await patch('/api/public-polls/' + id + '/close', {});
      toast('締めました');
      renderPublicPollDetail({ params: { id } });
    } catch (e) { toast('失敗: ' + e.message); }
  });
}
