import { get, post, patch, del } from '../api.js';
import { escapeHtml, avatarHtml, navigate } from '../router.js';
import { state, toast, refreshMe, requestNotificationPermission, TAB_DEFS, readTabLayout, writeTabLayout, applyTabLayout } from '../app.js';
import { uploadImage } from '../upload.js';
import { previewSoundUrl, refreshSoundCache } from '../sounds.js';
import { APPS, APP_CATEGORIES, isAppVisible, setAppVisible } from './apps.js';
import { HOME_ACTIONS, isHomeActionVisible, setHomeActionVisible,
         BALANCE_COMPONENTS, isBalanceCompVisible, setBalanceCompVisible } from './home.js';
import { HOME_CARDS, readHomeLayout, writeHomeLayout,
         readCalHideAfterMin, writeCalHideAfterMin } from './home.js';

export async function renderSettings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="card">
      <h2>設定</h2>
    </div>

    <div class="card">
      <h3>プロフィール</h3>
      <div id="profile-avatar-wrap" style="display:flex; justify-content:center; margin:8px 0 14px"></div>
      <label class="field">
        <span class="lbl">表示名</span>
        <input type="text" id="profile-name" maxlength="100">
      </label>
      <label class="field">
        <span class="lbl">電話番号 (任意) <span class="hint-sm">— 緊急連絡用。 ログイン中のラボメンバーに見えます</span></span>
        <input type="tel" id="profile-phone" maxlength="50" placeholder="例: 090-1234-5678" inputmode="tel">
      </label>
      <label class="field">
        <span class="lbl">Slack member ID (任意) <span class="hint-sm">— 設定するとアプリ通知が Slack DM にも届きます。 取得方法: Slack プロフィール → 「⋯」 → 「メンバー ID をコピー」</span></span>
        <input type="text" id="profile-slack" maxlength="40" placeholder="例: U01ABCD2345" autocapitalize="characters">
      </label>
      <label class="field">
        <span class="lbl">アバター画像</span>
        <input type="file" id="profile-avatar-file" accept="image/*">
        <div id="profile-avatar-status" class="hint-sm"></div>
      </label>
      <label class="field">
        <span class="lbl">🎯 趣味 (任意・他のメンバーから見えます)</span>
        <textarea id="profile-hobbies" rows="3" maxlength="1000" placeholder="例: ボードゲーム / 山登り / 料理"></textarea>
      </label>
      <label class="field">
        <span class="lbl">❤️ 推し (任意・他のメンバーから見えます)</span>
        <textarea id="profile-favorites" rows="3" maxlength="1000" placeholder="例: 〇〇 (アニメ) / △△ (バンド) / □□ (アイドル)"></textarea>
      </label>
      <label class="field">
        <span class="lbl">💴 PayPay ID (送金 用、 他のメンバーから 見えます)</span>
        <input type="text" id="profile-paypay" maxlength="100" placeholder="例: yourid1234 (PayPay 内 で 検索 できる ID)">
      </label>
      <label class="field">
        <span class="lbl">🏦 銀行口座 メモ (送金 用、 他のメンバーから 見えます)</span>
        <textarea id="profile-bank" rows="3" maxlength="500" placeholder="例: ○○銀行 ○○支店 普通 1234567 ヤマダ タロウ"></textarea>
      </label>
      <div class="row" style="gap:6px; align-items:flex-end">
        <label class="field" style="flex:1">
          <span class="lbl">🎂 誕生日 (任意、 ホームでバースデー表示)</span>
          <input type="text" id="profile-birthday-md" maxlength="5" placeholder="MM-DD (例: 03-15)" style="font-variant-numeric:tabular-nums">
        </label>
        <label class="field" style="width:120px">
          <span class="lbl">西暦 (任意)</span>
          <input type="number" id="profile-birthday-year" min="1900" max="2100" placeholder="1990">
        </label>
      </div>
      <div class="row" style="gap:6px">
        <button id="profile-save" class="primary">保存</button>
        <button id="profile-clear-avatar">アバター削除</button>
        <a id="profile-view" href="#" class="btn">👀 自分の公開プロフィールを見る</a>
      </div>
    </div>

    <div class="card">
      <h3>通知</h3>
      <p class="hint" style="margin:6px 0 8px">
        ブラウザ通知を許可すると、 アプリを開いていない時でも新着通知がスマホの通知センターに出ます (タブを開きっぱなしの時のみ動作)。
      </p>
      <button id="notif-perm" class="primary">🔔 ブラウザ通知を有効にする</button>
      <span id="notif-perm-status" class="hint-sm" style="margin-left:8px"></span>
    </div>

    <div class="card">
      <h3>自分の端末 (登録済み)</h3>
      <div id="dev-list" class="list"><div class="muted">読み込み中…</div></div>
    </div>

    <details class="card" id="auto-detect-card" ${state.hasMac ? '' : 'open'}>
      <summary style="cursor:pointer; font-weight:700; font-size:var(--text-lg); list-style:none">
        自動検出 ${state.hasMac ? '<span class="hint-sm">— 登録済み (タップで開く)</span>' : '<span class="hint-sm">— 未登録なのでここから追加</span>'}
      </summary>
      <p class="hint" style="margin-top:8px">
        ラボ内 scanner が直近の数分間に観測した「まだ誰のものでもない MAC」一覧。<br>
        <span style="color:var(--primary); font-weight:700">📶 確実な見つけ方:</span><br>
        <span style="display:inline-block; margin-left:14px">1. スマホの WiFi をオフにする</span><br>
        <span style="display:inline-block; margin-left:14px">2. 数秒待ってからオンに戻す</span><br>
        <span style="display:inline-block; margin-left:14px">3. 30〜60秒待ってから下の「最新の観測を取得」を押す</span><br>
        <span style="display:inline-block; margin-left:14px">→ 自分の端末が <span class="tag" style="font-size:10px">NEW</span> タグ付きで一番上に出てくるはず</span>
      </p>
      <div class="row" style="margin-bottom:8px; gap:6px; align-items:center">
        <button id="reload-unreg">最新の観測を取得</button>
        <span class="hint-sm">または</span>
        <input type="text" id="my-ip-input" placeholder="自分の IP (例 42 や 192.168.50.42)"
               inputmode="decimal" maxlength="15"
               style="flex:1; max-width:240px; font-family:Consolas,Menlo,monospace; font-size:13px">
        <span class="muted" style="font-size:11px">設定→WiFi→ネットワーク名で確認</span>
      </div>
      <div id="unreg-list" class="list"><div class="muted">読み込み中…</div></div>
    </details>

    <div class="card">
      <h3>ホーム ウィジェット</h3>
      <p class="hint">
        ホームに置く ウィジェット (進行中・タスク・いる人 など) と並び順を変えられます。
        チェックを外すと非表示。 ↑ ↓ で順番を入れ替え。 設定はこのブラウザにのみ保存されます。
      </p>
      <div id="home-layout-list" class="list" style="margin-top:6px"></div>
    </div>

    <div class="card">
      <h3>タブのカスタマイズ</h3>
      <p class="hint">
        上部のナビゲーションに表示するタブと並び順を変えられます。
        チェックを外すと非表示。 ↑ ↓ で並び替え。 設定はこのブラウザにのみ保存されます。
      </p>
      <div id="tab-layout-list" class="list" style="margin-top:6px"></div>
    </div>

    <div class="card" id="balance-comp">
      <h3>ポイント表示欄 (ホーム残高カード) の要素</h3>
      <p class="hint">
        時計 / 残高 / 連続ラボイン / 実績メダル / 占い / チェックイン / ショートカット を ON/OFF。
        占い と 実績 は デフォルト OFF。
      </p>
      <div id="balance-comp-list" class="list" style="margin-top:6px"></div>
    </div>

    <div class="card" id="home-actions">
      <h3>ホーム上部の クイック ボタン</h3>
      <p class="hint">
        ホーム画面の 残高 直下に 並ぶ 「買う / 売る / 頼む / 送る…」 のセット。
        必要なものだけ ON に。 設定は このブラウザ にのみ 保存されます。
      </p>
      <div id="home-actions-list" class="list" style="margin-top:6px"></div>
    </div>

    <!-- v497 #103 アプリ表示設定は撤去。 アプリは全部表示する方針 (apps.js 側で
         isAppVisible を常時 true 化済み)。 -->


    <div class="card">
      <h3>Google Calendar 連携</h3>
      <p class="hint">
        連携するとホームに「今日の予定」が出ます (calendar.readonly のみ)。
        どのカレンダーを表示するかは下で個別に切り替えられます。
      </p>
      <div id="cal-section"><div class="muted">読み込み中…</div></div>
      <div class="sep" style="margin:14px 0 10px"></div>
      <h3 style="margin:0">終わった予定を消すまでの時間</h3>
      <p class="hint">
        予定の終了時刻から指定した分数が経過したら、 ホームの「今日の予定」 から
        消えます (0 で即時、 1440 で 24 時間)。 default 120 分。
      </p>
      <div class="row" style="gap:6px; align-items:center; margin-top:4px">
        <input type="number" id="cal-hide-after-min" min="0" max="1440" step="10" style="max-width:120px">
        <span class="muted" style="font-size:13px">分</span>
        <button id="cal-hide-save" class="primary">保存</button>
      </div>
      <div class="sep" style="margin:14px 0 10px"></div>
      <h3 style="margin:0">予定の非表示ルール</h3>
      <p class="hint">
        タイトルにこの文字列を含む予定はホームの「今日の予定」に出ない。
        正規表現も可 (チェック ON で <code>^MTG </code>、<code>(個人|サブ)</code> など)。
        どれか 1 ルールにでもマッチすれば hide。
      </p>
      <div id="cal-filter-section" style="margin-top:6px"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>効果音</h3>
      <p class="hint">
        決済 / ルーレット などで鳴らす音。 admin 規定値を使う / 自分で選ぶ / 無音 から選べます。
        音源そのものは admin が登録します。
      </p>
      <div id="sound-prefs"><div class="muted">読み込み中…</div></div>
    </div>

    <div class="card">
      <h3>🎮 自作ゲーム を 登録</h3>
      <p class="hint">
        自分で 書いた 2 人対戦 ゲーム を LabPay に 追加できます。 JS ファイル を アップロード で OK
        (場代 % を設定 すれば pot から 提供者特典 が 入ります)。
      </p>
      <a href="#/my-games" class="btn">🎮 自作ゲーム 管理</a>
    </div>

    <div class="card">
      <h3>その他</h3>
      <button id="logout-from-settings" class="danger">ログアウト</button>
    </div>
  `;

  // v525 #175 各カテゴリ (h2 が無い card) を デフォルト折りたたみに変換。
  //   先頭の h2「設定」 カードはそのまま、 各 .card で 「:scope > h3」 を持つものを
  //   <details>/<summary> に変換 して default closed に。
  for (const card of document.querySelectorAll('#app > .card')) {
    const h3 = card.querySelector(':scope > h3');
    if (!h3) continue;
    const details = document.createElement('details');
    details.className = 'card';
    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer; list-style:none; padding:4px 0; user-select:none';
    summary.innerHTML = `<span style="font-size:14px; color:var(--muted)">▶ </span>`;
    summary.appendChild(h3.cloneNode(true));
    summary.querySelector('h3').style.display = 'inline';
    summary.querySelector('h3').style.margin = '0';
    summary.querySelector('h3').style.fontSize = '15px';
    details.appendChild(summary);
    Array.from(card.childNodes).forEach(n => {
      if (n === h3) return;
      details.appendChild(n);
    });
    // 矢印を回転
    details.addEventListener('toggle', () => {
      const arrow = summary.querySelector('span');
      if (arrow) arrow.textContent = details.open ? '▼ ' : '▶ ';
    });
    card.replaceWith(details);
  }

  await loadProfile();
  await load();
  loadSoundPrefs(); // fire-and-forget; 失敗してもページ全体は崩れない
  // v545 #203 全 getElementById に optional chaining + null ガードを入れる。 hash 変化等で
  //   非同期に DOM が差し替わったり、 条件付きレンダリングで要素が無い場合でも 「null is
  //   not an object」 で settings 全体が落ちないように。
  const savedIp = localStorage.getItem('labpay-my-ip');
  const myIpInput = document.getElementById('my-ip-input');
  if (savedIp && myIpInput) myIpInput.value = savedIp;
  await loadUnregistered();
  document.getElementById('reload-unreg')?.addEventListener('click', loadUnregistered);
  myIpInput?.addEventListener('input', (ev) => {
    const v = ev.target.value.trim();
    if (v === '') localStorage.removeItem('labpay-my-ip');
    else          localStorage.setItem('labpay-my-ip', v);
    loadUnregistered();
  });
  document.getElementById('profile-save')?.addEventListener('click', onProfileSave);
  // 通知許可ボタン
  const npStatus = document.getElementById('notif-perm-status');
  const npBtn = document.getElementById('notif-perm');
  function syncPermLabel() {
    if (!npStatus || !npBtn) return;
    if (typeof Notification === 'undefined') {
      npStatus.textContent = '(このブラウザは未対応)';
      npBtn.disabled = true;
    } else if (Notification.permission === 'granted') {
      npStatus.textContent = '(有効)';
      npStatus.style.color = '#2e7d32';
      npBtn.textContent = '🔔 通知有効';
      npBtn.disabled = true;
    } else if (Notification.permission === 'denied') {
      npStatus.textContent = '(ブロック中。 ブラウザ設定から許可してください)';
      npStatus.style.color = 'var(--danger)';
    } else {
      npStatus.textContent = '(未許可)';
    }
  }
  syncPermLabel();
  npBtn?.addEventListener('click', async () => {
    await requestNotificationPermission();
    syncPermLabel();
  });
  document.getElementById('profile-clear-avatar')?.addEventListener('click', onProfileClearAvatar);
  document.getElementById('profile-avatar-file')?.addEventListener('change', onAvatarFile);
  document.getElementById('logout-from-settings')?.addEventListener('click', onLogoutFromSettings);
  renderHomeLayoutEditor();
  renderTabLayoutEditor();
  // v497 #103 アプリ表示設定撤去 (全部表示する方針)。 関数呼び出しも削除。
  renderHomeActionsEditor();
  renderBalanceCompEditor();
  // v419b URL ?focus=home-actions の 場合は 該当 カードへ スクロール + 短時間 強調
  try {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const focus = q.get('focus');
    if (focus) {
      const el = document.getElementById(focus);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.style.transition = 'background 0.4s';
          const orig = el.style.background;
          el.style.background = '#fff7d6';
          setTimeout(() => { el.style.background = orig; }, 1500);
        }, 50);
      }
    }
  } catch (_) {}
  // 終わった予定を消す分数: localStorage から現在値を読んで input に流し込み、
  // 「保存」 で writeCalHideAfterMin。 即座に home.js が次回 render で使う。
  const hideInput = document.getElementById('cal-hide-after-min');
  if (hideInput) {
    hideInput.value = String(readCalHideAfterMin());
    document.getElementById('cal-hide-save')?.addEventListener('click', () => {
      writeCalHideAfterMin(hideInput.value);
      hideInput.value = String(readCalHideAfterMin());
      // 反映を早めるためカレンダーキャッシュも捨てる。
      try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
      toast('保存しました');
    });
  }
  await loadCalendar();
  await loadCalendarFilterRules();

}

// ---------------- ホームのカスタマイズ ----------------
// 表示順と非表示を localStorage (labpay-home-layout) に保存。ここで並べた結果を
// home.js の applyHomeLayout が読んで反映する。 ↑ ↓ で順序、チェックで表示/非表示。
function renderHomeLayoutEditor() {
  const root = document.getElementById('home-layout-list');
  if (!root) return;
  const layout = readHomeLayout();
  const knownIds = HOME_CARDS.map(c => c.id);
  // 保存 order に無いものは末尾。 未知の id は捨てる。
  const orderedIds = [
    ...layout.order.filter(id => knownIds.includes(id)),
    ...knownIds.filter(id => !layout.order.includes(id)),
  ];
  const hiddenSet = new Set(layout.hidden);

  root.innerHTML = orderedIds.map((id, idx) => {
    const card = HOME_CARDS.find(c => c.id === id);
    if (!card) return '';
    const visible = !hiddenSet.has(id);
    const isFirst = idx === 0;
    const isLast  = idx === orderedIds.length - 1;
    return `
      <div class="list-item" data-card-id="${escapeHtml(id)}" style="gap:6px; align-items:center">
        <label style="display:inline-flex; align-items:center; gap:8px; flex:1; cursor:pointer">
          <input type="checkbox" class="hl-show" ${visible ? 'checked' : ''}>
          <span class="bold">${escapeHtml(card.title)}</span>
        </label>
        <button class="hl-up"   ${isFirst ? 'disabled' : ''}>↑</button>
        <button class="hl-down" ${isLast  ? 'disabled' : ''}>↓</button>
      </div>`;
  }).join('');

  root.querySelectorAll('.list-item[data-card-id]').forEach(row => {
    const id = row.dataset.cardId;
    row.querySelector('.hl-show').addEventListener('change', (ev) => {
      const l = readHomeLayout();
      const set = new Set(l.hidden);
      if (ev.target.checked) set.delete(id); else set.add(id);
      l.hidden = [...set];
      // v652 toggle 時 は 必ず 現在 の 全 id を order に 保存。 これで
      // readHomeLayout() の NEW_DEFAULT_SHOWN auto-show merge() が
      // 「order に 既に いる」 と 判断 して ユーザ の チェック 解除 を
      // 上書き しなく なる (= チェック 外して も 反映 される)。
      l.order = orderedIds.slice();
      writeHomeLayout(l);
      renderHomeLayoutEditor();
    });
    row.querySelector('.hl-up')  .addEventListener('click', () => moveCard(id, -1, orderedIds));
    row.querySelector('.hl-down').addEventListener('click', () => moveCard(id, +1, orderedIds));
  });
}

function moveCard(id, delta, currentOrder) {
  const arr = currentOrder.slice();
  const i = arr.indexOf(id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const l = readHomeLayout();
  l.order = arr;
  writeHomeLayout(l);
  renderHomeLayoutEditor();
}

// ---------------- タブのカスタマイズ ----------------
// 上部ナビ #tabs の表示/非表示 + 並び順を localStorage に保存。
// 設定で編集 → app.js の applyTabLayout が反映 (即座に表示更新)。
function renderTabLayoutEditor() {
  const root = document.getElementById('tab-layout-list');
  if (!root) return;
  const layout = readTabLayout();
  const knownIds = TAB_DEFS.map(t => t.id);
  const orderedIds = [
    ...layout.order.filter(id => knownIds.includes(id)),
    ...knownIds.filter(id => !layout.order.includes(id)),
  ];
  const hiddenSet = new Set(layout.hidden);
  root.innerHTML = orderedIds.map((id, idx) => {
    const def = TAB_DEFS.find(t => t.id === id);
    if (!def) return '';
    const visible = !hiddenSet.has(id);
    const isFirst = idx === 0;
    const isLast  = idx === orderedIds.length - 1;
    return `
      <div class="list-item" data-tab-id="${escapeHtml(id)}" style="gap:6px; align-items:center">
        <label style="display:inline-flex; align-items:center; gap:8px; flex:1; cursor:pointer">
          <input type="checkbox" class="tl-show" ${visible ? 'checked' : ''}>
          <span class="bold">${escapeHtml(def.title)}</span>
          ${def.note ? `<span class="hint-sm">${escapeHtml(def.note)}</span>` : ''}
        </label>
        <button class="tl-up"   ${isFirst ? 'disabled' : ''}>↑</button>
        <button class="tl-down" ${isLast  ? 'disabled' : ''}>↓</button>
      </div>`;
  }).join('');
  root.querySelectorAll('.list-item[data-tab-id]').forEach(row => {
    const id = row.dataset.tabId;
    row.querySelector('.tl-show').addEventListener('change', (ev) => {
      const l = readTabLayout();
      const set = new Set(l.hidden);
      if (ev.target.checked) set.delete(id); else set.add(id);
      l.hidden = [...set];
      if (!l.order.length) l.order = orderedIds.slice();
      writeTabLayout(l);
      applyTabLayout();
      renderTabLayoutEditor();
    });
    row.querySelector('.tl-up')  .addEventListener('click', () => moveTab(id, -1, orderedIds));
    row.querySelector('.tl-down').addEventListener('click', () => moveTab(id, +1, orderedIds));
  });
}

function moveTab(id, delta, currentOrder) {
  const arr = currentOrder.slice();
  const i = arr.indexOf(id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const l = readTabLayout();
  l.order = arr;
  writeTabLayout(l);
  applyTabLayout();
  renderTabLayoutEditor();
}

// v419 ホーム クイック ボタン 表示 設定
function renderBalanceCompEditor() {
  const root = document.getElementById('balance-comp-list');
  if (!root) return;
  root.innerHTML = BALANCE_COMPONENTS.map(c => {
    const on = isBalanceCompVisible(c.id);
    return `
      <div class="list-item" data-bc-id="${escapeHtml(c.id)}" style="gap:8px; align-items:center">
        <label style="display:inline-flex; align-items:center; gap:8px; flex:1; cursor:pointer">
          <input type="checkbox" class="bc-show" ${on ? 'checked' : ''}>
          <span class="bold">${escapeHtml(c.label)}</span>
          ${c.defaultOn ? '' : '<span class="hint-sm">(初期 OFF)</span>'}
        </label>
      </div>`;
  }).join('');
  root.querySelectorAll('.list-item[data-bc-id]').forEach(row => {
    const id = row.dataset.bcId;
    row.querySelector('.bc-show').addEventListener('change', (ev) => {
      setBalanceCompVisible(id, ev.target.checked);
    });
  });
}

function renderHomeActionsEditor() {
  const root = document.getElementById('home-actions-list');
  if (!root) return;
  root.innerHTML = HOME_ACTIONS.map(a => {
    const on = isHomeActionVisible(a.id);
    return `
      <div class="list-item" data-ha-id="${escapeHtml(a.id)}" style="gap:8px; align-items:center">
        <label style="display:inline-flex; align-items:center; gap:8px; flex:1; cursor:pointer">
          <input type="checkbox" class="ha-show" ${on ? 'checked' : ''}>
          <span style="font-size:18px; width:24px; text-align:center">${escapeHtml(a.icon || '')}</span>
          <span class="bold">${escapeHtml(a.title)}</span>
        </label>
        <a href="${escapeHtml(a.url)}" class="hint-sm" style="text-decoration:none">${escapeHtml(a.url)}</a>
      </div>`;
  }).join('');
  root.querySelectorAll('.list-item[data-ha-id]').forEach(row => {
    const id = row.dataset.haId;
    row.querySelector('.ha-show').addEventListener('change', (ev) => {
      setHomeActionVisible(id, ev.target.checked);
    });
  });
}

// ---------------- アプリ表示 (/#/apps) ----------------
// 各 app id について 表示 / 非表示 を localStorage に保存。 設定値が無ければ defaultVisible。
// v444: 通知 軸 カテゴリ ごと に セクション 見出し付き で 並べる。
function renderAppsVisEditor() {
  const root = document.getElementById('apps-vis-list');
  if (!root) return;
  const sections = APP_CATEGORIES.map(c => {
    const items = APPS.filter(a => a.cat === c.id);
    if (!items.length) return '';
    const rows = items.map(a => {
      const on = isAppVisible(a.id);
      return `
        <div class="list-item" data-app-id="${escapeHtml(a.id)}" style="gap:8px; align-items:center">
          <label style="display:inline-flex; align-items:center; gap:8px; flex:1; cursor:pointer">
            <input type="checkbox" class="av-show" ${on ? 'checked' : ''}>
            <span class="bold">${escapeHtml(a.title)}</span>
          </label>
          <span class="hint-sm" style="text-align:right; max-width:50%">${escapeHtml(a.desc)}</span>
        </div>`;
    }).join('');
    return `
      <div style="margin-top:10px">
        <div class="bold" style="margin:6px 0 2px">${escapeHtml(c.label)}</div>
        <div class="hint" style="margin:0 0 4px">${escapeHtml(c.hint)}</div>
        ${rows}
      </div>`;
  }).join('');
  root.innerHTML = sections;
  root.querySelectorAll('.list-item[data-app-id]').forEach(row => {
    const id = row.dataset.appId;
    row.querySelector('.av-show').addEventListener('change', (ev) => {
      setAppVisible(id, ev.target.checked);
    });
  });
}

// ---------------- Google Calendar ----------------
// 連携状態を /api/me/calendar で取得し、未連携なら 「連携する」 ボタン
// (Google OAuth incremental authz)、連携済みなら calendar 一覧 + toggle + 解除 を出す。
async function loadCalendar() {
  const root = document.getElementById('cal-section');
  if (!root) return;
  try {
    const s = await get('/api/me/calendar');
    if (!s.connected) {
      root.innerHTML = `
        <p class="hint-sm">未連携です。下のボタンで Google の同意画面に遷移します。</p>
        <a href="/api/auth/calendar/connect" class="btn primary">📅 Google Calendar を連携する</a>`;
      return;
    }
    // 連携済み → calendar 一覧を出す。
    root.innerHTML = `
      <div class="hint-sm">${escapeHtml(s.connected_at ?? '')} に連携</div>
      <div id="cal-list" class="list" style="margin-top:8px"><div class="muted">カレンダー読み込み中…</div></div>
      <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap">
        <button id="cal-refresh">カレンダー一覧を再取得</button>
        <a id="cal-reconnect" href="/api/auth/calendar/connect" class="btn">再連携 (権限を更新)</a>
        <button id="cal-disconnect" class="danger">連携を解除</button>
      </div>
      <div class="hint-sm" style="margin-top:6px">
        書き込み権限 (Zoom MTG 作成など) を追加で要求する時は 「再連携」 でもう一度 Google の同意画面を通してください。
      </div>`;
    document.getElementById('cal-refresh')?.addEventListener('click', loadCalendar);
    document.getElementById('cal-disconnect')?.addEventListener('click', async () => {
      if (!confirm('Google Calendar の連携を解除しますか?')) return;
      try { await del('/api/me/calendar'); toast('解除しました'); await loadCalendar(); }
      catch (e) { toast('失敗: ' + e.message); }
    });

    let cals;
    try { cals = await get('/api/me/calendar/calendars'); }
    catch (e) {
      // 401/409 で 再連携を促されたら 「連携する」 に戻ったような表示に。
      document.getElementById('cal-list').innerHTML =
        `<div class="muted">${escapeHtml(e.message)}</div>`;
      return;
    }
    const selected = new Set(s.selected_ids?.length ? s.selected_ids : ['primary']);
    const items = cals.items || [];
    if (!items.length) {
      document.getElementById('cal-list').innerHTML =
        `<div class="empty">カレンダーが見つかりません</div>`;
      return;
    }
    document.getElementById('cal-list').innerHTML = items.map(c => `
      <label class="list-item" style="gap:8px; align-items:center; cursor:pointer">
        <input type="checkbox" data-cid="${escapeHtml(c.id)}"
               ${selected.has(c.id) || (c.primary && selected.has('primary')) ? 'checked' : ''}>
        <div class="grow">
          <div class="bold">${escapeHtml(c.summary)} ${c.primary ? '<span class="tag" style="font-size:10px">primary</span>' : ''}</div>
          <div class="meta mono" style="font-size:11px">${escapeHtml(c.id)}</div>
        </div>
        ${c.bg ? `<span style="width:14px; height:14px; border-radius:50%; background:${escapeHtml(c.bg)}"></span>` : ''}
      </label>`).join('');
    // チェック変更 → API に PATCH。primary は特別扱い: primary cal が選ばれてれば
    // 'primary' を ID リストに含める (API は primary alias を解釈する)。
    document.getElementById('cal-list').querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const ids = Array.from(document.querySelectorAll('#cal-list input[type=checkbox]:checked'))
          .map(b => b.dataset.cid);
        try {
          await patch('/api/me/calendar/selection', { ids });
          try { localStorage.removeItem('labpay-cal-events-cache'); } catch {}
          toast('表示対象を更新');
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- Calendar filter rules ----------------
// タイトル部分一致 / 正規表現で 「今日の予定」 カードに出さない予定を絞る。
// rules = [{pattern, regex?: true}, ...]
let cachedFilterRules = [];

async function loadCalendarFilterRules() {
  const root = document.getElementById('cal-filter-section');
  if (!root) return;
  try {
    const r = await get('/api/me/calendar/filter-rules');
    cachedFilterRules = Array.isArray(r.rules) ? r.rules : [];
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
    return;
  }
  renderCalendarFilterRules();
}

function renderCalendarFilterRules() {
  const root = document.getElementById('cal-filter-section');
  if (!root) return;
  const list = cachedFilterRules.length
    ? cachedFilterRules.map((r, i) => `
        <div class="list-item" style="padding:8px 12px; gap:6px; align-items:center">
          ${r.regex ? '<span class="tag" style="font-size:10px">regex</span>' : ''}
          <div class="bold mono grow" style="min-width:0; word-break:break-all">${escapeHtml(r.pattern)}</div>
          <button data-rm-rule="${i}" class="btn" style="padding:2px 8px; font-size:12px">削除</button>
        </div>`).join('')
    : `<div class="empty" style="padding:10px">ルールはまだありません</div>`;
  root.innerHTML = `
    <div class="list">${list}</div>
    <div class="row" style="margin-top:8px; gap:6px; align-items:center; flex-wrap:wrap">
      <input type="text" id="cal-rule-pat" maxlength="200" placeholder="例: w/o 先生 / ^個人 / (サブコミ|二重)" class="grow">
      <label class="hint-sm" style="display:inline-flex; align-items:center; gap:4px">
        <input type="checkbox" id="cal-rule-regex"> 正規表現
      </label>
      <button id="cal-rule-add" class="primary">追加</button>
    </div>
  `;
  document.getElementById('cal-rule-add').addEventListener('click', onCalendarRuleAdd);
  document.getElementById('cal-rule-pat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onCalendarRuleAdd(); }
  });
  root.querySelectorAll('[data-rm-rule]').forEach(b => {
    b.addEventListener('click', () => onCalendarRuleRemove(Number(b.dataset.rmRule)));
  });
}

async function onCalendarRuleAdd() {
  const pat = document.getElementById('cal-rule-pat').value.trim();
  if (!pat) { toast('パターンを入力してください'); return; }
  const regex = !!document.getElementById('cal-rule-regex').checked;
  const newRule = regex ? { pattern: pat, regex: true } : { pattern: pat };
  const next = [...cachedFilterRules, newRule];
  try {
    const r = await patch('/api/me/calendar/filter-rules', { rules: next });
    cachedFilterRules = r.rules || next;
    toast('追加しました');
    renderCalendarFilterRules();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onCalendarRuleRemove(idx) {
  const next = cachedFilterRules.filter((_, i) => i !== idx);
  try {
    const r = await patch('/api/me/calendar/filter-rules', { rules: next });
    cachedFilterRules = r.rules || next;
    toast('削除しました');
    renderCalendarFilterRules();
  } catch (e) { toast('失敗: ' + e.message); }
}

// ---------------- Profile ----------------
let pendingAvatarUrl = null; // staged URL after successful upload, written on save

async function loadProfile() {
  try {
    const me = await get('/api/me');
    document.getElementById('profile-name').value = me.user.display_name || '';
    document.getElementById('profile-phone').value = me.user.phone_number || '';
    document.getElementById('profile-slack').value = me.user.slack_member_id || '';
    document.getElementById('profile-hobbies').value = me.user.hobbies || '';
    document.getElementById('profile-favorites').value = me.user.favorites || '';
    document.getElementById('profile-paypay').value = me.user.paypay_id || '';
    document.getElementById('profile-bank').value   = me.user.bank_info || '';
    document.getElementById('profile-birthday-md').value   = me.user.birthday_md || '';
    document.getElementById('profile-birthday-year').value = me.user.birthday_year || '';
    const pv = document.getElementById('profile-view');
    if (pv) pv.href = '#/users/' + me.user.id;
    document.getElementById('profile-avatar-wrap').innerHTML = avatarHtml(me.user.display_name, me.user.avatar_url, 'lg');
    pendingAvatarUrl = null;
  } catch (e) { toast('プロフィール取得失敗: ' + e.message); }
}

async function onProfileSave() {
  const display_name = document.getElementById('profile-name').value.trim();
  if (!display_name) { toast('表示名を入力してください'); return; }
  const phone_raw = document.getElementById('profile-phone').value.trim();
  const slack_raw = document.getElementById('profile-slack').value.trim();
  const hobbies = document.getElementById('profile-hobbies').value.trim();
  const favorites = document.getElementById('profile-favorites').value.trim();
  const paypay = document.getElementById('profile-paypay').value.trim();
  const bank   = document.getElementById('profile-bank').value.trim();
  const bdMd   = document.getElementById('profile-birthday-md').value.trim();
  const bdY    = document.getElementById('profile-birthday-year').value.trim();
  const body = {
    display_name,
    phone_number: phone_raw === '' ? null : phone_raw,
    slack_member_id: slack_raw === '' ? null : slack_raw,
    hobbies:   hobbies   === '' ? null : hobbies,
    favorites: favorites === '' ? null : favorites,
    paypay_id: paypay    === '' ? null : paypay,
    bank_info: bank      === '' ? null : bank,
    birthday_md:   bdMd === '' ? null : bdMd,
    birthday_year: bdY  === '' ? null : Number(bdY),
  };
  if (pendingAvatarUrl !== null) body.avatar_url = pendingAvatarUrl;
  try {
    await patch('/api/me', body);
    toast('保存しました');
    await refreshMe();
    await loadProfile();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onProfileClearAvatar() {
  if (!confirm('アバター画像を削除しますか?')) return;
  try {
    await patch('/api/me', { avatar_url: null });
    toast('削除しました');
    await refreshMe();
    await loadProfile();
  } catch (e) { toast('失敗: ' + e.message); }
}

async function onAvatarFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const status = document.getElementById('profile-avatar-status');
  status.textContent = 'アップロード中…';
  try {
    const data = await uploadImage(f);
    pendingAvatarUrl = data.url;
    status.textContent = 'アップロード完了 — 「保存」で確定';
    // Preview using the just-uploaded URL
    document.getElementById('profile-avatar-wrap').innerHTML = avatarHtml(null, data.url, 'lg');
  } catch (e) { status.textContent = '失敗: ' + e.message; }
}

async function onLogoutFromSettings() {
  if (!confirm('ログアウトしますか?')) return;
  try { await post('/api/auth/logout', {}); } catch (_) {}
  state.me = null;
  state.balance = null;
  state.unread = 0;
  navigate('#/login');
}

// 効果音 設定 セクション: イベントごとに 規定 / 自分で選ぶ / 無音 の 3 モード切替。
// custom の時だけ clip dropdown + 音量 slider を露出。 変更は その場で PATCH。
async function loadSoundPrefs() {
  const root = document.getElementById('sound-prefs');
  if (!root) return;
  try {
    const [my, clipsResp] = await Promise.all([
      get('/api/sounds/my'),
      get('/api/sounds/clips'),
    ]);
    const items = my.items || [];
    const clips = clipsResp.items || [];
    if (!items.length) { root.innerHTML = '<div class="muted">イベント定義がありません</div>'; return; }
    const clipOpts = clips.map(c =>
      `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    root.innerHTML = items.map(it => {
      const defLabel = it.default_clip_id
        ? (clips.find(c => Number(c.id) === Number(it.default_clip_id))?.label || '未取得')
        : '無音';
      return `
      <div class="list-item" style="flex-wrap:wrap; gap:8px; align-items:center">
        <div style="min-width:180px; flex:1">
          <div class="bold">${escapeHtml(it.label)}</div>
          <div class="meta">規定: ${escapeHtml(defLabel)} · 音量 ${it.default_volume}</div>
        </div>
        <select data-sp-mode="${it.event_key}" style="min-width:130px">
          <option value="default" ${it.mode === 'default' ? 'selected' : ''}>規定値を使う</option>
          <option value="custom"  ${it.mode === 'custom'  ? 'selected' : ''}>自分で選ぶ</option>
          <option value="mute"    ${it.mode === 'mute'    ? 'selected' : ''}>無音</option>
        </select>
        <span data-sp-custom="${it.event_key}" ${it.mode === 'custom' ? '' : 'hidden'} style="display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap">
          <select data-sp-clip="${it.event_key}" style="min-width:140px">
            <option value="">— 音源を選択 —</option>
            ${clipOpts}
          </select>
          <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px">
            音量
            <input type="range" min="0" max="100" step="5" value="${it.pref_volume ?? 70}" data-sp-vol="${it.event_key}" style="width:100px">
            <span data-sp-volnum="${it.event_key}" style="min-width:30px">${it.pref_volume ?? 70}</span>
          </label>
        </span>
        <button class="btn" data-sp-preview="${it.event_key}">▶ 試聴</button>
      </div>`;
    }).join('');
    // 現在の pref_clip_id を 反映
    items.forEach(it => {
      if (it.mode === 'custom' && it.pref_clip_id) {
        const sel = root.querySelector(`[data-sp-clip="${it.event_key}"]`);
        if (sel) sel.value = String(it.pref_clip_id);
      }
    });
    const sendPatch = async (key) => {
      const mode = root.querySelector(`[data-sp-mode="${key}"]`).value;
      const body = { mode };
      if (mode === 'custom') {
        const clipId = Number(root.querySelector(`[data-sp-clip="${key}"]`).value);
        if (!clipId) { toast('音源を選んでください'); return; }
        body.clip_id = clipId;
        body.volume = Number(root.querySelector(`[data-sp-vol="${key}"]`).value);
      }
      try {
        await patch('/api/sounds/my/' + key, body);
        await refreshSoundCache();
      } catch (e) { toast('失敗: ' + e.message); }
    };
    root.querySelectorAll('[data-sp-mode]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const key = sel.dataset.spMode;
        // custom セクションの表示切替
        const cust = root.querySelector(`[data-sp-custom="${key}"]`);
        if (cust) cust.hidden = sel.value !== 'custom';
        if (sel.value !== 'custom') await sendPatch(key);
      });
    });
    root.querySelectorAll('[data-sp-clip]').forEach(sel => {
      sel.addEventListener('change', () => sendPatch(sel.dataset.spClip));
    });
    root.querySelectorAll('[data-sp-vol]').forEach(rng => {
      rng.addEventListener('input', () => {
        root.querySelector(`[data-sp-volnum="${rng.dataset.spVol}"]`).textContent = rng.value;
      });
      rng.addEventListener('change', () => sendPatch(rng.dataset.spVol));
    });
    root.querySelectorAll('[data-sp-preview]').forEach(b => {
      b.addEventListener('click', () => {
        const key = b.dataset.spPreview;
        const it = items.find(x => x.event_key === key);
        if (!it) return;
        const mode = root.querySelector(`[data-sp-mode="${key}"]`).value;
        if (mode === 'mute') { toast('無音設定です'); return; }
        let url = null, vol = 0.7;
        if (mode === 'custom') {
          const cid = Number(root.querySelector(`[data-sp-clip="${key}"]`).value);
          const clip = clips.find(c => Number(c.id) === cid);
          if (!clip) { toast('音源を選んでください'); return; }
          url = clip.file_url;
          vol = Number(root.querySelector(`[data-sp-vol="${key}"]`).value) / 100;
        } else {
          if (!it.default_clip_id) { toast('規定値が未設定 (無音) です'); return; }
          const clip = clips.find(c => Number(c.id) === Number(it.default_clip_id));
          if (clip) { url = clip.file_url; vol = (it.default_volume || 70) / 100; }
        }
        if (url) previewSoundUrl(url, vol);
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function load() {
  try {
    const data = await get('/api/presence/devices');
    const root = document.getElementById('dev-list');
    // v524 #173 #177 ページ遷移中に async が解決すると root が null になることがある
    //   ので 防御。 古い render の async 処理を捨てる形。
    if (!root) return;
    if (!data.items.length) {
      root.innerHTML = `<div class="empty">まだ登録されていません</div>`;
      return;
    }
    root.innerHTML = data.items.map(d => `
      <div class="list-item">
        <div>
          <div class="bold mono">${escapeHtml(d.mac)}</div>
          <div class="meta">${escapeHtml(d.label ?? '(ラベル無し)')} · ${escapeHtml(d.created_at)}</div>
        </div>
        <button data-rm="${d.id}" class="danger">削除</button>
      </div>
    `).join('');
    root.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('この端末を削除しますか?')) return;
        try { await del('/api/presence/devices/' + b.dataset.rm); }
        catch (e) { toast('失敗: ' + e.message); return; }
        toast('削除しました');
        await load();
      });
    });
  } catch (e) {
    const root = document.getElementById('dev-list');
    if (root) root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

async function loadUnregistered() {
  const root = document.getElementById('unreg-list');
  if (!root) return;
  root.innerHTML = `<div class="muted">読み込み中…</div>`;
  try {
    const d = await get('/api/presence/unregistered_macs');
    if (!d.items.length) {
      root.innerHTML = `<div class="empty">最近 ${d.window_minutes} 分以内に観測された未登録 MAC はありません。<br>ラボに居て scanner が動いていれば、数十秒待ってからもう一度押してみてください。</div>`;
      return;
    }
    const now = Date.now();
    const isAdmin = state.me?.role === 'admin';
    const myIp = document.getElementById('my-ip-input')?.value.trim() || '';
    // Match rule:
    //   - "42"               → last octet exact match (so "42" matches .42 but NOT .142)
    //   - "50.42" / "192.168" → substring match (handles partial prefixes too)
    //   - full IP            → substring also handles exact
    const ipMatches = (candidate) => {
      if (!myIp || !candidate) return false;
      if (myIp.includes('.')) return candidate.includes(myIp);
      const parts = candidate.split('.');
      return parts[parts.length - 1] === myIp;
    };
    // Matching records float to the top, otherwise keep server-side first_seen_at DESC order.
    const items = d.items.slice().sort((a, b) => {
      const am = ipMatches(a.ip) ? 1 : 0;
      const bm = ipMatches(b.ip) ? 1 : 0;
      return bm - am;
    });
    // Distinct color per room so 7F/10F devices are visually separable at a glance.
    const ROOM_COLORS = {
      '10F': '#4a106d',   // shikon (primary purple)
      '7F':  '#0e7c63',   // teal
    };
    const roomColor = (rid) => ROOM_COLORS[rid] || '#999';
    // Split an IP and emphasize the last octet so it's easy to match against your phone's
    // "192.168.50.XX" value at a glance.
    const ipHtml = (ip) => {
      if (!ip) return '-';
      const parts = String(ip).split('.');
      if (parts.length < 2) return escapeHtml(ip);
      const head = parts.slice(0, -1).join('.');
      const tail = parts[parts.length - 1];
      return `<span style="color:#666">${escapeHtml(head)}.</span><span style="color:#c0392b; font-weight:700">${escapeHtml(tail)}</span>`;
    };

    root.innerHTML = items.map(x => {
      // "NEW" tag for MACs first observed in the last 90s — i.e., devices that just joined.
      const firstAgeSec = x.first_seen_at ? (now - new Date(x.first_seen_at.replace(' ', 'T') + '+09:00').getTime()) / 1000 : Infinity;
      const isFresh  = firstAgeSec >= 0 && firstAgeSec < 90;
      const isMine   = ipMatches(x.ip);
      const rc       = roomColor(x.room_id);
      const roomTag  = `<span class="tag" style="font-size:10px; margin-right:6px; background:${rc}; color:white">${escapeHtml(x.room_id)}</span>`;
      const newTag   = isFresh ? '<span class="tag" style="font-size:10px; margin-left:6px">NEW</span>' : '';
      const hintTag  = x.hint  ? `<span class="tag muted" style="font-size:10px; margin-left:6px">${escapeHtml(x.hint)}</span>` : '';
      const mineTag  = isMine
        ? '<span class="tag" style="font-size:10px; margin-left:6px; background:#fff8d6; color:#7a5a00">📱 あなた</span>'
        : '';
      const adminBtn = isAdmin
        ? `<button data-infra="${escapeHtml(x.mac)}" style="margin-left:4px">機材登録</button>`
        : '';
      // Border priority: IP match (yellow) > fresh (purple) > none.
      const borderStyle = isMine
        ? `border-left:4px solid #f2c700; background:#fffdf4`
        : (isFresh ? `border-left:4px solid ${rc}` : `border-left:4px solid ${rc}33`);
      const claimBtnCls = isMine ? 'primary' : 'primary';
      const claimBtnTxt = isMine ? 'これは私 ✓' : 'これは私';
      // Show 最終観測 only when it's different from 初観測 (single-shot observations
      // would otherwise duplicate the same timestamp twice).
      const lastTxt = (x.last_seen_at && x.last_seen_at !== x.first_seen_at)
        ? ` · 最終観測 ${escapeHtml(x.last_seen_at)}`
        : '';
      return `
      <div class="list-item" style="${borderStyle}">
        <div>
          <div class="bold mono">${roomTag}${escapeHtml(x.mac)}${mineTag}${newTag}${hintTag}</div>
          <div class="meta">${escapeHtml(x.room_name)} · IP ${ipHtml(x.ip)} · 初観測 ${escapeHtml(x.first_seen_at ?? '-')}${lastTxt}</div>
        </div>
        <div>
          <button data-claim="${escapeHtml(x.mac)}" class="${claimBtnCls}">${claimBtnTxt}</button>
          ${adminBtn}
        </div>
      </div>`;
    }).join('');
    root.querySelectorAll('[data-claim]').forEach(b => {
      b.addEventListener('click', async () => {
        const mac = b.dataset.claim;
        // Pre-fill the label with "{自分の名前}スマートフォン" so the most common
        // case (= it's the user's own phone) takes 0 typing. Power users can
        // edit to "iPhone 16" / "iPad" / "サブ機" etc. inline.
        const defaultLabel = `${state.me?.display_name ?? ''}スマートフォン`;
        const label = prompt('この端末のラベル:', defaultLabel) || '';
        try {
          await post('/api/presence/devices', { mac, label: label || null });
          toast('登録しました');
          // Refresh global state so state.hasMac flips true immediately — without
          // this, navigating back to home would still show the onboarding card
          // until the next full page reload.
          await refreshMe();
          await load();
          await loadUnregistered();
        } catch (e) {
          toast('失敗: ' + e.message);
        }
      });
    });
    root.querySelectorAll('[data-infra]').forEach(b => {
      b.addEventListener('click', async () => {
        const mac = b.dataset.infra;
        const label = prompt('機材ラベル (例: プリンタ、研究室PC1):', '');
        if (!label) return;
        try {
          await post('/api/admin/presence_infrastructure', { mac, label });
          toast('機材として登録 → 候補から除外されます');
          await loadUnregistered();
        } catch (e) { toast('失敗: ' + e.message); }
      });
    });
  } catch (e) {
    root.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`;
  }
}

