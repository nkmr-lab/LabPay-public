// v1299 🏆 Ranking (#/rankings) — 全メンバー横断 の 各種 top 10 を 1 ページ に カード 並び。
//   従来 は #/streak-ranking の 1 種類 だけ。 中村さん要望「オープナー回数、徹夜回数のランキング
//   も示したい。 Ranking機能を作ると良い」で ハブ化。
//   NOTE: .row の 子要素 は style.css:398 で flex:1 が 効いて いる ので、 側要素 は
//     flex:0 0 幅 shorthand で grow を pin する 必要 が ある (streak_ranking.js と 同じ 罠)。

import { get } from '../api.js';
import { escapeHtml } from '../router.js';

const CARDS = [
  { key: 'streak',                 title: '🔥 最長連続ラボイン',  unit: '日',  desc: '連続でラボに来た最長記録日数' },
  { key: 'checkins',               title: '🏠 累計ラボイン',      unit: '日',  desc: 'これまでの総checkin日数' },
  { key: 'opener',                 title: '🔓 オープナー',         unit: '日',  desc: 'その日最初にラボに入った日数 (前夜泊まり除外)' },
  { key: 'closer',                 title: '🌃 クローザー',         unit: '日',  desc: 'その日最後にラボを出た日数 (その夜泊まり除外)' },
  { key: 'early_bird',             title: '🌅 早起きラボ',         unit: '日',  desc: '朝7:00〜8:30にラボにいた日数 (泊まり除外)' },
  { key: 'night_use',              title: '🌙 夜間ラボ族',         unit: '日',  desc: '夜23:00〜25:00にラボにいた日数' },
  { key: 'all_nighter',            title: '🛌 徹夜',                unit: '日',  desc: '日付をまたぐ在室 (0:00越え) の日数' },
  { key: 'sns_reactions_received', title: '❤️ 受けたリアクション', unit: '個',  desc: '自分のらぼったー投稿に付いたリアクションの累計 (自分のを除外)' },
  { key: 'sns_reactions_given',    title: '👍 したリアクション',    unit: '個',  desc: '他人のらぼったー投稿に自分が付けたリアクションの累計 (自postは除外)' },
  { key: 'sales_count',            title: '🏷 販売数',              unit: '個',  desc: '販売した商品の累計数量 (販売タブ/出品)' },
  { key: 'sales_amount',           title: '💰 販売額',              unit: 'pt', desc: '販売で稼いだpt累計 (unit_price × qty)' },
  { key: 'peak_sale',              title: '🏆 最高売上 (単一取引)', unit: 'pt', desc: '販売者ごとの1取引の最高金額 (unit_price × qty のMAX)' },
  { key: 'purchases_count',        title: '🛒 購入数',              unit: '個',  desc: '購入した商品の累計数量' },
  { key: 'purchases_amount',       title: '💸 購入額',              unit: 'pt', desc: '購入に使ったpt累計 (unit_price × qty)' },
  { key: 'peak_buy',               title: '💎 最高購入額 (単一取引)', unit: 'pt', desc: '買い手ごとの1取引の最高金額 (unit_price × qty のMAX)' },
  { key: 'spent_total',            title: '💳 使用ポイント累計',    unit: 'pt', desc: '実際に使ったptの累計' },
  { key: 'peak_balance',           title: '👑 富豪度 (歴代最高保持額)', unit: 'pt', desc: 'ledgerを時系列走査して各時点の残高を求め、その歴代最高値' },
  { key: 'task_done',              title: '✅ タスクやった',        unit: '件', desc: '承認済のタスク完了件数 (task_claims.status=approved)' },
  { key: 'task_delegated',         title: '📋 タスクやってもらった', unit: '件', desc: '自分が発注したタスクで完了承認された件数' },
  { key: 'exp_done',               title: '🧪 実験やった (被験者)', unit: '回', desc: '実験募集に被験者として参加した延べ回数' },
  { key: 'exp_delegated',          title: '👥 実験やってもらった',  unit: '人', desc: '自分主催の実験募集に集まった延べ参加者数' },
  { key: 'roulette_won',           title: '🎰 ルーレット当選数',    unit: '回', desc: 'ルーレットで当選した回数 (「運命の人」実績と同定義)' },
  { key: 'longest_visit',          title: '⏱ 最長ラボ滞在',        unit: '',   desc: '1回のラボ滞在の最長時間 (presence_sessionsの単一 duration MAX)',
    format: n => { const h = Math.floor(n / 60); const m = n % 60; return h > 0 ? `${h}時間${m}分` : `${m}分`; } },
];

export async function renderRankings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🏆 Ranking</h2>
      <div class="hint-sm" style="color:#666; font-size:11px; margin-top:2px">
        各top10。意味論は実績ページの対応バッジと揃えています。
      </div>
    </div>
    <div class="list apps-grid-2col" id="rk-grid">
      ${CARDS.map(c => `
        <div class="card" data-rk="${c.key}">
          <div class="row center" style="gap:6px; margin-bottom:4px">
            <h3 style="margin:0; flex:1 1 auto; font-size:15px">${c.title}</h3>
          </div>
          <div class="hint-sm" style="color:#666; font-size:11px; margin-bottom:6px">${escapeHtml(c.desc)}</div>
          <div id="rk-body-${c.key}" class="muted" style="font-size:12px">読み込み中…</div>
        </div>
      `).join('')}
    </div>
  `;

  try {
    const d = await get('/api/rankings');
    const rk = d.rankings || {};
    for (const c of CARDS) {
      const body = document.getElementById('rk-body-' + c.key);
      if (!body) continue;
      const rows = rk[c.key] || [];
      if (!rows.length) {
        body.innerHTML = '<div class="hint">まだ記録なし</div>';
        continue;
      }
      body.innerHTML = rows.map((r, i) => renderRow(r, i, c)).join('');
    }
  } catch (e) {
    for (const c of CARDS) {
      const body = document.getElementById('rk-body-' + c.key);
      if (body) body.innerHTML = `<div class="hint" style="color:#c00">取得失敗: ${escapeHtml(e.message)}</div>`;
    }
  }
}

function renderRow(r, i, card) {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
  const av = r.avatar_url
    ? `<img src="${escapeHtml(r.avatar_url)}" alt=""
         style="width:26px; height:26px; border-radius:50%; object-fit:cover; flex:0 0 26px; display:block">`
    : `<div style="width:26px; height:26px; border-radius:50%; background:#eee; flex:0 0 26px"></div>`;
  // card.format があれば それを 使う (「N時間MM分」等)、 なければ toLocaleString + unit
  const numHtml = card.format
    ? card.format(Number(r.count))
    : `${Number(r.count).toLocaleString()}<span style="font-size:10px; color:#666; font-weight:400; margin-left:2px">${card.unit}</span>`;
  return `
    <a href="#/users/${r.user_id}" class="row center"
       style="gap:8px; padding:5px 2px; border-bottom:1px solid var(--line);
              text-decoration:none; color:inherit">
      <span style="flex:0 0 28px; font-weight:600; color:#666; text-align:right; font-size:12px">${medal}</span>
      ${av}
      <div style="flex:1 1 0; min-width:0; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">
        ${escapeHtml(r.display_name)}
      </div>
      <div style="flex:0 0 auto; text-align:right; font-weight:700; color:#7b3fa0; font-size:14px">
        ${numHtml}
      </div>
    </a>
  `;
}
