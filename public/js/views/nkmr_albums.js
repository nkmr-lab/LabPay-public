// v970 中村研 アルバム。 v969 まで の RAW ハードコード → DB 化 + 追加 / 編集 / 削除。
//   /api/nkmr-albums から fetch、 タイル 表示、 「年度別 / 新しい順 / 古い順 / 場所別」 の
//   4 sort、 場所別 では 「🇯🇵 国内 (都道府県) / ✈ 国外 (国) / 🌏 すべて」 で フィルタ、
//   認証済 なら 誰でも 追加 可、 自分 (or admin) の レコード だけ 編集 / 削除。

import { escapeHtml } from '../router.js';
import { get, post, patch, del } from '../api.js';
import { state } from '../app.js';

// メモリ 内 キャッシュ (タブ 切替 で リセット)
const thumbCache = {};   // { url: '/api/album-thumbs/photo/<hash>' | null }
const countCache = {};   // { url: number | null }

let sections = [];       // API 応答 の sections
let sortMode = 'section';  // section | new | old | location
let locFilter = 'jp';      // v970.11 jp | overseas (場所別 mode 用、 「すべて」 は 廃止 して 国内 デフォルト)
let showAddForm = false;
let cachedJpSvg = null;    // v970.10 Geolonia SVG (regions.js と 共有 の /img/jp-prefectures.svg)

// 都道府県 → JIS X 0401 番号 (Geolonia SVG の data-code に 一致 する 1-47)
const PREF_TO_JIS = {
  '北海道': 1, '青森県': 2, '岩手県': 3, '宮城県': 4, '秋田県': 5, '山形県': 6, '福島県': 7,
  '茨城県': 8, '栃木県': 9, '群馬県': 10, '埼玉県': 11, '千葉県': 12, '東京都': 13, '神奈川県': 14,
  '新潟県': 15, '富山県': 16, '石川県': 17, '福井県': 18, '山梨県': 19, '長野県': 20,
  '岐阜県': 21, '静岡県': 22, '愛知県': 23, '三重県': 24, '滋賀県': 25, '京都府': 26, '大阪府': 27,
  '兵庫県': 28, '奈良県': 29, '和歌山県': 30,
  '鳥取県': 31, '島根県': 32, '岡山県': 33, '広島県': 34, '山口県': 35,
  '徳島県': 36, '香川県': 37, '愛媛県': 38, '高知県': 39,
  '福岡県': 40, '佐賀県': 41, '長崎県': 42, '熊本県': 43,
  '大分県': 44, '宮崎県': 45, '鹿児島県': 46, '沖縄県': 47,
};

// ─── 都道府県 マップ (場所別 の 国内 グループ化 用) ──────────────
// キー: タイトル 中 に 現れ得る 場所 語 / 都市 名、 値: 都道府県 名。
// 都道府県 名 自体 (「東京」 「京都」 …) を キー にも 入れて 素通し 対応。
const PREF_MAP = {
  // v970 seed 直後 は 「都道府県 名 自体」 + 主要 都市 / 大学 / 観光地。
  // v970.2 中村さん 指摘 で 関西大学 / 琉球大学 等 の 大学 名 と、 秩父 / 南あわじ / 隠岐 / つくば /
  //   ハウステンボス / 奥多摩 / 那須 / 浜名湖 / 上越教育大学 / はこだて等 の 地名 を 追加。
  '沖縄': '沖縄県', '那覇': '沖縄県', '石垣島': '沖縄県', '宮古島': '沖縄県',
  '琉球大学': '沖縄県', '琉球': '沖縄県',
  '北海道': '北海道', '札幌': '北海道', '函館': '北海道', 'はこだて': '北海道',
  'はこだて未来大学': '北海道', '小樽': '北海道', '苗場': '新潟県',
  '定山渓': '北海道', '奄美大島': '鹿児島県', '鹿児島': '鹿児島県',
  '福岡': '福岡県', '博多': '福岡県', '北九州': '福岡県',
  '長崎': '長崎県', 'ハウステンボス': '長崎県',
  '大分': '大分県', '別府': '大分県', '愛媛': '愛媛県',
  '高知': '高知県',
  '静岡': '静岡県', '浜松': '静岡県', '浜名湖': '静岡県', '伊東': '静岡県', '伊豆高原': '静岡県', '掛川': '静岡県',
  '愛知': '愛知県', '名古屋': '愛知県', '豊橋': '愛知県',
  '京都': '京都府', '大阪': '大阪府', 'Osaka': '大阪府', '関西大学': '大阪府',
  '兵庫': '兵庫県', '神戸': '兵庫県', '淡路島': '兵庫県', '南あわじ': '兵庫県', '六甲': '兵庫県',
  '奈良': '奈良県', '和歌山': '和歌山県', '滋賀': '滋賀県', '米原': '滋賀県', '長浜': '滋賀県',
  '三重': '三重県', '鳥羽': '三重県', '岐阜': '岐阜県', '高山': '岐阜県',
  '東京': '東京都', '中野': '東京都', '明治大学': '東京都', '芝浦': '東京都',
  '国士舘': '東京都',
  '茨城': '茨城県', '筑波': '茨城県', 'つくば': '茨城県',
  '神奈川': '神奈川県', '横浜': '神奈川県',
  '千葉': '千葉県', '白浜': '千葉県', '幕張': '千葉県',
  '埼玉': '埼玉県', '秩父': '埼玉県',
  // 「伊豆大島」 「奥多摩」 は 東京都 (fallback で 東京都 に なる ので 明示 マップ 不要)
  '群馬': '群馬県',
  '長野': '長野県', '八ヶ岳': '長野県',
  '福井': '福井県', '石川': '石川県', '金沢': '石川県', '富山': '富山県',
  '新潟': '新潟県', '上越教育大学': '新潟県',
  '山形': '山形県', '福島': '福島県', '猪苗代': '福島県',
  '仙台': '宮城県', '宮城': '宮城県', '青森': '青森県', '岩手': '岩手県', '秋田': '秋田県',
  '栃木': '栃木県', '日光': '栃木県', '鬼怒川': '栃木県', '那須': '栃木県',
  '山梨': '山梨県', '富士Q': '山梨県', '富士急': '山梨県',
  '広島': '広島県', '岡山': '岡山県', '山口': '山口県', '下関': '山口県',
  '徳島': '徳島県', '香川': '香川県', '高松': '香川県',
  '宮崎': '宮崎県', '熊本': '熊本県', '佐賀': '佐賀県',
  '島根': '島根県', '隠岐島': '島根県', '隠岐': '島根県',
};

