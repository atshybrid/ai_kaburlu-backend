import { Router } from 'express';
import passport from 'passport';
import { 
  sendToTokens, 
  sendToUser, 
  sendToTokensEnhanced,
  sendToUserEnhanced,
  sendToTopicEnhanced,
  getNotificationAnalytics,
  type PushNotificationPayload 
} from '../../lib/fcm';
import { isFirebaseReady } from '../../lib/firebase';
import notificationController from './notifications.controller';

const router = Router();

// Use new notification controller for enhanced endpoints
router.use('/', notificationController);

/**
 * @swagger
 * /notifications/firebase-status:
 *   get:
 *     summary: Check Firebase initialization status
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Firebase status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 initialized:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 */
router.get('/firebase-status', async (req, res) => {
  try {
    const initialized = await isFirebaseReady();
    res.json({
      status: initialized ? 'Firebase is ready' : 'Firebase not initialized',
      initialized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'Error checking Firebase status',
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /notifications/test-token:
 *   post:
 *     summary: Send a test notification to a token
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Send result
 */
router.post('/test-token', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { token, title, body, data } = req.body as { token?: string; title?: string; body?: string; data?: Record<string, string> };
    if (!token || !title || !body) return res.status(400).json({ error: 'token, title, body required' });
    const result = await sendToTokens([token], { title, body, data });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'failed to send' });
  }
});

/**
 * @swagger
 * /notifications/user:
 *   post:
 *     summary: Send a notification to a user (all devices)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Send result
 */
router.post('/user', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { userId, title, body, data } = req.body as { userId?: string; title?: string; body?: string; data?: Record<string, string> };
    if (!userId || !title || !body) return res.status(400).json({ error: 'userId, title, body required' });
    const result = await sendToUser(userId, { title, body, data });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'failed to send' });
  }
});

/**
 * @swagger
 * /notifications/enhanced/token:
 *   post:
 *     summary: Send enhanced notification to specific tokens with comprehensive logging
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of FCM tokens
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               image:
 *                 type: string
 *                 description: Optional notification image URL
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 properties:
 *                   priority:
 *                     type: string
 *                     enum: [normal, high]
 *                     default: normal
 *                   sourceController:
 *                     type: string
 *                     description: Source controller name for logging
 *                   sourceAction:
 *                     type: string
 *                     description: Source action for logging
 *             required: [tokens, title, body]
 *             example:
 *               tokens: ["fcm_token_1", "fcm_token_2"]
 *               title: "Breaking News"
 *               body: "Important update from your news app"
 *               image: "https://example.com/image.jpg"
 *               data:
 *                 type: "news"
 *                 newsId: "12345"
 *               options:
 *                 priority: "high"
 *                 sourceController: "admin-panel"
 *                 sourceAction: "manual-broadcast"
 *     responses:
 *       200:
 *         description: Notification sent with detailed results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 logId:
 *                   type: string
 *                   description: Notification log ID for tracking
 *                 successCount:
 *                   type: integer
 *                 failureCount:
 *                   type: integer
 *                 totalTargets:
 *                   type: integer
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.post('/enhanced/token', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { tokens, title, body, image, data, options = {} } = req.body;
    
    if (!tokens || !Array.isArray(tokens) || !title || !body) {
      return res.status(400).json({ 
        success: false,
        error: 'tokens (array), title, and body are required' 
      });
    }

    const payload: PushNotificationPayload = { title, body, image, data };
    const notificationOptions = {
      ...options,
      sourceController: options.sourceController || 'notifications-api',
      sourceAction: options.sourceAction || 'enhanced-token-send'
    };

    const result = await sendToTokensEnhanced(tokens, payload, notificationOptions);
    
    res.json({
      success: result.success,
      logId: result.logId,
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalTargets: result.totalTargets,
      errors: result.errors.slice(0, 10) // Limit error details in response
    });
    
  } catch (error: any) {
    console.error('[Notifications API] Enhanced token send failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send notification',
      message: error.message 
    });
  }
});

/**
 * @swagger
 * /notifications/enhanced/user:
 *   post:
 *     summary: Send enhanced notification to user with comprehensive logging
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: Target user ID
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               image:
 *                 type: string
 *                 description: Optional notification image URL
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 properties:
 *                   priority:
 *                     type: string
 *                     enum: [normal, high]
 *                     default: normal
 *                   sourceController:
 *                     type: string
 *                     description: Source controller name for logging
 *                   sourceAction:
 *                     type: string
 *                     description: Source action for logging
 *             required: [userId, title, body]
 *             example:
 *               userId: "clm7k8j9x0002user987654321"
 *               title: "Personal Update"
 *               body: "You have a new message"
 *               data:
 *                 type: "message"
 *                 messageId: "msg_123"
 *               options:
 *                 priority: "high"
 *                 sourceController: "messaging-service"
 *                 sourceAction: "new-message"
 *     responses:
 *       200:
 *         description: Notification sent with detailed results
 */
