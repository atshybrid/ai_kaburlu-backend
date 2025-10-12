import axios from 'axios';
import * as cheerio from 'cheerio';

/*
 Structured scraper for Andhra Pradesh mandals.
 Goal: Produce CSV: state,district,mandal,revenueDivision (state fixed to 'Andhra Pradesh').
 This tries to parse the primary wikitable containing the 679 mandals.
 Because Wikipedia structure can change, treat output as a starting point not a final authority.

 Limitations / Notes:
 - Some mandal rows might include disambiguation or urban/rural suffix (e.g., 'Kadapa mandal'). Keep as-is.
 - We normalize whitespace; we do not alter capitalization.
 - Deduplicates exact (district, mandal) pairs.
 - If resulting count != 679, investigate: layout changes, split tables, or parsing errors.

 Usage:
   npx ts-node scripts/fetch_ap_mandals_structured.ts > data/tmp_ap_mandals.csv
*/

const WIKI_URL = 'https://en.wikipedia.org/wiki/List_of_mandals_of_Andhra_Pradesh';

interface Row { mandal: string; revenueDivision: string; district: string; }

async function main() {
  const { data } = await axios.get(WIKI_URL, { headers: { 'User-Agent': 'kaburlu-seed-bot/1.0' } });
  const $ = cheerio.load(data);

  const rows: Row[] = [];

  // Heuristic: pick tables with class 'wikitable' that contain the phrase 'mandal' in header.
  $('table.wikitable').each((_, tbl) => {
    const headerText = $(tbl).find('th').first().text().toLowerCase();
    if (!/mandal/.test(headerText)) return; // skip unrelated tables

    $(tbl).find('tr').each((ri, tr) => {
      if (ri === 0) return; // skip header
      const tds = $(tr).find('td');
      if (tds.length < 1) return;
      // The expected columns (observed current format): Mandal | Revenue division | District
      // Sometimes revenue division may be absent or merged; handle lengths.
      const mandalRaw = $(tds[0]).text().trim();
      if (!mandalRaw) return;
      // Filter out spurious rows (like notes)
      if (/^note:/i.test(mandalRaw)) return;

      let revenueDivision = '';
      let district = '';
      if (tds.length >= 2) revenueDivision = $(tds[1]).text().trim();
      if (tds.length >= 3) district = $(tds[2]).text().trim();

      // Basic cleaning
      const clean = (s: string) => s.replace(/\[[^\]]+\]/g, '') // remove reference [1]
        .replace(/\s+/g, ' ')
        .replace(/\u00a0/g, ' ')
        .trim();

      const mandal = clean(mandalRaw.replace(/ mandal$/i, ' mandal')); // ensure consistent trailing ' mandal'
      revenueDivision = clean(revenueDivision.replace(/ revenue division$/i, ' revenue division'));
      district = clean(district.replace(/ district$/i, ' district'));

      if (!/mandal$/i.test(mandal)) return; // ensure it's actually a mandal row

      rows.push({ mandal, revenueDivision, district });
    });
  });

  // Deduplicate
  const dedupMap = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.district}|${r.mandal}`.toLowerCase();
    if (!dedupMap.has(key)) dedupMap.set(key, r);
  }
  const deduped = Array.from(dedupMap.values()).sort((a, b) => a.mandal.localeCompare(b.mandal));

  console.log('# state,district,mandal,revenueDivision');
  console.log(`# source: ${WIKI_URL}`);
  console.log(`# scrapedAt: ${new Date().toISOString()}`);
  console.log(`# count: ${deduped.length}`);
  for (const r of deduped) {
    // Escape commas inside fields if any (not expected) by wrapping in quotes
    const esc = (v: string) => /,/.test(v) ? `"${v}"` : v;
    console.log(`Andhra Pradesh,${esc(r.district || '')},${esc(r.mandal)},${esc(r.revenueDivision || '')}`);
  }

  if (deduped.length !== 679) {
    console.error(`# WARNING: Expected 679 mandals, got ${deduped.length}. Manual review needed.`);
  } else {
    console.error('# SUCCESS: 679 mandals captured.');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