// v970.12 タイトル 内 の 国 名 / 都市 名 キーワード → 国 名 (国外 グループ の 副 目的地 検出 用)。
//   例: 「(香港経由)」 の アルバム を 香港 の セクション にも 出す。
const COUNTRY_MAP = {
  '韓国': '韓国', 'ソウル': '韓国',
  '中国': '中国', '北京': '中国', '上海': '中国',
  '香港': '香港',   // 経由 地 として も 頻出
  '台湾': '台湾', '台北': '台湾',
  'タイ': 'タイ', 'バンコク': 'タイ',
  'ベトナム': 'ベトナム', 'ハノイ': 'ベトナム', 'ホーチミン': 'ベトナム',
  'フィリピン': 'フィリピン', 'マニラ': 'フィリピン',
  'マレーシア': 'マレーシア', 'クアラルンプール': 'マレーシア',
  'インドネシア': 'インドネシア', 'Depok': 'インドネシア',
  'シンガポール': 'シンガポール', 'Singapore': 'シンガポール',   // 経由 地
  'カンボジア': 'カンボジア', 'プノンペン': 'カンボジア',
  'インド': 'インド',
  'キプロス': 'キプロス',
  // 中東 (経由 地 で よく 使われる)
  'カタール': 'カタール', 'ドーハ': 'カタール', 'Doha': 'カタール',
  'UAE': 'UAE', 'ドバイ': 'UAE', 'アブダビ': 'UAE',
  'トルコ': 'トルコ', 'イスタンブール': 'トルコ',
  'オーストラリア': 'オーストラリア', 'Sydney': 'オーストラリア', 'Brisbane': 'オーストラリア', 'キャンベラ': 'オーストラリア',
  'ニュージーランド': 'ニュージーランド', 'Wellington': 'ニュージーランド',
  'アメリカ': 'アメリカ', 'ラスベガス': 'アメリカ', 'ニューヨーク': 'アメリカ', 'ロス': 'アメリカ', 'ハワイ': 'アメリカ',
  'カナダ': 'カナダ', 'モントリオール': 'カナダ', 'バンクーバー': 'カナダ',
  'メキシコ': 'メキシコ', 'カンクン': 'メキシコ',
  'ブラジル': 'ブラジル', 'サンパウロ': 'ブラジル',
  'ペルー': 'ペルー', 'アレキパ': 'ペルー',
  'アルゼンチン': 'アルゼンチン', 'ブエノスアイレス': 'アルゼンチン',
  'デンマーク': 'デンマーク', 'コペンハーゲン': 'デンマーク',
  'ドイツ': 'ドイツ', 'ベルリン': 'ドイツ', 'ミュンヘン': 'ドイツ',
  'オランダ': 'オランダ', 'アムステルダム': 'オランダ',   // 経由 地
  'イギリス': 'イギリス', 'ロンドン': 'イギリス',
  'フランス': 'フランス', 'パリ': 'フランス',
  'ポルトガル': 'ポルトガル', 'リスボン': 'ポルトガル', 'ポルト': 'ポルトガル',
  'スペイン': 'スペイン', 'バルセロナ': 'スペイン', 'マドリード': 'スペイン', 'Spain': 'スペイン',
  'ギリシャ': 'ギリシャ', 'アテネ': 'ギリシャ',
  'イタリア': 'イタリア', 'ローマ': 'イタリア', 'ミラノ': 'イタリア', 'ベネチア': 'イタリア', 'ジェノバ': 'イタリア', 'ベローナ': 'イタリア',
  'エジプト': 'エジプト', 'カイロ': 'エジプト',
};

