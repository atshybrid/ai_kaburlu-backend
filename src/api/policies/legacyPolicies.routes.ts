import { Router } from 'express';
import passport from 'passport';
import { getPublicPrivacy, getPublicTerms, listPrivacy, listTerms, createPrivacy, createTerms } from './legacyPolicies.controller';

const router = Router();

// Public
router.get('/public/privacy', getPublicPrivacy);
router.get('/public/terms', getPublicTerms);

// Admin
router.get('/privacy', passport.authenticate('jwt', { session: false }), listPrivacy);
router.get('/terms', passport.authenticate('jwt', { session: false }), listTerms);
router.post('/privacy', passport.authenticate('jwt', { session: false }), createPrivacy);
router.post('/terms', passport.authenticate('jwt', { session: false }), createTerms);

export default router;
