import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CONTENT = `You are a professional short news assistant. Rewrite the provided raw user text into a concise, factual short news draft in the SAME language as the input (language code: {{languageCode}}).
Constraints:
- Title: <= 50 characters, punchy, no clickbait, no ALL CAPS, no emojis.
- Content: <= 60 words. Neutral, factual tone. No repetition. No speculation beyond given facts.
- Remove greetings, personal opinions, promotional lines, and unrelated chatter.
- Preserve key facts: who, what, where, when. If missing, do NOT invent.
Output STRICT JSON ONLY (no markdown) with schema: {"title": string, "content": string}.
InputTitle (may be empty): {{title}}
InputText: {{content}}`;

async function main() {
  await prisma.prompt.upsert({
    where: { key: 'SHORTNEWS_REWRITE' },
  create: { key: 'SHORTNEWS_REWRITE', content: CONTENT, description: 'Rewrite raw user text into short news (title<=50 chars, content<=60 words)' },
  update: { content: CONTENT, description: 'Rewrite raw user text into short news (title<=50 chars, content<=60 words)' },
  });
  console.log('SHORTNEWS_REWRITE prompt upserted.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