// 国旗 絵文字 (regional indicator) → ISO2 → 表示 用 国名
function flagToCountry(flag) {
  if (!flag) return null;
  // regional indicator 2 文字 の 場合
  const codes = Array.from(flag).map(ch => ch.codePointAt(0)).filter(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
  if (codes.length < 2) return null;
  const iso = String.fromCharCode(0x41 + (codes[0] - 0x1F1E6)) + String.fromCharCode(0x41 + (codes[1] - 0x1F1E6));
  const map = { US:'アメリカ', IT:'イタリア', PT:'ポルトガル', ES:'スペイン', CY:'キプロス',
                DK:'デンマーク', GR:'ギリシャ', ID:'インドネシア', MY:'マレーシア', AU:'オーストラリア',
                KH:'カンボジア', PE:'ペルー', CA:'カナダ', TW:'台湾', MX:'メキシコ', NZ:'ニュージーランド',
                DE:'ドイツ', FR:'フランス', UK:'イギリス', GB:'イギリス', CN:'中国', KR:'韓国',
                IN:'インド', TH:'タイ', VN:'ベトナム', PH:'フィリピン', BR:'ブラジル', AR:'アルゼンチン' };
  return map[iso] || iso;
}

// v970.13 タイトル 内 の 括弧 (…) は 大抵 参加 者 名 リスト。 「福井、飯田、…」 の 名前
//   だけ の 括弧 は 場所 検出 から 除外。 一方 「佐賀県警、…」 の ように 「県 / 都 / 府」
//   マーカー を 含む 括弧 は 場所 情報 として 残す。
function scanTargetsFor(album) {
  const targets = [];
  const loc = String(album.location || '').trim();
  if (loc) targets.push(loc);
  let title = String(album.title || '');
  title = title.replace(/[（(]([^）)]*)[）)]/gu, (_, inner) => {
    return /[県都府]/.test(inner) ? inner : '';
  });
  targets.push(title);
  return targets;
}

// v970.12 タイトル/location から 複数 都道府県 を 抽出。 マッチ 無し は 東京都 fallback。
//   注意: 「東京都」 が 「京都」 を 部分文字列 として 含む ケース は skip。
function guessPrefectures(album) {
  const candidates = scanTargetsFor(album);
  const found = new Set();
  for (const cand of candidates) {
    for (const [key, val] of Object.entries(PREF_MAP)) {
      let pos = 0;
      while ((pos = cand.indexOf(key, pos)) >= 0) {
        const skip = key === '京都' && pos > 0 && cand[pos - 1] === '東';
        if (!skip) { found.add(val); break; }
        pos += key.length;
      }
    }
  }
  if (found.size === 0) return ['東京都'];
  return Array.from(found);
}
function guessPrefecture(album) { return guessPrefectures(album)[0]; }

// タイトル 先頭 の YYYY.MM.DD → sortKey
function extractSortKey(title) {
  const dm = title.match(/^(\d{4})\.(\d{2})(?:\.(\d{2}))?/);
  if (dm) return `${dm[1]}-${dm[2]}-${dm[3] || '01'}`;
  const ym = title.match(/(\d{4})\s*年度/);
  if (ym) return `${ym[1]}-00-00`;
  return '';
}

// v970.8 年度 (4-3 月) で 束ね直す。 タイトル 先頭 の YYYY.MM.DD から:
//   月 が 4-12 → 年度 = YYYY
//   月 が 1-3  → 年度 = YYYY - 1
//   日付 不明 は DB の section (「過去のもの」 等) を そのまま。
function fiscalYearOf(album) {
  const dm = String(album.title || '').match(/^(\d{4})\.(\d{2})/);
  if (dm) {
    const y = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10);
    return `${m >= 4 ? y : y - 1}年度`;
  }
  // section が 4 桁 数字 なら それ を そのまま 年度 に (年度 と 見なす)
  if (/^\d{4}$/.test(String(album.section || ''))) return `${album.section}年度`;
  return String(album.section || '中村研アルバム');
}

async function fetchAlbums() {
  const r = await get('/api/nkmr-albums');
  const all = (r.sections || []).flatMap(sec =>
    (sec.albums || []).map(a => ({ ...a, section: sec.title, sortKey: extractSortKey(a.title) }))
  );
  // 年度 で 束ね直す
  const grouped = {};
  for (const a of all) {
    const fy = fiscalYearOf(a);
    (grouped[fy] ||= []).push(a);
  }
  // 順序: 「YYYY年度」 は 数値 降順、 それ以外 (「過去のもの」 「中村研アルバム」 等) は 末尾
  const keys = Object.keys(grouped).sort((a, b) => {
    const na = a.match(/^(\d{4})年度$/), nb = b.match(/^(\d{4})年度$/);
    if (na && nb) return parseInt(nb[1]) - parseInt(na[1]);
    if (na) return -1;
    if (nb) return 1;
    return a.localeCompare(b);
  });
  sections = keys.map(k => ({
    title: k,
    albums: grouped[k].slice().sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || '')),
  }));
}

