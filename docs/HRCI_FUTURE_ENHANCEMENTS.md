# HRCI Future Enhancements

## Analytics & Reporting
- Volunteer growth over time (by level, team)
- Case resolution time percentiles (P50/P90)
- Donation source attribution (UTM style metadata)

## Escalation Workflow
- SLA rules table (priority -> max hours)
- Auto-escalate to higher team when SLA breached
- Notification hooks (email/SMS/push) per escalation event

## ID Card Lifecycle
- Pre-expiry reminder (n days before)
- Soft-expired grace state vs hard-expired
- Auto-renew fast path if payment captured & no profile changes

## Payments & Donations
- Recurring donation tokens (secure store) + cron charges
- Multi-currency support with FX snapshot table
- Reconciliation report: gateway vs internal totals

## Security & Compliance
- Audit log table for all HRCI state changes
- PII scrubbing job for orphaned profiles
- Attachment virus scanning pipeline

## Performance
- Cached hierarchical team tree (redis) w/ ETag invalidation
- Batched case activity feed pagination (cursor-based)

## Developer Tooling
- Contract tests for fee resolution fallback chain
- Load test scripts (k6) for high-volume payment webhooks

## UX/API
- GraphQL aggregation endpoint (optional)
- Bulk volunteer import CSV
- Public donation leaderboard (opt-in anonymity masking)

## AI Assistance (Later)
- Suggested case categorization
- Similar past case retrieval for context
- Donation impact narrative generator

