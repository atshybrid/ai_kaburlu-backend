import { Router } from 'express';
import passport from 'passport';
import * as shortNewsController from './shortnews.controller';
import { sendShortNewsApprovedNotification } from './shortnews.notifications';

const router = Router();

function roleName(user: any): string { return (user?.role?.name || '').toUpperCase(); }
function isReporterOrAbove(user: any): boolean {
	const r = roleName(user);
	// Allow reporters and above, plus MEMBER and HRCI_ADMIN explicitly
	return ['CITIZEN_REPORTER','REPORTER','NEWS_DESK','NEWS_DESK_ADMIN','LANGUAGE_ADMIN','SUPERADMIN','SUPER_ADMIN','ADMIN','MEMBER','HRCI_ADMIN'].includes(r);
}
function requireReporterOrAbove(req: any, res: any, next: any) {
	if (isReporterOrAbove(req.user)) return next();
	return res.status(403).json({ error: 'Forbidden: reporter/member/HRCI admin required' });
}

/**
 * @swagger
 * /shortnews/AIarticle:
 *   post:
 *     summary: AI generate short news draft (helper only, no save)
*     description: Accept raw field note text (<=500 words) and returns optimized short news draft (title <=50 chars, content <=60 words) plus optional category suggestion. If the suggested category doesn't exist, the server will auto-create a Category and a CategoryTranslation for the user's language and return their IDs.
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rawText]
 *             properties:
 *               rawText:
 *                 type: string
 *                 description: User raw note text (<=500 words)
 *                 example: "today morning heavy rain caused water logging near market area traffic slow police managing"
 *     responses:
 *       200:
 *         description: AI draft generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
*                     title: { type: string, description: "<=50 chars" }
 *                     content: { type: string, description: "<=60 words" }
 *                     languageCode: { type: string }
 *                     suggestedCategoryName: { type: string }
 *                     suggestedCategoryId: { type: string, nullable: true }
 *                     matchedCategoryName: { type: string, nullable: true }
 *                     createdCategory: { type: boolean, description: "True if a new category was created" }
 *                     categoryTranslationId: { type: string, nullable: true, description: "Translation row id for user's language if created/found" }
 *       400:
 *         description: Validation error (missing rawText or >100 words)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: AI failure or invalid output
 */
router.post('/AIarticle', passport.authenticate('jwt', { session: false }), requireReporterOrAbove, shortNewsController.aiGenerateShortNewsArticle);

/**
 * @swagger
 * /shortnews/ai/rewrite:
 *   post:
 *     summary: AI rewrite helper for short news (returns professional concise draft)
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rawText]
 *             properties:
 *               title:
 *                 type: string
 *                 description: Optional tentative title supplied by user
 *                 example: "Road accident update"
 *               rawText:
 *                 type: string
 *                 description: User's raw text / notes to rewrite
 *                 example: "hi today morning near main circle two cars collision no deaths police arrived"
 *     responses:
 *       200:
 *         description: AI rewrite successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
*                     title: { type: string, description: "<=50 chars optimized title" }
 *                     content: { type: string, description: "<=60 words rewritten content" }
 *                     languageCode: { type: string }
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: AI failure or invalid output
 */
router.post('/ai/rewrite', passport.authenticate('jwt', { session: false }), requireReporterOrAbove, shortNewsController.aiRewriteShortNews);