export async function renderNkmrAlbums() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="card">📸 中村研アルバムを読み込み中…</div>`;
  try {
    await fetchAlbums();
  } catch (e) {
    app.innerHTML = `<div class="card">⚠ 読み込み失敗: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  render();
}

function render() {
  const app = document.getElementById('app');
  const totalAlbums = sections.reduce((n, s) => n + s.albums.length, 0);

  let content = '';
  if (sortMode === 'location') content = renderByLocation();
  else if (sortMode !== 'section') content = renderFlat();
  else content = sections.map(renderSectionCard).join('');

  const editingAlbum = editingId ? sections.flatMap(s => s.albums).find(x => x.id === editingId) : null;

  app.innerHTML = `
    <div class="card">
      <h2 style="margin:0">📸 中村研アルバム</h2>
      <div class="hint-sm" style="margin-top:6px">
        Google Photosで管理してる中村研の写真アルバム (${totalAlbums}件)。
        タイルをタップでGoogle Photosが別タブで開きます。
        サムネ・写真枚数はバックグラウンドで自動取得、追加・編集・削除は誰でも可 (削除は追加した本人のみ)。
      </div>
      <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center">
        <button data-nkm-sort="section"  class="${sortMode==='section' ?'primary':''}" style="font-size:12px; padding:4px 10px">年度別</button>
        <button data-nkm-sort="new"      class="${sortMode==='new'     ?'primary':''}" style="font-size:12px; padding:4px 10px">新しい順</button>
        <button data-nkm-sort="old"      class="${sortMode==='old'     ?'primary':''}" style="font-size:12px; padding:4px 10px">古い順</button>
        <button data-nkm-sort="location" class="${sortMode==='location'?'primary':''}" style="font-size:12px; padding:4px 10px">場所別</button>
        <span style="flex:1"></span>
        <button data-nkm-add class="primary" style="font-size:12px; padding:4px 10px">${showAddForm && !editingAlbum ? '× 閉じる' : '＋ 追加'}</button>
      </div>
      ${sortMode === 'location' ? `
        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap">
          <button data-nkm-locfilter="jp"       class="${locFilter==='jp'      ?'primary':''}" style="font-size:11px; padding:2px 8px">🇯🇵 国内</button>
          <button data-nkm-locfilter="overseas" class="${locFilter==='overseas'?'primary':''}" style="font-size:11px; padding:2px 8px">✈ 国外</button>
        </div>` : ''}
    </div>
    ${showAddForm ? renderAddForm(editingAlbum) : ''}
    ${content}
  `;
  attachHandlers();
  lookupThumbs(collectVisibleUrls());
}

// v970.7 セクション ラベル: データ は カレンダー 年 (1-12月) で 束ねて いる ので、
//   4 桁 数字 なら 「N年」 表示 に (「年度」 だと 4-3 月 の 期待 に なるが 実 データ は
//   カレンダー 年 なので 混乱 する との 中村さん 指摘)。 それ以外 (過去のもの 等) は そのまま。
function sectionLabel(t) {
  return /^\d{4}$/.test(t) ? `${t}年` : t;
}
function renderSectionCard(sec) {
  return `
    <div class="card">
      <div style="display:flex; align-items:center; gap:8px">
        <div class="bold" style="flex:1; font-size:15px">${escapeHtml(sectionLabel(sec.title))}</div>
        <span class="hint-sm">${sec.albums.length} 件</span>
      </div>
      <div class="nkm-tile-grid">${sec.albums.map(renderAlbumTile).join('')}</div>
    </div>`;
}

