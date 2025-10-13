# Database Tables & User/Member Creation Explained

## 🗃️ **DATABASE TABLES INVOLVED**

### **Core Tables for Pay-First Flow:**

#### **1. PaymentIntent Table** (Payment Storage)
```sql
CREATE TABLE PaymentIntent (
  id                String PRIMARY KEY,
  cellCodeOrName    String,           -- e.g., "GENERAL_BODY"
  designationCode   String,           -- e.g., "PRESIDENT"
  level             OrgLevel,         -- NATIONAL, STATE, DISTRICT, etc.
  zone              HrcZone,          -- For ZONE level
  hrcStateId        String,           -- For STATE level
  hrcDistrictId     String,           -- For DISTRICT level  
  hrcMandalId       String,           -- For MANDAL level
  amount            Int,              -- Payment amount in paise
  currency          String DEFAULT 'INR',
  status            PaymentIntentStatus, -- PENDING, SUCCESS, FAILED
  providerRef       String,           -- Razorpay payment ID
  meta              Json,             -- { registrationMobile: "9876543210" }
  membershipId      String,           -- Links to Membership after registration
  createdAt         DateTime,
  updatedAt         DateTime
);
```

#### **2. User Table** (User Account)
```sql
CREATE TABLE User (
  id              String PRIMARY KEY,
  mobileNumber    String UNIQUE,      -- "9876543210"
  mpin            String,             -- Deprecated
  mpinHash        String,             -- bcrypt hash of MPIN
  firebaseUid     String,
  email           String UNIQUE,
  roleId          String,             -- Links to Role table
  languageId      String,             -- Links to Language table
  status          String DEFAULT 'PENDING', -- PENDING, ACTIVE, INACTIVE
  upgradedAt      DateTime,
  createdAt       DateTime,
  updatedAt       DateTime
);
```

#### **3. UserProfile Table** (User Details)
```sql
CREATE TABLE UserProfile (
  id                     String PRIMARY KEY,
  userId                 String UNIQUE,    -- Links to User
  fullName               String,           -- "John Doe"
  gender                 String,
  dob                    DateTime,
  maritalStatus          String,
  bio                    String,
  profilePhotoUrl        String,
  emergencyContactNumber String,
  address                Json,
  occupation             String,
  education              String,
  createdAt              DateTime,
  updatedAt              DateTime
);
```

#### **4. Membership Table** (Member Record)
```sql
CREATE TABLE Membership (
  id             String PRIMARY KEY,
  userId         String,              -- Links to User
  cellId         String,              -- Links to Cell table
  designationId  String,              -- Links to Designation table
  level          OrgLevel,            -- NATIONAL, STATE, DISTRICT, etc.
  zone           HrcZone,             -- For ZONE level
  hrcStateId     String,              -- Geographic scope
  hrcDistrictId  String,
  hrcMandalId    String,
  status         MembershipStatus,    -- PENDING_PAYMENT, ACTIVE, EXPIRED
  paymentStatus  MembershipPaymentStatus, -- SUCCESS, PENDING, FAILED
  idCardStatus   IdCardStatus,        -- GENERATED, PRINTED, DELIVERED
  activatedAt    DateTime,
  expiresAt      DateTime,
  createdAt      DateTime,
  updatedAt      DateTime
);
```

#### **5. IDCard Table** (ID Card Details)
```sql
CREATE TABLE IDCard (
  id              String PRIMARY KEY,
  membershipId    String UNIQUE,      -- Links to Membership
  cardNumber      String UNIQUE,      -- "HRCI-1234567890-123"
  issuedAt        DateTime,
  expiresAt       DateTime,
  status          IdCardStatus,       -- GENERATED, PRINTED, DELIVERED
  fullName        String,             -- Snapshot at issue time
  designationName String,             -- Snapshot
  cellName        String,             -- Snapshot
  mobileNumber    String,             -- Snapshot
  createdAt       DateTime,
  updatedAt       DateTime
);
```

---

## 🚀 **HOW USER & MEMBER CREATION WORKS**

### **Phase 1: Payment Intent Creation** (`POST /orders`)

```typescript
// 1. Create PaymentIntent record (NO user created yet)
const intent = await prisma.paymentIntent.create({
  data: {
    cellCodeOrName: "GENERAL_BODY",
    designationCode: "PRESIDENT", 
    level: "STATE",
    hrcStateId: "ap-state-uuid",
    amount: 5000,
    currency: "INR",
    status: "PENDING",
    meta: { registrationMobile: "9876543210" }  // Store mobile for later
  }
});

// 2. Create Razorpay order (external payment gateway)
const razorpayOrder = await createRazorpayOrder({
  amountPaise: 500000,  // 5000 * 100
  receipt: intent.id
});
```

**Database State After Phase 1:**
```
PaymentIntent: 1 record (PENDING)
User: 0 records
Membership: 0 records  
IDCard: 0 records
```

### **Phase 2: Payment Confirmation** (`POST /confirm`)

```typescript  
// 1. Verify Razorpay signature
const isValid = verifyRazorpaySignature({
  orderId: razorpayOrder.id,
  paymentId: razorpayPayment.id,
  signature: signature
});

// 2. Update PaymentIntent status (NO user created yet)
await prisma.paymentIntent.update({
  where: { id: orderId },
  data: { 
    status: "SUCCESS",
    providerRef: razorpayPayment.id 
  }
});
```