/**
 * @swagger
 * /shortnews:
 *   post:
 *     summary: Submit short news (citizen reporter)
 *     tags: [ShortNews]
 *     description: |
 *       Posts are associated with the author's language. When language enforcement is enabled, the server will reject content that is clearly written in a different script (e.g., Hindi/Devanagari posted under Telugu) with error LANGUAGE_MISMATCH. Configure via env SHORTNEWS_LANGUAGE_ENFORCE (default true) and SHORTNEWS_LANGUAGE_STRICTNESS (default 0.6).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *               - categoryId
 *               - latitude
 *               - longitude
 *             properties:
 *               title:
 *                 type: string
 *                 description: Required. The server will auto-generate the slug from this title.
 *                 example: "Local Event in Hyderabad"
 *               content:
 *                 type: string
 *                 example: "A new park was inaugurated today..."
 *               categoryId:
 *                 type: string
 *                 description: Required. Category to file this short news under.
 *                 example: "clx123abc456def"
 *               mediaUrls:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["https://img.com/1.jpg", "https://img.com/2.mp4"]
 *               latitude:
 *                 type: number
 *                 example: 17.385044
 *                 description: Required. Latitude between -90 and 90.
 *               longitude:
 *                 type: number
 *                 example: 78.486671
 *                 description: Required. Longitude between -180 and 180.
 *               address:
 *                 type: string
 *                 example: "Hyderabad, Telangana"
 *               accuracyMeters:
 *                 type: number
 *                 example: 12.5
 *               provider:
 *                 type: string
 *                 example: fused
 *                 description: "fused|gps|network"
 *               timestampUtc:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-09-14T12:30:45Z"
 *               placeId:
 *                 type: string
 *                 example: "ChIJ...abc"
 *               placeName:
 *                 type: string
 *                 example: "Hyderabad"
 *               source:
 *                 type: string
 *                 example: foreground
 *                 description: "foreground|background|manual"
 *     responses:
 *       201:
 *         description: Short news submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     slug:
 *                       type: string
 *                     transliteratedSlug:
 *                       type: string
 *                       description: ASCII transliteration of slug for URL usage
 *                     status:
 *                       type: string
 *                       description: Initial moderation status (AI_APPROVED, DESK_PENDING, or REJECTED)
 *                     languageId:
 *                       type: string
 *                     languageName:
 *                       type: string
 *                     languageCode:
 *                       type: string
 *                     canonicalUrl:
 *                       type: string
 *                     seo:
 *                       type: object
 *                       properties:
 *                         metaTitle:
 *                           type: string
 *                         metaDescription:
 *                           type: string
 *                         tags:
 *                           type: array
 *                           items:
 *                             type: string
 *                         altTexts:
 *                           type: object
 *                           additionalProperties:
 *                             type: string
 *                           description: Map of image URL to generated alt text (in the same language)
 *                         jsonLd:
 *                           type: object
 *                           description: Structured data for embedding
 *                     languageInfo:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         code:
 *                           type: string
 *                         name:
 *                           type: string
 *                         nativeName:
 *                           type: string
 *   get:
 *     summary: List short news (cursor-based)
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of items to return
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           example: eyJpZCI6IjEyMyIsImRhdGUiOiIyMDI1LTA5LTEzVDA3OjAwOjAwLjAwMFoifQ==
 *         description: Base64-encoded JSON { id, date } to get next items after this cursor
 *       - in: query
 *         name: all
 *         schema:
 *           type: boolean
 *         description: If true, return short news across ALL languages (admin-style global feed) instead of restricting to the authenticated user's language.
 *     responses:
 *       200:
 *         description: List of short news with pageInfo { nextCursor, hasMore }.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 pageInfo:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                     nextCursor:
 *                       type: string
 *                     hasMore:
 *                       type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       title: { type: string }
 *                       slug: { type: string }
 *                       mediaUrls:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: "Image/Video URLs (image: .webp, video: .webm preferred)"
 *                       languageId: { type: string, nullable: true }
 *                       languageName: { type: string, nullable: true }
 *                       languageCode: { type: string, nullable: true }
 *                       categoryId: { type: string }
 *                       categoryName: { type: string, nullable: true }
 *                       authorId: { type: string }
 *                       authorName: { type: string, nullable: true, description: "Currently email or mobile number" }
 *                       author:
 *                         type: object
 *                         properties:
 *                           id: { type: string, nullable: true }
 *                           fullName: { type: string, nullable: true }
 *                           profilePhotoUrl: { type: string, nullable: true }
 *                           email: { type: string, nullable: true }
 *                           mobileNumber: { type: string, nullable: true }
 *                           roleName: { type: string, nullable: true }
 *                           reporterType: { type: string, nullable: true, description: "Alias of roleName for clients" }
 *                       isOwner: { type: boolean, description: "True if the authenticated user authored this item" }
 *                       isRead: { type: boolean, description: "True if the authenticated user marked/read this item (ShortNewsRead)" }
 *                       placeName: { type: string, nullable: true }
 *                       address: { type: string, nullable: true }
 *                       latitude: { type: number, nullable: true }
 *                       longitude: { type: number, nullable: true }
 *                       accuracyMeters: { type: number, nullable: true }
 *                       provider: { type: string, nullable: true }
 *                       timestampUtc: { type: string, format: date-time, nullable: true }
 *                       placeId: { type: string, nullable: true }
 *                       source: { type: string, nullable: true }
 *
 * /shortnews/{id}/status:
 *   patch:
 *     summary: Update status (AI/desk approval)
 *     tags: [ShortNews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [AI_APPROVED, DESK_PENDING, DESK_APPROVED, REJECTED]
 *                 example: "DESK_PENDING"
 *               aiRemark:
 *                 type: string
 *                 example: "Plagiarism detected"
 *     responses:
 *       200:
 *         description: Status updated
 */
