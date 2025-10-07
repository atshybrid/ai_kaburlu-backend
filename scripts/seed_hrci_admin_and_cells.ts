import prisma from '../src/lib/prisma';

async function main() {
  console.log('Seeding HRCI admin role & default cells...');

  // 1. Upsert HRCI_ADMIN role
  const permissions = {
    hrc: {
      teams: ['create','read','update'],
      volunteers: ['onboard','assign'],
      idcards: ['issue','renew','revoke'],
      payments: ['create','refund','read'],
      cases: ['create','read','update','assign','close'],
      donations: ['read'],
    }
  };
  const hrcAdmin = await (prisma as any).role.upsert({
    where: { name: 'HRCI_ADMIN' },
    update: { permissions },
    create: { name: 'HRCI_ADMIN', permissions }
  });

  // Try to pick a state for scoping (optional)
  const state = await (prisma as any).state.findFirst();

  const baseCells = [
    {
      name: 'Complaint & Legal Support Cell',
      description: 'First point of contact for victims – intake, triage, legal referral.',
      scopeLevel: 'STATE',
      stateId: state?.id
    },
    {
      name: 'Women & Child Rights Cell',
      description: 'Handles domestic violence, child abuse, trafficking related issues.',
      scopeLevel: 'STATE',
      stateId: state?.id
    },
    {
      name: 'Social Justice Cell',
      description: 'Caste discrimination, labour exploitation, land rights advocacy.',
      scopeLevel: 'STATE',
      stateId: state?.id
    },
    {
      name: 'Awareness & Education Cell',
      description: 'School & college human rights awareness programs and training.',
      scopeLevel: 'STATE',
      stateId: state?.id
    }
  ];

  const results: string[] = [];
  for (const cell of baseCells) {
    const existing = await (prisma as any).hrcTeam.findFirst({ where: { name: cell.name } });
    if (existing) {
      results.push(existing.id);
    } else {
      const created = await (prisma as any).hrcTeam.create({ data: { ...cell, active: true } });
      results.push(created.id);
    }
  }

  console.log('Seeded HRCI admin & cells', { hrcAdmin: hrcAdmin.id, cells: results.length });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
