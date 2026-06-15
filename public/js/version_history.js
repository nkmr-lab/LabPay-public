// LabPay バージョン履歴。 トップバーの v### をタップで モーダル表示。
//   新しいバージョンを ship したら 先頭に追記してください。

export const VERSION_HISTORY = [
  { v: 'v626', d: '2026-06-15', s: '自作ゲーム 共通ヘルパー /js/cg_ui.js 切り出し (マルバツ ~80 行に短縮、 examples/connect_four も 同様) + 誕生日バナー 古いキャッシュ 救済 + オセロ AI 名 「💣 オセロ AI」 専用化 + AI 地雷 配置済み hint + AI に 1 秒 考える間' },
  { v: 'v625', d: '2026-06-15', s: '💣 地雷オセロ コンピュータ対戦 追加 (2pt、 払戻なし、 greedy + 角ボーナス AI、 AI 地雷は内側 12 マスからランダム配置)' },
  { v: 'v624', d: '2026-06-15', s: 'プレイフィー 調整: AI 麻雀 1→5pt / 地雷オセロ 1→2pt / 大富豪 1→2pt / 人狼 1→2pt (マルバツ 1pt / ito 1pt / 絵しりとり 2pt は据置)' },
  { v: 'v623', d: '2026-06-15', s: 'マルバツ 改良 (新 場代モデルに合わせて UI 文言整理) + 娯楽ハブ の バッジ統一 (無料は 表示なし / プレイフィーは X pt のみ表示)。 絵しりとり プレイフィー 2pt/人 (初回ターンで lazy 徴収)、 AI 麻雀 プレイフィー 1pt 化。 README + docs/CUSTOM_GAMES.md 更新' },
  { v: 'v622', d: '2026-06-15', s: 'ビンゴ 実績 追加: 🎯 通算 ライン数 + 🗓 ビンゴ 達成 週数' },
  { v: 'v621', d: '2026-06-15', s: '自作ゲーム 課金モデル を 「掛け金 / pot」 から 「場代 = プレイ毎の課金 (提供者 90% / SYSTEM 10%、 fee=0 可)」 に 簡素化。 終了時の払戻なし。' },
  { v: 'v620', d: '2026-06-15', s: '自作ゲーム を ユーザ単位で 登録可能に (設定→自作ゲーム管理) + JS を DB アップロード (サーバ書込権限不要) + 場代 % を 提供者が 受取れる + 汎用 /cg/:kind ディスパッチャ' },
  { v: 'v619', d: '2026-06-15', s: '自作ゲーム kind を DB 管理化 (管理画面から登録) + ビンゴ詳細レイアウト fix + 待ち合わせ false-positive 修正' },
  { v: 'v618', d: '2026-06-15', s: '自作ゲーム JS-only 化 (PHP 1 行 + JS 1 ファイル) + ビンゴ反映 bug 修正 (table/column 名 全部間違い)' },
  { v: 'v617', d: '2026-06-15', s: '自作ゲーム フレームワーク + サンプル ⭕❌ マルバツ + docs/CUSTOM_GAMES.md ガイド #236' },
  { v: 'v616', d: '2026-06-15', s: 'ビンゴ平日限定撤廃 (土日も) #239 + 食べある記メニュー化 #238 + SNS シェア モーダル化 #237' },
  { v: 'v615', d: '2026-06-15', s: '誕生日バナー出てなかった bug 修正 (/api/auth/me が birthday_md を返してなかった)' },
  { v: 'v614', d: '2026-06-15', s: 'ワリカ: 海外通貨の支出に カード会社の為替手数料 3.63% を 自動上乗せ' },
  { v: 'v613', d: '2026-06-15', s: '✂️ 文字数・単語数リライター (アブスト/リバッタル の制限と戦う、 サーバ側で正確カウント + 最大3回 再依頼)' },
  { v: 'v612', d: '2026-06-15', s: '原稿チェック PDF オンリー化 + ランダムグループ自動通知 + 順番決め コピー + 大富豪/オセロ プレイフィーのみ化' },
  { v: 'v611', d: '2026-06-15', s: '研究 / 運営 タブ から アイコン (🔬 🏢) を撤去、 文字のみに' },
  { v: 'v610', d: '2026-06-15', s: '優勝予想 / 勝敗予測 で 起案時の 通知対象 メンバー指定 + 「本日ラボイン済み」 メッセージ撤去' },
  { v: 'v609', d: '2026-06-15', s: '研究 / 運営タブ追加 + 勝敗予測アプリ (試合のスコアを当てて山分け)' },
  { v: 'v608', d: '2026-06-15', s: 'バージョン履歴 モーダル (タップで表示) + 地雷オセロ 地雷 2 → 1 個に' },
  { v: 'v607', d: '2026-06-15', s: 'ラボインボーナス説明: ベテラン判定 longest_streak 5 → 3 に緩和' },
  { v: 'v606', d: '2026-06-15', s: '残高横ビンゴを 5x5 ミニ盤に + ラボインボーナス説明をベテラン (5+ 連続) は省略' },
  { v: 'v605', d: '2026-06-15', s: 'ホーム残高横に ビンゴサマリ、 ウィジェットは デフォルト OFF に戻す' },
  { v: 'v604', d: '2026-06-15', s: '娯楽ハブ: 💬 みんなで共有 (らぼったー/食べある記) を最上段に' },
  { v: 'v603', d: '2026-06-15', s: '💴 売買 カテゴリ新設 + らぼったー/食べある記/フライト応援を娯楽へ' },
  { v: 'v602', d: '2026-06-15', s: 'アプリ: カテゴリ内の並び順を CATEGORY_ORDER マップで指定可能に' },
  { v: 'v601', d: '2026-06-15', s: '🔬 研究用 + 🏢 研究室運営サポート の 2 カテゴリ新設、 トップに配置' },
  { v: 'v600', d: '2026-06-15', s: '巡回まとめ: 連続ラボイン切れ表示修正 + カテゴリ整理 + 誕生日登録 + ビンゴウィジェット' },
  { v: 'v599', d: '2026-06-15', s: 'らぼったーが古いまま問題を修正 (SW SWR キャッシュ無効化のバグ)' },
  { v: 'v598', d: '2026-06-15', s: '占いスペース修正 + 原稿チェック PDF 対応 + サムネ品質改善 (320→640px)' },
  { v: 'v597', d: '2026-06-15', s: 'ビンゴ: FREE マス撤廃 + TODO/重要連絡 を プールから除外' },
  { v: 'v596', d: '2026-06-15', s: '散歩 特殊スワイプロック (↑→↓→↑ で解除)' },
  { v: 'v595', d: '2026-06-15', s: '大富豪 革命 (4 枚同時) + 8 切り (場流し + 同プレイヤー継続)' },
  { v: 'v594', d: '2026-06-15', s: 'シェアボタン展開 (tierlists / polls / auctions / mahjong / othello / daifugo)' },
  { v: 'v593', d: '2026-06-15', s: 'ビンゴ過去週閲覧 + 過去カード メタ取得 API' },
  { v: 'v592', d: '2026-06-15', s: 'ビンゴ 500 修正 + 占いボタン化 + SNS 画像/位置 + 残高カード 表示要素 設定' },
  { v: 'v591', d: '2026-06-15', s: '散歩 軌跡 画像化 → SNS 投稿 + 過去軌跡 重ね合わせ' },
  { v: 'v590', d: '2026-06-15', s: '大富豪 (シンプル MVP、 2-4 人、 1pt buy-in、 1 位 総取り)' },
  { v: 'v589', d: '2026-06-15', s: '散歩モード (Wake Lock + GPS 5 秒 軌跡記録 + 履歴閲覧)' },
  { v: 'v588', d: '2026-06-15', s: 'ビンゴ (週次 5x5、 平日 行動 自動判定、 リーチ / BINGO 演出、 LB)' },
  { v: 'v587', d: '2026-06-15', s: '地雷オセロ (1pt buy-in、 各自 2 地雷、 3x3 反転)' },
  { v: 'v586', d: '2026-06-14', s: 'フライト応援 (オフライン、 Wake Lock、 進捗% + 応援メッセージ)' },
  { v: 'v585', d: '2026-06-14', s: '麻雀 音声 (チー/ポン/ロン/カン/リーチ) + 天気/日の出 + シェアボタン' },
  { v: 'v584', d: '2026-06-14', s: '1 日 1 回 占い (30 種、 ホーム ポイント ウィジェット 内 表示)' },
  { v: 'v583', d: '2026-06-14', s: 'レジュメ原稿チェック (paper-review の 軽量版、 5pt、 #225)' },
  { v: 'v582', d: '2026-06-14', s: '優勝予想 締切 カウントダウン + ティア表 5 段階 + 画像対応 + 「対戦」 ラベル' },
  { v: 'v581', d: '2026-06-14', s: 'らぼったー ウィジェット に 投稿欄を追加 (Ctrl+Enter 対応)' },
  { v: 'v580', d: '2026-06-13', s: 'ホームのウィジェット / アイコン を 全アプリ 設定可能に + 絵しりとり 30 秒固定' },
  { v: 'v579', d: '2026-06-13', s: '制覇マップ 国リスト を 105 → 201 (UN 加盟 193 国 + 主要地域)' },
  { v: 'v578', d: '2026-06-13', s: 'AI 麻雀 を 練習モード化 (ポイント授受なし、 #224)' },
  { v: 'v577', d: '2026-06-13', s: '優勝予想: 締切後に予想を 即公開 + 2026 W杯 出場 48 か国 実データ' },
  { v: 'v576', d: '2026-06-12', s: '優勝予想 アプリ (W杯 / スポーツ / 学会 best paper の 順位予想で 山分け)' },
  { v: 'v575', d: '2026-06-12', s: 'AI 麻雀 + 麻雀 ターン管理 修正 + 各種 細かい改善' },
];

