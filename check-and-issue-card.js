#!/usr/bin/env node

/**
 * Quick utility to check member by phone and generate ID card with PDF link
 * Usage: node check-and-issue-card.js <phoneNumber>
 * Example: node check-and-issue-card.js 9075663455
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

async function generateNextIdCardNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yymm = `${yy}${mm}`;
  const prefix = `hrci-${yymm}-`;
  
  const last = await prisma.iDCard.findFirst({
    where: { cardNumber: { startsWith: prefix } },
    orderBy: { cardNumber: 'desc' }
  }).catch(() => null);
  
  let next = 1;
  if (last && last.cardNumber && String(last.cardNumber).startsWith(prefix)) {
    const tail = String(last.cardNumber).slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n)) next = n + 1;
  }
  
  const seq = String(next).padStart(5, '0');
  return `${prefix}${seq}`;
}

async function checkAndIssueCard(phoneNumber) {
  try {
    console.log(`\n📱 Checking member: ${phoneNumber}\n`);
    
    const norm = normalizeMobileNumber(phoneNumber);
    if (!norm) {
      console.error('❌ Invalid phone number');
      return;
    }
    
    console.log(`🔍 Normalized phone: ${norm}`);
    
    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { mobileNumber: norm },
          { mobileNumber: { endsWith: norm } }
        ]
      },
      select: { id: true, mobileNumber: true, fullName: true }
    });
    
    if (!user) {
      console.error('❌ Member not found');
      await prisma.$disconnect();
      return;
    }
    
    console.log(`✅ User found: ${user.fullName || 'N/A'} (${user.mobileNumber})`);
    
    // Find membership
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id },
      include: { idCard: true, designation: true, cell: true }
    });
    
    if (!membership) {
      console.error('❌ No membership found');
      await prisma.$disconnect();
      return;
    }
    
    console.log(`📋 Membership status: ${membership.status}`);
    console.log(`📍 Designation: ${membership.designation?.name || 'N/A'}`);
    console.log(`📍 Cell: ${membership.cell?.name || 'N/A'}`);
    
    // Check if card already exists
    if (membership.idCard) {
      console.log(`\n🪪 ID Card already exists:`);
      console.log(`   Card Number: ${membership.idCard.cardNumber}`);
      console.log(`   Status: ${membership.idCard.status}`);
      console.log(`   Expires: ${membership.idCard.expiresAt?.toISOString?.() || 'N/A'}`);
    } else if (membership.status === 'ACTIVE') {
      // Check for profile photo
      const profile = await prisma.userProfile.findUnique({
        where: { userId: user.id },
        select: { profilePhotoUrl: true, profilePhotoMediaId: true, fullName: true }
      });
      
      const hasPhoto = !!(profile?.profilePhotoUrl || profile?.profilePhotoMediaId);
      
      if (!hasPhoto) {
        console.error('\n❌ Member has no profile photo. Cannot auto-issue card.');
        console.log('   Please upload a profile photo first.');
      } else {
        console.log('\n✅ Generating ID card...');
        
        const cardNumber = await generateNextIdCardNumber();
        const expiresAt = membership.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        
        const card = await prisma.iDCard.create({
          data: {
            membershipId: membership.id,
            cardNumber,
            expiresAt,
            status: 'GENERATED',
            fullName: profile.fullName || user.fullName,
            mobileNumber: user.mobileNumber,
            designationName: membership.designation?.name,
            cellName: membership.cell?.name
          }
        });
        
        await prisma.membership.update({
          where: { id: membership.id },
          data: { idCardStatus: 'GENERATED' }
        }).catch(() => null);
        
        console.log(`\n🪪 ID Card generated successfully:`);
        console.log(`   Card Number: ${card.cardNumber}`);
        console.log(`   Status: ${card.status}`);
        console.log(`   Expires: ${card.expiresAt?.toISOString?.() || 'N/A'}`);
      }
    } else {
      console.error(`\n❌ Cannot issue card. Membership status: ${membership.status}`);
      console.log('   Only ACTIVE memberships can receive cards.');
    }
    
    // Get PDF link if card exists
    const finalCard = membership.idCard || (await prisma.iDCard.findFirst({
      where: { membershipId: membership.id }
    }));
    
    if (finalCard) {
      const baseUrl = process.env.PROD_BASE_URL || 'https://app.humanrightscouncilforindia.org/api/v1';
      const pdfUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(finalCard.cardNumber)}/pdf`;
      const htmlUrl = `${baseUrl}/hrci/idcard/${encodeURIComponent(finalCard.cardNumber)}/html`;
      const verifyUrl = `https://humanrightscouncilforindia.org/idcard/${encodeURIComponent(finalCard.cardNumber)}`;
      
      console.log(`\n🔗 Card URLs:`);
      console.log(`   PDF: ${pdfUrl}`);
      console.log(`   HTML: ${htmlUrl}`);
      console.log(`   Verify: ${verifyUrl}`);
      
      console.log(`\n✅ READY TO SEND TO MEMBER`);
    }
    
  } catch (err) {
    console.error('\n❌ Error:', err?.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('Usage: node check-and-issue-card.js <phoneNumber>');
  console.error('Example: node check-and-issue-card.js 9075663455');
  process.exit(1);
}

checkAndIssueCard(phoneNumber);
