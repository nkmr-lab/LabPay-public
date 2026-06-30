// v531 #163 47 都道府県 (ISO 3166-2:JP) と主要国 (ISO 3166-1 alpha-2 ~ 100 選別)。
//   国は「制覇したい」系でよく行く / 行きたい先を中心に 100 強。必要に応じて追加。

// v536 #192 日本地図風グリッド配置 (col, row, code)。 14列 x 16行。
//   各 prefecture の地理的位置をできるだけ近似 (完全な国土図ではなくスタイライズ)。
export const JP_MAP_LAYOUT = [
  // 北海道
  [10, 0, 'JP-01'],
  // 東北
  [10, 3, 'JP-02'], // 青森
  [9,  4, 'JP-05'], // 秋田
  [10, 4, 'JP-03'], // 岩手
  [9,  5, 'JP-06'], // 山形
  [10, 5, 'JP-04'], // 宮城
  [10, 6, 'JP-07'], // 福島
  // 関東
  [11, 6, 'JP-08'], // 茨城
  [10, 7, 'JP-09'], // 栃木
  [9,  7, 'JP-10'], // 群馬
  [10, 8, 'JP-11'], // 埼玉
  [11, 7, 'JP-12'], // 千葉
  [10, 9, 'JP-13'], // 東京
  [10,10, 'JP-14'], // 神奈川
  // 中部
  [9,  6, 'JP-15'], // 新潟
  [8,  7, 'JP-16'], // 富山
  [7,  7, 'JP-17'], // 石川
  [7,  8, 'JP-18'], // 福井
  [9,  9, 'JP-19'], // 山梨
  [8,  8, 'JP-20'], // 長野
  [8,  9, 'JP-21'], // 岐阜
  [9, 10, 'JP-22'], // 静岡
  [8, 10, 'JP-23'], // 愛知
  // 近畿
  [7,  9, 'JP-24'], // 三重
  [7, 10, 'JP-25'], // 滋賀
  [6,  9, 'JP-26'], // 京都
  [6, 10, 'JP-27'], // 大阪
  [5, 10, 'JP-28'], // 兵庫
  [6, 11, 'JP-29'], // 奈良
  [7, 11, 'JP-30'], // 和歌山
  // 中国
  [4, 10, 'JP-31'], // 鳥取
  [3, 10, 'JP-32'], // 島根
  [4, 11, 'JP-33'], // 岡山
  [3, 11, 'JP-34'], // 広島
  [2, 11, 'JP-35'], // 山口
  // 四国
  [5, 11, 'JP-36'], // 徳島
  [4, 12, 'JP-37'], // 香川
  [3, 12, 'JP-38'], // 愛媛
  [4, 13, 'JP-39'], // 高知
  // 九州
  [2, 12, 'JP-40'], // 福岡
  [1, 12, 'JP-41'], // 佐賀
  [0, 12, 'JP-42'], // 長崎
  [1, 13, 'JP-43'], // 熊本
  [2, 13, 'JP-44'], // 大分
  [1, 14, 'JP-45'], // 宮崎
  [0, 14, 'JP-46'], // 鹿児島
  // 沖縄
  [0, 15, 'JP-47'],
];