router.post('/', passport.authenticate('jwt', { session: false }), requireReporterOrAbove, shortNewsController.createShortNews);
router.get('/', passport.authenticate('jwt', { session: false }), shortNewsController.listShortNews);

// Role guard utility for privileged reads
function requireDeskOrAdmin(req: any, res: any, next: any) {
	const roleName = (req.user?.role?.name || '').toUpperCase();
	const allowed = new Set(['SUPERADMIN', 'SUPER_ADMIN', 'LANGUAGE_ADMIN', 'NEWS_DESK', 'NEWS_DESK_ADMIN', 'HRCI_ADMIN']);
	if (allowed.has(roleName)) return next();
	return res.status(403).json({ error: 'Forbidden: desk/admin access only' });
}

/**
 * @swagger
 * /shortnews/all:
 *   get:
 *     summary: List all short news (admin/desk)
 *     description: Returns all short news across categories and statuses. Optional filters by languageId, status, and categoryId.
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: languageId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, AI_APPROVED, DESK_PENDING, DESK_APPROVED, REJECTED]
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           example: eyJpZCI6IjEyMyIsImRhdGUiOiIyMDI1LTA5LTEzVDA3OjAwOjAwLjAwMFoifQ==
 *         description: Base64-encoded JSON { id, date }
 *     responses:
 *       200:
 *         description: List of short news (admin/desk) with pagination.
 */
router.get('/all', passport.authenticate('jwt', { session: false }), requireDeskOrAdmin, shortNewsController.listAllShortNews);
/**
 * @swagger
 * /shortnews/{id}:
 *   put:
 *     summary: Update short news (author or desk/admin)
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               content: { type: string, description: "Must be 60 words or less" }
 *               categoryId: { type: string }
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *               mediaUrls:
 *                 type: array
 *                 items: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               address: { type: string }
 *               accuracyMeters: { type: number }
 *               provider: { type: string }
 *               timestampUtc: { type: string, format: date-time }
 *               placeId: { type: string }
 *               placeName: { type: string }
 *               source: { type: string }
 *     responses:
 *       200:
 *         description: Updated short news item
 */
router.put('/:id', passport.authenticate('jwt', { session: false }), shortNewsController.updateShortNews);
router.patch('/:id/status', passport.authenticate('jwt', { session: false }), requireDeskOrAdmin, shortNewsController.updateShortNewsStatus);

/**
 * @swagger
 * /shortnews/{id}/jsonld:
 *   get:
 *     summary: Get JSON-LD for a ShortNews item
 *     tags: [ShortNews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: JSON-LD object for embedding in pages
 */
router.get('/:id/jsonld', shortNewsController.getShortNewsJsonLd);

