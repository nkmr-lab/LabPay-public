// /#/admin/sounds — 効果音の規定値 (admin 用)。
//   * 上段: clip upload + 一覧 (試聴 / 削除)
//   * 下段: イベントごとに規定 clip + 音量

import { get, post, patch, del } from '../api.js';
import { escapeHtml } from '../router.js';
import { state, toast } from '../app.js';
import { previewSoundUrl } from '../sounds.js';
import { fmtDateTime } from '../format.js';

async function fetchClips() { return (await get('/api/sounds/clips')).items || []; }
async function fetchDefaults() { return (await get('/api/sounds/defaults')).items || []; }

export async function renderAdminSounds() {
  if (!state.me || state.me.role !== 'admin') {
    document.getElementById('app').innerHTML = `<div class="card"><h2>管理者専用</h2><p>権限がありません。</p></div>`;
    return;
  }
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <a href="#/admin" class="hint">← 管理</a>
      <h2 style="margin:6px 0 0">🔊 効果音の規定値</h2>
    </div>

    <div class="card">
      <h3 style="margin:0">音源を追加</h3>
      <p class="hint">mp3 / ogg / wav / m4a など。 2 MB まで。</p>
      <label class="field">
        <span class="lbl">ラベル (画面に出る名前)</span>
        <input type="text" id="snd-up-label" maxlength="120" placeholder="例: コイン音、 ピロンッ">
      </label>
      <label class="field">
        <span class="lbl">音源ファイル</span>
        <input type="file" id="snd-up-file" accept="audio/*">
      </label>
      <div class="row" style="gap:6px">
        <button id="snd-up-go" class="primary">追加する</button>
        <span id="snd-up-status" class="hint-sm"></span>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0">音源一覧</h3>
      <div id="snd-clips" class="list" style="margin-top:6px"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3 style="margin:0">イベントごとの規定値</h3>
      <p class="hint">「— なし —」 を選ぶと既定では無音。 各ユーザは 「設定」 から個別に上書き可。</p>
      <div id="snd-defaults"><div class="muted">読み込み中…</div></div>
    </div>
  `;

  let clips = []; let defaults = [];
  async function reload() {
    [clips, defaults] = await Promise.all([fetchClips(), fetchDefaults()]);
    renderClips(); renderDefaults();
  }
  function renderClips() {
    const root = document.getElementById('snd-clips');
    if (!clips.length) { root.innerHTML = '<div class="empty">まだ音源は登録されていません</div>'; return; }
    root.innerHTML = clips.map(c => `
      <div class="list-item" style="align-items:center">
        <div class="grow" style="min-width:0">
          <div class="bold">${escapeHtml(c.label)}</div>
          <div class="meta">${escapeHtml(c.mime)} · ${Math.round((c.file_size||0)/1024)} KB · ${escapeHtml(fmtDateTime(c.created_at))}</div>
        </div>
        <button class="btn" data-preview="${escapeHtml(c.file_url)}">▶ 試聴</button>
        <button class="danger" data-rm="${c.id}" style="margin-left:6px">削除</button>
      </div>`).join('');
    root.querySelectorAll('[data-preview]').forEach(b => {
      b.addEventListener('click', () => previewSoundUrl(b.dataset.preview, 0.8));
    });
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('音源を削除しますか? (これを規定にしているイベントは「— なし —」に戻ります)')) return;
        try { await del('/api/sounds/clips/' + b.dataset.rm); toast('削除しました'); await reload(); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
  }
  function renderDefaults() {
    const root = document.getElementById('snd-defaults');
    root.innerHTML = defaults.map(d => {
      const opts = ['<option value="">— なし (無音) —</option>'].concat(
        clips.map(c => `<option value="${c.id}" ${Number(c.id) === Number(d.clip_id) ? 'selected' : ''}>${escapeHtml(c.label)}</option>`)
      ).join('');
      return `
        <div class="list-item" style="flex-wrap:wrap; gap:8px; align-items:center">
          <div style="min-width:200px; flex:1">
            <div class="bold">${escapeHtml(d.label)}</div>
            <div class="meta mono" style="font-size:11px">${escapeHtml(d.event_key)}</div>
          </div>
          <select data-def-clip="${d.event_key}" style="min-width:160px">${opts}</select>
          <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
            音量
            <input type="range" min="0" max="100" step="5" value="${d.volume}" data-def-vol="${d.event_key}" style="width:100px">
            <span data-def-volnum="${d.event_key}" style="min-width:30px">${d.volume}</span>
          </label>
          <button class="btn" data-def-preview="${d.event_key}">▶ 試聴</button>
        </div>`;
    }).join('');
    // dropdown change → PATCH
    root.querySelectorAll('[data-def-clip]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const key = sel.dataset.defClip;
        const clipId = sel.value || null;
        const vol = Number(document.querySelector(`[data-def-vol="${key}"]`).value);
        try { await patch('/api/sounds/defaults/' + key, { clip_id: clipId, volume: vol }); toast('規定を更新しました'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
    root.querySelectorAll('[data-def-vol]').forEach(rng => {
      rng.addEventListener('input', () => {
        document.querySelector(`[data-def-volnum="${rng.dataset.defVol}"]`).textContent = rng.value;
      });
      rng.addEventListener('change', async () => {
        const key = rng.dataset.defVol;
        const sel = document.querySelector(`[data-def-clip="${key}"]`);
        try { await patch('/api/sounds/defaults/' + key, { clip_id: sel.value || null, volume: Number(rng.value) }); toast('音量を更新しました'); }
        catch (e) { toast('失敗: ' + e.message); }
      });
    });
    root.querySelectorAll('[data-def-preview]').forEach(b => {
      b.addEventListener('click', () => {
        const key = b.dataset.defPreview;
        const sel = document.querySelector(`[data-def-clip="${key}"]`);
        const cid = Number(sel.value);
        const clip = clips.find(c => Number(c.id) === cid);
        if (!clip) { toast('まず音源を選んでください'); return; }
        const vol = Number(document.querySelector(`[data-def-vol="${key}"]`).value) / 100;
        previewSoundUrl(clip.file_url, vol);
      });
    });
  }

  document.getElementById('snd-up-go').addEventListener('click', async () => {
    const label = document.getElementById('snd-up-label').value.trim();
    const file = document.getElementById('snd-up-file').files?.[0];
    const status = document.getElementById('snd-up-status');
    if (!file) { toast('ファイルを選んでください'); return; }
    status.textContent = 'アップロード中…';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', label || file.name);
    try {
      const res = await fetch('/api/sounds/clips', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-Requested-With': 'labpay' }, body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'HTTP ' + res.status);
      status.textContent = '✓ 追加しました';
      document.getElementById('snd-up-label').value = '';
      document.getElementById('snd-up-file').value = '';
      await reload();
    } catch (e) { status.textContent = '失敗: ' + e.message; }
  });

  await reload();
}
