import express from 'express';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma';
import { sendToTokensEnhanced } from '../../lib/fcm-enhanced';

// Simple auth middleware for notifications
const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    (req as any).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
};

// Inline service functions to avoid import issues
async function sendBroadcastNotification(
  payload: { title: string; body: string; image?: string; data?: any; priority?: string }
) {
  console.log('[Notifications] Starting broadcast notification', {
    title: payload.title,
    targetType: 'all-users'
  });

  const devices = await prisma.device.findMany({
    where: { pushToken: { not: null } },
    select: { pushToken: true, userId: true }
  });

  const tokens = devices.map(d => d.pushToken!).filter(Boolean);

  if (tokens.length === 0) {
    return {
      success: false,
      message: 'No FCM tokens available for broadcast',
      totalTargets: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  const result = await sendToTokensEnhanced(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    data: { type: 'broadcast', ...payload.data }
  }, {
    priority: payload.priority as any,
    sourceController: 'notifications-service',
    sourceAction: 'broadcast'
  });

  return {
    success: result.success,
    message: `Broadcast sent to ${result.totalTargets} devices`,
    totalTargets: result.totalTargets,
    successCount: result.successCount,
    failureCount: result.failureCount,
    logId: result.logId,
    errors: result.errors
  };
}

async function sendNotificationToUser(
  userId: string,
  payload: { title: string; body: string; image?: string; data?: any; priority?: string }
) {
  const devices = await prisma.device.findMany({
    where: { userId, pushToken: { not: null } },
    select: { pushToken: true }
  });

  const tokens = devices.map(d => d.pushToken!).filter(Boolean);

  if (tokens.length === 0) {
    return {
      success: false,
      message: 'No FCM tokens found for user',
      totalTargets: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  const result = await sendToTokensEnhanced(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    data: { type: 'user_targeted', userId, ...payload.data }
  }, {
    priority: payload.priority as any,
    sourceController: 'notifications-service',
    sourceAction: 'user-targeted'
  });

  if (result.logId) {
    try {
      await prisma.pushNotificationLog.update({
        where: { id: result.logId },
        data: { deliveryType: 'USER', targetUserId: userId }
      });
    } catch (e) {
      console.warn('[NotificationsController] pushNotificationLog.update failed (non-fatal):', String((e as any)?.message || e));
    }
  }

  return result;
}

async function sendNotificationToLanguage(
  languageCode: string,
  payload: { title: string; body: string; image?: string; data?: any; priority?: string }
) {
  const language = await prisma.language.findUnique({
    where: { code: languageCode }
  });

  if (!language) {
    throw new Error(`Language with code '${languageCode}' not found`);
  }

  const devices = await prisma.device.findMany({
    where: {
      pushToken: { not: null },
      OR: [
        { user: { languageId: language.id } },
        { userId: null, languageId: language.id }
      ]
    },
    select: { pushToken: true, userId: true }
  });

  const tokens = devices.map(d => d.pushToken!).filter(Boolean);

  if (tokens.length === 0) {
    return {
      success: false,
      message: `No FCM tokens found for language: ${languageCode}`,
      totalTargets: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  const result = await sendToTokensEnhanced(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    data: { type: 'language_targeted', languageCode, ...payload.data }
  }, {
    priority: payload.priority as any,
    sourceController: 'notifications-service',
    sourceAction: 'language-targeted'
  });

  return result;
}

async function getNotificationHistory(filters: {
  limit?: number;
  status?: string;
  deliveryType?: string;
}) {
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.deliveryType) where.deliveryType = filters.deliveryType;

  const logs = await prisma.pushNotificationLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters.limit || 50,
    select: {
      id: true,
      title: true,
      body: true,
      deliveryType: true,
      status: true,
      totalTargets: true,
      successCount: true,
      failureCount: true,
      sourceController: true,
      sourceAction: true,
      createdAt: true,
      sentAt: true,
      completedAt: true,
      targetUserId: true,
      targetTopic: true
    }
  });

  return { logs };
}

async function getTokenStats() {
  const [totalDevices, devicesWithTokens] = await Promise.all([
    prisma.device.count(),
    prisma.device.count({ where: { pushToken: { not: null } } })
  ]);

  return {
    totalDevices,
    devicesWithTokens,
    tokenCoverage: totalDevices > 0 ? ((devicesWithTokens / totalDevices) * 100).toFixed(1) + '%' : '0%'
  };
}

