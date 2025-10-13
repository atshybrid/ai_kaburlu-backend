# How to Check Payment & Create Member Registration

## 🎯 **THE ANSWER TO YOUR QUESTION**

### **Question:** "If member paid amount success, how to check and how to create member registration? How to check that mobile number payment done?"

### **Answer:** Use these 3 endpoints in sequence:

## **✅ STEP 1: Check if Mobile Has Successful Payment**

**Endpoint:** `POST /memberships/payfirst/check-mobile`

```json
{
  "mobile": "9876543210"
}
```

**What it does:**
- Searches PaymentIntent table for `status: 'SUCCESS'`
- Looks for mobile number in `meta.registrationMobile` field
- Returns all paid but unregistered seats

**Response if payment exists:**
```json
{
  "success": true,
  "data": {
    "hasPendingPayments": true,
    "pendingSeats": [
      {
        "orderId": "uuid-123",
        "amount": 5000,
        "paidAt": "2024-01-15T10:30:00Z",
        "seatDetails": {
          "cell": { "name": "Andhra Pradesh" },
          "designation": { "name": "President" },
          "level": "STATE"
        }
      }
    ]
  }
}
```

**Response if no payment:**
```json
{
  "success": true,
  "data": {
    "hasPendingPayments": false,
    "pendingSeats": [],
    "message": "No pending payments found"
  }
}
```

## **✅ STEP 2: Verify Payment Status (Optional)**

**Endpoint:** `GET /memberships/payfirst/status/{orderId}`

```json
{
  "success": true,
  "data": {
    "paymentStatus": "SUCCESS",      // ✅ Payment confirmed
    "registrationStatus": "PENDING"  // ❌ User not created yet
  }
}
```

## **✅ STEP 3: Create Member Registration**

**Endpoint:** `POST /memberships/payfirst/register`

```json
{
  "orderId": "uuid-123",        // From Step 1
  "mobileNumber": "9876543210", // Must match payment mobile
  "fullName": "John Doe",
  "mpin": "123456"
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-uuid",
      "mobile": "9876543210"
    },
    "membership": {
      "id": "membership-uuid", 
      "status": "ACTIVE"
    },
    "idCard": {
      "cardNumber": "HRCI-1234567890-123",
      "status": "ACTIVE"
    }
  }
}
```

---

## **🔍 BACKEND LOGIC EXPLAINED**

### **How Payment Check Works:**
```sql
-- Database query performed by check-mobile endpoint
SELECT * FROM PaymentIntent 
WHERE status = 'SUCCESS' 
  AND membershipId IS NULL 
  AND meta->>'registrationMobile' = '9876543210'
```

### **How Registration Creation Works:**
```typescript
// 1. Verify payment exists and is successful
const paymentIntent = await prisma.paymentIntent.findUnique({
  where: { id: orderId }
});

if (paymentIntent.status !== 'SUCCESS') {
  throw new Error('Payment not successful');
}

// 2. Create user (if not exists)
let user = await prisma.user.findFirst({
  where: { mobileNumber }
});

if (!user) {
  user = await prisma.user.create({
    data: { mobileNumber, mpinHash, ... }
  });
}

// 3. Create membership using paid seat details
const membership = await membershipService.joinSeat({
  userId: user.id,
  cellCodeOrName: paymentIntent.cellCodeOrName,
  designationCode: paymentIntent.designationCode,
  level: paymentIntent.level,
  // ... location fields
});

// 4. Activate membership
await prisma.membership.update({
  where: { id: membership.id },
  data: { status: 'ACTIVE', paymentStatus: 'SUCCESS' }
});

// 5. Link payment to membership (prevents reuse)
await prisma.paymentIntent.update({
  where: { id: orderId },
  data: { membershipId: membership.id }
});

// 6. Auto-issue ID card
await prisma.iDCard.create({
  data: { userId, membershipId, cardNumber, status: 'ACTIVE' }
});
```

---

## **🚀 COMPLETE WORKING EXAMPLE**

```javascript
async function handleMemberRegistration(mobile, fullName, mpin) {
  // 1. Check if mobile has successful payments
  const checkResponse = await fetch('/memberships/payfirst/check-mobile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  
  const checkResult = await checkResponse.json();
  
  if (!checkResult.data.hasPendingPayments) {
    return { error: 'No payment found. Please pay first.' };
  }
  
  // 2. Get the order ID from payment
  const orderId = checkResult.data.pendingSeats[0].orderId;
  
  // 3. Create member registration
  const registerResponse = await fetch('/memberships/payfirst/register', {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      mobileNumber: mobile,
      fullName,
      mpin
    })
  });
  
  const registerResult = await registerResponse.json();
  
  if (registerResult.success) {
    console.log('✅ Member registered successfully!');
    console.log('ID Card:', registerResult.data.idCard.cardNumber);
    console.log('Membership Status:', registerResult.data.membership.status);
    return registerResult.data;
  }
  
  return { error: registerResult.message };
}

// Usage
handleMemberRegistration('9876543210', 'John Doe', '123456')
  .then(result => {
    if (result.error) {
      console.log('❌ Error:', result.error);
    } else {
      console.log('🎉 Success:', result);
    }
  });
```

---

## **💡 KEY POINTS**

1. **Payment First:** User must pay successfully before registration
2. **Mobile Linking:** Payment is linked to mobile number in `meta` field
3. **One-Time Use:** Each payment can only create one membership
4. **Auto ID Card:** ID card is issued immediately upon registration
5. **Status Tracking:** Payment status and registration status are separate
6. **Security:** Mobile number must match between payment and registration

## **🔄 COMPLETE FLOW SUMMARY**

```
User Pays → Payment SUCCESS → Check Mobile → Found Payment → Create Registration → Member ACTIVE
     ↓              ↓               ↓              ↓                ↓                ↓
   Orders      Confirm         check-mobile     status         register        Complete!
```

This system ensures **NO PAID USER IS EVER LOST** and provides complete traceability from payment to active membership! 🎯