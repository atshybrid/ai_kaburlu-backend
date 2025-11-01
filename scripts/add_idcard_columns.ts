require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addIdCardColumns() {
  try {
    // Check if columns already exist by trying to query them
    try {
      await prisma.$queryRaw`SELECT "regionalOfficeAddress" FROM "IdCardSetting" LIMIT 1`;
      console.log('✅ Columns already exist, skipping migration');
      return;
    } catch (error) {
      // Columns don't exist, we'll add them
      console.log('Adding new columns to IdCardSetting table...');
    }

    // Add the new columns
    await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "regionalOfficeAddress" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "administrationOfficeAddress" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "contactNumber1" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "contactNumber2" TEXT`;

    console.log('✅ Successfully added new columns to IdCardSetting table');
    
    // Verify columns were added
    const result = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'IdCardSetting' AND column_name IN ('regionalOfficeAddress', 'administrationOfficeAddress', 'contactNumber1', 'contactNumber2')`;
    console.log('Added columns:', result);

  } catch (error) {
    console.error('❌ Error adding columns:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

addIdCardColumns();