function renderFlat() {
  const flat = sections.flatMap(s => s.albums);
  flat.sort((a, b) => {
    const ka = a.sortKey || '0000-00-00';
    const kb = b.sortKey || '0000-00-00';
    if (ka === kb) return a.sort_order - b.sort_order;
    return sortMode === 'new' ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
  return `<div class="card"><div class="nkm-tile-grid">${flat.map(renderAlbumTile).join('')}</div></div>`;
}

// v970.3 場所別 の 都道府県 は 北 → 南 の 地理 順、 東京都 は ありふれてる ので 末尾 手前 に、
//   国外 は 件数 順、 場所不明 は 最後 (ユーザ 要望)。
const PREF_ORDER = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県',
  '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  // 「東京都」 は 敢えて 抜いて 末尾 手前 に 配置
];
const PREF_ORDER_INDEX = Object.fromEntries(PREF_ORDER.map((p, i) => [p, i]));

// v970.10 国外 の 並び 順 (東 アジア → 大洋州 → 北米 → 中南米 → ヨーロッパ → その他)
const COUNTRY_ORDER = [
  // 東 アジア
  '韓国', '中国', '香港', '台湾',
  // 東南 アジア
  'タイ', 'ベトナム', 'フィリピン', 'マレーシア', 'シンガポール', 'インドネシア', 'カンボジア', 'ミャンマー',
  // 南 アジア
  'インド',
  // 中東
  'UAE', 'カタール', 'トルコ', 'キプロス',
  // 大洋州
  'オーストラリア', 'ニュージーランド',
  // 北米
  'アメリカ', 'カナダ',
  // 中米 / 南米
  'メキシコ', 'ブラジル', 'ペルー', 'アルゼンチン',
  // ヨーロッパ (北 / 中 / 東 / 南)
  'デンマーク', 'オランダ', 'ドイツ', 'イギリス', 'フランス', 'ポルトガル', 'スペイン', 'ギリシャ', 'イタリア',
  // アフリカ
  'エジプト', '南アフリカ',
];
const COUNTRY_ORDER_INDEX = Object.fromEntries(COUNTRY_ORDER.map((c, i) => [c, i]));

function renderByLocation() {
  const flat = sections.flatMap(s => s.albums);
  const groups = {};
  for (const a of flat) {
    const country = flagToCountry(a.flag);
    if (country) {
      if (locFilter === 'jp') continue;
      // v970.12 flag 由来 の 主 目的地 + タイトル / 場所 内 の 副 目的地 (経由 地) も 追加。
      // v970.13 括弧 内 の 名前 リスト は 除外 (scanTargetsFor 経由)
      const countries = new Set([country]);
      const searchText = scanTargetsFor(a).join(' ');
      for (const [kw, c] of Object.entries(COUNTRY_MAP)) {
        if (searchText.indexOf(kw) >= 0) countries.add(c);
      }
      for (const c of countries) (groups[`✈ ${c}`] ||= []).push(a);
    } else {
      if (locFilter === 'overseas') continue;
      // 複数 都道府県 に またがる アルバム は 各 都道府県 の セクション に 登場 させる
      for (const pref of guessPrefectures(a)) {
        (groups[pref] ||= []).push(a);
      }
    }
  }
  // カテゴリ: 0=都道府県 (北→南)、 1=東京都 (ありふれてる ので 末尾 手前)、 2=国外。
  //   guessPrefecture が 何 に も 該当 しない 時 は 「東京都」 を 返す (中村さん 「それ以外 は 全部 東京」)。
  const catOf = (k) => {
    if (k === '東京都')     return 1;
    if (k.startsWith('✈ ')) return 2;
    return 0;
  };
  const keys = Object.keys(groups).sort((a, b) => {
    const ca = catOf(a), cb = catOf(b);
    if (ca !== cb) return ca - cb;
    if (ca === 0) {
      const ia = PREF_ORDER_INDEX[a] ?? 999;
      const ib = PREF_ORDER_INDEX[b] ?? 999;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    }
    if (ca === 2) {
      // v970.10 国外 は 大陸 順 に (日本 から 近い 順 に 東 → 西 → 遠隔)
      const ra = COUNTRY_ORDER_INDEX[a.replace(/^✈\s+/, '')] ?? 999;
      const rb = COUNTRY_ORDER_INDEX[b.replace(/^✈\s+/, '')] ?? 999;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    }
    return 0;
  });
  // v970.10 国内 モード (all / jp) で は 上部 に 日本 白地図 (choropleth) を 出す。
  //   都道府県 別 の アルバム 数 で 色分け、 タップ で 該当 セクション に スクロール。
  let mapBlock = '';
  if (locFilter !== 'overseas') {
    const prefCounts = {};
    for (const [k, arr] of Object.entries(groups)) {
      if (PREF_TO_JIS[k]) prefCounts[k] = arr.length;
    }
    mapBlock = renderJpChoropleth(prefCounts);
  }
  const cards = keys.map(k => {
    const arr = groups[k].slice().sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''));
    const anchor = PREF_TO_JIS[k] ? ` data-nkm-anchor="${PREF_TO_JIS[k]}"` : '';
    return `
      <div class="card"${anchor}>
        <div style="display:flex; align-items:center; gap:8px">
          <div class="bold" style="flex:1; font-size:14px">${escapeHtml(k)}</div>
          <span class="hint-sm">${arr.length} 件</span>
        </div>
        <div class="nkm-tile-grid">${arr.map(renderAlbumTile).join('')}</div>
      </div>`;
  }).join('');
  return mapBlock + cards;
}