/**
 * @swagger
 * /shortnews/public:
 *   get:
 *     summary: Public feed - approved only (AI_APPROVED and DESK_APPROVED)
 *     description: |
 *       Returns a paginated list of approved short news items. When the ADS feature is enabled, the feed includes sponsor ads injected approximately every 2 items.
 *       Each item has a discriminant field `kind` which is either `news` or `ad`.
 *       Clients should handle both shapes. Ads are included only when their status is ACTIVE and within their configured date window.
 *     tags: [ShortNews]
 *     parameters:
 *       - in: query
 *         name: languageId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional language ID filter. If provided, only items in this language are returned.
 *       - in: query
 *         name: languageCode
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional language CODE filter (e.g., "en", "te"). If provided (and languageId is not), items in this language are returned.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Base64-encoded JSON { id, date }
 *       - in: query
 *         name: latitude
 *         required: false
 *         schema:
 *           type: number
 *           format: float
 *         description: Optional latitude. If both latitude and longitude are provided, results are filtered to within ~30 km radius.
 *       - in: query
 *         name: longitude
 *         required: false
 *         schema:
 *           type: number
 *           format: float
 *         description: Optional longitude. If both latitude and longitude are provided, results are filtered to within ~30 km radius.
 *       - in: query
 *         name: radiusKm
 *         required: false
 *         schema:
 *           type: number
 *         description: Optional search radius in kilometers (default 30, min 1, max 200) applied when latitude and longitude are provided.
 *     responses:
 *       200:
 *         description: Approved short news list enriched with categoryName, author (object), authorName (legacy), place/address, lat/lon, canonicalUrl, jsonLd, primary media, and optional isOwner/isRead flags if bearer token supplied. May include injected ads when feature flag ADS_ENABLED is true.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 pageInfo:
 *                   type: object
 *                   properties:
 *                     limit: { type: integer }
 *                     nextCursor: { type: string, nullable: true }
 *                     hasMore: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     oneOf:
 *                       - type: object
 *                         description: ShortNews item
 *                         properties:
 *                           kind: { type: string, enum: [news] }
 *                           id: { type: string }
 *                           title: { type: string }
 *                           slug: { type: string }
 *                           authorName: { type: string, nullable: true }
 *                           author:
 *                             type: object
 *                             properties:
 *                               id: { type: string, nullable: true }
 *                               fullName: { type: string, nullable: true }
 *                               profilePhotoUrl: { type: string, nullable: true }
 *                               email: { type: string, nullable: true }
 *                               mobileNumber: { type: string, nullable: true }
 *                               roleName: { type: string, nullable: true }
 *                               reporterType: { type: string, nullable: true }
 *                           isOwner: { type: boolean }
 *                           isRead: { type: boolean }
 *                       - type: object
 *                         description: Injected sponsor ad
 *                         properties:
 *                           kind: { type: string, enum: [ad] }
 *                           id: { type: string }
 *                           title: { type: string }
 *                           mediaType: { type: string, enum: [IMAGE, GIF, VIDEO] }
 *                           mediaUrl: { type: string }
 *                           posterUrl: { type: string, nullable: true }
 *                           clickUrl: { type: string, nullable: true }
 *                           languageId: { type: string, nullable: true }
 */
router.get('/public', shortNewsController.listApprovedShortNews);

