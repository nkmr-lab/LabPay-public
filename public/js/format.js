// 共有 表示 ヘルパ。 各 view で 同じ パターンが ばらつくのを 抑える。
//
//   fmtDate(s)       "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"      (日付だけ)
//   fmtDateTime(s)   "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD HH:MM" (秒なし)
//   fmtTime(s)       "YYYY-MM-DD HH:MM:SS" → "HH:MM"            (時刻だけ)
//   fmtRelative(s)   未来時刻 → "あと N 分/時間/日 ・ 終了" の 残り 時間文字
//
//   tag(kind, label, opts) → <span class="tag {kind}">label</span> の 文字列。
//                            kind: 'ok' (進行中・参加済), 'warn' (注意・締切間近),
//                                  'danger' (期限切れ・取消理由), 'muted' (終了・取消),
//                                  ''      (規定色 = 紫)
//
//   participantChip(p)   avatar のみ (small 12px) + title 属性で 名前。 行のサマリ用。
//   participantPill(p)   avatar + 名前 (詳細ページの 参加者一覧用、 既存 presence-pill)

import { escapeHtml, avatarHtml } from './router.js';

function pad(n) { return String(n).padStart(2, '0'); }

// "YYYY-MM-DD HH:MM:SS" / Date 型 / null を受け取って 安全に文字列にする。
function asStr(s) {
  if (s === null || s === undefined) return '';
  if (s instanceof Date) {
    return `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())} ${pad(s.getHours())}:${pad(s.getMinutes())}:00`;
  }
  return String(s);
}

export function fmtDate(s) {
  const x = asStr(s);
  return x ? x.slice(0, 10) : '';
}

export function fmtDateTime(s) {
  const x = asStr(s);
  if (!x) return '';
  // v560 #218 サーバは JST の "YYYY-MM-DD HH:MM:SS" を返す。 TZ mode が 'local'
  //   なら ブラウザのローカル TZ に変換して表示。 'jst' なら そのまま (default)。
  try {
    const mode = localStorage.getItem('labpay-tz-mode') || 'jst';
    if (mode === 'jst') return x.slice(0, 16);
    // JST → UTC → ローカル
    const d = new Date(x.replace(' ', 'T') + '+09:00');
    if (!Number.isFinite(d.getTime())) return x.slice(0, 16);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return x.slice(0, 16);
  }
}

export function fmtTime(s) {
  const x = asStr(s);
  return x.length >= 16 ? x.slice(11, 16) : '';
}

// DATETIME 文字列 → datetime-local input value ("YYYY-MM-DDTHH:MM")
// SQL は "YYYY-MM-DD HH:MM:SS" を返すが、 input[type=datetime-local] は T 区切り + 秒なし。
export function fmtLocalInput(s) {
  const x = asStr(s);
  if (!x) return '';
  return x.replace(' ', 'T').slice(0, 16);
}

// "YYYY-MM-DD HH:MM" → 「あと N 分」 / 「あと N 時間 M 分」 / 「あと N 日」 / 「終了」
// closed が true なら 「終了」。 過去時刻なら 「超過」 (短い)。
export function fmtRelative(s, opts = {}) {
  const { closed = false, expiredLabel = '超過', endedLabel = '終了' } = opts;
  if (closed) return endedLabel;
  if (!s) return '';
  const t = new Date(asStr(s).replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = t - Date.now();
  if (diff <= 0) return expiredLabel;
  const min = Math.floor(diff / 60000);
  if (min < 60) return `あと ${min}分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと ${h}時間${min % 60}分`;
  return `あと ${Math.floor(h / 24)}日`;
}

// 統一タグ。 inline style を散らさないようにする。
//   kind: 'ok' | 'warn' | 'danger' | 'muted' | ''
//   label: 文字列 (escapeHtml 済 でも 渡せる — このヘルパは raw として扱う)
export function tag(kind, label) {
  const cls = kind ? `tag ${kind}` : 'tag';
  return `<span class="${cls}">${label}</span>`;
}

// presence-pill 形式 (既存 CSS)。 詳細ページの 参加者一覧で使う。
export function participantPill(p) {
  if (!p) return '';
  const name = p.display_name || '';
  const grade = p.grade ? ` <span class="muted" style="font-size:11px">[${escapeHtml(p.grade)}]</span>` : '';
  return `
    <span class="presence-pill">
      ${avatarHtml(name, p.avatar_url, 'sm')}
      <span class="presence-pill-name">${escapeHtml(name)}</span>${grade}
    </span>`;
}

// avatar のみ (チップ列 = リストサマリ等)。 名前は title (hover) で確認。
export function participantChip(p) {
  if (!p) return '';
  const name = p.display_name || '';
  return `
    <span title="${escapeHtml(name)}" style="display:inline-flex">
      ${avatarHtml(name, p.avatar_url, 'xs')}
    </span>`;
}

// 参加者 アイコン列 + 余り表記。
//   participants: [{display_name, avatar_url}, ...]
//   max: 表示する 上限 (デフォ 8)
//   showCount: true なら 末尾に (N 人)
export function participantChipRow(participants, { max = 8, showCount = false } = {}) {
  if (!Array.isArray(participants) || !participants.length) return '';
  const chips = participants.slice(0, max).map(participantChip).join('');
  const rest = participants.length > max
    ? `<span class="muted" style="font-size:11px">+${participants.length - max}</span>` : '';
  const count = showCount
    ? `<span class="muted" style="font-size:11px; margin-left:auto">(${participants.length}人)</span>` : '';
  return `<div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px; align-items:center">${chips}${rest}${count}</div>`;
}