// v970.10 都道府県 別 アルバム 数 を 色分け した 日本 地図 (Geolonia の SVG を 使い回し)。
//   色 スケール (アルバム 数): 0=薄グレー、 1-2=薄紫、 3-5=紫、 6-10=濃紫、 11+=最濃紫
function renderJpChoropleth(prefCounts) {
  if (!cachedJpSvg) {
    // 初回 は 非同期 fetch し、 完了 後 に 再 render (place-holder を 返す)
    ensureJpSvgAsync();
    return `<div class="card" id="nkm-jp-map-placeholder" style="text-align:center; color:#9ca3af; padding:20px">🗾 日本地図を読み込み中…</div>`;
  }
  const svg = cachedJpSvg.cloneNode(true);
  svg.removeAttribute('class');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('style', 'display:block; width:100%; max-width:560px; margin:0 auto');

  const maxCount = Math.max(...Object.values(prefCounts), 1);
  const colorFor = (n) => {
    if (!n) return '#f3f4f6';
    if (n <= 2)  return '#ede4f3';
    if (n <= 5)  return '#c4a3d6';
    if (n <= 10) return '#7b3fa0';
    return '#4a106d';
  };
  svg.querySelectorAll('g.prefecture').forEach(g => {
    const code = parseInt(g.getAttribute('data-code') || '0', 10);
    const prefName = Object.keys(PREF_TO_JIS).find(k => PREF_TO_JIS[k] === code) || '';
    const n = prefCounts[prefName] || 0;
    g.setAttribute('fill', colorFor(n));
    g.setAttribute('stroke', n ? '#4a106d' : '#c0c0c0');
    g.setAttribute('stroke-width', n ? '1' : '0.6');
    g.style.cursor = n ? 'pointer' : 'default';
    if (n) {
      g.classList.add('nkm-map-cell');
      g.setAttribute('data-nkm-map-code', String(code));
      g.setAttribute('data-nkm-map-count', String(n));
    }
    // tooltip
    const title = g.querySelector('title');
    if (title) title.textContent = prefName ? `${prefName} — ${n}件` : title.textContent;
  });

  const legendItems = [
    ['#f3f4f6', '0'],
    ['#ede4f3', '1-2'],
    ['#c4a3d6', '3-5'],
    ['#7b3fa0', '6-10'],
    ['#4a106d', '11+'],
  ];
  return `
    <div class="card" style="padding:10px; background:linear-gradient(180deg, #bee5fb 0%, #e8f4fd 100%)">
      <div class="hint-sm" style="text-align:center; margin-bottom:4px; color:#1d4ed8">
        🗾 都道府県別アルバム分布 (最大 ${maxCount} 件) — タップで一覧にスクロール
      </div>
      ${svg.outerHTML}
      <div style="display:flex; gap:6px; justify-content:center; margin-top:6px; font-size:10.5px; color:#374151">
        ${legendItems.map(([c, l]) => `
          <span style="display:inline-flex; align-items:center; gap:3px">
            <span style="width:12px; height:12px; background:${c}; border:1px solid #6b7280; display:inline-block"></span>${l}
          </span>`).join('')}
      </div>
    </div>`;
}

let jpSvgFetching = false;
async function ensureJpSvgAsync() {
  if (cachedJpSvg || jpSvgFetching) return;
  jpSvgFetching = true;
  try {
    const r = await fetch('/img/jp-prefectures.svg', { cache: 'force-cache' });
    if (!r.ok) return;
    const text = await r.text();
    const wrap = document.createElement('div');
    wrap.innerHTML = text;
    cachedJpSvg = wrap.querySelector('svg');
    // 再 render (map placeholder を 差し替え)
    if (typeof render === 'function') render();
  } catch (_) {}
  jpSvgFetching = false;
}

function renderAlbumTile(a) {
  const thumbUrl = thumbCache[a.url];
  const count    = countCache[a.url];
  const isOwner  = state.me?.id && Number(a.created_by) === Number(state.me.id);
  const isAdmin  = state.me?.role === 'admin';
  const canEdit  = isOwner || isAdmin;

  const thumbNode = thumbUrl
    ? `<img src="${escapeHtml(thumbUrl)}" loading="lazy" class="nkm-thumb"
            style="width:100%; aspect-ratio: 4/3; object-fit:cover; background:#f3f4f6; display:block">`
    : `<div class="nkm-thumb" style="width:100%; aspect-ratio: 4/3; background:#f3f4f6; display:flex;
             align-items:center; justify-content:center; color:#9ca3af; font-size:26px">📷</div>`;
  // v970.6 fb#479: Google Photos の 初期 HTML は ~300 枚 で 頭打ち に なる (lazy load 上限)。
  //   実 count が それ 以上 の アルバム は 「300+」 と 表示 して 誤解 を 防ぐ。
  const countBadge = (typeof count === 'number' && count > 0)
    ? `<span style="background:rgba(0,0,0,0.55); color:#fff; font-size:10px; padding:2px 6px;
                    border-radius:8px; position:absolute; right:6px; bottom:6px">📷 ${count >= 298 ? '300+' : count}</span>`
    : '';
  const flagChip = a.flag
    ? `<span style="position:absolute; left:6px; top:6px; font-size:14px;
                    background:rgba(0,0,0,0.4); border-radius:4px; padding:0 4px">${escapeHtml(a.flag)}</span>`
    : '';
  const menu = canEdit ? `
    <button data-nkm-edit="${a.id}" title="編集"
            style="position:absolute; right:6px; top:6px; background:rgba(0,0,0,0.5); color:#fff;
                   border:0; border-radius:4px; padding:2px 6px; font-size:11px; cursor:pointer">⋯</button>` : '';
  return `
    <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"
       data-nkm-url="${escapeHtml(a.url)}" class="nkm-tile"
       style="display:block; text-decoration:none; color:inherit; border-radius:6px; overflow:hidden;
              background:#fff; border:1px solid #e5e7eb; position:relative">
      <div style="position:relative">${thumbNode}${flagChip}${countBadge}${menu}</div>
      <div style="padding:6px 8px 8px; font-size:12px; line-height:1.35; color:#374151;
                  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden">
        ${escapeHtml(a.title)}
      </div>
    </a>`;
}

