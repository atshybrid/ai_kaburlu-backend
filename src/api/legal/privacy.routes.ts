import { Router } from 'express';
import passport from 'passport';
import {
  getActivePrivacyController,
  getActivePrivacyHtmlController,
  getAllPrivacyController,
  getPrivacyByIdController,
  createPrivacyController,
  updatePrivacyController,
  deletePrivacyController,
  activatePrivacyController
} from './privacy.controller';

const router = Router();
const adminAuth = passport.authenticate('jwt', { session: false });

// Role guard: only SUPER_ADMIN can create/update/delete privacy policy
function requireSuperAdmin(req: any, res: any, next: any) {
  const roleName = (req.user?.role?.name || '').toUpperCase();
  if (roleName === 'SUPER_ADMIN' || roleName === 'SUPERADMIN') return next();
  return res.status(403).json({ error: 'Forbidden: SUPER_ADMIN only' });
}

/**
 * @swagger
 * tags:
 *   name: Legal - Privacy Policy
 *   description: Privacy Policy management
 */

/**
 * @swagger
 * /legal/privacy:
 *   get:
 *     summary: Get active Privacy Policy (Public)
 *     tags: [Legal - Privacy Policy]
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           default: en
 *         description: Language code (en, te, hi, etc.)
 *     responses:
 *       200:
 *         description: Active Privacy Policy retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PrivacyPolicy'
 *       404:
 *         description: No active privacy policy found for the specified language
 */
router.get('/', getActivePrivacyController);

/**
 * @swagger
 * /legal/privacy/html:
 *   get:
 *     summary: Get active Privacy Policy as HTML page (Public)
 *     tags: [Legal - Privacy Policy]
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           default: en
 *         description: Language code (en, te, hi, etc.)
 *     responses:
 *       200:
 *         description: HTML page with Privacy Policy
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       404:
 *         description: No active privacy policy found
 */
router.get('/html', getActivePrivacyHtmlController);

/**
 * @swagger
 * /legal/privacy/admin:
 *   get:
 *     summary: Get all Privacy Policy versions (Admin only)
 *     tags: [Legal - Privacy Policy]
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
 *         description: All Privacy Policy versions retrieved
 *   post:
 *     summary: Create new Privacy Policy (Admin only)
 *     tags: [Legal - Privacy Policy]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/CreatePrivacyDto'
 *               - type: object
 *                 description: Structured flat payload (auto-renders HTML content)
 *                 properties:
 *                   appName:
 *                     type: string
 *                     example: Kaburlu
 *                   policyType:
 *                     type: string
 *                     example: Privacy Policy
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
 *               - type: object
 *                 description: Nested structured payload under privacyPolicy (auto-renders HTML content)
 *                 properties:
 *                   privacyPolicy:
 *                     type: object
 *                     properties:
 *                       appName:
 *                         type: string
 *                         example: Kaburlu
 *                       introduction:
 *                         type: string
 *                       dataCollected:
 *                         type: string
 *                       howWeUseData:
 *                         type: string
 *                       contactInformation:
 *                         type: object
 *                         properties:
 *                           email:
 *                             type: string
 *                           address:
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
 *                 title: Kaburlu - Privacy Policy
 *                 content: "<p>We value your privacy...</p>"
 *                 language: en
 *                 version: '1.0'
 *                 isActive: true
 *                 effectiveAt: '2025-09-28'
 *             structuredFlat:
 *               summary: Structured flat payload
 *               value:
 *                 appName: Kaburlu
 *                 policyType: Privacy Policy
 *                 sections:
 *                   - title: Introduction
 *                     content: Welcome to Kaburlu...
 *                   - title: Data Collected
 *                     points: [Name, Email]
 *                 language: en
 *                 version: '1.0'
 *                 isActive: true
 *                 effectiveDate: '2025-09-28'
 *             structuredNested:
 *               summary: Nested privacyPolicy payload
 *               value:
 *                 privacyPolicy:
 *                   appName: Kaburlu
 *                   introduction: Welcome...
 *                   dataCollected: We collect A, B, C...
 *                   howWeUseData: We use your data to...
 *                   contactInformation:
 *                     email: support@example.com
 *                 language: en
 *                 version: '1.0'
 *                 isActive: true
 *                 effectiveDate: '2025-09-28'
 *     responses:
 *       201:
 *         description: Privacy Policy created successfully
 */
router.route('/admin')
  .get(adminAuth, getAllPrivacyController)
  .post(adminAuth, requireSuperAdmin, createPrivacyController);

/**
 * @swagger
 * /legal/privacy/admin/{id}:
 *   get:
 *     summary: Get Privacy Policy by ID (Admin only)
 *     tags: [Legal - Privacy Policy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Privacy Policy ID
 *     responses:
 *       200:
 *         description: Privacy Policy retrieved successfully
 *       404:
 *         description: Privacy Policy not found
 *   put:
 *     summary: Update Privacy Policy (SUPER_ADMIN only)
 *     tags: [Legal - Privacy Policy]
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
 *               - $ref: '#/components/schemas/UpdatePrivacyDto'
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
 *               - type: object
 *                 description: Nested structured payload under privacyPolicy (auto-renders HTML content)
 *                 properties:
 *                   privacyPolicy:
 *                     type: object
 *                     properties:
 *                       appName:
 *                         type: string
 *                       introduction:
 *                         type: string
 *                       dataCollected:
 *                         type: string
 *                       howWeUseData:
 *                         type: string
 *                       contactInformation:
 *                         type: object
 *                         properties:
 *                           email:
 *                             type: string
 *                           address:
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
 *                 title: Updated Privacy Policy
 *                 content: "<p>Updated content</p>"
 *                 isActive: true
 *             structuredFlat:
 *               summary: Structured flat update
 *               value:
 *                 appName: Kaburlu
 *                 policyType: Privacy Policy
 *                 sections:
 *                   - title: Changes
 *                     content: We updated this section
 *                 isActive: true
 *             structuredNested:
 *               summary: Nested privacyPolicy update
 *               value:
 *                 privacyPolicy:
 *                   introduction: Updated intro
 *                 isActive: true
 *     responses:
 *       200:
 *         description: Privacy Policy updated successfully
 *   delete:
 *     summary: Delete Privacy Policy (SUPER_ADMIN only)
 *     tags: [Legal - Privacy Policy]
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
 *         description: Privacy Policy deleted successfully
 */
router.route('/admin/:id')
  .get(adminAuth, getPrivacyByIdController)
  .put(adminAuth, requireSuperAdmin, updatePrivacyController)
  .delete(adminAuth, requireSuperAdmin, deletePrivacyController);

/**
 * @swagger
 * /legal/privacy/admin/{id}/activate:
 *   post:
 *     summary: Activate Privacy Policy version (SUPER_ADMIN only)
 *     tags: [Legal - Privacy Policy]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Privacy Policy ID to activate
 *     responses:
 *       200:
 *         description: Privacy Policy activated successfully
 *       404:
 *         description: Privacy Policy not found
 */
router.post('/admin/:id/activate', adminAuth, requireSuperAdmin, activatePrivacyController);

export default router;