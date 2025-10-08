import prisma from '../src/lib/prisma';

async function main() {
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await (prisma as any).$disconnect(); });
