require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const p: any = prisma;

async function updateIdCardSettingAddresses() {
  try {
    // Find the active ID card setting
    const activeSetting = await p.idCardSetting.findFirst({
      where: { isActive: true }
    });

    if (!activeSetting) {
      console.log('No active ID card setting found. Creating default setting...');
      
      const newSetting = await p.idCardSetting.create({
        data: {
          name: 'default',
          isActive: true,
          primaryColor: '#0d6efd',
          secondaryColor: '#6c757d',
          frontH1: 'Human Rights & Civil Initiatives',
          frontH2: 'Identity Card',
          frontFooterText: 'This card remains property of HRCI and must be returned upon request.',
          registerDetails: 'Registered under Societies Act. Valid for 12 months from issue date.',
          headOfficeAddress: '7/19 CENAL CENTER KARAMCHEDU\nPRAKASAM, BAPATLA\nAndhra Pradesh - 523138\nINDIA',
          regionalOfficeAddress: 'Regional Office Address\nCity, State - PIN\nINDIA',
          administrationOfficeAddress: 'Administration Office Address\nCity, State - PIN\nINDIA',
          contactNumber1: '+91-9876543210',
          contactNumber2: '+91-9876543211'
        }
      });
      
      console.log('✅ Created new ID card setting with office addresses and contact numbers:', newSetting.id);
      return;
    }

    // Update existing setting with sample office addresses and contact numbers
    const updated = await p.idCardSetting.update({
      where: { id: activeSetting.id },
      data: {
        headOfficeAddress: activeSetting.headOfficeAddress || '7/19 CENAL CENTER KARAMCHEDU\nPRAKASAM, BAPATLA\nAndhra Pradesh - 523138\nINDIA',
        regionalOfficeAddress: 'Regional Office Complex\nMain Road, Commercial District\nHyderabad, Telangana - 500001\nINDIA',
        administrationOfficeAddress: 'Administration Wing\nGovernment Complex, Sector-12\nNew Delhi - 110001\nINDIA',
        contactNumber1: '+91-9876543210',
        contactNumber2: '+91-9876543211'
      }
    });

    console.log('✅ Updated ID card setting with office addresses and contact numbers');
    console.log('Setting ID:', updated.id);
    console.log('Head Office:', updated.headOfficeAddress);
    console.log('Regional Office:', updated.regionalOfficeAddress);
    console.log('Administration Office:', updated.administrationOfficeAddress);
    console.log('Contact 1:', updated.contactNumber1);
    console.log('Contact 2:', updated.contactNumber2);

  } catch (error) {
    console.error('❌ Error updating ID card setting:', error);
    throw error;
  }
}

async function main() {
  await updateIdCardSettingAddresses();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });