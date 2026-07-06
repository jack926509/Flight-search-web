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

  airports.push({
    iata,
    name: (row.name ?? "").replace(/"/g, ""),
    city: (row.municipality ?? row.iso_region ?? "").replace(/"/g, ""),
    country: row.iso_country ?? "",
  });
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
