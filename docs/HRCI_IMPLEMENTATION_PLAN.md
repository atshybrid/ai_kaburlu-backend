# HRCI Implementation Plan

## Phase 1 (Foundational)
1. Domain Types & DTOs
2. Team Service (create/list basic filters)
3. Volunteer onboarding (create HrcVolunteerProfile from existing user + attach to teams)
4. Fee resolution service (PaymentFeeConfig hierarchy)
5. Payment order creation (Razorpay) + signature verify util (no webhook yet)
6. Issue ID card after payment success (direct capture path)
7. Basic Swagger docs for above endpoints
8. Minimal tests (fee resolution edge cases)

## Phase 2 (Core Operations)
1. Cases CRUD (HrcCase)
2. Case updates & attachments upload pipeline
3. Donation intent + order + capture + record donation
4. Webhook listener (payments + refunds) with idempotency
5. Refund endpoint (admin) – marks PaymentTransaction + updates HrcDonation/HrcIdCard

## Phase 3 (Lifecycle & Analytics)
1. Scheduled expiry job (mark ID cards expired, generate renewal tasks)
2. Renewal reminders queue (email/SMS future)
3. Reporting endpoints (aggregations)
4. Escalation matrix & SLA timers
5. Recurring donation prototype (cron + stored token – future secure vault)

## Cross-Cutting Concerns
- Validation: class-validator DTOs
- AuthZ: role guard expansion (TEAM_ADMIN, CASE_MANAGER future)
- Concurrency: SELECT ... FOR UPDATE (Prisma $transaction) around payment/id card issuance
- Idempotency: Upsert PaymentTransaction by providerOrderId + providerPaymentId composite
- Observability: log entries with context { domain: 'hrc', action, entityId }

## Edge Cases
- Payment succeeds but network fails before response: client poll endpoint /payments/:orderId/status
- Fee config missing at specific scope: fallback to broader scope or default -> 404 if none
- Multi-team membership: ID card fee chooses highest precedence team (configurable tie-break)
- Webhook arrives before API acknowledgment: transaction uses upsert logic, safe

## Data Flow (ID Card Issuance)
User -> POST /hrc/payments/order (level/team) -> Creates PaymentTransaction(pending) + Razorpay order
User completes payment (frontend) -> POST /hrc/idcards/issue with payment refs -> verifies signature + marks paid -> creates HrcIdCard(active)
Webhook (later) reconciles status -> updates transaction if mismatch

## TODO Matrix (Detailed)
See root TODO list tooling for live status.
