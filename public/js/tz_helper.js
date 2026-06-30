// v560 #213 #215 #218 タイムゾーン helper
//   海外滞在中に「日本時間で 〜 に集合」と設定したいケースに対応。
//   datetime-local はブラウザのローカル TZ で解釈されるため、ユーザに「JST で設定 / ローカルで設定」を選ばせる。
//   デフォルト = JST (中村研究室メイン用途)。
//   設定は localStorage.labpay-tz-mode に 'jst' / 'local' で永続化。

const KEY = 'labpay-tz-mode';

export function getTzMode() {
  try { return localStorage.getItem(KEY) || 'jst'; }
  catch { return 'jst'; }
}

export function setTzMode(m) {
  try { localStorage.setItem(KEY, m); } catch {}
}

// datetime-local の値 (例: "2026-06-15T10:00") を ISO UTC に変換。
//   mode='jst': 入力を JST と解釈 → "2026-06-15T01:00Z"
//   mode='local': 入力をブラウザの TZ と解釈 → 既存挙動
export function localDtToIso(dtLocal, mode = null) {
  if (!dtLocal) return null;
  mode = mode || getTzMode();
  if (mode === 'jst') {
    // "+09:00" を付けて解釈させる
    return new Date(dtLocal + '+09:00').toISOString();
  }
  return new Date(dtLocal).toISOString();
}

// ISO UTC を datetime-local 用の "YYYY-MM-DDTHH:MM" に変換 (mode 考慮)
export function isoToLocalDt(iso, mode = null) {
  if (!iso) return '';
  mode = mode || getTzMode();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (mode === 'jst') {
    // JST 表示
    const jst = new Date(d.getTime() + 9 * 3600 * 1000);
    return jst.toISOString().slice(0, 16);
  }
  // ローカル表示
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// 切替トグル UI (フォーム上部に置く)
export function tzToggleHtml(id = 'tz-mode') {
  const m = getTzMode();
  return `
    <div style="display:inline-flex; gap:6px; align-items:center; font-size:11px; padding:4px 8px; background:#f3eef8; border-radius:4px; margin-bottom:6px">
      <span style="color:var(--muted)">時刻入力:</span>
      <label style="cursor:pointer; padding:1px 6px; background:${m === 'jst' ? 'var(--primary, #4a106d)' : 'transparent'}; color:${m === 'jst' ? '#fff' : 'inherit'}; border-radius:3px">
        <input type="radio" name="${id}" value="jst" ${m === 'jst' ? 'checked' : ''} style="display:none">
        🇯🇵 JST
      </label>
      <label style="cursor:pointer; padding:1px 6px; background:${m === 'local' ? 'var(--primary, #4a106d)' : 'transparent'}; color:${m === 'local' ? '#fff' : 'inherit'}; border-radius:3px">
        <input type="radio" name="${id}" value="local" ${m === 'local' ? 'checked' : ''} style="display:none">
        🌍 ローカル
      </label>
    </div>
  `;
}

export function bindTzToggle(id = 'tz-mode', onChange = null) {
  document.querySelectorAll(`input[name="${id}"]`).forEach(el => {
    el.addEventListener('change', () => {
      if (el.checked) {
        setTzMode(el.value);
        // 親要素の表示を更新するため一度自身を再描画 (簡略: caller が onChange で再描画)
        if (onChange) onChange(el.value);
      }
    });
  });
}
