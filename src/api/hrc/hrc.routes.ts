import { Router } from 'express';
import passport from 'passport';

// Placeholder controllers (to implement progressively)
import { ensureSuperAdminOrManager } from './hrc.security';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: HRCI
 *   description: Human Rights & Citizen Initiative module (volunteers, teams, ID cards, cases, donations)
 */

// HEALTH / VERSION
router.get('/health', (_req, res) => {
  res.json({ success: true, module: 'HRCI', status: 'scaffold', version: 1 });
});

// --- TEAMS (phase 1 minimal placeholders) ---
router.post('/teams', passport.authenticate('jwt', { session: false }), ensureSuperAdminOrManager, (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.get('/teams', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- VOLUNTEERS ---
router.post('/volunteers/onboard', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- ID CARDS ---
router.post('/idcards/issue', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- CASES ---
router.post('/cases', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- DONATIONS ---
router.post('/donations', (_req, res) => {
  // public / anonymous allowed for initiating donation intent
  res.status(501).json({ error: 'Not implemented yet' });
});

// --- PAYMENTS (Razorpay) ---
router.post('/payments/order', passport.authenticate('jwt', { session: false }), (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

router.post('/payments/webhook', (_req, res) => {
  // signature verification will be added; keep body raw (configure in app when implementing)
  res.status(501).json({ error: 'Not implemented yet' });
});

export default router;
