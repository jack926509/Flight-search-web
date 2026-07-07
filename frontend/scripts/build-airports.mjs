/**
 * Build public/airports.json from OurAirports CSV.
 * Download: https://davidmegginson.github.io/ourairports-data/airports.csv
 * Place at: /data/airports.csv (repo root)
 * Run: npm run build:airports
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../data/airports.csv");
const OUT_PATH = resolve(__dirname, "../public/airports.json");

const ALLOWED_TYPES = new Set(["large_airport", "medium_airport"]);

// 中文別名（城市＋機場常用名）— 只掛在主要機場上，控制 JSON 體積。
// Fuse 以 zh 欄位比對，讓「東京」「大阪」等中文查詢命中。
const ZH_ALIASES = {
  // 台灣
  TPE: "台北 臺北 桃園 桃園國際機場",
  TSA: "台北 臺北 松山 松山機場",
  KHH: "高雄 小港",
  RMQ: "台中 臺中 清泉崗",
  TNN: "台南 臺南",
  HUN: "花蓮",
  TTT: "台東 臺東",
  KNH: "金門",
  MZG: "澎湖 馬公",
  // 日本
  NRT: "東京 成田",
  HND: "東京 羽田",
  KIX: "大阪 關西 关西",
  ITM: "大阪 伊丹",
  NGO: "名古屋 中部",
  FUK: "福岡 福冈",
  CTS: "札幌 新千歲 北海道",
  OKA: "沖繩 冲绳 那霸",
  SDJ: "仙台",
  HIJ: "廣島 广岛",
  KOJ: "鹿兒島 鹿儿岛",
  KMJ: "熊本",
  TAK: "高松",
  MYJ: "松山 愛媛",
  KIJ: "新潟",
  AOJ: "青森",
  AKJ: "旭川",
  HKD: "函館 函馆",
  ISG: "石垣",
  MMY: "宮古 宫古",
  // 韓國
  ICN: "首爾 首尔 仁川",
  GMP: "首爾 首尔 金浦",
  PUS: "釜山 金海",
  CJU: "濟州 济州",
  TAE: "大邱",
  // 港澳中國
  HKG: "香港 赤鱲角",
  MFM: "澳門 澳门",
  PVG: "上海 浦東 浦东",
  SHA: "上海 虹橋 虹桥",
  PEK: "北京 首都",
  PKX: "北京 大興 大兴",
  CAN: "廣州 广州 白雲 白云",
  SZX: "深圳 寶安 宝安",
  CTU: "成都 天府",
  XMN: "廈門 厦门",
  FOC: "福州",
  HGH: "杭州 蕭山 萧山",
  NKG: "南京 祿口 禄口",
  CKG: "重慶 重庆",
  XIY: "西安 咸陽 咸阳",
  KMG: "昆明",
  WUH: "武漢 武汉",
  // 東南亞
  SIN: "新加坡 樟宜",
  BKK: "曼谷 蘇凡納布 素萬那普",
  DMK: "曼谷 廊曼",
  CNX: "清邁 清迈",
  HKT: "普吉",
  KUL: "吉隆坡",
  PEN: "檳城 槟城",
  MNL: "馬尼拉 马尼拉",
  CEB: "宿霧 宿雾",
  SGN: "胡志明 西貢 西贡",
  HAN: "河內 河内",
  DAD: "峴港 岘港",
  CXR: "芽莊 芽庄 金蘭 金兰",
  PQC: "富國島 富国岛",
  RGN: "仰光",
  PNH: "金邊 金边",
  CGK: "雅加達 雅加达",
  DPS: "峇里島 巴厘岛 峇里 巴里",
  // 美加
  LAX: "洛杉磯 洛杉矶",
  SFO: "舊金山 旧金山 三藩市",
  SEA: "西雅圖 西雅图",
  JFK: "紐約 纽约 甘迺迪 肯尼迪",
  EWR: "紐約 纽约 紐華克 纽瓦克",
  ORD: "芝加哥",
  BOS: "波士頓 波士顿",
  IAH: "休士頓 休斯顿",
  DFW: "達拉斯 达拉斯",
  LAS: "拉斯維加斯 拉斯维加斯",
  SAN: "聖地牙哥 圣地亚哥",
  HNL: "檀香山 夏威夷",
  YVR: "溫哥華 温哥华",
  YYZ: "多倫多 多伦多",
  YUL: "蒙特婁 蒙特利尔",
  // 歐洲／其他
  LHR: "倫敦 伦敦 希斯洛 希思罗",
  LGW: "倫敦 伦敦 蓋威克 盖特威克",
  CDG: "巴黎 戴高樂 戴高乐",
  FRA: "法蘭克福 法兰克福",
  MUC: "慕尼黑",
  AMS: "阿姆斯特丹",
  ZRH: "蘇黎世 苏黎世",
  VIE: "維也納 维也纳",
  FCO: "羅馬 罗马",
  MXP: "米蘭 米兰",
  MAD: "馬德里 马德里",
  BCN: "巴塞隆納 巴塞罗那",
  IST: "伊斯坦堡 伊斯坦布尔",
  DXB: "杜拜 迪拜",
  DOH: "杜哈 多哈",
  SYD: "雪梨 悉尼",
  MEL: "墨爾本 墨尔本",
  BNE: "布里斯本 布里斯班",
  AKL: "奧克蘭 奥克兰",
  GUM: "關島 关岛",
  SPN: "塞班",
  PLW: "帛琉 帕劳",
};

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

let headers = null;
const airports = [];

const rl = createInterface({ input: createReadStream(CSV_PATH), crlfDelay: Infinity });

rl.on("line", (line) => {
  const fields = parseCSVLine(line);
  if (!headers) {
    headers = fields;
    return;
  }
  const row = Object.fromEntries(headers.map((h, i) => [h, fields[i] ?? ""]));
  const type = row.type ?? "";
  const iata = (row.iata_code ?? "").trim();
  if (!ALLOWED_TYPES.has(type) || !iata || iata.length !== 3) return;
  if (row.scheduled_service !== "yes") return;

  const entry = {
    iata,
    name: (row.name ?? "").replace(/"/g, ""),
    city: (row.municipality ?? row.iso_region ?? "").replace(/"/g, ""),
    country: row.iso_country ?? "",
  };
  if (ZH_ALIASES[iata]) entry.zh = ZH_ALIASES[iata];
  airports.push(entry);
});

rl.on("close", () => {
  airports.sort((a, b) => a.iata.localeCompare(b.iata));
  const json = JSON.stringify(airports);
  writeFileSync(OUT_PATH, json);
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`✓ Wrote ${airports.length} airports → ${OUT_PATH} (${kb} KB)`);
  if (parseFloat(kb) > 300) {
    console.warn(`⚠ Output ${kb} KB exceeds 300 KB target — consider filtering`);
  }
});
