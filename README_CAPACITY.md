# Membership Capacity Strategy

This project supports two layers of seat limiting:

1. Designation Capacity (always enforced)
   - Field: `Designation.defaultCapacity`
   - Scope key: (cellId + designationId + level + geo filters + status in [active/pending])
   - Prevents one designation from exceeding its configured seat count.

2. Aggregate Capacity (optional)
   - Table: `CellLevelCapacity`
   - Simple Mode (recommended): only rows for (cellId + level=NATIONAL) and (cellId + level=ZONE + zone)
   - Advanced Mode: rows can exist for STATE / DISTRICT / MANDAL (and include proper geo IDs) but this increases data volume and complexity

## Simple Mode (Recommended)

Use only: `scripts/seed_cell_level_capacity.ts`

What it seeds:
- NATIONAL capacity per cell (e.g., 72)
- Per-ZONE capacity per cell+zone (e.g., 40)

Aggregate lookup logic (in `membershipService`) purposely ignores state/district/mandal so only those broad caps apply. All finer tiers are limited by designation capacity alone.

Benefits:
- Predictable
- Minimal rows
- Easy to reason about

## Advanced Mode (Optional)

Use: `scripts/seed_all_level_capacities.ts`

Adds rows for STATE / DISTRICT / MANDAL. Only use if you need strict aggregate totals at those granular levels.

Environment variable controls:
```
MAX_STATES=10 MAX_DISTRICTS=50 MAX_MANDALS=200 FILTER_STATE_NAMES="Andhra Pradesh,Telangana"
```

## How Join Logic Works
1. Count designation usage (enforce designation.defaultCapacity).
2. Query `CellLevelCapacity` for an aggregate row of the chosen level (simple mode: only matches national/zone entries with geo nulls).
3. If aggregate row exists, count all memberships at that (cell + level [+ zone]) and compare to its capacity.
4. Reject with:
   - `NO_SEATS_DESIGNATION` if the designation is full
   - `NO_SEATS_LEVEL_AGGREGATE` if the aggregate cap is hit

## Switching From Advanced Back to Simple
- Delete non-national/non-zone rows from `CellLevelCapacity`.
- Keep only NATIONAL and ZONE rows.
- No code change required (service already filters to rows with geo fields null for non-zone levels).

## Example Commands (PowerShell)
Seed simple:
```
npx ts-node scripts/seed_cell_level_capacity.ts
```

Seed advanced (restricted):
```
$env:MAX_STATES=5; $env:MAX_DISTRICTS=30; npx ts-node scripts/seed_all_level_capacities.ts
```
Clear variables:
```
Remove-Item Env:MAX_STATES, Env:MAX_DISTRICTS, Env:MAX_MANDALS, Env:FILTER_STATE_NAMES
```

## Adjusting Capacities
Edit the constants inside the seed scripts:
- `NATIONAL: 72`
- `ZONE: 40`
(etc.)

Re-run the seed script—it will upsert (update if changed, create if missing).

## Future Extensions
- Per designation per level override table (e.g., `DesignationLevel`)
- Utilization reporting endpoint
- Fallback hierarchical aggregate enforcement (not recommended unless needed)

## Summary
Start simple (National + Zone). Only add deeper aggregate rows when a clear business rule exists.