export const PREFECTURES = [
  { code: 'JP-01', name: '北海道',  region: '北海道' },
  { code: 'JP-02', name: '青森県',  region: '東北' },
  { code: 'JP-03', name: '岩手県',  region: '東北' },
  { code: 'JP-04', name: '宮城県',  region: '東北' },
  { code: 'JP-05', name: '秋田県',  region: '東北' },
  { code: 'JP-06', name: '山形県',  region: '東北' },
  { code: 'JP-07', name: '福島県',  region: '東北' },
  { code: 'JP-08', name: '茨城県',  region: '関東' },
  { code: 'JP-09', name: '栃木県',  region: '関東' },
  { code: 'JP-10', name: '群馬県',  region: '関東' },
  { code: 'JP-11', name: '埼玉県',  region: '関東' },
  { code: 'JP-12', name: '千葉県',  region: '関東' },
  { code: 'JP-13', name: '東京都',  region: '関東' },
  { code: 'JP-14', name: '神奈川県', region: '関東' },
  { code: 'JP-15', name: '新潟県',  region: '中部' },
  { code: 'JP-16', name: '富山県',  region: '中部' },
  { code: 'JP-17', name: '石川県',  region: '中部' },
  { code: 'JP-18', name: '福井県',  region: '中部' },
  { code: 'JP-19', name: '山梨県',  region: '中部' },
  { code: 'JP-20', name: '長野県',  region: '中部' },
  { code: 'JP-21', name: '岐阜県',  region: '中部' },
  { code: 'JP-22', name: '静岡県',  region: '中部' },
  { code: 'JP-23', name: '愛知県',  region: '中部' },
  { code: 'JP-24', name: '三重県',  region: '近畿' },
  { code: 'JP-25', name: '滋賀県',  region: '近畿' },
  { code: 'JP-26', name: '京都府',  region: '近畿' },
  { code: 'JP-27', name: '大阪府',  region: '近畿' },
  { code: 'JP-28', name: '兵庫県',  region: '近畿' },
  { code: 'JP-29', name: '奈良県',  region: '近畿' },
  { code: 'JP-30', name: '和歌山県', region: '近畿' },
  { code: 'JP-31', name: '鳥取県',  region: '中国' },
  { code: 'JP-32', name: '島根県',  region: '中国' },
  { code: 'JP-33', name: '岡山県',  region: '中国' },
  { code: 'JP-34', name: '広島県',  region: '中国' },
  { code: 'JP-35', name: '山口県',  region: '中国' },
  { code: 'JP-36', name: '徳島県',  region: '四国' },
  { code: 'JP-37', name: '香川県',  region: '四国' },
  { code: 'JP-38', name: '愛媛県',  region: '四国' },
  { code: 'JP-39', name: '高知県',  region: '四国' },
  { code: 'JP-40', name: '福岡県',  region: '九州' },
  { code: 'JP-41', name: '佐賀県',  region: '九州' },
  { code: 'JP-42', name: '長崎県',  region: '九州' },
  { code: 'JP-43', name: '熊本県',  region: '九州' },
  { code: 'JP-44', name: '大分県',  region: '九州' },
  { code: 'JP-45', name: '宮崎県',  region: '九州' },
  { code: 'JP-46', name: '鹿児島県', region: '九州' },
  { code: 'JP-47', name: '沖縄県',  region: '九州' },
];

