import prisma from '../src/lib/prisma';

const cells = [
  {
    code: 'COMPLAINT_LEGAL_SUPPORT',
    title: 'Complaint & Legal Support Cell',
    description: 'First point of contact for victims; intake, guidance and legal coordination.'
  },
  {
    code: 'WOMEN_CHILD_RIGHTS',
    title: 'Women & Child Rights Cell',
    description: 'Focus on domestic violence, child abuse, trafficking and protective interventions.'
  },
  {
    code: 'SOCIAL_JUSTICE',
    title: 'Social Justice Cell',
    description: 'Handles caste discrimination, labour exploitation, land and livelihood rights.'
  },
  {
    code: 'AWARENESS_EDUCATION',
    title: 'Awareness & Education Cell',
    description: 'Conducts human rights awareness programs in schools, colleges and communities.'
  }
];

async function main() {
  for (const c of cells) {
    const existing = await (prisma as any).hrcCellCatalog.findFirst({ where: { code: c.code } });
    if (existing) {
      console.log('Exists:', c.code);
      continue;
    }
    await (prisma as any).hrcCellCatalog.create({ data: c });
    console.log('Created:', c.code);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await (prisma as any).$disconnect(); });