function renderAddForm(editingAlbum = null) {
  const secs = sections.map(s => s.title).filter(t => /^\d{4}$/.test(t));
  const defaultSec = editingAlbum?.section
                  || (secs[0] || String(new Date().getFullYear()));
  const suggest = secs.filter(t => t !== defaultSec).slice(0, 4);
  const a = editingAlbum || {};
  return `
    <div class="card" style="background:#f9fafb; border:1px solid #ede4f3">
      <div class="bold" style="margin-bottom:8px">${editingAlbum ? '✏ 編集' : '➕ 新規追加'}</div>
      <div style="display:grid; gap:8px">
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:80px; color:#6b7280">セクション</span>
          <input id="nkm-form-section" type="text" value="${escapeHtml(a.section || defaultSec)}"
                 placeholder="2026等" style="flex:1; padding:4px 6px" maxlength="60">
        </label>
        ${suggest.length ? `<div style="margin-left:86px; font-size:11px; color:#6b7280">
          候補: ${suggest.map(t => `<button data-nkm-sec-suggest="${escapeHtml(t)}" style="font-size:11px; padding:1px 6px; margin:0 2px">${escapeHtml(t)}</button>`).join('')}
        </div>` : ''}
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:80px; color:#6b7280">タイトル</span>
          <input id="nkm-form-title" type="text" value="${escapeHtml(a.title || '')}"
                 placeholder="YYYY.MM.DD 内容 (例: 2026.07.08 伊藤研合同研究会)"
                 style="flex:1; padding:4px 6px" maxlength="200">
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:80px; color:#6b7280">URL</span>
          <input id="nkm-form-url" type="url" value="${escapeHtml(a.url || '')}"
                 placeholder="https://photos.app.goo.gl/..." style="flex:1; padding:4px 6px" maxlength="500">
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:80px; color:#6b7280">場所</span>
          <input id="nkm-form-location" type="text" value="${escapeHtml(a.location || '')}"
                 placeholder="沖縄・京都・イタリア等 (省略可)" style="flex:1; padding:4px 6px" maxlength="80">
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:12px">
          <span style="width:80px; color:#6b7280">国旗</span>
          <input id="nkm-form-flag" type="text" value="${escapeHtml(a.flag || '')}"
                 placeholder="🇮🇹等 (海外のみ)" style="flex:1; padding:4px 6px" maxlength="20">
        </label>
      </div>
      <div style="margin-top:10px; display:flex; gap:6px">
        <button id="nkm-form-save" class="primary" style="padding:5px 14px">${editingAlbum ? '保存' : '追加'}</button>
        <button id="nkm-form-cancel" style="padding:5px 14px">キャンセル</button>
        ${editingAlbum ? `<span style="flex:1"></span>
          <button id="nkm-form-delete" style="padding:5px 14px; color:#b91c1c">🗑 削除</button>` : ''}
      </div>
    </div>`;
}

