// /#/research-ai — v1263 「研究特化AIチャット」は一旦廃止。
//   中村さん指示「画面の一部しか使っていないのでイマイチ。一旦なくす。
//   AIサブスクと、Chaiへのリンクを示そう」。
//   → 案内画面のみ。旧サブスク契約者 (grandfather) には LabPay 内 AI 機能
//     (要約 / 全訳 / 査読 等) は AIサブスク契約中なら使い放題 と 案内。
//     チャット UI 本体 (スレッド / 履歴 / 送信) は完全撤去。
//   バックエンド API (/api/research-ai/*) は動作継続 (旧データ保全)、
//   ただし UI からの新規スレッド作成導線は消える。

import { get } from '../api.js';
import { escapeHtml, navigate } from '../router.js';

export async function renderResearchAI() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card page-header">
      <h2 style="margin:0">🔬 研究特化AIチャット</h2>
      <div class="hint-sm" style="margin-top:4px; color:#92400e">
        この機能は一旦停止しています。汎用のAIチャットは <b>chai.nkmr.io</b> を、
        LabPay内AI (📑 要約 / 📑 全訳 / 📄 査読 / 🔎 Deep Research / 🧪 実験計画書チェック /
        📝 原稿チェック / ✂️ リライター) の使い放題は <b>AIサブスク</b> をご利用ください。
      </div>
    </div>

    <div class="card" style="background:#f5f3ff; border-left:4px solid #7b3fa0">
      <h3 style="margin:0 0 8px; font-size:15px; color:#4a106d">💬 汎用のチャット (ChatGPT / Claude風)</h3>
      <div class="hint-sm" style="margin-bottom:10px; line-height:1.7">
        中村研の自前チャットサイト <b>chai.nkmr.io</b> をお使いください。
        履歴保存 / PDF・画像添付 / 複数モデル切替 に対応しています。
        AIサブスク契約中はフル機能で使えます。
      </div>
      <a href="https://chai.nkmr.io" target="_blank" rel="noopener"
         class="btn primary" style="text-decoration:none; padding:10px 18px; font-size:14px">
        💬 chai.nkmr.io を開く →
      </a>
    </div>

    <div class="card" style="background:#fef3c7; border-left:4px solid #f59e0b; margin-top:10px">
      <h3 style="margin:0 0 8px; font-size:15px; color:#92400e">🤖 AIサブスク (週500pt / 全AI使い放題)</h3>
      <div class="hint-sm" style="margin-bottom:10px; line-height:1.7">
        契約中は LabPay 内の AI 機能 (📑 論文要約 / 📑 全訳 / 📄 査読 /
        🔎 Deep Research / 🧪 実験計画書チェック / 📝 原稿チェック / ✂️ リライター) が
        <b>全部無料</b> で使えます。chai.nkmr.io / file.nkmr.io など
        <b>*.nkmr.io</b> 系サービスもフル機能に。
      </div>
      <a href="#/ai-sub" class="btn primary"
         style="text-decoration:none; padding:10px 18px; font-size:14px">
        🤖 AIサブスクの詳細 / 契約へ →
      </a>
    </div>

    <div id="rai-grandfather" style="display:none"></div>
    <div class="card" style="margin-top:10px">
      <div class="hint-sm" style="font-size:12px; color:#6b7280">
        <a href="#/" style="color:#4a106d; text-decoration:none">← ホームに戻る</a>
      </div>
    </div>
  `;

  // grandfather (旧研究特化サブスク の 残 トークン が ある 人) には ひとこと 添える。
  //   バックエンドは活きてるので状態を取得できるが、失敗しても案内画面としては成立するので silent に。
  try {
    const d = await get('/api/research-ai');
    const sub = d?.subscription;
    if (sub && sub.plan) {
      const box = document.getElementById('rai-grandfather');
      if (box) {
        let remain = '';
        if (sub.plan === 'unlimited_weekly') {
          const left = Math.max(0, (sub.weekly_limit || 0) - (sub.weekly_used || 0));
          remain = `週次 ${(left/1000).toFixed(0)}k / ${(sub.weekly_limit/1000).toFixed(0)}k tokens 残 (旧 unlimited_weekly)`;
        } else if (sub.plan === 'tokens_ticket') {
          remain = `${((sub.tokens_left || 0)/1000).toFixed(1)}k tokens 残 (旧 tokens_ticket)`;
        } else if (sub.plan === 'quota60') {
          remain = `${sub.quota_left || 0} 件残 (旧 quota60)`;
        } else if (sub.plan === 'unlimited') {
          remain = `旧 unlimited プラン`;
        } else {
          remain = `旧プラン: ${escapeHtml(sub.plan)}`;
        }
        box.style.display = '';
        box.innerHTML = `
          <div class="card" style="background:#eef2ff; border-left:4px solid #6366f1; margin-top:10px">
            <div class="bold" style="color:#3730a3; margin-bottom:6px">🎟 旧サブスク残: ${escapeHtml(remain)}</div>
            <div class="hint-sm" style="line-height:1.7">
              研究特化AIチャットのUIは撤去しましたが、旧サブスクの残枠自体は消していません。
              今後は AIサブスク (週500pt) に乗り換えれば、LabPay 内の AI 全機能が使い放題になります。
              残枠の扱いにご希望があれば、フィードバックからお知らせください。
            </div>
          </div>
        `;
      }
    }
  } catch (_) { /* silent */ }
}