**Database State After Phase 2:**
```
PaymentIntent: 1 record (SUCCESS) ✅
User: 0 records
Membership: 0 records
IDCard: 0 records
```

### **Phase 3: User & Member Registration** (`POST /register`)

This is where the actual user and member creation happens:

```typescript
await prisma.$transaction(async (tx) => {
  // STEP 1: Create/Update User
  let user = await tx.user.findFirst({ 
    where: { mobileNumber: "9876543210" } 
  });
  
  const mpinHash = await bcrypt.hash("123456", 10);
  
  if (!user) {
    // CREATE NEW USER
    const citizen = await tx.role.findFirst({ 
      where: { name: { in: ['CITIZEN_REPORTER','USER','MEMBER','GUEST'] } } 
    });
    const lang = await tx.language.findFirst();
    
    user = await tx.user.create({
      data: {
        mobileNumber: "9876543210",
        mpin: null,
        mpinHash: mpinHash,
        roleId: citizen.id,
        languageId: lang.id,
        status: "PENDING"
      }
    });
  } else {
    // UPDATE EXISTING USER
    await tx.user.update({
      where: { id: user.id },
      data: { mpin: null, mpinHash: mpinHash }
    });
  }
  
  // STEP 2: Create/Update UserProfile
  await tx.userProfile.upsert({
    where: { userId: user.id },
    create: { 
      userId: user.id, 
      fullName: "John Doe" 
    },
    update: { 
      fullName: "John Doe" 
    }
  });
  
  // STEP 3: Create Membership using membershipService
  const join = await membershipService.joinSeat({
    userId: user.id,
    cellCodeOrName: intent.cellCodeOrName,      // "GENERAL_BODY"
    designationCode: intent.designationCode,    // "PRESIDENT"  
    level: intent.level,                        // "STATE"
    hrcStateId: intent.hrcStateId,              // "ap-state-uuid"
  });
  
  if (!join.accepted) {
    throw new Error('Seat no longer available');
  }
  
  // STEP 4: Activate Membership
  await tx.membership.update({
    where: { id: join.membershipId },
    data: { 
      status: "ACTIVE",
      paymentStatus: "SUCCESS",
      activatedAt: new Date() 
    }
  });
  
  // STEP 5: Link PaymentIntent to Membership
  await tx.paymentIntent.update({
    where: { id: intent.id },
    data: { membershipId: join.membershipId }
  });
  
  // STEP 6: Auto-Issue ID Card
  const idCard = await tx.iDCard.create({
    data: {
      membershipId: join.membershipId,
      cardNumber: `HRCI-${Date.now()}-${user.id}`,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: "GENERATED",
      fullName: "John Doe",
      designationName: "President", 
      cellName: "General Body",
      mobileNumber: "9876543210"
    }
  });
});
```

**Database State After Phase 3:**
```
PaymentIntent: 1 record (SUCCESS, linked to membership) ✅
User: 1 record (PENDING status) ✅
UserProfile: 1 record (fullName) ✅  
Membership: 1 record (ACTIVE, SUCCESS payment) ✅
IDCard: 1 record (GENERATED) ✅
```

---

## 📊 **DATA FLOW DIAGRAM**

```
Payment Order → Payment Success → User Registration
     ↓                ↓                    ↓
PaymentIntent    PaymentIntent      User + UserProfile
  (PENDING)       (SUCCESS)        Membership (ACTIVE)
                                   IDCard (GENERATED)
     ↓                ↓                    ↓
  No User         No User           Full Member
  No Membership   No Membership     Complete Registration
```

---

## 🔍 **KEY FEATURES EXPLAINED**

### **1. Separated Payment & Registration:**
- **PaymentIntent** stores payment BEFORE user creation
- User can pay and register later
- No quota blocking by unpaid users

### **2. Transaction Safety:**
- Entire registration wrapped in database transaction  
- If any step fails, everything rolls back
- Prevents partial/corrupt registrations

### **3. User Deduplication:**
- Checks if mobile number already exists
- Updates existing user instead of creating duplicate
- Prevents multiple accounts per mobile

### **4. Membership Service Integration:**
- Uses `membershipService.joinSeat()` for seat allocation
- Handles capacity limits and seat availability
- Creates proper Cell + Designation + Geography links

### **5. Auto ID Card Issuance:**
- ID card created immediately upon registration
- Snapshots user details at registration time  
- Unique card number: `HRCI-{timestamp}-{userId}`

### **6. Payment Linking:**
- PaymentIntent links to Membership after registration
- Prevents reuse of same payment for multiple registrations
- Maintains audit trail from payment to membership

---

## 💡 **SUMMARY**

**Tables Created/Updated:**
1. **PaymentIntent** → Payment tracking (created in /orders)
2. **User** → User account (created/updated in /register)  
3. **UserProfile** → User details (created/updated in /register)
4. **Membership** → Member seat (created in /register)
5. **IDCard** → ID card (auto-created in /register)

**Process:**
1. **Pay First** → Create PaymentIntent only
2. **Payment Success** → Update PaymentIntent status  
3. **Register** → Create User + Membership + IDCard atomically

This ensures **no payments are lost** and **every paid user can complete registration**! 🎯