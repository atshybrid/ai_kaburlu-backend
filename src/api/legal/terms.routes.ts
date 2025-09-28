import { Router } from 'express';
import passport from 'passport';
import {
  getActiveTermsController,
  getActiveTermsHtmlController,
  getAllTermsController,
  getTermsByIdController,
  createTermsController,
  updateTermsController,
  deleteTermsController,
  activateTermsController
} from './terms.controller';

const router = Router();
const adminAuth = passport.authenticate('jwt', { session: false });

// Role guard: only SUPER_ADMIN can create/update/delete terms
function requireSuperAdmin(req: any, res: any, next: any) {
  const roleName = (req.user?.role?.name || '').toUpperCase();
  if (roleName === 'SUPER_ADMIN' || roleName === 'SUPERADMIN') return next();
  return res.status(403).json({ error: 'Forbidden: SUPER_ADMIN only' });
}/**
 * @swagger
 * tags:
 *   name: Legal - Terms & Conditions
 *   description: Terms and Conditions management
 */

/**
 * @swagger
 * /legal/terms:
 *   get:
 *     summary: Get active Terms and Conditions (Public)
 *     tags: [Legal - Terms & Conditions]
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           default: en
 *         description: Language code (en, te, hi, etc.)
 *     responses:
 *       200:
 *         description: Active Terms and Conditions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TermsAndConditions'
 *       404:
 *         description: No active terms found for the specified language
 */
router.get('/', getActiveTermsController);

/**
 * @swagger
 * /legal/terms/html:
 *   get:
 *     summary: Get active Terms and Conditions as HTML page (Public)
 *     tags: [Legal - Terms & Conditions]
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           default: en
 *         description: Language code (en, te, hi, etc.)
 *     responses:
 *       200:
 *         description: HTML page with Terms and Conditions
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       404:
 *         description: No active terms found
 */
router.get('/html', getActiveTermsHtmlController);

/**
 * @swagger
 * /legal/terms/admin:
 *   get:
 *     summary: Get all Terms and Conditions versions (Admin only)
 *     tags: [Legal - Terms & Conditions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *         description: Filter by language code
 *     responses:
 *       200:
 *         description: All Terms and Conditions versions retrieved
 *   post:
 *     summary: Create new Terms and Conditions (Admin only)
 *     tags: [Legal - Terms & Conditions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/CreateTermsDto'
 *               - type: object
 *                 description: Structured flat payload (auto-renders HTML content)
 *                 properties:
 *                   appName:
 *                     type: string
 *                     example: Kaburlu
 *                   policyType:
 *                     type: string
 *                     example: Terms and Conditions
 *                   sections:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         title:
 *                           type: string
 *                         content:
 *                           type: string
 *                         points:
 *                           type: array
 *                           items:
 *                             type: string
 *                   language:
 *                     type: string
 *                     example: en
 *                   version:
 *                     type: string
 *                     example: '1.0'
 *                   isActive:
 *                     type: boolean
 *                     example: true
 *                   effectiveDate:
 *                     type: string
 *                     format: date
 *           examples:
 *             simple:
 *               summary: Simple title/content payload
 *               value:
 *                 title: Kaburlu - Terms & Conditions
 *                 content: "<p>These are the terms...</p>"
 *                 language: en
 *                 version: '1.0'
 *                 isActive: true
 *                 effectiveAt: '2025-09-28'
 *             structuredFlat:
 *               summary: Structured flat payload
 *               value:
 *                 appName: Kaburlu
 *                 policyType: Terms and Conditions
 *                 sections:
 *                   - title: Acceptance
 *                     content: By using the app...
 *                   - title: Usage
 *                     points: ["Don’t misuse","Follow laws"]
 *                 language: en
 *                 version: '1.0'
 *                 isActive: true
 *                 effectiveDate: '2025-09-28'
 *     responses:
 *       201:
 *         description: Terms and Conditions created successfully
 */
router.route('/admin')
  .get(adminAuth, getAllTermsController)
  .post(adminAuth, requireSuperAdmin, createTermsController);

/**
 * @swagger
 * /legal/terms/admin/{id}:
 *   get:
 *     summary: Get Terms and Conditions by ID (Admin only)
 *     tags: [Legal - Terms & Conditions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Terms and Conditions ID
 *     responses:
 *       200:
 *         description: Terms and Conditions retrieved successfully
 *       404:
 *         description: Terms and Conditions not found
 *   put:
 *     summary: Update Terms and Conditions (SUPER_ADMIN only)
 *     tags: [Legal - Terms & Conditions]
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
 *             oneOf:
 *               - $ref: '#/components/schemas/UpdateTermsDto'
 *               - type: object
 *                 description: Structured flat payload (auto-renders HTML content)
 *                 properties:
 *                   appName:
 *                     type: string
 *                   policyType:
 *                     type: string
 *                   sections:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         title:
 *                           type: string
 *                         content:
 *                           type: string
 *                         points:
 *                           type: array
 *                           items:
 *                             type: string
 *                   language:
 *                     type: string
 *                   version:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   effectiveDate:
 *                     type: string
 *                     format: date
 *           examples:
 *             simple:
 *               summary: Simple update (title/content)
 *               value:
 *                 title: Updated Terms
 *                 content: "<p>Updated content...</p>"
 *                 isActive: true
 *             structuredFlat:
 *               summary: Structured flat update
 *               value:
 *                 appName: Kaburlu
 *                 policyType: Terms and Conditions
 *                 sections:
 *                   - title: Changes
 *                     content: We updated this section
 *                 isActive: true
 *     responses:
 *       200:
 *         description: Terms and Conditions updated successfully
 *   delete:
 *     summary: Delete Terms and Conditions (SUPER_ADMIN only)
 *     tags: [Legal - Terms & Conditions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Terms and Conditions deleted successfully
 */
router.route('/admin/:id')
  .get(adminAuth, getTermsByIdController)
  .put(adminAuth, requireSuperAdmin, updateTermsController)
  .delete(adminAuth, requireSuperAdmin, deleteTermsController);

/**
 * @swagger
 * /legal/terms/admin/{id}/activate:
 *   post:
 *     summary: Activate Terms and Conditions version (SUPER_ADMIN only)
 *     tags: [Legal - Terms & Conditions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Terms and Conditions ID to activate
 *     responses:
 *       200:
 *         description: Terms and Conditions activated successfully
 *       404:
 *         description: Terms and Conditions not found
 */
router.post('/admin/:id/activate', adminAuth, requireSuperAdmin, activateTermsController);

export default router;