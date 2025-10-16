import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// New moderation prompt text (from product requirement) for strict JSON response
const NEW_MODERATION_PROMPT = `Content moderation for news. Analyze the text for plagiarism likelihood and sensitive content (violence, hate, adult, personal data).
Return STRICT JSON: {"plagiarismScore": number (0-1), "sensitiveFlags": string[], "decision": "ALLOW"|"REVIEW"|"BLOCK", "remark": string (short, in {{languageCode}})}.
Text: {{content}}`;

async function main() {
  const existing = await prisma.prompt.findUnique({ where: { key: 'MODERATION' } });
  if (!existing) {
    await prisma.prompt.create({ data: { key: 'MODERATION', content: NEW_MODERATION_PROMPT, description: 'High precision moderation (low false positives)' } });
    console.log('Created MODERATION prompt.');
  } else {
    await prisma.prompt.update({ where: { key: 'MODERATION' }, data: { content: NEW_MODERATION_PROMPT, description: 'High precision moderation (low false positives)' } });
    console.log('Updated MODERATION prompt.');
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
