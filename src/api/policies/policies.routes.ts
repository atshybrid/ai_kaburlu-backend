import { Router } from 'express';
import passport from 'passport';
import { getPublicPolicy, listPolicies, upsertPolicy } from './policies.controller';

const router = Router();

// Public: latest published policy by type
router.get('/public/:type', getPublicPolicy);

// Admin: list and create versions (JWT protected, require admin or desk roles if middleware available)
router.get('/', passport.authenticate('jwt', { session: false }), listPolicies);
router.post('/', passport.authenticate('jwt', { session: false }), upsertPolicy);

export default router;
