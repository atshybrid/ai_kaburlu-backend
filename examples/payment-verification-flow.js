// Complete Payment Verification and Registration Flow Example

const API_BASE = 'http://localhost:3000/api/v1/memberships/payfirst';

// Step 1: Check if mobile number has any successful payments
async function checkMobilePayments(mobile) {
  const response = await fetch(`${API_BASE}/check-mobile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  
  const result = await response.json();
  
  if (result.success && result.data.hasPendingPayments) {
    console.log('✅ Found paid seats for mobile:', mobile);
    console.log('Pending seats:', result.data.pendingSeats);
    return result.data.pendingSeats;
  } else {
    console.log('❌ No pending payments found for mobile:', mobile);
    return [];
  }
}

// Step 2: Check specific payment status
async function checkPaymentStatus(orderId) {
  const response = await fetch(`${API_BASE}/status/${orderId}`);
  const result = await response.json();
  
  if (result.success) {
    console.log('Payment Status:', result.data.paymentStatus);
    console.log('Registration Status:', result.data.registrationStatus);
    return result.data;
  }
  
  throw new Error('Failed to check payment status');
}

// Step 3: Complete registration if payment successful
async function completeRegistration(orderId, userDetails) {
  const response = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      mobileNumber: userDetails.mobile,
      fullName: userDetails.fullName,
      mpin: userDetails.mpin
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('✅ Registration completed successfully!');
    console.log('User ID:', result.data.user.id);
    console.log('Membership ID:', result.data.membership.id);
    console.log('ID Card:', result.data.idCard.cardNumber);
    return result.data;
  }
  
  throw new Error(result.message || 'Registration failed');
}

// Complete workflow example
async function handleUserRegistration(mobile, fullName, mpin) {
  try {
    // 1. Check if user has pending payments
    console.log('🔍 Checking payments for mobile:', mobile);
    const pendingSeats = await checkMobilePayments(mobile);
    
    if (pendingSeats.length === 0) {
      console.log('❌ No payments found. User needs to create order first.');
      return { needsPayment: true };
    }
    
    // 2. Take the first pending seat (or let user choose)
    const selectedSeat = pendingSeats[0];
    console.log('📋 Selected seat:', selectedSeat);
    
    // 3. Verify payment status
    console.log('🔍 Verifying payment status...');
    const paymentStatus = await checkPaymentStatus(selectedSeat.orderId);
    
    if (paymentStatus.paymentStatus !== 'SUCCESS') {
      console.log('❌ Payment not successful yet');
      return { paymentPending: true };
    }
    
    if (paymentStatus.registrationStatus === 'COMPLETED') {
      console.log('❌ Already registered');
      return { alreadyRegistered: true };
    }
    
    // 4. Complete registration
    console.log('✅ Payment verified! Completing registration...');
    const registration = await completeRegistration(selectedSeat.orderId, {
      mobile,
      fullName,
      mpin
    });
    
    return {
      success: true,
      registration
    };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return { error: error.message };
  }
}

// Usage examples:

// Example 1: User trying to register
handleUserRegistration('9876543210', 'John Doe', '123456')
  .then(result => {
    if (result.success) {
      console.log('🎉 Registration successful!');
    } else if (result.needsPayment) {
      console.log('💳 Please create payment order first');
    } else if (result.alreadyRegistered) {
      console.log('👤 Already registered');
    }
  });

// Example 2: Just check payments without registration
checkMobilePayments('9876543210')
  .then(pendingSeats => {
    pendingSeats.forEach(seat => {
      console.log(`Seat: ${seat.seatDetails.designation.name} at ${seat.seatDetails.level}`);
      console.log(`Amount: ₹${seat.amount}, Paid: ${seat.daysSincePaid} days ago`);
    });
  });

// Example 3: Admin checking specific order
checkPaymentStatus('specific-order-id')
  .then(status => {
    console.log('Order Status:', status);
  });

module.exports = {
  checkMobilePayments,
  checkPaymentStatus,
  completeRegistration,
  handleUserRegistration
};