const router = express.Router();

/**
 * @swagger
 * /api/v1/notifications/broadcast:
 *   post:
 *     summary: Send push notification to all users
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Breaking News"
 *               body:
 *                 type: string  
 *                 example: "Important announcement for all users"
 *               image:
 *                 type: string
 *                 example: "https://example.com/image.jpg"
 *               data:
 *                 type: object
 *                 example: { "type": "announcement", "url": "https://example.com" }
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *                 example: "high"
 *     responses:
 *       200:
 *         description: Notification sent successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/broadcast', authMiddleware, async (req, res) => {
  try {
    const { title, body, image, data, priority } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }

    const result = await sendBroadcastNotification({
      title,
      body,
      image,
      data: data || {},
      priority: priority || 'normal'
    });

    res.json({
      success: true,
      message: 'Broadcast notification sent',
      data: result
    });
  } catch (error: any) {
    console.error('Broadcast notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send broadcast notification'
    });
  }
});

/**
 * @swagger
 * /api/v1/notifications/user/{userId}:
 *   post:
 *     summary: Send push notification to specific user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               image:
 *                 type: string
 *               data:
 *                 type: object
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *     responses:
 *       200:
 *         description: Notification sent successfully
 */
router.post('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, body, image, data, priority } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }

    const result = await sendNotificationToUser(userId, {
      title,
      body,
      image,
      data: data || {},
      priority: priority || 'normal'
    });

    res.json({
      success: true,
      message: 'User notification sent',
      data: result
    });
  } catch (error: any) {
    console.error('User notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send user notification'
    });
  }
});

/**
 * @swagger
 * /api/v1/notifications/language/{languageCode}:
 *   post:
 *     summary: Send push notification to users by language
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: languageCode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               image:
 *                 type: string
 *               data:
 *                 type: object
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high]
 *     responses:
 *       200:
 *         description: Notification sent successfully
 */
router.post('/language/:languageCode', authMiddleware, async (req, res) => {
  try {
    const { languageCode } = req.params;
    const { title, body, image, data, priority } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }

    const result = await sendNotificationToLanguage(languageCode, {
      title,
      body,
      image,
      data: data || {},
      priority: priority || 'normal'
    });

    res.json({
      success: true,
      message: 'Language-targeted notification sent',
      data: result
    });
  } catch (error: any) {
    console.error('Language notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send language notification'
    });
  }
});

/**
 * @swagger
 * /api/v1/notifications/history:
 *   get:
 *     summary: Get notification history
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, SENDING, SUCCESS, PARTIAL_SUCCESS, FAILED]
 *       - in: query
 *         name: deliveryType
 *         schema:
 *           type: string
 *           enum: [TOKEN, USER, TOPIC, BULK]
 *     responses:
 *       200:
 *         description: Notification history retrieved
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { limit, status, deliveryType } = req.query;
    
    const result = await getNotificationHistory({
      limit: limit ? parseInt(limit as string) : 50,
      status: status as string,
      deliveryType: deliveryType as string
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Notification history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get notification history'
    });
  }
});

/**
 * @swagger
 * /api/v1/notifications/test:
 *   post:
 *     summary: Test notification system
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 example: "FCM_TOKEN_HERE"
 *               title:
 *                 type: string
 *                 example: "Test Notification"
 *               body:
 *                 type: string
 *                 example: "This is a test notification"
 *     responses:
 *       200:
 *         description: Test notification sent
 */
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const { token, title = 'Test Notification', body = 'This is a test notification' } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required for testing'
      });
    }

    const { sendToTokensEnhanced } = await import('../../lib/fcm-enhanced');
    
    const result = await sendToTokensEnhanced([token], {
      title,
      body,
      data: { type: 'test' }
    }, {
      sourceController: 'notifications-controller',
      sourceAction: 'test-notification'
    });

    res.json({
      success: true,
      message: 'Test notification sent',
      data: result
    });
  } catch (error: any) {
    console.error('Test notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send test notification'
    });
  }
});

/**
 * @swagger
 * /api/v1/notifications/stats:
 *   get:
 *     summary: Get FCM token statistics
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token statistics retrieved
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    // Use inline getTokenStats function
    const stats = await getTokenStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    console.error('Token stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get token statistics'
    });
  }
});

export default router;