// v579 国数を 105 → 200 に拡張。 UN 加盟 193 国 + 主要地域 (台湾 / 香港 / マカオ /
//   プエルトリコ / パレスチナ / バチカン等)。 ISO 3166-1 alpha-2 コードベース。
export const COUNTRIES = [
  // アジア (東・東南・南・中央・西アジア、コーカサス)
  { code: 'JP', flag: '🇯🇵', name: '日本',         region: 'アジア' },
  { code: 'KR', flag: '🇰🇷', name: '韓国',         region: 'アジア' },
  { code: 'KP', flag: '🇰🇵', name: '北朝鮮',       region: 'アジア' },
  { code: 'CN', flag: '🇨🇳', name: '中国',         region: 'アジア' },
  { code: 'TW', flag: '🇹🇼', name: '台湾',         region: 'アジア' },
  { code: 'HK', flag: '🇭🇰', name: '香港',         region: 'アジア' },
  { code: 'MO', flag: '🇲🇴', name: 'マカオ',       region: 'アジア' },
  { code: 'MN', flag: '🇲🇳', name: 'モンゴル',     region: 'アジア' },
  { code: 'TH', flag: '🇹🇭', name: 'タイ',         region: 'アジア' },
  { code: 'VN', flag: '🇻🇳', name: 'ベトナム',     region: 'アジア' },
  { code: 'KH', flag: '🇰🇭', name: 'カンボジア',   region: 'アジア' },
  { code: 'LA', flag: '🇱🇦', name: 'ラオス',       region: 'アジア' },
  { code: 'MM', flag: '🇲🇲', name: 'ミャンマー',   region: 'アジア' },
  { code: 'MY', flag: '🇲🇾', name: 'マレーシア',   region: 'アジア' },
  { code: 'SG', flag: '🇸🇬', name: 'シンガポール', region: 'アジア' },
  { code: 'ID', flag: '🇮🇩', name: 'インドネシア', region: 'アジア' },
  { code: 'PH', flag: '🇵🇭', name: 'フィリピン',   region: 'アジア' },
  { code: 'BN', flag: '🇧🇳', name: 'ブルネイ',     region: 'アジア' },
  { code: 'TL', flag: '🇹🇱', name: '東ティモール', region: 'アジア' },
  { code: 'IN', flag: '🇮🇳', name: 'インド',       region: 'アジア' },
  { code: 'BD', flag: '🇧🇩', name: 'バングラデシュ', region: 'アジア' },
  { code: 'PK', flag: '🇵🇰', name: 'パキスタン',   region: 'アジア' },
  { code: 'LK', flag: '🇱🇰', name: 'スリランカ',   region: 'アジア' },
  { code: 'NP', flag: '🇳🇵', name: 'ネパール',     region: 'アジア' },
  { code: 'BT', flag: '🇧🇹', name: 'ブータン',     region: 'アジア' },
  { code: 'MV', flag: '🇲🇻', name: 'モルディブ',   region: 'アジア' },
  { code: 'AF', flag: '🇦🇫', name: 'アフガニスタン', region: 'アジア' },
  { code: 'KZ', flag: '🇰🇿', name: 'カザフスタン', region: 'アジア' },
  { code: 'UZ', flag: '🇺🇿', name: 'ウズベキスタン', region: 'アジア' },
  { code: 'KG', flag: '🇰🇬', name: 'キルギス',     region: 'アジア' },
  { code: 'TJ', flag: '🇹🇯', name: 'タジキスタン', region: 'アジア' },
  { code: 'TM', flag: '🇹🇲', name: 'トルクメニスタン', region: 'アジア' },
  { code: 'AE', flag: '🇦🇪', name: 'アラブ首長国連邦', region: 'アジア' },
  { code: 'SA', flag: '🇸🇦', name: 'サウジアラビア', region: 'アジア' },
  { code: 'IL', flag: '🇮🇱', name: 'イスラエル',   region: 'アジア' },
  { code: 'PS', flag: '🇵🇸', name: 'パレスチナ',   region: 'アジア' },
  { code: 'TR', flag: '🇹🇷', name: 'トルコ',       region: 'アジア' },
  { code: 'QA', flag: '🇶🇦', name: 'カタール',     region: 'アジア' },
  { code: 'IR', flag: '🇮🇷', name: 'イラン',       region: 'アジア' },
  { code: 'IQ', flag: '🇮🇶', name: 'イラク',       region: 'アジア' },
  { code: 'SY', flag: '🇸🇾', name: 'シリア',       region: 'アジア' },
  { code: 'JO', flag: '🇯🇴', name: 'ヨルダン',     region: 'アジア' },
  { code: 'LB', flag: '🇱🇧', name: 'レバノン',     region: 'アジア' },
  { code: 'KW', flag: '🇰🇼', name: 'クウェート',   region: 'アジア' },
  { code: 'BH', flag: '🇧🇭', name: 'バーレーン',   region: 'アジア' },
  { code: 'OM', flag: '🇴🇲', name: 'オマーン',     region: 'アジア' },
  { code: 'YE', flag: '🇾🇪', name: 'イエメン',     region: 'アジア' },
  { code: 'AM', flag: '🇦🇲', name: 'アルメニア',   region: 'アジア' },
  { code: 'AZ', flag: '🇦🇿', name: 'アゼルバイジャン', region: 'アジア' },
  { code: 'GE', flag: '🇬🇪', name: 'ジョージア',   region: 'アジア' },
  // ヨーロッパ
  { code: 'GB', flag: '🇬🇧', name: 'イギリス',     region: 'ヨーロッパ' },
  { code: 'IE', flag: '🇮🇪', name: 'アイルランド', region: 'ヨーロッパ' },
  { code: 'FR', flag: '🇫🇷', name: 'フランス',     region: 'ヨーロッパ' },
  { code: 'DE', flag: '🇩🇪', name: 'ドイツ',       region: 'ヨーロッパ' },
  { code: 'IT', flag: '🇮🇹', name: 'イタリア',     region: 'ヨーロッパ' },
  { code: 'ES', flag: '🇪🇸', name: 'スペイン',     region: 'ヨーロッパ' },
  { code: 'PT', flag: '🇵🇹', name: 'ポルトガル',   region: 'ヨーロッパ' },
  { code: 'NL', flag: '🇳🇱', name: 'オランダ',     region: 'ヨーロッパ' },
  { code: 'BE', flag: '🇧🇪', name: 'ベルギー',     region: 'ヨーロッパ' },
  { code: 'CH', flag: '🇨🇭', name: 'スイス',       region: 'ヨーロッパ' },
  { code: 'AT', flag: '🇦🇹', name: 'オーストリア', region: 'ヨーロッパ' },
  { code: 'LU', flag: '🇱🇺', name: 'ルクセンブルク', region: 'ヨーロッパ' },
  { code: 'LI', flag: '🇱🇮', name: 'リヒテンシュタイン', region: 'ヨーロッパ' },
  { code: 'GR', flag: '🇬🇷', name: 'ギリシャ',     region: 'ヨーロッパ' },
  { code: 'CY', flag: '🇨🇾', name: 'キプロス',     region: 'ヨーロッパ' },
  { code: 'PL', flag: '🇵🇱', name: 'ポーランド',   region: 'ヨーロッパ' },
  { code: 'CZ', flag: '🇨🇿', name: 'チェコ',       region: 'ヨーロッパ' },
  { code: 'SK', flag: '🇸🇰', name: 'スロバキア',   region: 'ヨーロッパ' },
  { code: 'HU', flag: '🇭🇺', name: 'ハンガリー',   region: 'ヨーロッパ' },
  { code: 'RO', flag: '🇷🇴', name: 'ルーマニア',   region: 'ヨーロッパ' },
  { code: 'BG', flag: '🇧🇬', name: 'ブルガリア',   region: 'ヨーロッパ' },
  { code: 'HR', flag: '🇭🇷', name: 'クロアチア',   region: 'ヨーロッパ' },
  { code: 'SI', flag: '🇸🇮', name: 'スロベニア',   region: 'ヨーロッパ' },
  { code: 'RS', flag: '🇷🇸', name: 'セルビア',     region: 'ヨーロッパ' },
  { code: 'BA', flag: '🇧🇦', name: 'ボスニア・ヘルツェゴビナ', region: 'ヨーロッパ' },
  { code: 'ME', flag: '🇲🇪', name: 'モンテネグロ', region: 'ヨーロッパ' },
  { code: 'MK', flag: '🇲🇰', name: '北マケドニア', region: 'ヨーロッパ' },
  { code: 'AL', flag: '🇦🇱', name: 'アルバニア',   region: 'ヨーロッパ' },
  { code: 'NO', flag: '🇳🇴', name: 'ノルウェー',   region: 'ヨーロッパ' },
  { code: 'SE', flag: '🇸🇪', name: 'スウェーデン', region: 'ヨーロッパ' },
  { code: 'FI', flag: '🇫🇮', name: 'フィンランド', region: 'ヨーロッパ' },
  { code: 'DK', flag: '🇩🇰', name: 'デンマーク',   region: 'ヨーロッパ' },
  { code: 'IS', flag: '🇮🇸', name: 'アイスランド', region: 'ヨーロッパ' },
  { code: 'EE', flag: '🇪🇪', name: 'エストニア',   region: 'ヨーロッパ' },
  { code: 'LV', flag: '🇱🇻', name: 'ラトビア',     region: 'ヨーロッパ' },
  { code: 'LT', flag: '🇱🇹', name: 'リトアニア',   region: 'ヨーロッパ' },
  { code: 'BY', flag: '🇧🇾', name: 'ベラルーシ',   region: 'ヨーロッパ' },
  { code: 'UA', flag: '🇺🇦', name: 'ウクライナ',   region: 'ヨーロッパ' },
  { code: 'MD', flag: '🇲🇩', name: 'モルドバ',     region: 'ヨーロッパ' },
  { code: 'RU', flag: '🇷🇺', name: 'ロシア',       region: 'ヨーロッパ' },
  { code: 'MT', flag: '🇲🇹', name: 'マルタ',       region: 'ヨーロッパ' },
  { code: 'MC', flag: '🇲🇨', name: 'モナコ',       region: 'ヨーロッパ' },
  { code: 'VA', flag: '🇻🇦', name: 'バチカン',     region: 'ヨーロッパ' },
  { code: 'SM', flag: '🇸🇲', name: 'サンマリノ',   region: 'ヨーロッパ' },
  { code: 'AD', flag: '🇦🇩', name: 'アンドラ',     region: 'ヨーロッパ' },
  // 北米
  { code: 'US', flag: '🇺🇸', name: 'アメリカ',     region: '北米' },
  { code: 'CA', flag: '🇨🇦', name: 'カナダ',       region: '北米' },
  { code: 'MX', flag: '🇲🇽', name: 'メキシコ',     region: '北米' },
  // 中米・カリブ
  { code: 'GT', flag: '🇬🇹', name: 'グアテマラ',   region: '中米・カリブ' },
  { code: 'BZ', flag: '🇧🇿', name: 'ベリーズ',     region: '中米・カリブ' },
  { code: 'SV', flag: '🇸🇻', name: 'エルサルバドル', region: '中米・カリブ' },
  { code: 'HN', flag: '🇭🇳', name: 'ホンジュラス', region: '中米・カリブ' },
  { code: 'NI', flag: '🇳🇮', name: 'ニカラグア',   region: '中米・カリブ' },
  { code: 'CR', flag: '🇨🇷', name: 'コスタリカ',   region: '中米・カリブ' },
  { code: 'PA', flag: '🇵🇦', name: 'パナマ',       region: '中米・カリブ' },
  { code: 'CU', flag: '🇨🇺', name: 'キューバ',     region: '中米・カリブ' },
  { code: 'JM', flag: '🇯🇲', name: 'ジャマイカ',   region: '中米・カリブ' },
  { code: 'HT', flag: '🇭🇹', name: 'ハイチ',       region: '中米・カリブ' },
  { code: 'DO', flag: '🇩🇴', name: 'ドミニカ共和国', region: '中米・カリブ' },
  { code: 'PR', flag: '🇵🇷', name: 'プエルトリコ', region: '中米・カリブ' },
  { code: 'BS', flag: '🇧🇸', name: 'バハマ',       region: '中米・カリブ' },
  { code: 'BB', flag: '🇧🇧', name: 'バルバドス',   region: '中米・カリブ' },
  { code: 'TT', flag: '🇹🇹', name: 'トリニダード・トバゴ', region: '中米・カリブ' },
  { code: 'AG', flag: '🇦🇬', name: 'アンティグア・バーブーダ', region: '中米・カリブ' },
  { code: 'DM', flag: '🇩🇲', name: 'ドミニカ国',   region: '中米・カリブ' },
  { code: 'GD', flag: '🇬🇩', name: 'グレナダ',     region: '中米・カリブ' },
  { code: 'KN', flag: '🇰🇳', name: 'セントクリストファー・ネイビス', region: '中米・カリブ' },
  { code: 'LC', flag: '🇱🇨', name: 'セントルシア', region: '中米・カリブ' },
  { code: 'VC', flag: '🇻🇨', name: 'セントビンセント・グレナディーン', region: '中米・カリブ' },
  { code: 'AW', flag: '🇦🇼', name: 'アルバ',       region: '中米・カリブ' },
  { code: 'CW', flag: '🇨🇼', name: 'キュラソー',   region: '中米・カリブ' },
  // 南米
  { code: 'BR', flag: '🇧🇷', name: 'ブラジル',     region: '南米' },
  { code: 'AR', flag: '🇦🇷', name: 'アルゼンチン', region: '南米' },
  { code: 'CL', flag: '🇨🇱', name: 'チリ',         region: '南米' },
  { code: 'PE', flag: '🇵🇪', name: 'ペルー',       region: '南米' },
  { code: 'CO', flag: '🇨🇴', name: 'コロンビア',   region: '南米' },
  { code: 'VE', flag: '🇻🇪', name: 'ベネズエラ',   region: '南米' },
  { code: 'EC', flag: '🇪🇨', name: 'エクアドル',   region: '南米' },
  { code: 'BO', flag: '🇧🇴', name: 'ボリビア',     region: '南米' },
  { code: 'UY', flag: '🇺🇾', name: 'ウルグアイ',   region: '南米' },
  { code: 'PY', flag: '🇵🇾', name: 'パラグアイ',   region: '南米' },
  { code: 'GY', flag: '🇬🇾', name: 'ガイアナ',     region: '南米' },
  { code: 'SR', flag: '🇸🇷', name: 'スリナム',     region: '南米' },
  // オセアニア
  { code: 'AU', flag: '🇦🇺', name: 'オーストラリア', region: 'オセアニア' },
  { code: 'NZ', flag: '🇳🇿', name: 'ニュージーランド', region: 'オセアニア' },
  { code: 'PG', flag: '🇵🇬', name: 'パプアニューギニア', region: 'オセアニア' },
  { code: 'FJ', flag: '🇫🇯', name: 'フィジー',     region: 'オセアニア' },
  { code: 'SB', flag: '🇸🇧', name: 'ソロモン諸島', region: 'オセアニア' },
  { code: 'VU', flag: '🇻🇺', name: 'バヌアツ',     region: 'オセアニア' },
  { code: 'WS', flag: '🇼🇸', name: 'サモア',       region: 'オセアニア' },
  { code: 'TO', flag: '🇹🇴', name: 'トンガ',       region: 'オセアニア' },
  { code: 'KI', flag: '🇰🇮', name: 'キリバス',     region: 'オセアニア' },
  { code: 'TV', flag: '🇹🇻', name: 'ツバル',       region: 'オセアニア' },
  { code: 'NR', flag: '🇳🇷', name: 'ナウル',       region: 'オセアニア' },
  { code: 'PW', flag: '🇵🇼', name: 'パラオ',       region: 'オセアニア' },
  { code: 'FM', flag: '🇫🇲', name: 'ミクロネシア連邦', region: 'オセアニア' },
  { code: 'MH', flag: '🇲🇭', name: 'マーシャル諸島', region: 'オセアニア' },
  // アフリカ (北・西・中央・東・南)
  { code: 'EG', flag: '🇪🇬', name: 'エジプト',     region: 'アフリカ' },
  { code: 'MA', flag: '🇲🇦', name: 'モロッコ',     region: 'アフリカ' },
  { code: 'TN', flag: '🇹🇳', name: 'チュニジア',   region: 'アフリカ' },
  { code: 'DZ', flag: '🇩🇿', name: 'アルジェリア', region: 'アフリカ' },
  { code: 'LY', flag: '🇱🇾', name: 'リビア',       region: 'アフリカ' },
  { code: 'SD', flag: '🇸🇩', name: 'スーダン',     region: 'アフリカ' },
  { code: 'SS', flag: '🇸🇸', name: '南スーダン',   region: 'アフリカ' },
  { code: 'MR', flag: '🇲🇷', name: 'モーリタニア', region: 'アフリカ' },
  { code: 'ML', flag: '🇲🇱', name: 'マリ',         region: 'アフリカ' },
  { code: 'BF', flag: '🇧🇫', name: 'ブルキナファソ', region: 'アフリカ' },
  { code: 'NE', flag: '🇳🇪', name: 'ニジェール',   region: 'アフリカ' },
  { code: 'TD', flag: '🇹🇩', name: 'チャド',       region: 'アフリカ' },
  { code: 'SN', flag: '🇸🇳', name: 'セネガル',     region: 'アフリカ' },
  { code: 'GM', flag: '🇬🇲', name: 'ガンビア',     region: 'アフリカ' },
  { code: 'GW', flag: '🇬🇼', name: 'ギニアビサウ', region: 'アフリカ' },
  { code: 'GN', flag: '🇬🇳', name: 'ギニア',       region: 'アフリカ' },
  { code: 'SL', flag: '🇸🇱', name: 'シエラレオネ', region: 'アフリカ' },
  { code: 'LR', flag: '🇱🇷', name: 'リベリア',     region: 'アフリカ' },
  { code: 'CI', flag: '🇨🇮', name: 'コートジボワール', region: 'アフリカ' },
  { code: 'GH', flag: '🇬🇭', name: 'ガーナ',       region: 'アフリカ' },
  { code: 'TG', flag: '🇹🇬', name: 'トーゴ',       region: 'アフリカ' },
  { code: 'BJ', flag: '🇧🇯', name: 'ベナン',       region: 'アフリカ' },
  { code: 'NG', flag: '🇳🇬', name: 'ナイジェリア', region: 'アフリカ' },
  { code: 'CM', flag: '🇨🇲', name: 'カメルーン',   region: 'アフリカ' },
  { code: 'CF', flag: '🇨🇫', name: '中央アフリカ共和国', region: 'アフリカ' },
  { code: 'GA', flag: '🇬🇦', name: 'ガボン',       region: 'アフリカ' },
  { code: 'CG', flag: '🇨🇬', name: 'コンゴ共和国', region: 'アフリカ' },
  { code: 'CD', flag: '🇨🇩', name: 'コンゴ民主共和国', region: 'アフリカ' },
  { code: 'AO', flag: '🇦🇴', name: 'アンゴラ',     region: 'アフリカ' },
  { code: 'GQ', flag: '🇬🇶', name: '赤道ギニア',   region: 'アフリカ' },
  { code: 'ST', flag: '🇸🇹', name: 'サントメ・プリンシペ', region: 'アフリカ' },
  { code: 'CV', flag: '🇨🇻', name: 'カーボベルデ', region: 'アフリカ' },
  { code: 'ET', flag: '🇪🇹', name: 'エチオピア',   region: 'アフリカ' },
  { code: 'ER', flag: '🇪🇷', name: 'エリトリア',   region: 'アフリカ' },
  { code: 'DJ', flag: '🇩🇯', name: 'ジブチ',       region: 'アフリカ' },
  { code: 'SO', flag: '🇸🇴', name: 'ソマリア',     region: 'アフリカ' },
  { code: 'KE', flag: '🇰🇪', name: 'ケニア',       region: 'アフリカ' },
  { code: 'UG', flag: '🇺🇬', name: 'ウガンダ',     region: 'アフリカ' },
  { code: 'RW', flag: '🇷🇼', name: 'ルワンダ',     region: 'アフリカ' },
  { code: 'BI', flag: '🇧🇮', name: 'ブルンジ',     region: 'アフリカ' },
  { code: 'TZ', flag: '🇹🇿', name: 'タンザニア',   region: 'アフリカ' },
  { code: 'MW', flag: '🇲🇼', name: 'マラウイ',     region: 'アフリカ' },
  { code: 'MZ', flag: '🇲🇿', name: 'モザンビーク', region: 'アフリカ' },
  { code: 'ZM', flag: '🇿🇲', name: 'ザンビア',     region: 'アフリカ' },
  { code: 'ZW', flag: '🇿🇼', name: 'ジンバブエ',   region: 'アフリカ' },
  { code: 'NA', flag: '🇳🇦', name: 'ナミビア',     region: 'アフリカ' },
  { code: 'BW', flag: '🇧🇼', name: 'ボツワナ',     region: 'アフリカ' },
  { code: 'ZA', flag: '🇿🇦', name: '南アフリカ',   region: 'アフリカ' },
  { code: 'SZ', flag: '🇸🇿', name: 'エスワティニ', region: 'アフリカ' },
  { code: 'LS', flag: '🇱🇸', name: 'レソト',       region: 'アフリカ' },
  { code: 'MG', flag: '🇲🇬', name: 'マダガスカル', region: 'アフリカ' },
  { code: 'MU', flag: '🇲🇺', name: 'モーリシャス', region: 'アフリカ' },
  { code: 'SC', flag: '🇸🇨', name: 'セーシェル',   region: 'アフリカ' },
  { code: 'KM', flag: '🇰🇲', name: 'コモロ',       region: 'アフリカ' },
];