router.post('/enhanced/user', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { userId, title, body, image, data, options = {} } = req.body;
    
    if (!userId || !title || !body) {
      return res.status(400).json({ 
        success: false,
        error: 'userId, title, and body are required' 
      });
    }

    const payload: PushNotificationPayload = { title, body, image, data };
    const notificationOptions = {
      ...options,
      sourceController: options.sourceController || 'notifications-api',
      sourceAction: options.sourceAction || 'enhanced-user-send'
    };

    const result = await sendToUserEnhanced(userId, payload, notificationOptions);
    
    res.json({
      success: result.success,
      logId: result.logId,
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalTargets: result.totalTargets,
      errors: result.errors.slice(0, 10)
    });
    
  } catch (error: any) {
    console.error('[Notifications API] Enhanced user send failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send notification',
      message: error.message 
    });
  }
});

/**
 * @swagger
 * /notifications/enhanced/topic:
 *   post:
 *     summary: Send enhanced notification to topic with comprehensive logging
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               topic:
 *                 type: string
 *                 description: FCM topic name
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               image:
 *                 type: string
 *                 description: Optional notification image URL
 *               data:
 *                 type: object
 *                 description: Additional data payload
 *               options:
 *                 type: object
 *                 properties:
 *                   priority:
 *                     type: string
 *                     enum: [normal, high]
 *                     default: normal
 *                   sourceController:
 *                     type: string
 *                     description: Source controller name for logging
 *                   sourceAction:
 *                     type: string
 *                     description: Source action for logging
 *             required: [topic, title, body]
 *             example:
 *               topic: "news-lang-en"
 *               title: "Breaking News"
 *               body: "Major news update for English readers"
 *               image: "https://example.com/news-image.jpg"
 *               data:
 *                 type: "breaking-news"
 *                 categoryId: "politics"
 *               options:
 *                 priority: "high"
 *                 sourceController: "news-publishing"
 *                 sourceAction: "breaking-news-alert"
 *     responses:
 *       200:
 *         description: Topic notification sent with detailed results
 */
router.post('/enhanced/topic', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { topic, title, body, image, data, options = {} } = req.body;
    
    if (!topic || !title || !body) {
      return res.status(400).json({ 
        success: false,
        error: 'topic, title, and body are required' 
      });
    }

    const payload: PushNotificationPayload = { title, body, image, data };
    const notificationOptions = {
      ...options,
      sourceController: options.sourceController || 'notifications-api',
      sourceAction: options.sourceAction || 'enhanced-topic-send'
    };

    const result = await sendToTopicEnhanced(topic, payload, notificationOptions);
    
    res.json({
      success: result.success,
      logId: result.logId,
      successCount: result.successCount,
      failureCount: result.failureCount,
      totalTargets: result.totalTargets,
      errors: result.errors,
      fcmMessageId: result.fcmMessageId
    });
    
  } catch (error: any) {
    console.error('[Notifications API] Enhanced topic send failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send notification',
      message: error.message 
    });
  }
});

