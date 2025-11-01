require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyIdCardSettings() {
  try {
    console.log('🔍 Verifying ID Card Settings...\n');
    
    // Get the active setting
    const activeSetting = await (prisma as any).idCardSetting.findFirst({
      where: { isActive: true }
    });

    if (!activeSetting) {
      console.log('❌ No active ID card setting found');
      return;
    }

    console.log('✅ Active ID Card Setting Found');
    console.log('📋 Setting Details:');
    console.log(`   ID: ${activeSetting.id}`);
    console.log(`   Name: ${activeSetting.name}`);
    console.log(`   Active: ${activeSetting.isActive}`);
    
    console.log('\n🏢 Office Addresses:');
    console.log('   Head Office:');
    console.log(`   ${activeSetting.headOfficeAddress || 'Not set'}`);
    
    console.log('\n   Regional Office:');
    console.log(`   ${activeSetting.regionalOfficeAddress || 'Not set'}`);
    
    console.log('\n   Administration Office:');
    console.log(`   ${activeSetting.administrationOfficeAddress || 'Not set'}`);
    
    console.log('\n📞 Contact Numbers:');
    console.log(`   Contact 1: ${activeSetting.contactNumber1 || 'Not set'}`);
    console.log(`   Contact 2: ${activeSetting.contactNumber2 || 'Not set'}`);
    
    console.log('\n🎨 Visual Settings:');
    console.log(`   Primary Color: ${activeSetting.primaryColor || 'Not set'}`);
    console.log(`   Secondary Color: ${activeSetting.secondaryColor || 'Not set'}`);
    console.log(`   Front H1: ${activeSetting.frontH1 || 'Not set'}`);
    console.log(`   Front H2: ${activeSetting.frontH2 || 'Not set'}`);
    
    // Check if we have any ID cards to test with
    const cardCount = await prisma.iDCard.count();
    console.log(`\n🆔 Total ID Cards in system: ${cardCount}`);
    
    if (cardCount > 0) {
      const sampleCard = await prisma.iDCard.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      console.log(`   Latest card number: ${sampleCard?.cardNumber}`);
      console.log(`   👀 Test URL: http://localhost:3001/hrci/idcard/${sampleCard?.cardNumber}/html`);
    }

  } catch (error) {
    console.error('❌ Error verifying settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyIdCardSettings();