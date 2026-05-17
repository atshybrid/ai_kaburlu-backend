#!/usr/bin/env node

/**
 * Diagnostic: Check why member's ID card wasn't found/generated
 * Usage: node diagnose-card-issue.js <phoneNumber>
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizeMobileNumber(input) {
  const digits = String(input || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('91') && digits.length > 10) return digits.slice(-10);
  if (digits.startsWith('0') && digits.length > 10) return digits.slice(-10);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function diagnose(phoneNumber) {
  try {
    console.log(`\n🔍 DIAGNOSTIC: Member ${phoneNumber}\n`);
    
    const norm = normalizeMobileNumber(phoneNumber);
    console.log(`📱 Normalized: ${norm}\n`);
    
    // Step 1: Find user
    console.log('Step 1️⃣: Searching for user...');
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { mobileNumber: norm },
          { mobileNumber: { endsWith: norm } },
          { mobileNumber: phoneNumber }
        ]
      },
      select: { id: true, mobileNumber: true, fullName: true, email: true, status: true }
    });
    
    if (users.length === 0) {
      console.log('❌ No user found with any phone matching logic');
      console.log('\nTrying direct search for ANY users...');
      const allUsers = await prisma.user.findMany({ take: 5, select: { id: true, mobileNumber: true } });
      console.log('Sample users:', allUsers.map(u => u.mobileNumber));
      return;
    }
    
    console.log(`✅ Found ${users.length} user(s):`);
    users.forEach(u => {
      console.log(`   - ID: ${u.id}, Phone: ${u.mobileNumber}, Name: ${u.fullName}, Status: ${u.status}`);
    });
    
    for (const user of users) {
      console.log(`\n📋 Checking user: ${user.id} (${user.mobileNumber})`);
      
      // Step 2: Find memberships
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
        include: {
          idCard: true,
          designation: { select: { name: true } },
          cell: { select: { name: true } }
        }
      });
      
      if (memberships.length === 0) {
        console.log('   ❌ No membership found');
        continue;
      }
      
      console.log(`   ✅ Found ${memberships.length} membership(s):`);
      
      for (const m of memberships) {
        console.log(`\n   Membership ID: ${m.id}`);
        console.log(`   Status: ${m.status}`);
        console.log(`   Payment Status: ${m.paymentStatus}`);
        console.log(`   ID Card Status: ${m.idCardStatus}`);
        console.log(`   Designation: ${m.designation?.name || 'N/A'}`);
        console.log(`   Cell: ${m.cell?.name || 'N/A'}`);
        
        // Step 3: Check ID Card
        if (m.idCard) {
          console.log(`   🪪 ID Card EXISTS: ${m.idCard.cardNumber}`);
          console.log(`      Status: ${m.idCard.status}`);
          console.log(`      Expires: ${m.idCard.expiresAt}`);
        } else {
          console.log(`   ❌ No ID Card found (status: ${m.idCardStatus})`);
          
          // Step 4: Check why card can't be issued
          if (m.status !== 'ACTIVE') {
            console.log(`      ⚠️  Cannot issue: Membership not ACTIVE (current: ${m.status})`);
          } else {
            console.log(`      ✅ Membership is ACTIVE, checking profile...`);
            
            const profile = await prisma.userProfile.findUnique({
              where: { userId: user.id },
              select: { fullName: true, profilePhotoUrl: true, profilePhotoMediaId: true }
            });
            
            if (!profile) {
              console.log(`      ❌ No profile found`);
            } else {
              console.log(`      Profile Name: ${profile.fullName || 'N/A'}`);
              const hasPhoto = !!(profile.profilePhotoUrl || profile.profilePhotoMediaId);
              if (!hasPhoto) {
                console.log(`      ❌ No profile photo (cannot issue card)`);
              } else {
                console.log(`      ✅ Profile photo exists - CAN GENERATE CARD`);
              }
            }
          }
        }
      }
    }
    
  } catch (err) {
    console.error('\n❌ Database Error:', err?.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('Usage: node diagnose-card-issue.js <phoneNumber>');
  console.error('Example: node diagnose-card-issue.js 9075663455');
  process.exit(1);
}

diagnose(phoneNumber);
