
import { Router } from 'express';
import passport from 'passport';
import * as userController from './users.controller';
import { addPushToken, removePushToken, updateLocation, getLocation } from './users.service';

const router = Router();

function isAdmin(user: any): boolean {
	const r = (user?.role?.name || '').toUpperCase();
	return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'LANGUAGE_ADMIN' || r === 'ADMIN';
}

function requireAdmin(req: any, res: any, next: any) {
	if (isAdmin(req.user)) return next();
	return res.status(403).json({ error: 'Forbidden' });
}

function requireSelfOrAdmin(req: any, res: any, next: any) {
	if (isAdmin(req.user)) return next();
	if (req.user?.id && req.params?.userId && req.user.id === req.params.userId) return next();
	return res.status(403).json({ error: 'Forbidden' });
}

// Push Notification APIs
router.post('/:userId/push-token', passport.authenticate('jwt', { session: false }), requireSelfOrAdmin, async (req, res) => {
	const { deviceId, deviceModel, pushToken } = req.body;
	const { userId } = req.params;
	const result = await addPushToken(userId, deviceId, deviceModel, pushToken);
	res.json(result);
});

// Mounted at /users in app.ts; keep all paths relative under this router

router.get('/:userId/location', passport.authenticate('jwt', { session: false }), requireSelfOrAdmin, async (req, res) => {
	const { userId } = req.params;
	const result = await getLocation(userId);
	res.json(result);
});


/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     responses:
 *       201:
 *         description: User created
 */
router.post('/', passport.authenticate('jwt', { session: false }), requireAdmin, userController.createUser);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: List of users
 */
router.get('/', passport.authenticate('jwt', { session: false }), requireAdmin, userController.getAllUsers);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get the authenticated user's own account details
 *     tags: [Users, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Your user record
 *       401:
 *         description: Unauthorized
 */
router.get('/me', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
	try {
		const user = await userController.getUserById({ params: { id: req.user.id } } as any, {
			status: (code: number) => ({ json: (data: any) => res.status(code).json(data) }),
			json: (data: any) => res.json(data)
		} as any);
	} catch (e: any) {
		res.status(500).json({ success: false, message: e?.message });
	}
});

/**
 * @swagger
 * /users/me:
 *   put:
 *     summary: Update the authenticated user's own account (limited fields)
 *     tags: [Users, Member APIs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               languageId: { type: string }
 *               mpin: { type: string, description: '4-digit PIN; will be hashed' }
 *     responses:
 *       200:
 *         description: Updated user
 *       401:
 *         description: Unauthorized
 */
router.put('/me', passport.authenticate('jwt', { session: false }), async (req: any, res) => {
	try {
		// Allow only a safe subset from body
		const { email, languageId, mpin } = req.body || {};
		const data: any = {};
		if (email !== undefined) data.email = email;
		if (languageId) data.languageId = languageId;
		if (mpin) data.mpin = mpin;
		const out = await userController.updateUser({ params: { id: req.user.id }, body: data } as any, {
			status: (code: number) => ({ json: (d: any) => res.status(code).json(d) }),
			json: (d: any) => res.json(d)
		} as any);
	} catch (e: any) {
		res.status(500).json({ success: false, message: e?.message });
	}
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, userController.getUserById);

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update an existing user
 *     tags:
 *       - Users
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
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               mobileNumber:
 *                 type: string
 *                 example: "9392010248"
 *               email:
 *                 type: string
 *                 example: "john.doe@example.com"
 *               mpin:
 *                 type: string
 *                 example: "1234"
 *               languageId:
 *                 type: string
 *                 example: "cmfdwhqk80009ugtof37yt8vv"
 *               location:
 *                 type: object
 *                 properties:
 *                   latitude:
 *                     type: number
 *                     example: 0
 *                   longitude:
 *                     type: number
 *                     example: 0
 *               deviceId:
 *                 type: string
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: User updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User not found
 */
router.put('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, userController.updateUser);

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted
 *       404:
 *         description: User not found
 */
router.delete('/:id', passport.authenticate('jwt', { session: false }), requireAdmin, userController.deleteUser);

// ...existing code...
export default router;