let editingId = null;
function attachHandlers() {
  const app = document.getElementById('app');
  app.querySelectorAll('[data-nkm-sort]').forEach(b => {
    b.addEventListener('click', () => { sortMode = b.dataset.nkmSort; render(); });
  });
  app.querySelectorAll('[data-nkm-locfilter]').forEach(b => {
    b.addEventListener('click', () => { locFilter = b.dataset.nkmLocfilter; render(); });
  });
  // v970.10 choropleth 地図 の 都道府県 タップ で 該当 セクション に スクロール
  app.querySelectorAll('.nkm-map-cell').forEach(g => {
    g.addEventListener('click', (ev) => {
      ev.preventDefault();
      const code = g.getAttribute('data-nkm-map-code');
      const target = app.querySelector(`[data-nkm-anchor="${code}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  const addBtn = app.querySelector('[data-nkm-add]');
  if (addBtn) addBtn.addEventListener('click', () => {
    editingId = null; showAddForm = !showAddForm; render();
  });
  app.querySelectorAll('[data-nkm-edit]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      editingId = Number(b.dataset.nkmEdit);
      showAddForm = true;
      render();
    });
  });
  app.querySelectorAll('[data-nkm-sec-suggest]').forEach(b => {
    b.addEventListener('click', () => {
      const inp = document.getElementById('nkm-form-section');
      if (inp) inp.value = b.dataset.nkmSecSuggest;
    });
  });
  const saveBtn = app.querySelector('#nkm-form-save');
  if (saveBtn) saveBtn.addEventListener('click', () => submitForm(editingId));
  const cancelBtn = app.querySelector('#nkm-form-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { showAddForm = false; editingId = null; render(); });
  const delBtn = app.querySelector('#nkm-form-delete');
  if (delBtn) delBtn.addEventListener('click', () => submitDelete(editingId));

}

async function submitForm(id) {
  const body = {
    section : document.getElementById('nkm-form-section').value.trim(),
    title   : document.getElementById('nkm-form-title').value.trim(),
    url     : document.getElementById('nkm-form-url').value.trim(),
    location: document.getElementById('nkm-form-location').value.trim(),
    flag    : document.getElementById('nkm-form-flag').value.trim(),
  };
  if (!body.section || !body.title || !body.url) {
    alert('セクション・タイトル・URLは必須です');
    return;
  }
  try {
    if (id) {
      await patch('/api/nkmr-albums/' + id, body);
    } else {
      await post('/api/nkmr-albums', body);
    }
    editingId = null; showAddForm = false;
    await fetchAlbums();
    render();
  } catch (e) {
    alert('保存失敗: ' + (e.message || String(e)));
  }
}

async function submitDelete(id) {
  if (!id) return;
  if (!confirm('このアルバム登録を削除しますか？\n(Google Photos側は影響なし、一覧から消えるだけ)')) return;
  try {
    await del('/api/nkmr-albums/' + id);
    editingId = null; showAddForm = false;
    await fetchAlbums();
    render();
  } catch (e) {
    alert('削除失敗: ' + (e.message || String(e)));
  }
}

function collectVisibleUrls() {
  return Array.from(document.querySelectorAll('[data-nkm-url]')).map(a => a.dataset.nkmUrl);
}

let lookupInProgress = false;
async function lookupThumbs(urls) {
  if (lookupInProgress) return;
  const needAsk = urls.filter(u => thumbCache[u] === undefined || countCache[u] === undefined);
  if (!needAsk.length) return;
  lookupInProgress = true;
  try {
    // v970.4 上限 を 300 → 1000 に (DB 素引き なので 一括 で 安全)。
    const r = await post('/api/album-thumbs', { urls: needAsk.slice(0, 1000) });
    const thumbs = r.thumbs || {};
    const counts = r.counts || {};
    for (const u of needAsk) {
      thumbCache[u] = (u in thumbs) ? thumbs[u] : null;
      countCache[u] = (u in counts) ? counts[u] : null;
    }
    applyThumbToDom();
  } catch (_) { /* silent */ }
  lookupInProgress = false;
}

function applyThumbToDom() {
  document.querySelectorAll('[data-nkm-url]').forEach(a => {
    const url = a.dataset.nkmUrl;
    const t = thumbCache[url];
    if (t) {
      const cur = a.querySelector('img.nkm-thumb');
      if (!cur) {
        const wrap = a.querySelector('div[style*="position:relative"]');
        const oldPh = wrap?.querySelector('div.nkm-thumb');
        if (wrap && oldPh) {
          const img = document.createElement('img');
          img.src = t;
          img.loading = 'lazy';
          img.className = 'nkm-thumb';
          img.style.cssText = 'width:100%; aspect-ratio: 4/3; object-fit:cover; background:#f3f4f6; display:block';
          wrap.replaceChild(img, oldPh);
        }
      }
    }
    const c = countCache[url];
    if (typeof c === 'number' && c > 0) {
      const wrap = a.querySelector('div[style*="position:relative"]');
      if (wrap && !wrap.querySelector('[data-nkm-count]')) {
        const badge = document.createElement('span');
        badge.dataset.nkmCount = '1';
        badge.textContent = `📷 ${c}`;
        badge.style.cssText = 'background:rgba(0,0,0,0.55); color:#fff; font-size:10px; padding:2px 6px; border-radius:8px; position:absolute; right:6px; bottom:6px';
        wrap.appendChild(badge);
      }
    }
  });
}

// タイル グリッド CSS を 一度 だけ 差し込む
if (typeof document !== 'undefined' && !document.getElementById('nkm-tile-grid-style')) {
  const s = document.createElement('style');
  s.id = 'nkm-tile-grid-style';
  s.textContent = `
    .nkm-tile-grid { margin-top:8px; display:grid;
                     grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                     gap:10px; }
    @media (max-width: 480px) {
      .nkm-tile-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:8px; }
    }
    .nkm-tile:active { transform: scale(0.98); }
  `;
  document.head.appendChild(s);
}