/**
 * @swagger
 * /shortnews/public/{id}:
 *   get:
 *     summary: Get single approved short news by ID (PUBLIC - no auth required)
 *     description: Returns a single approved short news item with full enriched data including reactions, comments, and metadata. Only DESK_APPROVED and AI_APPROVED items are accessible. Perfect for URL sharing and deep linking.
 *     tags: [ShortNews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ShortNews ID
 *       - in: query
 *         name: languageId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional language ID guard. If provided and the item's language differs, 404 is returned.
 *       - in: query
 *         name: languageCode
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional language CODE guard (e.g., "en", "te"). If provided (and languageId is not), and the item's language differs, 404 is returned.
 *     responses:
 *       200:
 *         description: Single approved short news item with enriched data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     title: { type: string }
 *                     content: { type: string }
 *                     slug: { type: string }
 *                     status: { type: string }
 *                     authorName: { type: string, nullable: true }
 *                     author:
 *                       type: object
 *                       properties:
 *                         id: { type: string, nullable: true }
 *                         fullName: { type: string, nullable: true }
 *                         profilePhotoUrl: { type: string, nullable: true }
 *                         email: { type: string, nullable: true }
 *                         mobileNumber: { type: string, nullable: true }
 *                         roleName: { type: string, nullable: true }
 *                         reporterType: { type: string, nullable: true }
 *                     categoryName: { type: string, nullable: true }
 *                     languageId: { type: string, nullable: true }
 *                     languageName: { type: string, nullable: true }
 *                     languageCode: { type: string, nullable: true }
 *                     mediaUrls: { type: array, items: { type: string } }
 *                     primaryImageUrl: { type: string, nullable: true }
 *                     primaryVideoUrl: { type: string, nullable: true }
 *                     canonicalUrl: { type: string }
 *                     jsonLd: { type: object }
 *                     isOwner: { type: boolean, description: "True if requesting user is the author" }
 *                     isRead: { type: boolean, description: "True if requesting user has read this item" }
 *                     placeName: { type: string, nullable: true }
 *                     address: { type: string, nullable: true }
 *                     latitude: { type: number, nullable: true }
 *                     longitude: { type: number, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *       404:
 *         description: ShortNews not found or not approved for public access
 *       500:
 *         description: Internal server error
 */
router.get('/public/:id', shortNewsController.getApprovedShortNewsById);

/**
 * @swagger
 * /shortnews/moderation:
 *   get:
 *     summary: Moderation queue/status-wise listing
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, AI_APPROVED, DESK_PENDING, DESK_APPROVED, REJECTED]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Base64-encoded JSON { id, date }
 *     responses:
 *       200:
 *         description: Items by status for current user/desk enriched with categoryName, authorName, place/address, lat/lon
 */
router.get('/moderation', passport.authenticate('jwt', { session: false }), shortNewsController.listShortNewsByStatus);

/**
 * @swagger
 * /shortnews/{id}/notify:
 *   post:
 *     summary: Manually trigger (or dry-run) push notification for an approved ShortNews
 *     description: Sends (or previews) the push notification for a ShortNews item if it is in AI_APPROVED or DESK_APPROVED status. Use force=true to resend even if previously sent. Use dryRun=true to only preview tokens/payload.
 *     tags: [ShortNews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: force
 *         schema: { type: boolean }
 *         description: Resend even if already notified.
 *       - in: query
 *         name: dryRun
 *         schema: { type: boolean }
 *         description: If true, do not send; just return tokens count and payload.
 *       - in: query
 *         name: topics
 *         schema: { type: boolean }
 *         description: If false, skip topic broadcast.
 *     responses:
 *       200:
 *         description: Notification result or dry-run preview.
 *       404:
 *         description: Not found / status not approved.
 */
router.post('/:id/notify', passport.authenticate('jwt', { session: false }), async (req, res) => {
	try {
		const { id } = req.params;
		const force = String(req.query.force).toLowerCase() === 'true';
		const dryRun = String(req.query.dryRun).toLowerCase() === 'true';
		const useTopics = req.query.topics === undefined ? true : String(req.query.topics).toLowerCase() === 'true';
		const result = await sendShortNewsApprovedNotification(id, { force, dryRun, useTopics });
		if (result.skipped && result.reason === 'status') {
			return res.status(404).json({ success: false, error: 'ShortNews not approved', reason: result.reason });
		}
		return res.json({ success: true, result });
	} catch (e: any) {
		console.error('Manual notify error', e);
		return res.status(500).json({ success: false, error: e.message || 'Internal error' });
	}
});

export default router;
