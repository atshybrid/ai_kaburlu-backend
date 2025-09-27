import { Router } from 'express';
import termsRoutes from './terms.routes';
import privacyRoutes from './privacy.routes';

const router = Router();

// Mount legal document routes
router.use('/terms', termsRoutes);
router.use('/privacy', privacyRoutes);

export default router;