/**
 * @swagger
 * /notifications/analytics:
 *   get:
 *     summary: Get notification delivery analytics and logs
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deliveryType
 *         schema:
 *           type: string
 *           enum: [TOKEN, USER, TOPIC, BULK]
 *         description: Filter by delivery type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, SENDING, SUCCESS, PARTIAL_SUCCESS, FAILED, RETRY]
 *         description: Filter by delivery status
 *       - in: query
 *         name: sourceController
 *         schema:
 *           type: string
 *         description: Filter by source controller
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date for filtering (ISO 8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date for filtering (ISO 8601)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *         description: Maximum number of logs to return
 *     responses:
 *       200:
 *         description: Notification analytics and logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                       body:
 *                         type: string
 *                       deliveryType:
 *                         type: string
 *                       status:
 *                         type: string
 *                       successCount:
 *                         type: integer
 *                       failureCount:
 *                         type: integer
 *                       totalTargets:
 *                         type: integer
 *                       sourceController:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       completedAt:
 *                         type: string
 *                         format: date-time
 *                 stats:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                       count:
 *                         type: integer
 *                       totalSuccessCount:
 *                         type: integer
 *                       totalFailureCount:
 *                         type: integer
 *                       totalTargets:
 *                         type: integer
 */
router.get('/analytics', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { deliveryType, status, sourceController, from, to, limit } = req.query as {
      deliveryType?: string;
      status?: string;
      sourceController?: string;
      from?: string;
      to?: string;
      limit?: string;
    };

    const filters: any = {};
    if (deliveryType) filters.deliveryType = deliveryType;
    if (status) filters.status = status;
    if (sourceController) filters.sourceController = sourceController;
    if (from) filters.from = new Date(from);
    if (to) filters.to = new Date(to);
    if (limit) filters.limit = Math.min(parseInt(limit), 1000);

    const analytics = await getNotificationAnalytics(filters);
    
    // Format stats for easier consumption
    const formattedStats = analytics.stats.map((stat: any) => ({
      status: stat.status,
      count: stat._count.id,
      totalSuccessCount: stat._sum.successCount || 0,
      totalFailureCount: stat._sum.failureCount || 0,
      totalTargets: stat._sum.totalTargets || 0
    }));

    res.json({
      success: true,
      data: {
        logs: analytics.logs,
        stats: formattedStats,
        summary: {
          totalLogs: analytics.logs.length,
          dateRange: filters.from || filters.to ? {
            from: filters.from,
            to: filters.to
          } : null
        }
      }
    });
    
  } catch (error: any) {
    console.error('[Notifications API] Analytics fetch failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch analytics',
      message: error.message 
    });
  }
});

/**
 * @swagger
 * /notifications/test-enhanced:
 *   post:
 *     summary: Test enhanced notification system with validation
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Test FCM token
 *               title:
 *                 type: string
 *                 default: "Test Notification"
 *               body:
 *                 type: string
 *                 default: "This is a test notification from the enhanced system"
 *               priority:
 *                 type: string
 *                 enum: [normal, high]
 *                 default: normal
 *             required: [token]
 *             example:
 *               token: "test_fcm_token_here"
 *               title: "Test Enhanced Notification"
 *               body: "Testing the enhanced notification system with logging"
 *               priority: "high"
 *     responses:
 *       200:
 *         description: Test notification sent with detailed results and validation
 */
router.post('/test-enhanced', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const { token, title = 'Test Notification', body = 'This is a test notification from the enhanced system', priority = 'normal' } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false,
        error: 'token is required for testing' 
      });
    }

    const payload: PushNotificationPayload = { 
      title, 
      body, 
      data: { 
        test: 'true', 
        timestamp: new Date().toISOString(),
        version: 'enhanced'
      } 
    };
    
    const options = {
      priority: priority as 'normal' | 'high',
      sourceController: 'notifications-api',
      sourceAction: 'test-enhanced-notification'
    };

    console.log(`[Notifications API] Sending test notification to token: ${token.substring(0, 20)}...`);

    const result = await sendToTokensEnhanced([token], payload, options);
    
    res.json({
      success: result.success,
      message: result.success ? 'Test notification sent successfully!' : 'Test notification failed',
      logId: result.logId,
      results: {
        successCount: result.successCount,
        failureCount: result.failureCount,
        totalTargets: result.totalTargets,
        errors: result.errors
      },
      testDetails: {
        token: token.substring(0, 20) + '...',
        payload,
        options,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error: any) {
    console.error('[Notifications API] Test enhanced notification failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Test notification failed',
      message: error.message 
    });
  }
});

/**
 * @swagger
 * /api/notifications/config/test:
 *   get:
 *     summary: Test Firebase configuration and connection
 *     tags: [Enhanced Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Firebase configuration test results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 firebase:
 *                   type: object
 *                   properties:
 *                     initialized:
 *                       type: boolean
 *                     projectId:
 *                       type: string
 *                     method:
 *                       type: string
 *                     messagingAvailable:
 *                       type: boolean
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     warnings:
 *                       type: array
 *                       items:
 *                         type: string
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/config/test', passport.authenticate('jwt', { session: false }), async (req: any, res: any) => {
  try {
    const { getFirebaseInitStatus, testFirebaseConnection, isFirebaseReady } = await import('../../lib/firebase');
    
    // Get initialization status
    const initStatus = getFirebaseInitStatus();
    
    // Test connection
    const connectionTest = await testFirebaseConnection();
    
    // Check if Firebase is ready
    const isReady = isFirebaseReady();
    
    // Generate recommendations based on status
    const recommendations: string[] = [];
    
    if (!initStatus.success) {
      recommendations.push('Firebase initialization failed. Check your credentials configuration.');
    }
    
    if (initStatus.errors.length > 0) {
      recommendations.push('Fix configuration errors to enable push notifications.');
    }
    
    if (initStatus.warnings.length > 0) {
      recommendations.push('Address configuration warnings to improve reliability.');
    }
    
    if (!connectionTest.messagingAvailable) {
      recommendations.push('Firebase Messaging service is not available. Check your service account permissions.');
    }
    
    if (connectionTest.projectId !== 'khabarx-f0365') {
      recommendations.push('Project ID mismatch detected. Verify your Firebase project configuration.');
    }
    
    if (isReady) {
      recommendations.push('✅ Firebase is properly configured and ready for push notifications.');
    }
    
    // Environment info (without sensitive data)
    const envInfo = {
      hasCredentialsPath: !!process.env.FIREBASE_CREDENTIALS_PATH,
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      hasGoogleAppCreds: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      nodeEnv: process.env.NODE_ENV || 'unknown'
    };
    
    res.json({
      success: true,
      firebase: {
        initialized: isReady,
        projectId: connectionTest.projectId,
        method: initStatus.method,
        messagingAvailable: connectionTest.messagingAvailable,
        errors: [...initStatus.errors, ...connectionTest.errors],
        warnings: initStatus.warnings || []
      },
      environment: envInfo,
      recommendations,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Firebase config test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test Firebase configuration',
      error: error.message,
      recommendations: [
        'Check server logs for detailed error information',
        'Verify Firebase service account credentials',
        'Ensure required environment variables are set'
      ]
    });
  }
});

/**
 * @swagger
 * /api/notifications/queue/batch:
 *   post:
 *     summary: Send bulk notifications using queue system
 *     tags: [Enhanced Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokens
 *               - notification
 *             properties:
 *               tokens:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of FCM tokens
 *               notification:
 *                 type: object
 *                 required:
 *                   - title
 *                   - body
 *                 properties:
 *                   title:
 *                     type: string
 *                   body:
 *                     type: string
 *                   image:
 *                     type: string
 *                   data:
 *                     type: object
 *               batchOptions:
 *                 type: object
 *                 properties:
 *                   batchSize:
 *                     type: number
 *                     default: 100
 *                   batchDelay:
 *                     type: number
 *                     default: 1000
 *                   priority:
 *                     type: string
 *                     enum: [low, normal, high]
 *                     default: normal
 *                   maxRetries:
 *                     type: number
 *                     default: 3
 *     responses:
 *       200:
 *         description: Batch jobs created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batchId:
 *                   type: string
 *                 jobIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 totalJobs:
 *                   type: number
 *                 totalTargets:
 *                   type: number
 */
