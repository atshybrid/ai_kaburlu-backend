require('dotenv-flow').config();
import '../src/config/env';
import { PrismaClient } from '@prisma/client';
import { generateNextIdCardNumber } from '../src/lib/idCardNumber';

const prisma = new PrismaClient();
const p: any = prisma;

async function seedDevIdCardData() {
  console.log('🌱 Seeding development database with ID card test data...\n');
  
  try {
    // Check if we already have test data
    const existingCards = await prisma.iDCard.count();
    if (existingCards > 0) {
      console.log(`✅ Development database already has ${existingCards} ID cards`);
      return;
    }
    
    console.log('📋 Creating test users and memberships...');
    
    // Create test users if they don't exist
    const testUsers = [
      {
        mobileNumber: '9876543210',
        mpin: '$2b$10$kH.laSBSVvP5t0/j95pxi.zdPhwIThzO7WxrDKeeeZYjufmx4bsDW', // hashed "1234"
        fullName: 'Test User One',
        email: 'testuser1@example.com'
      },
      {
        mobileNumber: '9876543211',
        mpin: '$2b$10$kH.laSBSVvP5t0/j95pxi.zdPhwIThzO7WxrDKeeeZYjufmx4bsDW', // hashed "1234"
        fullName: 'Test User Two',
        email: 'testuser2@example.com'
      }
    ];
    
    for (const userData of testUsers) {
      // Check if user exists
      let user = await prisma.user.findUnique({
        where: { mobileNumber: userData.mobileNumber }
      });
      
      if (!user) {
        // Get or create default role
        let memberRole = await prisma.role.findFirst({
          where: { name: 'MEMBER' }
        });
        
        if (!memberRole) {
          memberRole = await prisma.role.create({
            data: {
              name: 'MEMBER',
              permissions: { member: ['read'] }
            }
          });
        }
        
        // Get default language
        let language = await prisma.language.findFirst();
        if (!language) {
          language = await prisma.language.create({
            data: {
              code: 'en',
              name: 'English',
              nativeName: 'English'
            }
          });
        }
        
        // Create user
        user = await prisma.user.create({
          data: {
            mobileNumber: userData.mobileNumber,
            mpin: userData.mpin,
            roleId: memberRole.id,
            languageId: language.id
          }
        });
        
        // Create profile
        await prisma.userProfile.create({
          data: {
            userId: user.id,
            fullName: userData.fullName,
            profilePhotoUrl: 'https://via.placeholder.com/150x150/0d6efd/ffffff?text=HRCI'
          }
        });
        
        console.log(`✅ Created test user: ${userData.fullName}`);
      }
    }
    
    // Get test users
    const users = await prisma.user.findMany({
      where: {
        mobileNumber: {
          in: ['9876543210', '9876543211']
        }
      },
      include: {
        profile: true
      }
    });
    
    // Create basic organizational structure for memberships
    let generalBodyCell = await (p.cell?.findFirst?.({
      where: { name: 'General Body' }
    })) || null;
    
    if (!generalBodyCell) {
      generalBodyCell = await (p.cell?.create?.({
        data: {
          name: 'General Body',
          code: 'GENERAL_BODY',
          level: 'NATIONAL',
          isActive: true
        }
      })) || null;
    }
    
    let memberDesignation = await (p.designation?.findFirst?.({
      where: { name: 'Member' }
    })) || null;
    
    if (!memberDesignation) {
      memberDesignation = await (p.designation?.create?.({
        data: {
          name: 'Member',
          code: 'MEMBER',
          defaultCapacity: 1000000,
          orderRank: 10
        }
      })) || null;
    }
    
    console.log('🆔 Creating test ID cards...');
    
    // Create memberships and ID cards for test users
    for (const user of users) {
      if (!user.profile) continue;
      
      // Create membership
      const membership = await (p.membership?.create?.({
        data: {
          userId: user.id,
          cellId: generalBodyCell.id,
          designationId: memberDesignation.id,
          level: 'NATIONAL',
          status: 'ACTIVE'
        }
      })) || null;
      
      if (membership) {
        // Generate ID card
        const cardNumber = await generateNextIdCardNumber(prisma as any);
        
        const idCard = await prisma.iDCard.create({
          data: {
            membershipId: membership.id,
            cardNumber,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
            fullName: user.profile.fullName,
            mobileNumber: user.mobileNumber,
            designationName: memberDesignation.name,
            cellName: generalBodyCell.name
          } as any
        });
        
        console.log(`✅ Created ID card: ${cardNumber} for ${user.profile.fullName}`);
      }
    }
    
    // Final verification
    const finalCardCount = await prisma.iDCard.count();
    console.log(`\n🎉 Development database seeded successfully!`);
    console.log(`📊 Total ID cards created: ${finalCardCount}`);
    
    if (finalCardCount > 0) {
      const sampleCard = await prisma.iDCard.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      console.log(`\n🔗 Test your changes at:`);
      console.log(`   http://localhost:3001/hrci/idcard/${sampleCard?.cardNumber}/html`);
    }
    
  } catch (error) {
    console.error('❌ Error seeding dev database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedDevIdCardData();