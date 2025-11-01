import 'dotenv-flow/config';
import '../src/config/env';
import fs from 'fs';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET, getPublicUrl } from '../src/lib/r2';
import prisma from '../src/lib/prisma';

async function main() {
  const localPath = (process.argv[2] || '').trim();
  if (!localPath) {
    console.error('Usage: npx ts-node scripts/upload_letterhead.ts <local-pdf-path>');
    process.exit(1);
  }
  const abs = path.resolve(localPath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(2);
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext !== '.pdf') {
    console.error('Only PDF letterheads are supported. Provided:', ext);
    process.exit(3);
  }
  if (!R2_BUCKET) {
    console.error('R2 not configured. Please set R2_BUCKET and credentials.');
    process.exit(4);
  }

  const buf = fs.readFileSync(abs);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const fileName = `letterhead-${now.getTime()}.pdf`;
  const key = `org/letterhead/${year}/${month}/${fileName}`;

  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'application/pdf',
    CacheControl: 'public, max-age=31536000',
  }));
  const publicUrl = getPublicUrl(key);
  console.log('[upload] stored at:', publicUrl);

  const org = await prisma.orgSetting.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!org) {
    console.error('No OrgSetting found. Seed org settings first.');
    process.exit(5);
  }
  const docs = Array.isArray((org as any).documents) ? ((org as any).documents as any[]) : [];
  const idx = docs.findIndex((d: any) => {
    const t = String(d?.type || '').toLowerCase();
    const title = String(d?.title || '').toLowerCase();
    return t === 'letterhead' || title.includes('letterhead');
  });
  const entry = { type: 'letterhead', title: 'Letterhead PDF', url: publicUrl } as any;
  if (idx >= 0) docs[idx] = { ...docs[idx], ...entry };
  else docs.push(entry);

  await prisma.orgSetting.update({ where: { id: org.id }, data: { documents: docs as any } });
  console.log('[org] OrgSetting updated with letterhead.');
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(10); });
