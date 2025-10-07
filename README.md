# Node + Express Service Starter

> HRCI Module (Human Rights & Citizen Initiative) – scaffold added. Implements volunteer hierarchy, ID cards, cases, donations, Razorpay payments (in progress).

This is a simple API sample in Node.js with express.js based on [Google Cloud Run Quickstart](https://cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-nodejs-service).

## Getting Started

Server should run automatically when starting a workspace. To run manually, run:
```sh
npm run dev
```

## Database Seeding

The project ships with an idempotent TypeScript seed script (`prisma/seed.ts`).

Basic core lookup seed (roles, languages, country+states, categories+translations, prompts, core admin users):

PowerShell / Windows
```
npm run seed
```

Full sample content (adds sample Articles, ShortNews, reactions, reads, comments, devices):

```
$env:FULL_SEED=1; npm run seed
```

Force wipe (destructive) then full seed:
```
$env:FORCE_WIPE=1; $env:FULL_SEED=1; npm run seed
```

Created Accounts (MPINs are hashed in DB):
| Role | Mobile | MPIN | Notes |
|------|--------|------|-------|
| SUPER_ADMIN | 8282868389 | 1947 | Primary admin |
| LANGUAGE_ADMIN | 9502337775 | 1234 | Telugu language admin |
| REPORTER | 9000000001 | 1111 | Created only with FULL_SEED |

Guest device (no user row) is also created with deviceId `dev-guest-demo` when FULL_SEED is enabled.

Repeatable: Running the seed again updates/upsers without duplicating rows. Only when `FORCE_WIPE=1` are tables truncated (selected order) before reseeding.

Summary counts are printed at the end (users, articles, short news, comments, devices, reactions) for quick verification.

Legacy `prisma/seed.js` is deprecated (kept only for backward compatibility); always prefer `npm run seed` which executes the TypeScript version.


## Admin: Managing AI Prompt Templates

The API uses DB-backed prompt templates for AI features (SEO, moderation, translations). Admins can view and update these via the Prompts API.

- Swagger UI: navigate to `/api/docs` and open the "Prompts" tag.
- Endpoints:
	- GET `/prompts` — list all templates
	- PUT `/prompts` — upsert a template by `{ key, content, description? }`
- Auth: Requires JWT. Roles allowed: `SUPERADMIN`, `LANGUAGE_ADMIN`, `NEWS_DESK_ADMIN`.

Example request body for PUT /prompts:

```json
{
	"key": "SEO_GENERATION",
	"content": "You are an SEO assistant...",
	"description": "Generates SEO tags/meta/alt for ShortNews"
}
```

Notes:
- Templates may use `{{placeholders}}`; the backend fills them at runtime.
- If a key is missing in DB, code-level defaults are used automatically.

---

## ShortNews AI Draft Endpoint

Helper endpoint (no DB write) that converts a raw field note (≤500 words) into a structured short news draft:

`POST /api/v1/shortnews/AIarticle`

Request body:
```json
{ "rawText": "today morning heavy rain caused water logging near market area traffic slow police managing" }
```

Response body (success):
```json
{
	"success": true,
	"data": {
		"title": "Rain slows market traffic downtown", // <=50 chars (truncated if longer)
		"content": "... 58-60 words ...",            // AI enforced 58-60 words (retry logic if <58)
		"languageCode": "en",
		"suggestedCategoryName": "Weather",
		"suggestedCategoryId": "clx...",             // Newly created or matched Category
		"matchedCategoryName": "Weather",            // Base category name if matched
		"createdCategory": false,                     // true if backend auto-created it
		"categoryTranslationId": "clt...",           // CategoryTranslation for user language
		"languageCategoryId": "clt...",              // Alias (same value) for clarity
		"localizedCategoryName": "Weather",          // Translation in user language
		"attempts": 2,                                // How many AI attempts (incl. success / fallback)
		"fallback": false                            // true if deterministic local fallback used
	}
}
```

Rules & Notes:
- Title is trimmed to 50 characters if AI output longer.
- Content strictly capped to 60 words; generation retries up to 2 times if initial word count <58.
- If AI provider fails (empty / invalid JSON for all attempts) a deterministic fallback draft is produced from the raw input (first 6 words headline + first 60 words body) and `fallback: true` is returned so the client can optionally flag it for manual review.
- If the suggested category does not exist, a Category + CategoryTranslation (for user language) are created immediately; background job fills other languages.
- Requires authenticated user (JWT) with language set (languageId on user).

## ShortNews Submission Endpoint
`POST /api/v1/shortnews` persists a short news item. Requires: `title`, `content`, `categoryId`, `latitude`, `longitude`. (See Swagger for full schema.)

---

## Unified Read Tracking

Legacy tables (`ArticleRead`, `ShortNewsRead`) are being superseded by `ContentRead` for analytics. Current behavior:

| Aspect | Article | ShortNews |
|--------|---------|-----------|
| Complex progress endpoint | Deprecated (410) | Active (`/shortnews/read/progress`) |
| Dual write to `ContentRead` | Yes (where old endpoints still touched) | Yes |
| Returned analytics snapshot | Added in ShortNews progress response (`contentRead`) | Included |

### POST /api/v1/shortnews/read/progress
Body:
```json
{
	"shortNewsId": "...",
	"deltaTimeMs": 1200,
	"maxScrollPercent": 55,
	"ended": false
}
```
Response:
```json
{
	"updated": [ { "shortNewsId": "...", "totalTimeMs": 3400, "maxScrollPercent": 72, "completed": false, "sessionsCount": 1, "readAt": "..." } ],
	"contentRead": { "totalTimeMs": 3400, "maxScrollPercent": 72, "completed": false, "sessionsCount": 1, "updatedAt": "..." }
}
```

Completion logic (defaults, configurable via env):
- `READ_COMPLETE_MIN_TIME_MS` (default 8000)
- `READ_COMPLETE_SCROLL_PERCENT` (default 85)
- Marked completed when both thresholds reached.

### ContentRead Model (polymorphic)
```
id, userId, contentId, contentType (ARTICLE|SHORTNEWS), totalTimeMs, maxScrollPercent,
completed, sessionsCount, completedAt, lastEventAt, geo snapshot (stateId/districtId/mandalId + lat/long fields)
```
Unique composite: `(userId, contentType, contentId)`.

---

## Unified Reactions

Legacy `Like` / `Dislike` tables (Article-only) are replaced by `ContentReaction`:
```
id, userId, contentId, contentType (ARTICLE|SHORTNEWS), reaction (LIKE|DISLIKE), createdAt, updatedAt
```
Unique composite: `(userId, contentType, contentId)`.

### PUT /api/v1/reactions
Body variants:
```json
{ "articleId": "<article-or-shortnews-id>", "reaction": "LIKE" }
{ "shortNewsId": "<shortnews-id>", "reaction": "DISLIKE" }
{ "contentId": "<any id>", "reaction": "NONE" }
```
Behavior:
- If `articleId` is provided but no Article exists, backend auto-falls back to ShortNews detection.
- `reaction: NONE` clears the row.

Response example:
```json
{
	"success": true,
	"data": { "contentType": "SHORTNEWS", "contentId": "...", "reaction": "LIKE", "counts": { "likes": 5, "dislikes": 1 } }
}
```

### POST /api/v1/reactions/status (batch)
Body: `{ "shortNewsIds": ["id1","id2"] }` OR `{ "articleIds": ["..."] }`.
Returns array of current reaction + aggregate counts.

---

## Deprecations Summary
| Endpoint | Status | Replacement |
|----------|--------|-------------|
| /articles/read/progress (complex) | 410 Gone | /shortnews/read/progress |
| /likes, /dislikes (legacy) | Deprecated | /reactions |
| Legacy article-only comment variant paths | Merged | /comments?articleId=... or /comments?shortNewsId=... |

---

## Environment Variables (Relevant)
| Variable | Purpose | Default |
|----------|---------|---------|
| READ_COMPLETE_MIN_TIME_MS | Min ms for completion | 8000 |
| READ_COMPLETE_SCROLL_PERCENT | Scroll % for completion | 85 |
| RAZORPAY_KEY_ID | Razorpay public key | (none) |
| RAZORPAY_KEY_SECRET | Razorpay secret key | (none) |
| RAZORPAY_WEBHOOK_SECRET | HMAC secret for webhook signature verify | (none) |
| HRCI_IDCARD_VALIDITY_DAYS | Default validity window for ID cards | 365 |
| HRCI_IDCARD_RENEW_GRACE_DAYS | Grace days after expiry for renewal pricing | 30 |
| HRCI_DEFAULT_CURRENCY | Currency for payments | INR |
| HRCI_AUTO_EXPIRE_CRON | (future) cron expression for card expiry job | 0 2 * * * |

---

## Frontend Integration Cheat Sheet
1. Generate AI draft -> user may edit -> submit shortnews.
2. While user reads: send periodic `/shortnews/read/progress` with accumulated delta & highest scroll; mark ended=true when leaving view.
3. Reactions: single toggle call; send `reaction: NONE` to clear.
4. For analytics dashboards, prefer aggregating from `ContentRead` and `ContentReaction`.

---

## Future Cleanup (Planned)
- Remove legacy Like/Dislike tables after confidence window.
- Optional mixed-type batch reactions endpoint.
- Expand AI validation (e.g., toxicity, duplicate detection) on draft submission.

---

## Polymorphic Comments (Articles & ShortNews)

Comments now support both parent content types without duplicating tables.

Model shape (conceptual):
```
Comment {
	id            String
	articleId     String?    // nullable
	shortNewsId   String?    // nullable
	parentId      String?    // self-referencing for replies
	userId        String
	content       String
	createdAt / updatedAt
}
```

DB Constraint (XOR): exactly one of `articleId` or `shortNewsId` must be non-null. This prevents ambiguous linkage and keeps indexes selective.

API Usage:
```
POST /api/v1/comments
{ "articleId": "...", "content": "text" }

POST /api/v1/comments
{ "shortNewsId": "...", "content": "text" }

GET /api/v1/comments?articleId=...   // list for article
GET /api/v1/comments?shortNewsId=... // list for short news
```

Replies: include `parentId` referencing another comment that targets the same content (validated server-side to avoid cross-content threading).

Best Practices Implemented:
1. Single table polymorphism (avoids UNION queries & redundant migrations).
2. XOR check constraint (enforced at DB, not just application).
3. Narrow composite indexes on `(articleId)` and `(shortNewsId)` for efficient filtered fetch.
4. DTO-level validation to reject payloads supplying both or neither IDs early with 400.
5. Forward-compatible: can extend to a third content type later by introducing a generic `(contentId, contentType)` pair in a v2 table without data loss (migration path documented in code comments – future work).

Response Shape (example list):
```json
[
	{ "id": "c1", "content": "Nice update", "userId": "u1", "articleId": "a1", "parentId": null },
	{ "id": "c2", "content": "More details?", "userId": "u2", "shortNewsId": "s5", "parentId": null }
]
```

---

## Architectural Evolution & Unified Models

| Concern | Legacy | Current Unified | Rationale |
|---------|--------|-----------------|-----------|
| Read Analytics | ArticleRead + ShortNewsRead (separate logic) | ContentRead (polymorphic) + transitional dual-write | Simplifies dashboards, consistent attribution, geo snapshot in one place. |
| Reactions | Likes / Dislikes (Article only) | ContentReaction (ARTICLE|SHORTNEWS) | Eliminates table explosion, simpler aggregation. |
| Comments | Article-only table | Polymorphic Comment (articleId XOR shortNewsId) | Avoids duplicate code & future expansion complexity. |
| AI Drafting | Ad hoc prompt string | DB-backed prompt templates | Runtime tunability without redeploy. |

Deprecation Path Notes:
1. Retain legacy tables until monitoring confirms no stale writers (logs show zero hits for 7 days).
2. Add a data parity check job (optional future task) comparing per-content aggregates between legacy & unified tables — can then drop legacy.
3. Remove fallback code branch for reactions once Prisma client export for `ReactionValue` confirmed stable across environments.
4. (Planned) Add a feature flag to fully disable ArticleRead writes (already functionally 410 for complex progress) before schema prune.

---

## AI Draft Quality & Enforcement Details

Why 58–60 words? Gives the AI slight flexibility while ensuring a visually balanced short news card. Retries are issued if the body is under 58 words; if after 3 attempts still short, current implementation returns the last attempt (future improvement: deterministic expansion step).

Hard Caps:
- Title forcibly truncated to 50 characters (post-trim) to avoid overflow.
- Content truncated at 60 words (token safe for push notifications & preview snippets).

Recommended Future Enhancements:
1. Post-generation semantic filter (toxicity / PII / repetition) before returning to client.
2. Deterministic expansion fallback when <58 words after final retry (e.g., append concise context phrases extracted from rawText until threshold met).
3. Telemetry event on each retry attempt with reason (under-length, JSON parse error) to refine prompt.
4. Caching: identical `rawText` + language within short window returns cached structured draft to save tokens.

---

## Testing Strategy (Suggested)

Because AI provider calls are external and non-deterministic, isolate logic:
1. Extract word-count & retry loop into a pure helper (`generateShortNewsDraft(aiFn, rawText, languageCode)`).
2. Inject a mock `aiFn` in unit tests to simulate: valid JSON, malformed JSON, too-short content, over-length title/content.
3. Add contract tests ensuring:
	 - Output always <=50 chars title, <=60 words content.
	 - Minimum word threshold behavior (retries invoked when <58 words on early attempts).
	 - Category auto-creation path vs existing category path.

Example (pseudo):
```ts
it('retries when under 58 words', async () => {
	const calls: string[] = [];
	const aiFn = async (prompt: string) => {
		calls.push(prompt);
		return calls.length < 2 ? JSON.stringify({ title: 'T', content: 'one two three' }) : JSON.stringify({ title: 'T', content: new Array(59).fill('w').join(' ') });
	};
	const out = await generateShortNewsDraft(aiFn, RAW, 'en');
	expect(out.content.split(/\s+/).length).toBeGreaterThanOrEqual(58);
	expect(calls.length).toBe(2);
});
```

---

## Operational Best Practices Checklist (Current Status)
| Area | Status | Next Step |
|------|--------|-----------|
| AI Prompt versioning | DB-backed key | Add migration to log historical prompt changes |
| Read tracking migration | Dual-write active | Add parity audit & then drop legacy tables |
| Reactions | Unified | Remove fallback code & legacy schema post-audit |
| Comments | Polymorphic | Consider future general contentType if 3rd type added |
| Error telemetry | Partial (HTTP codes) | Add structured event logs for AI retries & category auto-create |
| Rate limiting | Not yet | Add simple token bucket per user for AI endpoints |
| Security | JWT enforced | Add role/permission guard for admin-only AI endpoints |

## HRCI Module Roadmap (High Level)
Phase 1:
- Teams CRUD (basic)
- Volunteer onboarding + profile create
- Fee resolution & order creation (Razorpay)
- ID card issue / renew (pending payment success)

Phase 2:
- Cases CRUD + updates + attachments
- Donations (anonymous + attributed)
- Refund initiation (admin)

Phase 3:
- Reporting & analytics endpoints
- Automated expiry job & renewal reminders
- Escalation & SLA timers
- Recurring donations placeholder activation