export function showVersionHistory() {
  // 既存モーダルがあれば閉じる
  document.getElementById('vh-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'vh-modal';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:80vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,0.3)">
      <div style="padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px">
        <h3 style="margin:0; flex:1; font-size:16px">📜 LabPay バージョン履歴</h3>
        <button id="vh-close" style="background:none; border:none; font-size:22px; cursor:pointer; padding:0 6px; line-height:1">×</button>
      </div>
      <div style="flex:1; overflow:auto; padding:6px 16px">
        ${VERSION_HISTORY.map(v => `
          <div style="padding:10px 0; border-bottom:1px solid #f3f4f6">
            <div style="display:flex; align-items:baseline; gap:8px">
              <span style="font-weight:700; color:#4a106d; font-family:ui-monospace, monospace">${v.v}</span>
              <span style="font-size:11px; color:#999; font-variant-numeric:tabular-nums">${v.d}</span>
            </div>
            <div style="font-size:13px; line-height:1.5; margin-top:2px">${v.s}</div>
          </div>
        `).join('')}
        <div style="padding:14px 0; text-align:center; font-size:12px; color:#888">
          より古いバージョン は <a href="https://github.com/nkmr-lab/LabPay/commits/main" target="_blank" rel="noopener" style="color:#4a106d">GitHub</a> で
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.getElementById('vh-close').addEventListener('click', () => overlay.remove());
}

// グローバル関数として登録 (HTML attribute から呼べるように)
window.showVersionHistory = showVersionHistory;