router.post('/queue/batch', passport.authenticate('jwt', { session: false }), async (req: any, res: any) => {
  try {
    const { tokens, notification, batchOptions = {} } = req.body;
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tokens array is required and must not be empty'
      });
    }
    
    if (!notification || !notification.title || !notification.body) {
      return res.status(400).json({
        success: false,
        message: 'Notification with title and body is required'
      });
    }
    
    const { notificationQueue } = await import('../../lib/notification-queue');
    
    const jobIds = await notificationQueue.addBatchJobs(
      'tokens',
      tokens,
      notification,
      batchOptions
    );
    
    // Get the batch ID from the first job
    const firstJob = notificationQueue.getJobStatus(jobIds[0]);
    const batchId = firstJob?.batchId || 'unknown';
    
    res.json({
      success: true,
      batchId,
      jobIds,
      totalJobs: jobIds.length,
      totalTargets: tokens.length,
      message: `Created ${jobIds.length} batch jobs for ${tokens.length} tokens`
    });
    
  } catch (error: any) {
    console.error('[Queue API] Batch creation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create batch jobs',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/notifications/queue/status/{jobId}:
 *   get:
 *     summary: Get job status
 *     tags: [Enhanced Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID to check status
 *     responses:
 *       200:
 *         description: Job status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 job:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending, processing, completed, failed, cancelled]
 *                     type:
 *                       type: string
 *                       enum: [tokens, user, topic]
 *                     priority:
 *                       type: string
 *                       enum: [low, normal, high]
 *                     retryCount:
 *                       type: number
 *                     maxRetries:
 *                       type: number
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: Job not found
 */
router.get('/queue/status/:jobId', passport.authenticate('jwt', { session: false }), async (req: any, res: any) => {
  try {
    const { jobId } = req.params;
    const { notificationQueue } = await import('../../lib/notification-queue');
    
    const job = notificationQueue.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }
    
    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        type: job.type,
        priority: job.priority,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        createdAt: job.createdAt,
        scheduledAt: job.scheduledAt,
        batchId: job.batchId,
        targetCount: Array.isArray(job.targets) ? job.targets.length : 1
      }
    });
    
  } catch (error: any) {
    console.error('[Queue API] Job status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/notifications/queue/batch/{batchId}:
 *   get:
 *     summary: Get batch status
 *     tags: [Enhanced Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: string
 *         description: Batch ID to check status
 *     responses:
 *       200:
 *         description: Batch status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 batch:
 *                   type: object
 *                   properties:
 *                     batchId:
 *                       type: string
 *                     totalJobs:
 *                       type: number
 *                     completedJobs:
 *                       type: number
 *                     failedJobs:
 *                       type: number
 *                     pendingJobs:
 *                       type: number
 *                     processingJobs:
 *                       type: number
 *                     progress:
 *                       type: number
 *                       description: Completion percentage
 */
router.get('/queue/batch/:batchId', passport.authenticate('jwt', { session: false }), async (req: any, res: any) => {
  try {
    const { batchId } = req.params;
    const { notificationQueue } = await import('../../lib/notification-queue');
    
    const batchStatus = notificationQueue.getBatchStatus(batchId);
    
    if (batchStatus.totalJobs === 0) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }
    
    const progress = batchStatus.totalJobs > 0 
      ? Math.round(((batchStatus.completedJobs + batchStatus.failedJobs) / batchStatus.totalJobs) * 100)
      : 0;
    
    res.json({
      success: true,
      batch: {
        ...batchStatus,
        progress
      }
    });
    
  } catch (error: any) {
    console.error('[Queue API] Batch status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get batch status',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/notifications/queue/metrics:
 *   get:
 *     summary: Get queue metrics and performance statistics
 *     tags: [Enhanced Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 metrics:
 *                   type: object
 *                   properties:
 *                     totalJobs:
 *                       type: number
 *                     pendingJobs:
 *                       type: number
 *                     processingJobs:
 *                       type: number
 *                     completedJobs:
 *                       type: number
 *                     failedJobs:
 *                       type: number
 *                     averageProcessingTime:
 *                       type: number
 *                     throughputPerMinute:
 *                       type: number
 */
router.get('/queue/metrics', passport.authenticate('jwt', { session: false }), async (req: any, res: any) => {
  try {
    const { notificationQueue } = await import('../../lib/notification-queue');
    
    const metrics = notificationQueue.getMetrics();
    
    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('[Queue API] Metrics retrieval failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get queue metrics',
      error: error.message
    });
  }
});

export default router;
