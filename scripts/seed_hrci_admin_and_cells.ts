import prisma from '../src/lib/prisma';

async function main() {
  console.log('Seeding default cells...');

  // Try to pick a state for scoping (optional)
  const state = await (prisma as any).state.findFirst();

  const baseCells = [
    {
      name: 'Complaint & Legal Support Cell',
      description: 'First point of contact for victims – intake, triage, legal referral.',
      scopeLevel: 'STATE',
      stateId: state?.id,
      cellType: 'COMPLAINT_LEGAL_SUPPORT'
    },
    {
      name: 'Women & Child Rights Cell',
      description: 'Handles domestic violence, child abuse, trafficking related issues.',
      scopeLevel: 'STATE',
      stateId: state?.id,
      cellType: 'WOMEN_CHILD_RIGHTS'
    },
    {
      name: 'Social Justice Cell',
      description: 'Caste discrimination, labour exploitation, land rights advocacy.',
      scopeLevel: 'STATE',
      stateId: state?.id,
      cellType: 'SOCIAL_JUSTICE'
    },
    {
      name: 'Awareness & Education Cell',
      description: 'School & college human rights awareness programs and training.',
      scopeLevel: 'STATE',
      stateId: state?.id,
      cellType: 'AWARENESS_EDUCATION'
    }
  ];

  const results: string[] = [];
  for (const cell of baseCells) {
    const existing = await (prisma as any).hrcTeam.findFirst({ where: { name: cell.name } });
    if (existing) {
      if (!existing.cellType) {
        await (prisma as any).hrcTeam.update({ where: { id: existing.id }, data: { cellType: cell.cellType } });
      }
      results.push(existing.id);
    } else {
      const created = await (prisma as any).hrcTeam.create({ data: { ...cell, active: true } });
      results.push(created.id);
    }
  }

  console.log('Seeded cells', { cells: results.length });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
