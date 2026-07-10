// v961 中村研 Google Photos アルバム集 (#/albums)。
//   raw テキスト を parse して 年別 セクション + 各 アルバム リンク を 表示。
//   データ更新 は 下の RAW を 差し替える だけ で OK (Cosense 側 の 記法 と 同じ)。

import { escapeHtml } from '../router.js';
import { post } from '../api.js';

// v964 サムネ キャッシュ (メモリ内、 タブ 開いてる 間 は 保持)。 { url: '/api/album-thumbs/photo/<hash>' | null }
const thumbCache = {};

// ─── 生 データ (Cosense の 記法 と 同じ、 [(* YYYY] で 年 区切り、 [title url] が 各 アルバム) ─────────
const RAW = String.raw`
中村研アルバム

 [中村研2025年度 日常 https://photos.google.com/share/REDACTED]
 [中村研2024年度 日常 https://photos.google.com/share/REDACTED]
 [中村研2023年度 日常 https://photos.google.com/share/REDACTED]

[(* 2026]
 [2026年度 日常 https://photos.google.com/share/REDACTED]
 [2026.01.09 未踏、DC1、WISSおめでとう＆学振、CHIお疲れ飲み会 https://photos.google.com/share/REDACTED]
 [2026.01.13-16 HCI216@宮古島（中川、木下、宮本、能宗、村上、高野、巻野） https://photos.google.com/share/REDACTED]
 [2026.01.21-24 CN/DCC宮古島（畑中・大石・渡邊・津田・新嶌・金谷・加藤＋福井） https://photos.google.com/share/REDACTED]
 [2026.01.31 卒論発表会およびB3/M1/M2/D1進捗発表会 https://photos.google.com/share/REDACTED]
 [2026.02.07 山﨑郁未さん結婚式 https://photos.google.com/share/REDACTED]
 [2026.02.12 修論発表会および打ち上げ https://photos.google.com/share/REDACTED]
 [2026.02.28-03.02 SIGMUS＠名古屋工業大学（小川・金谷） https://photos.google.com/share/REDACTED]
 [2026.03.03-05 インタラクション2026 https://photos.google.com/share/REDACTED]
 [2026.03.09-11 CN/HCI研究会芝浦工大（福井、飯田、重松、鳩貝、徳原、野島） https://photos.google.com/share/REDACTED]
 [2026.03.11 萩原さんのバイト先訪問（小松、大石、萩原） https://photos.google.com/share/REDACTED]
 [2026.03.14-19 MVE研究会＠沖縄（會田、熊谷、関口） https://photos.google.com/share/REDACTED]
 [2026.03.26 卒業式＋学位授与式 https://photos.google.com/share/REDACTED]
 [2026.03.26 卒業式＋学位授与式 by wtnb先生 https://photos.google.com/share/REDACTED]
 [2026.03.27 卒業生が暴れる会＋追いコン https://photos.google.com/share/REDACTED]
 [2026.04.06 新歓 https://photos.google.com/share/REDACTED]
 🇪🇸 [2026.04.11-19 CHI2026バルセロナ（三山・中川） https://photos.google.com/share/REDACTED]
 [2026.05.09 競馬 https://photos.google.com/share/REDACTED]
 [2026.05.17 牧結婚報告 https://photos.google.com/share/REDACTED]
 [2026.05.21 崔明根さん講演及び大江戸ビール祭り https://photos.google.com/share/REDACTED]
 [2026.05.28 栗林さん講演およびビール https://photos.google.com/share/REDACTED]
 [2026.06.05 菊池研とのバレーボール https://photos.google.com/share/REDACTED]
 🇮🇹 [2026.06.07-06.14 AVI2026 ベネチア（宮崎・中川） https://photos.google.com/share/REDACTED]
 [2026.07.08 伊藤研究室との合同研究会 https://photos.google.com/share/REDACTED]

[(* 2025]
 [2025年度 日常 https://photos.google.com/share/REDACTED]
 [2025.01.13-16 HCI211沖縄（村上、津田、能宗、田中、三山、大石、関口） https://photos.google.com/share/REDACTED]
 [2025.01.22-24 CN研究会＠奄美大島（萩原、飯田、福井） https://photos.google.com/share/REDACTED]
 [2025.02.12 修論発表会および打ち上げ https://photos.google.com/share/REDACTED]
 [2025.02.25 SUBARUさん4年間の打ち上げ https://photos.google.com/share/REDACTED]
 [2025.03.02-04 インタラクション2025東京（木下、関口、金谷、宮本、能宗） https://photos.google.com/share/REDACTED]
 [2025.03.05-07 HCI212/CN125東京（たかく、たかの、あおき、きのした、とくはら） https://photos.google.com/share/REDACTED]
 [2025.03.17-19 EC研究会＠京都（櫻井、小川、渡邉、重松、宮崎、鳩貝、新嶌） https://photos.google.com/share/REDACTED]
 [2025.03.18-19 長崎大学教育学部付属小学校での実験（會田、津田） https://photos.google.com/share/REDACTED]
 [2025.03.24 M2富士急 https://photos.google.com/share/REDACTED]
 [2025.03.28 卒業生が好き勝手やる会および追いコン https://photos.google.com/share/REDACTED]
 [2025.04.11 新歓 https://photos.google.com/share/REDACTED]
 [2025.04.28-05.01 CHI2025 at 横浜（関口、中川、木下） https://photos.google.com/share/REDACTED]
 [2025.05.16-18 研究室合宿 in 白浜 https://photos.google.com/share/REDACTED]
 [2025.05.23- 大江戸ビール祭り https://photos.google.com/share/REDACTED]
 [2025.05.23-24 掛川花鳥園＋浜松市動物園（中川・高野） https://photos.google.com/share/REDACTED]
 [2025.05.30-06.03 HCS研沖縄（宮本、金谷、木下） https://photos.google.com/share/REDACTED]
 [2025.06.19 伊藤研究室との合同研究会（+栗原研） https://photos.google.com/share/REDACTED]
 🇵🇹 [2025.06.29-07.06 ICAD2025ポルト・コインブラ・リスボン（大石） https://photos.google.com/share/REDACTED]
 [2025.07.10 新D1交流会（関口、中川、他） https://photos.google.com/share/REDACTED]
 [2025.07.12 大学院入試および打ち上げ（B4） https://photos.google.com/share/REDACTED]
 [2025.07.19 OBOGとバーベキュー https://photos.google.com/share/REDACTED]
 [2025.07.24 大掃除とビアガーデン https://photos.google.com/share/REDACTED]
 [2025.08.11 豊橋総合動植物公園 のんほいパークと、浜松湖体験学習施設ウォット https://photos.google.com/share/REDACTED]
 [2025.08.21 第19回ドクター中松（関西大学松下研との合同研究会） in 明治大学中野キャンパス https://photos.google.com/share/REDACTED]
 [2025.08.26 米原市・ワコム・筑波大学・明治大学契約締結式（米原市役所） https://photos.google.com/share/REDACTED]
 [2025.08.28-29 パイロットさんハッカソン https://photos.google.com/share/REDACTED]
 [2025.09.02-05 HCI214＠北海道科学大学（菅生・三山・中川・ゲスト金谷） https://photos.google.com/share/REDACTED]
 [2025.09.09-12 KES2025 at Osaka, Japan（小林、萩原） https://photos.google.com/share/REDACTED]
 [2025.10.09-13 サンシャイン水族館 実証実験 https://photos.google.com/share/REDACTED]
 [2025.11.03-04 関西大学との合同研究会 in 関西大学とその前後 https://photos.google.com/share/REDACTED]
 [2025.11.03-04 B2京都合宿 https://photos.google.com/share/REDACTED]
 [2025.11.13-15 EC研究会 in 高知（小林） https://photos.google.com/share/REDACTED]
 🇮🇩 [2025.11.03-09 CollabTech2025 in Depok, Indonesia（萩原、福井、飯田） https://photos.google.com/share/REDACTED]
 [2025.11.06-12 掛川花鳥園での実証実験（中川） https://photos.google.com/share/REDACTED]
 [2025.11.25-27 HCI215@淡路島（木下、三山、宮崎、田中、成瀬、江森、伊藤、関口） https://photos.google.com/share/REDACTED]
 🇦🇺 [2025.11.28-12.04 OzCHI2025 in Sydney（小川、小林、渡邉） https://photos.google.com/share/REDACTED]
 [2025.12.03-05 WISS2025＠北海道定山渓（中川、関口、瀬崎） https://photos.google.com/share/REDACTED]
 🇲🇾 [2025.12.08-13 ACM Multimedia Asia 2025 クアラルンプール（重松、鳩貝、中川） https://photos.google.com/share/REDACTED]
 [2025.12.09-13 HCGシンポジウム2025 in 北九州（萩原） https://photos.google.com/share/REDACTED]

[(* 2024]
 [2024年度 日常 https://photos.google.com/share/REDACTED]
 [2024.01.15-18 HCI206沖縄那覇（植木、青木、高野、小林、渡邉） https://photos.google.com/share/REDACTED]
 [2024.01.19 パイロットさん懇親会 https://photos.google.com/share/REDACTED]
 [2024.01.20-24 CN研究会＠伊豆大島（小松原・畑中・高久・木下・古賀・福井） https://photos.google.com/share/REDACTED]
 [2024.01.23-24 兵庫県警（関口渡邉大石萩原） https://photos.google.com/share/REDACTED]
 [2024.01.27 卒論・B3M1M2進捗発表会＆打ち上げ https://photos.google.com/share/REDACTED]
 [2024.02.07 NEC第8回および打ち上げ https://photos.google.com/share/REDACTED]
 [2024.02.08 B3新年会 https://photos.google.com/share/REDACTED]
 [2024.02.08、16、29 NEC最終成果物作成会 https://photos.google.com/share/REDACTED]
 [2024.03.05 ハッカソンと一部の人で打ち上げ https://photos.google.com/share/REDACTED]
 [2023.03.10-11 鳥羽、名古屋、南知多の水族館巡り（中川） https://photos.google.com/share/REDACTED]
 [2024.03.12-15 MVE沖縄（青木、鳩貝、飯田） https://photos.google.com/share/REDACTED]
 [2024.03.16 長崎ペンギン水族館 https://photos.google.com/share/REDACTED]
 [2024.03.22 春休み中間ゼミ・卒業生が好き勝手やる会・追いコン https://photos.google.com/share/REDACTED]
 [2024.04.04 顔合わせとガイダンス https://photos.google.com/share/REDACTED]
 [2024.04.12 新歓 at 食堂 https://photos.google.com/share/REDACTED]
 [2024.04.19 多目的室でバレーボール https://photos.google.com/share/REDACTED]
 [2024.05.02 研究アイディア出し会と運動会 https://photos.google.com/share/REDACTED]
 [2024.05.10-12 研究室合宿 in 秩父 https://photos.google.com/share/REDACTED]
 [2024.05.12-16 HCS研沖縄（中川、松田、徳原、三山） https://photos.google.com/share/REDACTED]
 [2024.05.22, 24, 29 クラフトビール祭り https://photos.google.com/share/REDACTED]
 🇮🇹 [2024.06.01-09 AVI2024ミラノ・ジェノバ（中川・松田） https://photos.google.com/share/REDACTED]
 [2024.07.02 すみだ水族館実験 https://photos.google.com/share/REDACTED]
 [2024.07.11 お茶の水女子大学伊藤研との合同研究会と懇親会 https://photos.google.com/share/REDACTED]
 [2024.07.13 大学院入試及び打ち上げ https://photos.google.com/share/REDACTED]
 [2024.07.21-24 HCI209北海道（木下） https://photos.google.com/share/REDACTED]
 [2023.07.26 小松原および卒業生 https://photos.google.com/share/REDACTED]
 [2024.08.01 中野区役所とのアイディアソン https://photos.google.com/share/REDACTED]
 [2024.08.02-03 オープンキャンパス https://photos.google.com/share/REDACTED]
 [2024.08.07-08 ハッカソン Sponsored By パイロットさん https://photos.google.com/share/REDACTED]
 [2024.08.21 サンシャイン水族館下調べ https://photos.google.com/share/REDACTED]
 [2024.08.22 松下研究室との合同研究会 https://photos.google.com/share/REDACTED]
 [2024.08.23-25 HCS研＠兵庫県立大学（萩原、小林、金谷、宮本）とちょっと小松原 https://photos.google.com/share/REDACTED]
 [2024.09.01-04 エンタテイメントコンピューティング2024 at 北海道情報大学（中川） https://photos.google.com/share/REDACTED]
 [2024.09.07 土屋駿貴くん、久保田夏美さん結婚式および披露宴、そして二次会 https://photos.google.com/share/REDACTED]
 🇪🇸 [2024.09.09-17 KES2024 & CollabTech2024 in Spain （高野・櫻井・中川・木下・田中） https://photos.google.com/share/REDACTED]
 [2024.09.24 B4親睦会 in 富士Q https://photos.google.com/share/REDACTED]
 [2024.09.27 東京ゲームショー2024幕張メッセ https://photos.google.com/share/REDACTED]
 [2024.09.30 夏の終わりのビアガーデン https://photos.google.com/share/REDACTED]
 [2024.10.15 ギガクリスタ10周年イベント https://photos.google.com/share/REDACTED]
 [2024.10.15-21 サンシャイン水族館実証実験（中川ほか） https://photos.google.com/share/REDACTED]
 [2024.11.04-06 関西大学との合同研究会および関西でのフィールドワーク https://photos.google.com/share/REDACTED]
 [2024.12.10-13 WISS前泊とWISS2024苗場（関口） https://photos.google.com/share/REDACTED]
 [2024.12.10-13 HCGシンポジウム2024金沢（あいた、なるせ、萩原） https://photos.google.com/share/REDACTED]
 [2024.12.20 卒論修論提出および忘年会 https://photos.google.com/share/REDACTED]

[(* 2023]
 [2023.01.15-18 HCI201＠石垣島（B2+B4+萩原大石渡邉小川+植木伊藤横山） https://photos.google.com/share/REDACTED]
 [2023.01.23-25 GN研究会＠南あわじ（髙久、畑中、古賀） https://photos.google.com/share/REDACTED]
 [2023.01.28 卒論発表会兼、B3/M1/M2進捗発表会、んでもって打ち上げ https://photos.google.com/share/REDACTED]
 [2023.02.12 修論諮問会と打ち上げ＠845 https://photos.google.com/share/REDACTED]
 [2023.03.11 ニュースアプリ配信打ち上げ at tsuiteru（関口、中川） https://photos.google.com/share/REDACTED]
 [2023.03.12-13 コミック工学研究会 at 大阪（伊藤、櫻井、濱野） https://photos.google.com/share/REDACTED]
 [2023.03.13-15 HCI研@国士舘大学（船崎、松田、小川） https://photos.google.com/share/REDACTED]
 [2023.03.14-17 MVE研@那覇市（福井、髙久） https://photos.google.com/share/REDACTED]
 [2023.03.26 明治大学卒業式・学位授与式 https://photos.google.com/share/REDACTED]
 [2023.04.06 中村研初回ゼミ＋お菓子会＋飲み会 https://photos.google.com/share/REDACTED]
 [2023.05.11 瀬崎・松田ケーキ対決 https://photos.google.com/share/REDACTED]
 [2023.05.14-17 HCS 5月研究会＠沖縄（中川、松田、木下、渡邉） https://photos.google.com/share/REDACTED]
 [2023.05.19-21 研究室合宿＠伊豆高原 https://photos.google.com/share/REDACTED]
 [2023.06.05 ビアガーデン https://photos.google.com/share/REDACTED]
 [2023.06.09 運動会（大縄跳び） https://photos.google.com/share/REDACTED]
 [2023.06.15 お茶大伊藤研との合同研究会 https://photos.google.com/share/REDACTED]
 [2023.06.30 バレーボール大会 https://photos.google.com/share/REDACTED]
 [2023.07.03 ショートビアガーデン https://photos.google.com/share/REDACTED]
 [2023.07.08 大学院入試終わりのBBQ（B4 only） https://photos.google.com/share/REDACTED]
 🇩🇰 [2023.07.23-30 HCII2023@コペンハーゲン（木下、中川、関口、青木ゆ、山﨑、植木、小松原） https://photos.google.com/share/REDACTED]
 [2023.08.02-03 オープンキャンパス https://photos.google.com/share/REDACTED]
 [2023.08.06-10 北海道情報大学湯村研・伊藤研との合同研究会＆HCI204@北海道（たくさん） https://photos.google.com/share/REDACTED]
 [2023.08.28 パイロットさんアイディアソン https://photos.google.com/share/REDACTED]
 [2023.08.29 関西大学松下研との合同研究会 https://photos.google.com/share/REDACTED]
 🇬🇷 [2023.09.04-11 KES2023 at アテネ（高久、青木と、娘） https://photos.google.com/share/REDACTED]
 [2023.09.10-12 HCS研究会 in 愛媛（植木、青木ゆ、徳原、三山、瀬崎） https://photos.google.com/share/REDACTED]
 [2023.09.19 パイロットさんアイディアソン2日目 https://photos.google.com/share/REDACTED]
 [2023.10.05 NECさんとの共同研究キックオフ https://photos.google.com/share/REDACTED]
 [2023.10.13 すみだ水族館実験大会 https://photos.google.com/share/REDACTED]
 [2023.10.13 SUBARUさん（松田、中川ほか） https://photos.google.com/share/REDACTED]
 [2023.11.02 サンシャイン水族館とNECアイディアソン https://photos.google.com/share/REDACTED]
 [2023.11.05-07 B2京都合宿 https://photos.google.com/share/REDACTED]
 [2023.11.05-07 ドクター中松＠六甲＆京都合宿（B3+B4+M1+小松原） https://photos.google.com/share/REDACTED]
 [2023.11.16 AdobeMax講演 https://photos.google.com/share/REDACTED]
 [2023.11.20-22 HCI205 in 淡路島（中川、重松、大石、小林） https://photos.google.com/share/REDACTED]
 [2023.11.29 警視庁へ遠足 https://photos.google.com/share/REDACTED]
 [2023.11.29-12.01 WISS2023@八ヶ岳（関口、古賀） https://photos.google.com/share/REDACTED]
 [2023.12.01-07 OzCHI2023@Wellington（山﨑、中川、福井） https://photos.google.com/share/REDACTED]
 [2023.12.10-13 HCGシンポジウム2023@北九州（中村りょうた、櫻井、宮崎） https://photos.google.com/share/REDACTED]
 [2023.11.27-12.16 色んな県の県警本部訪問 https://photos.google.com/share/REDACTED]
 [2023.12.16 OBとの忘年会 https://photos.google.com/share/REDACTED]
 [2023.12.22 卒論修論締め切りと忘年会 https://photos.google.com/share/REDACTED]

[(* 2022]
 [2022.03.06-08 京都アイディアソン合宿 https://photos.google.com/share/REDACTED]
 [2022.03.26 卒業式 https://photos.google.com/share/REDACTED]
 [2022.04.19 SUBARU https://photos.google.com/share/REDACTED]
 [2022.05.14 4期生修了おめでとさん会 https://photos.google.com/share/REDACTED]
 [2022.06.01 すみだ水族館 https://photos.google.com/share/REDACTED]
 [2022.06.02 中村研運動会 https://photos.google.com/share/REDACTED]
 [2022.06.03-05 鬼怒川合宿 https://photos.google.com/share/REDACTED]
 [2022.06.08 サンシャイン水族館 https://photos.google.com/share/REDACTED]
 [2022.07.07 お茶の水女子大学伊藤研究室との合同研究会 https://photos.google.com/share/REDACTED]
 [2022.08.08-12 中村研夏ハッカソン https://photos.google.com/share/REDACTED]
 🇨🇦 [2022.08.19-24 MANPU2022 モントリオール（櫻井一人旅） https://photos.google.com/share/REDACTED]
 [2022.08.20-25 HCI研＠小樽（M2+小松原+青木ゆ） https://photos.google.com/share/REDACTED]
 [2022.08.31-09.03 エンタテイメントコンピュティング2022（藤原・濱野・小松原） https://photos.google.com/share/REDACTED]
 🇮🇹 [2022.09.05-13 KES2022 at イタリアベローナ・ミラノ・コモ湖（松田） https://photos.google.com/share/REDACTED]
 [2022.11.04-06 ドクター中松（関西大学松下研との合同研究会）（横山＋B3～M1） at 関西大学 https://photos.google.com/share/REDACTED]
 [2022.11.07-09 HCI200淡路島夢舞台（横山、梶田、山﨑、高野、松田、木下） https://photos.google.com/share/REDACTED]
 [2022.11.17 首腰肩のケアのワークショップ（まにわ先生）と運動会@多目的室 https://photos.google.com/share/REDACTED]
 [2022.11.23 スマートフォンアプリコンテスト https://photos.google.com/share/REDACTED]
 🇦🇺 [2022.11.28-12.04 OzCHI2022 キャンベラ・シドニー（梶田、中川、中村） https://photos.google.com/share/REDACTED]
 [2022.12.13-16 HCGシンポジウム2022@高松（りょうた、植木、小林） https://photos.google.com/share/REDACTED]
 [2022.12.16 卒論修論締め切りと打ち上げ https://photos.google.com/share/REDACTED]
 [2022.12.22 年末運動会 https://photos.google.com/share/REDACTED]

[(* 2021]
 [2021.03.26-卒業式 https://photos.google.com/share/REDACTED]
 [2021.03.26 学位授与式 https://photos.google.com/share/REDACTED]
 [2021.03.26 3期生修了おめでとさん会＠カタリナ https://photos.google.com/share/REDACTED]
 [2021.11.30-12.01 HCI195@淡路島 https://photos.google.com/share/REDACTED]

[(* 2020]
 [2020.01.14-17 HCI186＠石垣島（髙橋、佐々木、古市、細谷、田村） https://photos.google.com/share/REDACTED]
 [2020.01.22-01.25 GN研究会 隠岐島（菅野・斎藤光・樋川・徳久） https://photos.google.com/share/REDACTED]
 [2020.02.12 2期生修論お疲れさん会 https://photos.google.com/share/REDACTED]
 [2020.03.23-卒業式 https://photos.google.com/share/REDACTED]
 [2020.12.07-10 HCI研＠淡路島（山﨑・青木・植木） https://photos.google.com/share/REDACTED]

[(* 2019]
 🇬🇷 [2019.01.07-14 MMM2019＠ギリシャ（田村，斉藤） https://photos.google.com/share/REDACTED]
 [2019.01.20-26 HCI181 ＆ DCC GN106＠石垣島（細谷，佐々木，松井，新納，徳久，田島，高橋，土屋，今城） https://photos.google.com/share/REDACTED]
 [2019.01.31 卒論提出完了！（B4） https://photos.google.com/share/REDACTED]
 [2019.02.01 修士論文発表会および打ち上げの腕相撲大会 in 鳥貴族（M2） https://photos.google.com/share/REDACTED]
 [2019.02.02 卒論発表会・修論報告会・B2/B3/M1進捗報告会および懇親会 https://photos.google.com/share/REDACTED]
 [2019.02.09 修士論文印刷版提出 https://photos.google.com/share/REDACTED]
 [2019.02.26 中野区長から賞状をもらう（土屋・白鳥・田島） https://photos.google.com/share/REDACTED]
 [2019.03.04-06 DEIM2019@ハウステンボス https://photos.google.com/share/REDACTED]
 [2019.03.21 1期生追いコン https://photos.google.com/share/REDACTED]
 [2019.03.26 卒業式（修士1期生&学士3期生） https://photos.google.com/share/REDACTED]
 [2019.04.16 新歓＠炙谷 https://photos.google.com/share/REDACTED]
 [2019.05.04 中村研1期生を招いて＠中村家 https://photos.google.com/share/REDACTED]
 [2019.05.15-18 HCS2019@沖縄（梶田、杉本、伊藤、濱野、築館、川島、一平、野中、細谷、阿部、徳久、山浦） https://photos.google.com/share/REDACTED]
 [2019.05.16-17 HCS研究会＠那覇 https://photos.google.com/share/REDACTED]
 [2019.05.21 聖マリアンナ医科大学調査 https://photos.google.com/share/REDACTED]
 [2019.05.24-26 研究室合宿 in 猪苗代（レイクサイド磐光） https://photos.google.com/share/REDACTED]
 [2019.06.29 お茶の水女子大学伊藤貴之研究室との合同研究会 https://photos.google.com/share/REDACTED]
 [2019.07.10 B2懇親会 https://photos.google.com/share/REDACTED]
 [2019.07.19 グループホームあさがやでのシステム検証 https://photos.google.com/share/REDACTED]
 [2019.07.21-24 HCI184＠札幌（山浦・又吉・二宮・横山・徳久） https://photos.google.com/share/REDACTED]
 [2019.07.30 中村研前期打ち上げ＠ばらえ亭 https://photos.google.com/share/REDACTED]
 [2018.08.05-09 ACCEL集中ハッカソン https://photos.google.com/share/REDACTED]
 [2019.08.06-07 ACCELリーダー合宿＠つくば https://photos.google.com/share/REDACTED]
 [2019.08.20-21 オープンキャンパス2019 https://photos.google.com/share/REDACTED]
 [2019.08.26 中村研・松下研合同研究会（明治大学） https://photos.google.com/share/REDACTED]
 🇨🇾 [2019.08.30-09.08 INTERACT2019＠キプロス（佐々木・細谷・古市・中村） https://photos.google.com/share/REDACTED]
 [2019.09.02-05 HIS2019＠京都（濱野・船﨑・菅野・山浦） https://photos.google.com/share/REDACTED]
 🇹🇼 [2019.09.17-21 関西大学・国立曁南国際大学・南開科技大學合同ワークショップ＠台湾（M1+M2+野中） https://photos.google.com/share/REDACTED]
 [2019.09.19-22 EC2019@福岡 https://photos.google.com/share/REDACTED]
 [2019.09.20-22 EC2019@福岡(藤原・南里・古市・木頃) https://photos.google.com/share/REDACTED]
 [2019.09.25-27 WISS2019@長野（樋川・又吉） https://photos.google.com/share/REDACTED]
 [2019.10.25-27 第2回コミック工学@函館（阿部・松山・二宮） https://photos.google.com/share/REDACTED]
 [2019.11.06~11.07 中松研究会＠関西大（学部生＋徳久） https://photos.google.com/share/REDACTED]
 [2019.11.07 ドクター中松 https://photos.google.com/share/REDACTED]
 🇵🇪 [2019.11.09-16 ICEC-JCSG2019 in ペルー・アレキパ（徳久，野中） https://photos.google.com/share/REDACTED]
 [2019.12.10-12.11 SIGHCI185@淡路島（神山、山浦、船﨑、梶田、伊藤、瀬戸） https://photos.google.com/share/REDACTED]
 [2019.12.20 卒論・修論締め切りと忘年会 https://photos.google.com/share/REDACTED]

[(* 2018]
 [2018.01.21-23 SIGHCI176@琉球大学（斉藤、佐々木、佐藤、新納、松井） https://photos.google.com/share/REDACTED]
 [2018.02.01 宮下研中村研合同発表会 https://photos.google.com/share/REDACTED]
 [2018.02.13 M1飲み会＠ぢどりや https://photos.google.com/share/REDACTED]
 [2018.02.27 修士・修士進学組第進捗報告会打ち上げ＠炙谷 https://photos.google.com/share/REDACTED]
 [2018.03.13 白鳥裕士山下記念賞授賞式 https://photos.google.com/share/REDACTED]
 [2018.03.16 SIGEC47＠電気通信大学（斉藤、佐藤、牧） https://photos.google.com/share/REDACTED]
 [2018.03.16 Inkathon(又吉) https://photos.google.com/share/REDACTED]
 [2018.03.16-17 情報処理学会HCI研究会（山浦，阿部，福地）＆学生奨励賞表彰式（松井）＠明治大学 https://photos.google.com/share/REDACTED]
 [2018.03.19-20 SIGGN104＠筑波大学（樋川，松田） https://photos.google.com/share/REDACTED]
 [2018.03.24 中村研2017年度謝恩会_さらば福地翼,久保田夏美 https://photos.google.com/share/REDACTED]
 [2018.03.26 学位授与式・謝恩会（2期生B4） https://photos.google.com/share/REDACTED]
 [2018.04.23 中村研新歓B3・B4・M1・M2＠炙谷 https://photos.google.com/share/REDACTED]
 [2018.05.20-23 HCS研究会＠沖縄（高橋，田島，大野） https://photos.google.com/share/REDACTED]
 [2018.05.25-27 ゼミ合宿@千葉県白浜 https://photos.google.com/share/REDACTED]
 🇮🇹 [2018.05.28-06.03 AVI2018 in イタリアローマ・チヴィタなど（松田、又吉） https://photos.google.com/share/REDACTED]
 [2018.06.05-08 JSAI2018@鹿児島（佐藤、牧、斉藤） https://photos.google.com/share/REDACTED]
 [2018.06.14-15@東大 HCI178（佐々木、徳久） https://photos.google.com/share/REDACTED]
 [2018.06.23 お茶の水女子大学伊藤貴之研究室との合同研究会＠明治大学 https://photos.google.com/share/REDACTED]
 [2018.07.03 ビアガーデン https://photos.google.com/share/REDACTED]
 🇺🇸 [2018.07.16-22 HCII2018＠ラスベガス（樋川，山浦，牧，光） https://photos.google.com/share/REDACTED]
 [2018.07.31 修士論文中間報告会・打ち上げ（M2・阿部・B3）＠炙谷 https://photos.google.com/share/REDACTED]
 [2018.08.06-08.10 ACCEL集中ハッカソン https://photos.google.com/share/REDACTED]
 [2018.08.20-21 SIGHCI179@京都（田島、細谷、山浦） https://photos.google.com/share/REDACTED]
 [2018.08.21-22 オープンキャンパス https://photos.google.com/share/REDACTED]
 [2018.09.04-07 HIS2018（今城・いっぺい・新納）@筑波 https://photos.google.com/share/REDACTED]
 🇵🇹 [2018.09.04-10 ポルトガル・リスボン・シントラ・ロカ岬（土屋・白鳥・佐々木） https://photos.google.com/share/REDACTED]
 [2018.09.13-15 B2合宿＠京都鍵屋荘 https://photos.google.com/share/REDACTED]
 [2018.09.22-24 VIP2018 https://photos.google.com/share/REDACTED]
 [2018.11.03-05 関西大合同合宿 https://photos.google.com/share/REDACTED]
 [2018.12.04-05 HCI180@淡路島（松山、桑原、田島、高橋） https://photos.google.com/share/REDACTED]
 [2018.12.26 GN/DCC投稿打ち上げ https://photos.google.com/share/REDACTED]
 [2018.12.21-22 EC50@函館（阿部・野中・古市） https://photos.google.com/share/REDACTED]

[(* 2017]
 [2017.01.22-24 SIGHCI171@石垣島（前島・松井・松田） https://photos.google.com/share/REDACTED]
 [2017.01.28 卒論合同発表会 https://photos.google.com/share/REDACTED]
 [2017.02.16 中村研B2打ち上げ＠塩ホルモンさとう https://photos.google.com/share/REDACTED]
 [2017.02.27 久保田夏美学生奨励賞 https://photos.google.com/share/REDACTED]
 [2017.03.10-11 GN101@玉川大学（佐藤・田村・新納） https://goo.gl/photos/REDACTED]
 🇨🇾 [2017.03.12-17 IUI2017キプロス・ロンドン（中村） https://photos.google.com/share/REDACTED]
 [2017.03.22 中村研2016年度お疲れさま会＋謝恩会（中村・B4・B3）＠中野 https://photos.google.com/share/REDACTED]
 [2017.03.26 学位授与式・謝恩会（1期生B4） https://photos.google.com/share/REDACTED]
 [2017.04.07 新B1（5期生） https://photos.google.com/share/REDACTED]
 [2017.04.14-15 ACCEL合宿＠伊東 https://photos.google.com/share/REDACTED]
 [2017.04.17 中村研新歓B3・B4・M1＠めりはり屋 https://photos.google.com/share/REDACTED]
 [2017.04.27 中村研B1，B2，B3，B4，M1懇親会（中野キャンパス） https://photos.google.com/share/REDACTED]
 [2017.05.12-14 ゼミ合宿@那須 https://goo.gl/photos/REDACTED]
 [2017.05.14-18 HCS研究会@沖縄（土屋、久保田） https://goo.gl/photos/REDACTED]
 [2017.05.23-26 JSAI2017@名古屋（牧・斉藤絢） https://goo.gl/photos/REDACTED]
 [2017.05.30 中村研1年次の三期生＠ツイテル https://photos.google.com/share/REDACTED]
 [2017.06.17 津田塾とのハッカソン https://photos.google.com/share/REDACTED]
 🇵🇹 [2017.06.18-25 INTETAIN2017@マディラ島（新納・中村） https://photos.google.com/share/REDACTED]
 [2017.06.22 第2回nkmr研釣り大会@奥多摩 https://goo.gl/photos/REDACTED]
 [2017.06.25 中村研・伊藤研合同研究会＠お茶の水女子大学 https://goo.gl/photos/REDACTED]
 [2017.07.07-08 WI2研究会＠京都大学（又吉、斉藤、中村） https://goo.gl/photos/REDACTED]
 [2017.07.14 富士急ハイランド https://photos.google.com/share/REDACTED]
 [2017.07.25-26 はこだて未来大学（中村、斉藤） https://photos.google.com/share/REDACTED]
 [2017.08-09 CVIM209@札幌（上西・前島・阿部・土屋・今城） https://photos.google.com/share/REDACTED]
 [2017.08.22-23 オープンキャンパスと打ち上げ https://photos.google.com/share/REDACTED]
 [2017.08.23-24 HCI174研究会＠京都（佐々木、田島、松田） https://goo.gl/photos/REDACTED]
 [2017.08.28-30 ドクター中松＠関西大学（B3、B4、M1） https://photos.google.com/share/REDACTED]
 [2017.08.31-09.01 イノベーションジャパン＠ビッグサイト（中村、久保田、又吉） https://photos.google.com/share/REDACTED]
 [2017.09.15-17 VIP2017 https://photos.google.com/share/REDACTED]
 [2017.09.16-18 EC2017@仙台（松田、松井、佐藤） https://photos.google.com/share/REDACTED]
 [2017.11.01-02 SIGHCI175@淡路島（松井、神山、山浦、福地、高橋） https://photos.google.com/share/REDACTED]
 [2017.11.11-12 Songleハッカソン https://photos.google.com/share/REDACTED]
 [2017.11.15 中村研B1懇親会 https://photos.google.com/share/REDACTED]
 🇦🇺 [2017.11.27-12.04 OzCHI2017 at Brisbane（田島） https://photos.google.com/share/REDACTED]
 🇰🇭 [2017.12.10-15 ACIS2017 at プノンペン（牧） https://photos.google.com/share/REDACTED]
 [2017.12.19 肉会＠新中野かぶり（稲見先生，簗瀬さん，又吉） https://photos.google.com/share/REDACTED]
 [2017.12.20 忘年会＆卒論初稿お疲れさん会＠炙谷＆門田ビル（B3, B4, M1） https://photos.google.com/share/REDACTED]

[(* 2016]
 [2016.02.09 中村研・宮下研合同研究発表会 https://goo.gl/photos/REDACTED]
 [2016.02.22 B2＆B3合同飲み会＠青鋼 https://goo.gl/photos/REDACTED]
 [2016.02.29-03.02 DEIM2016＠博多（中村・今城・白鳥・土屋・田島・前島） https://goo.gl/photos/REDACTED]
 [2016.03.22-24 中村研究室 冬の遊び合宿（B3）＠群馬県片品村 https://photos.google.com/share/REDACTED]
 [2016.05.06 中村研究室B1～B4懇親会＠中野キャンパス https://goo.gl/photos/REDACTED]
 [2016.06.04-05 中村研究室B3_B4 研究着手合宿＠伊東山喜旅館 https://photos.google.com/share/REDACTED]
 [2016.06.06-09 JSAI2016＠福岡（新納） https://goo.gl/photos/REDACTED]
 [2016.06.15 中村先生誕生祭@研究室 https://photos.google.com/share/REDACTED]
 [2016.06.25 中村研・伊藤研合同研究会＠中野キャンパス https://goo.gl/photos/REDACTED]
 [2016.07.02 津田塾稲葉ゼミ・栗原ゼミとのアイディアソン・ハッカソン＠中野キャンパス https://goo.gl/photos/REDACTED]
 [2016.07.13 大学院入試お疲れさん会＠青鋼 https://photos.google.com/share/REDACTED]
 [2016.08.10-11 上越教育大学（中村・鈴木・新納・斉藤・久保田） https://goo.gl/photos/REDACTED]
 [2016.08.27 OngaCRESTシンポジウム＠明治大学中野キャンパス https://photos.google.com/share/REDACTED]
 [2016.08.29-30 SIGHCI169＠下関（山浦・斉藤・久保田・福地・樋川） https://photos.google.com/share/REDACTED]
 [2016.09.01 ドクター中松@明治大学中野キャンパス https://goo.gl/photos/REDACTED]
 [2016.09.02 サテライトオフィス探しのための内見 https://goo.gl/photos/REDACTED]
 [2016.09.12 BBQ@吉祥寺 https://photos.google.com/share/REDACTED]
 [2016.09.13 高円寺南・門田ビル内見 https://goo.gl/photos/REDACTED]
 [2016.09.17-19 中村研究室B2 夏合宿＠京都鍵屋荘（B2） https://goo.gl/photos/REDACTED]
 [2016.09.24 中村研・栗原研合同研究会@中野キャンパス https://goo.gl/photos/REDACTED]
 [2016.10.29-31 はこだて未来大学での合同研究会（B3＆B4） https://photos.google.com/share/REDACTED]
 [2016.11.05 門田ビル新居記念飲み会 https://photos.google.com/share/REDACTED]
 [2016.11.18-19 グループウェアとネットワークサービスワークショップ2016（阿部、今城、土屋） https://goo.gl/photos/REDACTED]
 🇲🇽 [2016.12.04-08 MANPU2016 @ メキシコ・カンクン・チェチェンイッツァ （中村・久保田・新納） https://goo.gl/photos/REDACTED]
 [2016.12.14-16 WISS2016＠長浜（中村、樋川、久保田、福地、田島、新納、又吉、萩原） https://goo.gl/photos/REDACTED]
 [2016.12.22 中村研究室忘年会（B3＆B4）＠青鋼 https://photos.google.com/share/REDACTED]

[(* 2015]
 [2015.03.10 中村研究室打ち上げ飲み会 https://goo.gl/photos/REDACTED]
 [2015.04.14 B3新歓＠塩ホルモンさとう https://goo.gl/photos/REDACTED]
 [2015.04.28 中村研究室 B1~B3合同新歓 https://goo.gl/photos/REDACTED]
 [2015.05.23-24 B3スタートアップ伊東合宿 https://goo.gl/photos/REDACTED]
 [2015.07.12 アイディアソン＋ハッカソン with 津田塾稲葉研究室、栗原研究室 https://goo.gl/photos/REDACTED]
 [2015.08.19-20 明治大学オープンキャンパス https://goo.gl/photos/REDACTED]
 [2015.08.24 ドクター中松＠明治大学中野キャンパス https://goo.gl/photos/REDACTED]
 [2015.08.31-09.02 音楽情報処理研究会 SIGMUS108（中村・大野・土屋） https://goo.gl/photos/REDACTED]
 [2015.09.18-20 中村研究室B2 京都夏合宿（2015） https://goo.gl/photos/REDACTED]
 [2015.09.24-28 エンタテイメントコンピューティング2015＠札幌（中村・佐藤・田村・新納・牧・松井・松田・鈴木先生） https://goo.gl/photos/REDACTED]
 [2015.10.02-03 SIGGN96（グループウェアとネットワークサービス研究会）＠岐阜高山（中村・土屋・白鳥・田島） https://goo.gl/photos/REDACTED]
 [2015.10.03-04 OngaCREST合宿＠浜名湖（中村・宮下・大野・松田・新納） https://goo.gl/photos/REDACTED]
 [2015.10.12 中村研究室B3 夏休みの諸々の投稿・発表おつかれさん会＆これから投稿頑張ってね懇親会（Tsuiteruポイント精算会） https://goo.gl/photos/REDACTED]
 [2015.11.01-03 B3京都合宿（三都物語）鍵屋荘研究会、ドクター中松＠関西大、SIGGRAPH ASIA＠神戸 https://goo.gl/photos/REDACTED]
 [2015.11.02 ドクター中松＠関西大学 https://goo.gl/photos/REDACTED]
 [2015.11.26 丈ちゃん（中村・牧・新納・松田） https://goo.gl/photos/REDACTED]
 [2015.11.29-12.03 HCI165回研究会＋WISS2015＠別府（中村，神山） https://goo.gl/photos/REDACTED]
 [2015.12.16-12-18 HCGシンポジウム2015（中村・松田） https://goo.gl/photos/REDACTED]

[(* 過去のもの]
 [2010.11.05 ドクター中松（初回）関西大学 https://photos.google.com/share/REDACTED]
 [2011.11.20 ドクター中松（第2回） at 京都大学 https://photos.google.com/share/REDACTED]
 [2012.11.24 第3回ドクター中松 at 京都リサーチパーク＆鍵屋荘 https://photos.google.com/share/REDACTED]
`;

