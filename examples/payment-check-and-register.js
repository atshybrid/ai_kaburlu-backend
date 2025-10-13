/**
 * Complete Payment Verification & Registration Helper
 * 
 * This script shows exactly how to:
 * 1. Check if mobile has successful payments
 * 2. Create member registration from paid order
 */

const BASE_URL = 'http://localhost:3000/api/v1/memberships/payfirst';

/**
 * Step 1: Check if mobile number has any successful payments
 */
async function checkMobilePayment(mobile) {
  try {
    const response = await fetch(`${BASE_URL}/check-mobile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mobile })
    });

    const result = await response.json();
    
    console.log('📱 Checking mobile:', mobile);
    
    if (result.success && result.data.hasPendingPayments) {
      console.log('✅ Payment found!');
      console.log('💰 Pending payments:', result.data.pendingSeats.length);
      
      result.data.pendingSeats.forEach((seat, index) => {
        console.log(`\n${index + 1}. Order ID: ${seat.orderId}`);
        console.log(`   Amount: ₹${seat.amount}`);
        console.log(`   Seat: ${seat.seatDetails.designation.name} at ${seat.seatDetails.level}`);
        console.log(`   Paid: ${seat.daysSincePaid} days ago`);
      });
      
      return result.data.pendingSeats;
    } else {
      console.log('❌ No payments found for mobile:', mobile);
      return [];
    }
  } catch (error) {
    console.error('❌ Error checking mobile:', error);
    return [];
  }
}

/**
 * Step 2: Complete registration using paid order
 */
async function createMemberRegistration(orderId, userDetails) {
  try {
    console.log('\n🔄 Creating registration...');
    console.log('Order ID:', orderId);
    console.log('Mobile:', userDetails.mobile);
    console.log('Name:', userDetails.fullName);
    
    const response = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        orderId: orderId,
        mobileNumber: userDetails.mobile,
        fullName: userDetails.fullName,
        mpin: userDetails.mpin
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('🎉 Registration successful!');
      console.log('👤 User ID:', result.data.user.id);
      console.log('🏛️ Membership ID:', result.data.membership.id);
      console.log('🆔 ID Card:', result.data.idCard.cardNumber);
      console.log('📋 Status:', result.data.membership.status);
      
      return {
        success: true,
        user: result.data.user,
        membership: result.data.membership,
        idCard: result.data.idCard
      };
    } else {
      console.error('❌ Registration failed:', result.message);
      return { success: false, error: result.message };
    }
  } catch (error) {
    console.error('❌ Registration error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Complete flow: Check payment + Create registration
 */
async function completeUserRegistration(mobile, fullName, mpin) {
  console.log('🚀 Starting complete registration flow...\n');
  
  // Step 1: Check if mobile has payments
  const pendingPayments = await checkMobilePayment(mobile);
  
  if (pendingPayments.length === 0) {
    console.log('\n💳 No payments found. Please create payment order first!');
    return { needsPayment: true };
  }
  
  // Step 2: Use first payment (or let user choose)
  const selectedPayment = pendingPayments[0];
  console.log(`\n✅ Using payment: ${selectedPayment.orderId}`);
  
  // Step 3: Create registration
  const registration = await createMemberRegistration(selectedPayment.orderId, {
    mobile,
    fullName,
    mpin
  });
  
  if (registration.success) {
    console.log('\n🏆 COMPLETE SUCCESS!');
    console.log('Member is now registered and active!');
  }
  
  return registration;
}

/**
 * Usage Examples:
 */

// Example 1: Complete registration flow
async function example1() {
  console.log('=== EXAMPLE 1: Complete Registration ===');
  
  const result = await completeUserRegistration(
    '9876543210',    // mobile
    'John Doe',      // fullName  
    '123456'         // mpin
  );
  
  if (result.success) {
    console.log('User successfully registered!');
  } else if (result.needsPayment) {
    console.log('User needs to make payment first');
  }
}

// Example 2: Just check payments
async function example2() {
  console.log('\n=== EXAMPLE 2: Check Payments Only ===');
  
  const payments = await checkMobilePayment('9876543210');
  
  if (payments.length > 0) {
    console.log('Ready for registration!');
  } else {
    console.log('No payments found');
  }
}

// Example 3: Manual step-by-step
async function example3() {
  console.log('\n=== EXAMPLE 3: Manual Steps ===');
  
  // Step 1: Check payments
  const payments = await checkMobilePayment('9876543210');
  
  if (payments.length > 0) {
    // Step 2: Create registration
    const orderId = payments[0].orderId;
    const registration = await createMemberRegistration(orderId, {
      mobile: '9876543210',
      fullName: 'John Doe', 
      mpin: '123456'
    });
    
    console.log('Final result:', registration);
  }
}

// Run examples
if (require.main === module) {
  // Uncomment to test:
  // example1();
  // example2(); 
  // example3();
}

module.exports = {
  checkMobilePayment,
  createMemberRegistration,
  completeUserRegistration
};