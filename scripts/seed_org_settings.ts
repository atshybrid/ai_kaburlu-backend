// Ensure environment is loaded before Prisma client is instantiated
require('dotenv-flow').config();
import '../src/config/env';
import prisma from '../src/lib/prisma';

async function main() {
  const sample = {
    orgName: 'HUMAN RIGHTS COUNCIL FOR INDIA',
    addressLine1: '7/19 CENAL CENTER KARAMCHEDU',
    addressLine2: 'PRAKASAM',
    city: 'BAPATLA',
    state: 'Andhra Pradesh',
    pincode: '523138',
    country: 'INDIA',
    pan: 'AACTH7205E',
    eightyGNumber: 'AACTH7205E24HY02',
    eightyGValidFrom: new Date('2025-10-16T18:28:24.245Z'),
    eightyGValidTo: new Date('2030-10-16T18:28:24.245Z'),
    email: '',
    phone: '',
    website: '',
    authorizedSignatoryName: 'Srikanth CH',
    authorizedSignatoryTitle: 'Srikanth CH',
    hrciLogoUrl: 'https://pub-b13a983e33694dbd96cd42158ce2147b.r2.dev/string/2025/10/14/string.png',
    stampRoundUrl: 'https://pub-b13a983e33694dbd96cd42158ce2147b.r2.dev/string/2025/10/14/string.png',
    documents: [
      { title: '', url: '', type: '' }
    ] as any
  };

  const existing = await (prisma as any).orgSetting.findFirst({ orderBy: { createdAt: 'desc' } });
  if (existing) {
    await (prisma as any).orgSetting.update({ where: { id: existing.id }, data: sample });
    console.log('OrgSetting updated:', existing.id);
  } else {
    const created = await (prisma as any).orgSetting.create({ data: sample });
    console.log('OrgSetting created:', created.id);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