// ─── Parse: 「[(* SECTION]」 で 区切って、 各 セクション 内 の 「[title url]」 行 を 抽出 ────────
// v969 タイトル 先頭 の YYYY.MM.DD (or YYYY.MM) を 日付 として 抽出。 セクション 順 用 の
//       row index も 保持 (RAW 内 の 元 の 並び を 保つ ため の tie-break)。
function parseAlbums(raw) {
  const sections = [];
  let cur = { title: '中村研アルバム', albums: [] };
  sections.push(cur);
  const lines = raw.split(/\r?\n/);
  const secRe   = /^\[\(\*\s*(.+?)\s*\]/;
  const albumRe = /\[(.+?)\s+(https?:\/\/\S+?)\]/;
  let idx = 0;
  for (const line of lines) {
    const sm = line.match(secRe);
    if (sm) {
      cur = { title: sm[1], albums: [] };
      sections.push(cur);
      continue;
    }
    const am = line.match(albumRe);
    if (am) {
      const flagMatch = line.match(/^\s*([\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}]+)/u);
      const flag = flagMatch ? flagMatch[1] : '';
      const title = am[1];
      // 日付 抽出: 2026.07.08 / 2026.07 / 2026 (数字 の 先頭 パターン)
      // 「YYYY.MM.DD」 → sortKey = 'YYYY-MM-DD'
      // 「YYYY.MM」    → 'YYYY-MM-01'
      // 「YYYY年度 日常」 の ような 汎用 は 'YYYY-00-00' として セクション 冒頭 相当
      let sortKey = '';
      const dm = title.match(/^(\d{4})\.(\d{2})(?:\.(\d{2}))?/);
      if (dm) {
        sortKey = `${dm[1]}-${dm[2]}-${dm[3] || '01'}`;
      } else {
        const ym = title.match(/(\d{4})\s*年度/);
        if (ym) sortKey = `${ym[1]}-00-00`;
      }
      cur.albums.push({ title, url: am[2], flag, sortKey, idx: idx++ });
    }
  }
  return sections.filter(s => s.albums.length);
}

// UI 状態 (メモリ 保持、 タブ 切替 で リセット)
let openState = null;   // { [sectionTitle]: bool }
let sortMode  = 'section';  // 'section' | 'new' | 'old'
// v969 サムネ 追加分 の 情報 (photo_count)
const countCache = {};   // { url: N | null }

export async function renderNkmrAlbums() {
  const app = document.getElementById('app');
  const sections = parseAlbums(RAW);
  if (openState === null) {
    openState = {};
    sections.slice(0, 3).forEach(s => { openState[s.title] = true; });
  }
  const totalAlbums = sections.reduce((n, s) => n + s.albums.length, 0);

  const render = () => {
    const isFlat = sortMode !== 'section';
    let flatAlbums = null;
    if (isFlat) {
      flatAlbums = sections.flatMap(s => s.albums.map(a => ({ ...a, _sec: s.title })));
      flatAlbums.sort((a, b) => {
        // 日付 なし は 末尾 (新しい順) or 先頭 (古い順)? 情報 少ない ので 末尾 に。
        const ka = a.sortKey || '0000-00-00';
        const kb = b.sortKey || '0000-00-00';
        if (ka === kb) return a.idx - b.idx;
        return sortMode === 'new' ? kb.localeCompare(ka) : ka.localeCompare(kb);
      });
    }

    app.innerHTML = `
      <div class="card">
        <h2 style="margin:0">📸 中村研アルバム</h2>
        <div class="hint-sm" style="margin-top:6px">
          Google Photos で管理してる中村研の写真アルバム集 (${totalAlbums} 件)。
          タイル をタップで Google Photos が別タブで開きます。
          サムネ / 写真枚数 は 30 分毎 に バックグラウンド で 自動取得 されます。
        </div>
        <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap">
          <button data-nkm-sort="section" class="${sortMode==='section' ? 'primary' : ''}"
                  style="font-size:12px; padding:4px 10px">年度 別</button>
          <button data-nkm-sort="new" class="${sortMode==='new' ? 'primary' : ''}"
                  style="font-size:12px; padding:4px 10px">新しい順</button>
          <button data-nkm-sort="old" class="${sortMode==='old' ? 'primary' : ''}"
                  style="font-size:12px; padding:4px 10px">古い順</button>
        </div>
      </div>
      ${isFlat ? renderFlat(flatAlbums) : sections.map(sec => renderSection(sec)).join('')}
    `;
    // 開閉 ハンドラ (セクション 表示 の 時 だけ)
    app.querySelectorAll('[data-nkm-sec]').forEach(h => {
      h.addEventListener('click', () => {
        const t = h.dataset.nkmSec;
        openState[t] = !openState[t];
        render();
      });
    });
    app.querySelectorAll('[data-nkm-sort]').forEach(b => {
      b.addEventListener('click', () => {
        sortMode = b.dataset.nkmSort;
        render();
      });
    });
    // v969 表示中 URL の サムネ / 写真枚数 を DB キャッシュ から 引く (fetch 動作 なし、 即返却)
    lookupThumbs(currentVisibleUrls());
  };

  const renderSection = (sec) => {
    const isOpen = !!openState[sec.title];
    const chev = isOpen ? '▾' : '▸';
    return `
      <div class="card">
        <div data-nkm-sec="${escapeHtml(sec.title)}"
             style="cursor:pointer; display:flex; align-items:center; gap:8px; user-select:none">
          <span style="color:#9ca3af; width:16px; text-align:center">${chev}</span>
          <div class="bold" style="flex:1; font-size:15px">${escapeHtml(sec.title)}</div>
          <span class="hint-sm">${sec.albums.length} 件</span>
        </div>
        ${isOpen ? `<div class="nkm-tile-grid">${sec.albums.map(a => renderAlbumTile(a)).join('')}</div>` : ''}
      </div>
    `;
  };

  const renderFlat = (albums) => `
    <div class="card">
      <div class="nkm-tile-grid">${albums.map(a => renderAlbumTile(a)).join('')}</div>
    </div>
  `;

  render();
}

