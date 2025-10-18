/**
 * @swagger
 * tags:
 *   - name: HRCI Cases
 *     description: Case Management APIs for HRCI
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     HrcCaseCreateRequest:
 *       type: object
 *       required: [title, description]
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         incidentAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         latitude:
 *           type: number
 *           nullable: true
 *         longitude:
 *           type: number
 *           nullable: true
 *         address:
 *           type: string
 *           nullable: true
 *         category:
 *           type: string
 *           nullable: true
 *         priority:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, URGENT]
 *           default: MEDIUM
 *     HrcCaseSummary:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         caseNumber: { type: string }
 *         title: { type: string }
 *         status: { type: string }
 *         priority: { type: string }
 *         createdAt: { type: string, format: date-time }
 *     HrcCaseDetail:
 *       allOf:
 *         - $ref: '#/components/schemas/HrcCaseSummary'
 *         - type: object
 *           properties:
 *             description: { type: string }
 *             incidentAt: { type: string, format: date-time, nullable: true }
 *             latitude: { type: number, nullable: true }
 *             longitude: { type: number, nullable: true }
 *             address: { type: string, nullable: true }
 *             category: { type: string, nullable: true }
 *             visibility: { type: string, enum: [PRIVATE, PUBLIC_LINK] }
 *     HrcCaseAssignRequest:
 *       type: object
 *       required: [assignedToUserId]
 *       properties:
 *         assignedToUserId: { type: string }
 *         assignedRoleHint: { type: string, nullable: true }
 *     HrcCaseStatusUpdateRequest:
 *       type: object
 *       required: [status]
 *       properties:
 *         status:
 *           type: string
 *           enum: [NEW, TRIAGED, IN_PROGRESS, LEGAL_REVIEW, ACTION_TAKEN, RESOLVED, REJECTED, CLOSED, ESCALATED]
 *         note:
 *           type: string
 *           nullable: true
 *     HrcCaseCommentRequest:
 *       type: object
 *       required: [body]
 *       properties:
 *         body: { type: string }
 *         visibility:
 *           type: string
 *           enum: [EXTERNAL, INTERNAL]
 *           default: EXTERNAL
 *     HrcCaseLegalRequest:
 *       type: object
 *       properties:
 *         legalStatus:
 *           type: string
 *           enum: [NOT_REQUIRED, ADVISED, FILED, IN_COURT]
 *         legalSuggestion:
 *           type: string
 *           nullable: true
 *     HrcCaseEventItem:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         type: { type: string }
 *         data: { type: object }
 *         actorUserId: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     HrcCaseAttachmentItem:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         mediaId: { type: string }
 *         fileName: { type: string, nullable: true }
 *         mime: { type: string, nullable: true }
 *         size: { type: integer, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     HrcCaseCategory:
 *       type: object
 *       properties:
 *         code: { type: string }
 *         name: { type: string }
 *         parentCode: { type: string, nullable: true }
 *         children:
 *           type: array
 *           items: { $ref: '#/components/schemas/HrcCaseCategory' }
 *
 * /hrci/cases:
 *   post:
 *     summary: Create a new case (Complainant or Staff on-behalf)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/HrcCaseCreateRequest'
 *     responses:
 *       201:
 *         description: Case created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/HrcCaseDetail'
 *       400:
 *         description: Validation error
 *
 *   get:
 *     summary: List cases (staff filterable)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: priority
 *         schema: { type: string }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of cases scoped to the requester
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/HrcCaseSummary' }
 *
 * /hrci/cases/me:
 *   get:
 *     summary: List my filed cases (Complainant)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My cases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/HrcCaseSummary' }
 *
 * /hrci/cases/{id}:
 *   get:
 *     summary: Get case by id
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Case detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/HrcCaseDetail' }
 *
 * /hrci/cases/{id}/assign:
 *   patch:
 *     summary: Assign a case to a staff user
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/HrcCaseAssignRequest' }
 *     responses:
 *       200:
 *         description: Assignment updated
 *
 * /hrci/cases/{id}/status:
 *   patch:
 *     summary: Update case workflow status
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/HrcCaseStatusUpdateRequest' }
 *     responses:
 *       200:
 *         description: Status updated
 *
 * /hrci/cases/{id}/comments:
 *   post:
 *     summary: Add a comment (external by default)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/HrcCaseCommentRequest' }
 *     responses:
 *       201:
 *         description: Comment added
 *
 * /hrci/cases/{id}/comments/internal:
 *   post:
 *     summary: Add an internal comment (staff only)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/HrcCaseCommentRequest' }
 *     responses:
 *       201:
 *         description: Internal comment added
 *
 * /hrci/cases/{id}/attachments:
 *   post:
 *     summary: Upload an attachment
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Attachment added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/HrcCaseAttachmentItem' }
 *
 * /hrci/cases/{id}/legal:
 *   patch:
 *     summary: Update legal status/suggestion
 *     description: |
 *       Allowed callers:
 *       - Admin roles: HRCI_ADMIN, ADMIN, SUPERADMIN, SUPER_ADMIN
 *       - Members holding LEGAL_SECRETARY designation (ACTIVE)
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/HrcCaseLegalRequest' }
 *     responses:
 *       200:
 *         description: Legal updated
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
 *                     caseNumber: { type: string }
 *                     legalStatus: { type: string, enum: [NOT_REQUIRED, ADVISED, FILED, IN_COURT] }
 *                     legalSuggestion: { type: string, nullable: true }
 *                     updatedAt: { type: string, format: date-time }
 *       403:
 *         description: Forbidden (insufficient role/designation)
 *       404:
 *         description: Case not found
 *
 * /hrci/cases/{id}/timeline:
 *   get:
 *     summary: Get case timeline/events
 *     tags: [HRCI Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Events
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/HrcCaseEventItem' }
 *
 * /hrci/cases/categories:
 *   get:
 *     summary: List supported case categories
 *     tags: [HRCI Cases]
 *     responses:
 *       200:
 *         description: Categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/HrcCaseCategory' }
 */
