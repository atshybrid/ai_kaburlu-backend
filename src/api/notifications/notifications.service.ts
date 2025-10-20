import prisma from '../../lib/prisma';
import { sendToTokensEnhanced } from '../../lib/fcm-enhanced';

export interface NotificationPayload {
  title: string;
  body: string;
  image?: string;
  data?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high';
}

export interface NotificationOptions {
  sourceController?: string;
  sourceAction?: string;
  batchId?: string;
}

/**
 * Send broadcast notification to all users with FCM tokens
 */
export async function sendBroadcastNotification(
  payload: NotificationPayload,
  options: NotificationOptions = {}
) {
  console.log('[Notifications] Starting broadcast notification', {
    title: payload.title,
    targetType: 'all-users'
  });

  // Get all devices with push tokens
  const devices = await prisma.device.findMany({
    where: {
      pushToken: { not: null }
    },
    select: {
      pushToken: true,
      userId: true
    }
  });

  const tokens = devices
    .map(d => d.pushToken!)
    .filter(Boolean);

  if (tokens.length === 0) {
    console.warn('[Notifications] No FCM tokens found for broadcast');
    return {
      success: false,
      message: 'No FCM tokens available for broadcast',
      totalTargets: 0,
      successCount: 0,
      failureCount: 0
    };
  }

  console.log(`[Notifications] Broadcasting to ${tokens.length} devices`);

  const result = await sendToTokensEnhanced(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    data: {
      type: 'broadcast',
      ...payload.data
    }
  }, {
    priority: payload.priority,
    sourceController: options.sourceController || 'notifications-service',
    sourceAction: options.sourceAction || 'broadcast',
    batchId: options.batchId
  });

  console.log('[Notifications] Broadcast notification completed', {
    success: result.success,
    successCount: result.successCount,
    failureCount: result.failureCount,
    totalTargets: result.totalTargets
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

/**
 * Send notification to specific user
 */
export async function sendNotificationToUser(
  userId: string,
  payload: NotificationPayload,
  options: NotificationOptions = {}
) {
  console.log('[Notifications] Sending notification to user', {
    userId,
    title: payload.title
  });

  // Get user's devices with push tokens
  const devices = await prisma.device.findMany({
    where: {
      userId,
      pushToken: { not: null }
    },
    select: {
      pushToken: true
    }
  });

  const tokens = devices
    .map(d => d.pushToken!)
    .filter(Boolean);

  if (tokens.length === 0) {
    console.warn(`[Notifications] No FCM tokens found for user: ${userId}`);
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
    data: {
      type: 'user_targeted',
      userId,
      ...payload.data
    }
  }, {
    priority: payload.priority,
    sourceController: options.sourceController || 'notifications-service',
    sourceAction: options.sourceAction || 'user-targeted',
    batchId: options.batchId
  });

  // Update log to reflect user targeting
  if (result.logId) {
    try {
      await prisma.pushNotificationLog.update({
        where: { id: result.logId },
        data: {
          deliveryType: 'USER',
          targetUserId: userId
        }
      });
    } catch (e) {
      console.warn('[NotificationsService] pushNotificationLog.update failed (non-fatal):', String((e as any)?.message || e));
    }
  }

  return {
    success: result.success,
    message: `Notification sent to user ${userId}`,
    totalTargets: result.totalTargets,
    successCount: result.successCount,
    failureCount: result.failureCount,
    logId: result.logId,
    errors: result.errors
  };
}

/**
 * Send notification to users by language
 */
export async function sendNotificationToLanguage(
  languageCode: string,
  payload: NotificationPayload,
  options: NotificationOptions = {}
) {
  console.log('[Notifications] Sending notification by language', {
    languageCode,
    title: payload.title
  });

  // First find the language
  const language = await prisma.language.findUnique({
    where: { code: languageCode }
  });

  if (!language) {
    throw new Error(`Language with code '${languageCode}' not found`);
  }

  // Get devices for users with this language
  const devices = await prisma.device.findMany({
    where: {
      pushToken: { not: null },
      OR: [
        // User's language
        {
          user: {
            languageId: language.id
          }
        },
        // Guest device language
        {
          userId: null,
          languageId: language.id
        }
      ]
    },
    select: {
      pushToken: true,
      userId: true
    }
  });

  const tokens = devices
    .map(d => d.pushToken!)
    .filter(Boolean);

  if (tokens.length === 0) {
    console.warn(`[Notifications] No FCM tokens found for language: ${languageCode}`);
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
    data: {
      type: 'language_targeted',
      languageCode,
      ...payload.data
    }
  }, {
    priority: payload.priority,
    sourceController: options.sourceController || 'notifications-service',
    sourceAction: options.sourceAction || 'language-targeted',
    batchId: options.batchId
  });

  return {
    success: result.success,
    message: `Notification sent to ${languageCode} language users`,
    totalTargets: result.totalTargets,
    successCount: result.successCount,
    failureCount: result.failureCount,
    logId: result.logId,
    errors: result.errors
  };
}

/**
 * Get notification history with filtering
 */
export async function getNotificationHistory(filters: {
  limit?: number;
  status?: string;
  deliveryType?: string;
  sourceController?: string;
  from?: Date;
  to?: Date;
}) {
  const where: any = {};
  
  if (filters.status) where.status = filters.status;
  if (filters.deliveryType) where.deliveryType = filters.deliveryType;
  if (filters.sourceController) where.sourceController = filters.sourceController;
  
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [logs, summary] = await Promise.all([
    // Get recent logs
    prisma.pushNotificationLog.findMany({
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
    }),
    
    // Get summary stats
    prisma.pushNotificationLog.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _sum: {
        totalTargets: true,
        successCount: true,
        failureCount: true
      }
    })
  ]);

  return {
    logs,
    summary: {
      totalNotifications: summary.reduce((acc, s) => acc + s._count.id, 0),
      totalTargets: summary.reduce((acc, s) => acc + (s._sum.totalTargets || 0), 0),
      totalSuccesses: summary.reduce((acc, s) => acc + (s._sum.successCount || 0), 0),
      totalFailures: summary.reduce((acc, s) => acc + (s._sum.failureCount || 0), 0),
      byStatus: summary.reduce((acc, s) => {
        acc[s.status] = s._count.id;
        return acc;
      }, {} as Record<string, number>)
    }
  };
}

/**
 * Get current FCM token statistics
 */
export async function getTokenStats() {
  const [
    totalDevices,
    devicesWithTokens,
    userDevicesWithTokens,
    guestDevicesWithTokens,
    languageBreakdown
  ] = await Promise.all([
    prisma.device.count(),
    
    prisma.device.count({
      where: { pushToken: { not: null } }
    }),
    
    prisma.device.count({
      where: { 
        pushToken: { not: null },
        userId: { not: null }
      }
    }),
    
    prisma.device.count({
      where: { 
        pushToken: { not: null },
        userId: null
      }
    }),
    
    prisma.device.groupBy({
      by: ['languageId'],
      where: { pushToken: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    })
  ]);

  return {
    totalDevices,
    devicesWithTokens,
    userDevicesWithTokens,
    guestDevicesWithTokens,
    tokenCoverage: totalDevices > 0 ? (devicesWithTokens / totalDevices * 100).toFixed(1) + '%' : '0%',
    languageBreakdown: languageBreakdown.map(l => ({
      languageId: l.languageId,
      deviceCount: l._count.id
    }))
  };
}