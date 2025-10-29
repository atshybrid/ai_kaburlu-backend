import axios from 'axios';
import * as cheerio from 'cheerio';

/*
  Utility script: Fetch Andhra Pradesh mandal names from Wikipedia.
  This is a helper to assist manual verification and CSV completion.
  It does NOT persist to the database.

  Usage:
    npx ts-node scripts/fetch_ap_mandals.ts > ap_mandals_scrape.txt

  Notes:
  - Wikipedia structure may change; this scraper uses defensive parsing.
  - The official authoritative source is the Government of AP (Socio Economic Survey 2022-23, p.431).
  - After generating list, manually map mandals to correct district names used in your DB.
*/

const WIKI_URL = 'https://en.wikipedia.org/wiki/List_of_mandals_of_Andhra_Pradesh';

async function main() {
  const { data } = await axios.get(WIKI_URL, { headers: { 'User-Agent': 'kaburlu-seed-bot/1.0' } });
  const $ = cheerio.load(data);

  // Strategy: Find tables or lists that contain mandal rows.
  // The page uses a big table; We'll collect all cells containing 'mandal' token.
  const mandalSet = new Set<string>();

  // Avoid relying on specific Cheerio element types for maximum compatibility
  $('table, tr, td, li').each((_: number, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    // Heuristic: lines ending with ' mandal' or containing ' mandal ' or with 'Mandal' (case-insensitive)
    const lowered = text.toLowerCase();
    if (/(^|\s)[a-z0-9'.()-]*mandal(\s|$)/i.test(lowered)) {
      // Extract possible mandal name tokens by splitting pipe-separated or cell text
      // We'll simplify: remove ' revenue division' and ' district' substrings
      let cleaned = text
        .replace(/revenue division/gi, '')
        .replace(/district/gi, '')
        .replace(/\bmandals?\b/gi, 'mandal')
        .replace(/\s+/g, ' ')
        .trim();

      // Split on | if present (some wiki extraction patterns)
  const parts = cleaned.split(/\|/).map((p: string) => p.trim()).filter(Boolean);
  parts.forEach((p: string) => {
        // Only keep items ending with 'mandal'
        if (/mandal$/i.test(p)) {
          // Normalize capitalization (retain original except trimming)
          const norm = p.replace(/\s+mandal$/i, ' mandal');
          mandalSet.add(norm);
        }
      });
      // Fallback: if cleaned itself is a single mandal
      if (/mandal$/i.test(cleaned)) mandalSet.add(cleaned.replace(/\s+mandal$/i, ' mandal'));
    }
  });

  const mandals = Array.from(mandalSet).sort((a, b) => a.localeCompare(b));
  console.log(`# Extracted mandal-like entries (unique) from ${WIKI_URL}`);
  console.log(`# Count: ${mandals.length}`);
  console.log('mandal');
  mandals.forEach(m => console.log(m));
}

main().catch(err => {
  console.error('Error fetching/parsing:', err);
  process.exit(1);
});
