require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function applyIdCardChangesToDevDB() {
  console.log('🔧 Applying ID Card changes to Development Database...\n');
  
  try {
    // Check current environment
    const envType = process.env.ENV_TYPE;
    const dbUrl = process.env.DATABASE_URL;
    console.log(`📊 Environment: ${envType}`);
    console.log(`🗄️  Database: ${dbUrl?.substring(0, 50)}...`);
    
    if (envType !== 'dev') {
      console.log('⚠️  Warning: ENV_TYPE is not set to "dev". Current value:', envType);
    }
    
    // Step 1: Check if columns already exist
    console.log('🔍 Checking if columns exist...');
    try {
      await prisma.$queryRaw`SELECT "regionalOfficeAddress" FROM "IdCardSetting" LIMIT 1`;
      console.log('✅ Columns already exist in dev database');
    } catch (error) {
      console.log('➕ Adding new columns to dev database...');
      
      // Add the new columns to dev database
      await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "regionalOfficeAddress" TEXT`;
      await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "administrationOfficeAddress" TEXT`;
      await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "contactNumber1" TEXT`;
      await prisma.$executeRaw`ALTER TABLE "IdCardSetting" ADD COLUMN IF NOT EXISTS "contactNumber2" TEXT`;
      
      console.log('✅ Successfully added columns to dev database');
    }
    
    // Step 2: Check if we have an active ID card setting
    const activeSetting = await (prisma as any).idCardSetting.findFirst({
      where: { isActive: true }
    });
    
    if (!activeSetting) {
      console.log('📋 No active ID card setting found. Creating default setting...');
      
      const newSetting = await (prisma as any).idCardSetting.create({
        data: {
          name: 'HRCI Development Setting',
          isActive: true,
          primaryColor: '#0d6efd',
          secondaryColor: '#6c757d',
          frontH1: 'HUMAN RIGHTS COUNCIL FOR INDIA',
          frontH2: 'Identity Card',
          frontFooterText: 'This card remains property of HRCI and must be returned upon request.',
          registerDetails: 'Registered under Societies Act. Valid for 12 months from issue date.',
          headOfficeAddress: `HEAD OFFICE
7/19 CENAL CENTER KARAMCHEDU
PRAKASAM, BAPATLA
Andhra Pradesh - 523138, INDIA`,
          regionalOfficeAddress: `REGIONAL OFFICE
Regional Complex, Main Road
Commercial District
Hyderabad, Telangana - 500001, INDIA`,
          administrationOfficeAddress: `ADMINISTRATION OFFICE
Government Complex, Sector-12
Administrative Wing
New Delhi - 110001, INDIA`,
          contactNumber1: '+91-9876543210',
          contactNumber2: '+91-9876543211'
        }
      });
      
      console.log('✅ Created new ID card setting with all office addresses');
      console.log('   Setting ID:', newSetting.id);
    } else {
      console.log('📋 Updating existing active setting...');
      
      // Update existing setting with new fields
      const updated = await (prisma as any).idCardSetting.update({
        where: { id: activeSetting.id },
        data: {
          headOfficeAddress: activeSetting.headOfficeAddress || `HEAD OFFICE
7/19 CENAL CENTER KARAMCHEDU
PRAKASAM, BAPATLA
Andhra Pradesh - 523138, INDIA`,
          regionalOfficeAddress: `REGIONAL OFFICE
Regional Complex, Main Road
Commercial District
Hyderabad, Telangana - 500001, INDIA`,
          administrationOfficeAddress: `ADMINISTRATION OFFICE
Government Complex, Sector-12
Administrative Wing
New Delhi - 110001, INDIA`,
          contactNumber1: '+91-9876543210',
          contactNumber2: '+91-9876543211'
        }
      });
      
      console.log('✅ Updated existing ID card setting');
      console.log('   Setting ID:', updated.id);
    }
    
    // Step 3: Verify the final state
    console.log('\n🔍 Verifying dev database state...');
    const finalSetting = await (prisma as any).idCardSetting.findFirst({
      where: { isActive: true }
    });
    
    if (finalSetting) {
      console.log('✅ Development database is ready!');
      console.log('\n🏢 Office Addresses configured:');
      console.log('   ✓ Head Office:', !!finalSetting.headOfficeAddress);
      console.log('   ✓ Regional Office:', !!finalSetting.regionalOfficeAddress);
      console.log('   ✓ Administration Office:', !!finalSetting.administrationOfficeAddress);
      console.log('\n📞 Contact Numbers configured:');
      console.log('   ✓ Contact 1:', finalSetting.contactNumber1 || 'Not set');
      console.log('   ✓ Contact 2:', finalSetting.contactNumber2 || 'Not set');
      
      // Check for any existing ID cards
      const cardCount = await prisma.iDCard.count();
      console.log(`\n🆔 ID Cards in dev database: ${cardCount}`);
      
      if (cardCount > 0) {
        const sampleCard = await prisma.iDCard.findFirst({
          orderBy: { createdAt: 'desc' }
        });
        console.log(`   Latest card: ${sampleCard?.cardNumber}`);
        console.log(`   🔗 Test URL: http://localhost:3001/hrci/idcard/${sampleCard?.cardNumber}/html`);
      }
    }
    
    console.log('\n✅ Development database update complete!');
    
  } catch (error) {
    console.error('❌ Error updating dev database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

applyIdCardChangesToDevDB();