// v969 タイル 表示。 CSS Grid の auto-fill で 画面幅 に 応じて 段数 が 変わる。
//   サムネ 上、 タイトル (改行 可)、 flag + 写真枚数 バッジ、 で 縦 スタック。
function renderAlbumTile(a) {
  const thumbUrl = thumbCache[a.url];    // undefined = 未問合せ、 null = 未取得 / 失敗、 string = URL
  const count    = countCache[a.url];    // undefined / null / number
  const thumbNode = thumbUrl
    ? `<img src="${escapeHtml(thumbUrl)}" loading="lazy" class="nkm-thumb"
            style="width:100%; aspect-ratio: 4/3; object-fit:cover; background:#f3f4f6; display:block">`
    : `<div class="nkm-thumb" style="width:100%; aspect-ratio: 4/3; background:#f3f4f6; display:flex;
             align-items:center; justify-content:center; color:#9ca3af; font-size:26px">📷</div>`;
  const countBadge = (typeof count === 'number' && count > 0)
    ? `<span style="background:rgba(0,0,0,0.55); color:#fff; font-size:10px; padding:2px 6px;
                    border-radius:8px; position:absolute; right:6px; bottom:6px">📷 ${count}</span>`
    : '';
  const flagChip = a.flag
    ? `<span style="position:absolute; left:6px; top:6px; font-size:14px;
                    background:rgba(0,0,0,0.4); border-radius:4px; padding:0 4px">${a.flag}</span>`
    : '';
  return `
    <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"
       data-nkm-url="${escapeHtml(a.url)}" class="nkm-tile"
       style="display:block; text-decoration:none; color:inherit; border-radius:6px; overflow:hidden;
              background:#fff; border:1px solid #e5e7eb">
      <div style="position:relative">${thumbNode}${flagChip}${countBadge}</div>
      <div style="padding:6px 8px 8px; font-size:12px; line-height:1.35; color:#374151;
                  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden">
        ${escapeHtml(a.title)}
      </div>
    </a>`;
}

function currentVisibleUrls() {
  return Array.from(document.querySelectorAll('[data-nkm-url]'))
              .map(a => a.dataset.nkmUrl);
}

// v969 バックグラウンド fetch は cron 側 に 移した ので、 ここでは DB キャッシュ の 「引き」 のみ。
//   未取得 URL は cron が 埋める まで 待つ (次 の 表示 時 に 反映)。
let lookupInProgress = false;
async function lookupThumbs(urls) {
  if (lookupInProgress) return;
  const needAsk = urls.filter(u => thumbCache[u] === undefined || countCache[u] === undefined);
  if (!needAsk.length) return;
  lookupInProgress = true;
  try {
    const r = await post('/api/album-thumbs', { urls: needAsk.slice(0, 300) });
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
    // サムネ 差し替え
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
    // 写真枚数 バッジ
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

// v969 タイル グリッド CSS を 一度 だけ 差し込む
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
