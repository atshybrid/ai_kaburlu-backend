# PayFirst Flow - Complete API Documentation

## Overview
The pay-first flow separates payment from user registration, allowing users to pay for a seat first, then complete registration later. This prevents quota blocking by unpaid registrations.

## Flow Phases

### Phase 1: Payment Order Creation
**Endpoint:** `POST /memberships/payfirst/orders`

Creates a payment intent and Razorpay order without creating any user or membership record.

**Request Body:**
```json
{
  "cellCodeOrName": "AP001",
  "designationCode": "PRES",
  "level": "STATE",
  "hrcStateId": "state-id-here",
  "amount": 5000,
  "registrationMobile": "9876543210"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentIntent": {
      "id": "intent-uuid",
      "amount": 5000,
      "status": "PENDING"
    },
    "razorpayOrder": {
      "id": "order_xyz123",
      "amount": 500000,
      "currency": "INR"
    },
    "razorpayKeyId": "rzp_test_..."
  }
}
```

### Phase 2: Payment Confirmation
**Endpoint:** `POST /memberships/payfirst/confirm`

Verifies Razorpay payment and marks payment intent as SUCCESS. Does NOT create user or membership.

**Request Body:**
```json
{
  "orderId": "intent-uuid",
  "razorpayPaymentId": "pay_xyz123",
  "razorpaySignature": "signature-hash"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Payment confirmed successfully",
    "paymentStatus": "SUCCESS",
    "nextStep": "Complete registration using /register endpoint",
    "registrationToken": "temp-token-for-registration"
  }
}
```

### Phase 3: User Registration
**Endpoint:** `POST /memberships/payfirst/register`

Creates the actual user and membership record using a confirmed payment intent.

**Request Body:**
```json
{
  "orderId": "intent-uuid",
  "mobileNumber": "9876543210",
  "fullName": "John Doe",
  "mpin": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Registration completed successfully",
    "user": {
      "id": "user-uuid",
      "mobile": "9876543210"
    },
    "membership": {
      "id": "membership-uuid",
      "cell": { "id": "cell-uuid", "name": "Andhra Pradesh", "code": "AP001" },
      "designation": { "id": "desig-uuid", "name": "President", "code": "PRES" },
      "level": "STATE",
      "location": { "type": "state", "id": "state-id", "name": "Andhra Pradesh" },
      "status": "ACTIVE"
    },
    "idCard": {
      "id": "card-uuid",
      "cardNumber": "HRCI-1234567890-user-id",
      "status": "ACTIVE"
    }
  }
}
```

## Utility Endpoints

### Check Payment Status
**Endpoint:** `GET /memberships/payfirst/status/{orderId}`

Check the current status of a payment intent.

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "intent-uuid",
    "paymentStatus": "SUCCESS",
    "registrationStatus": "COMPLETED",
    "seatDetails": {
      "cell": { "name": "Andhra Pradesh", "code": "AP001" },
      "designation": { "name": "President", "code": "PRES" },
      "level": "STATE"
    }
  }
}
```

### Check Mobile for Pending Payments
**Endpoint:** `POST /memberships/payfirst/check-mobile`

Check if a mobile number has any paid but unregistered seats.

**Request Body:**
```json
{
  "mobile": "9876543210"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "hasPendingPayments": true,
    "pendingSeats": [
      {
        "orderId": "intent-uuid",
        "amount": 5000,
        "paidAt": "2024-01-15T10:30:00Z",
        "seatDetails": {
          "cell": { "name": "Andhra Pradesh" },
          "designation": { "name": "President" },
          "level": "STATE"
        },
        "daysSincePaid": 2
      }
    ],
    "message": "Found 1 paid seat(s) awaiting registration"
  }
}
```

## Admin Endpoints

### List All Pending Registrations
**Endpoint:** `GET /memberships/payfirst/admin/pending`

Lists all paid but unregistered seats across the system.

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 5,
    "pendingRegistrations": [
      {
        "orderId": "intent-uuid",
        "amount": 5000,
        "paidAt": "2024-01-15T10:30:00Z",
        "linkedMobile": "9876543210",
        "seatDetails": {
          "cell": { "name": "Andhra Pradesh" },
          "designation": { "name": "President" },
          "level": "STATE"
        },
        "daysSincePaid": 2
      }
    ],
    "message": "Found 5 paid seats awaiting registration"
  }
}
```

### Manually Complete Registration
**Endpoint:** `POST /memberships/payfirst/admin/complete/{orderId}`

Admin can manually complete registration for a paid order.

**Request Body:**
```json
{
  "mobile": "9876543210",
  "firstName": "John",
  "lastName": "Doe",
  "mpin": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Registration completed successfully by admin",
    "user": {
      "id": "user-uuid",
      "mobile": "9876543210",
      "createdNewUser": true
    },
    "membership": {
      "id": "membership-uuid",
      "status": "ACTIVE"
    },
    "idCard": {
      "cardNumber": "HRCI-1234567890-user-id",
      "status": "ACTIVE"
    }
  }
}
```

## Edge Cases Handled

1. **Payment Success, No Registration**: User can check status and complete registration later
2. **Multiple Payments Same Mobile**: System tracks all pending payments per mobile
3. **Payment Timeout**: Razorpay orders expire after 15 minutes
4. **Seat Unavailable During Registration**: Registration fails gracefully, payment remains valid
5. **Admin Intervention**: Admins can complete registrations manually
6. **Duplicate Mobile Check**: Prevents confusion about existing vs new registrations

## Security Features

1. **Razorpay Signature Verification**: All payments verified cryptographically
2. **Payment Intent Linking**: Payments can only be used once for registration
3. **Mobile Verification**: Registration mobile must match payment intent mobile
4. **Admin Access Control**: Admin endpoints require proper authentication
5. **MPIN Hashing**: All MPINs stored as bcrypt hashes

## Database Models

### PaymentIntent
- Stores payment details before user creation
- Links to Razorpay order and payment IDs
- Tracks registration mobile in meta field
- Status: PENDING → SUCCESS → (linked to membership)

### Membership
- Created only after successful registration
- Links to PaymentIntent for audit trail
- Immediate ACTIVE status for paid registrations

### IDCard
- Auto-issued upon successful registration
- Links to both user and membership