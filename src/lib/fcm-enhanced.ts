import { getMessaging, isFirebaseReady, validateFCMToken } from './firebase';
import { isExpoPushToken, sendExpoNotifications } from './expo';
import prisma from './prisma';

// Types for better TypeScript support
export interface PushNotificationPayload {
  title: string;
  body: string;
  image?: string;
  data?: Record<string, string>;
}

export interface NotificationOptions {
  priority?: 'low' | 'normal' | 'high';
  maxRetries?: number;
  batchId?: string;
  sourceController?: string;
  sourceAction?: string;
  scheduledAt?: Date;
}

export interface DeliveryResult {
  success: boolean;
  logId: string;
  successCount: number;
  failureCount: number;
  totalTargets: number;
  errors: any[];
  fcmResponse?: any;
  fcmMessageId?: string;
}

// Environment detection
const getEnvironment = (): string => {
  return process.env.NODE_ENV || 'development';
};

// Create notification log entry
async function createNotificationLog(
  deliveryType: string,
  payload: PushNotificationPayload,
  options: NotificationOptions = {},
  targetTokens?: string[],
  targetUserId?: string,
  targetTopic?: string
) {
  const logEntry = await prisma.pushNotificationLog.create({
    data: {
      title: payload.title,
      body: payload.body,
      imageUrl: payload.image,
      data: payload.data || {},
      deliveryType,
      targetTokens: targetTokens || [],
      targetUserId,
      targetTopic,
      batchId: options.batchId,
      totalTargets: targetTokens?.length || 1,
      priority: options.priority?.toUpperCase() || 'NORMAL',
      environment: getEnvironment(),
      sourceController: options.sourceController,
      sourceAction: options.sourceAction,
      maxRetries: options.maxRetries || 3,
      scheduledAt: options.scheduledAt,
      status: 'PENDING'
    }
  });

  console.log(`[FCM Enhanced] Created notification log: ${logEntry.id}`, {
    deliveryType,
    title: payload.title,
    targetCount: targetTokens?.length || 1,
    batchId: options.batchId,
    environment: getEnvironment()
  });

  return logEntry;
}

// Update notification log with results
async function updateNotificationLog(
  logId: string,
  status: string,
  result: {
    successCount?: number;
    failureCount?: number;
    errors?: any[];
    fcmResponse?: any;
    fcmMessageId?: string;
  }
) {
  const updateData: any = {
    status,
    updatedAt: new Date()
  };

  if (result.successCount !== undefined) updateData.successCount = result.successCount;
  if (result.failureCount !== undefined) updateData.failureCount = result.failureCount;
  if (result.errors) updateData.errors = result.errors;
  if (result.fcmResponse) updateData.fcmResponse = result.fcmResponse;
  if (result.fcmMessageId) updateData.fcmMessageId = result.fcmMessageId;
  
  if (status === 'SENDING') {
    updateData.sentAt = new Date();
  } else if (['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'].includes(status)) {
    updateData.completedAt = new Date();
  }

  let updatedLog;
  try {
    updatedLog = await prisma.pushNotificationLog.update({
      where: { id: logId },
      data: updateData
    });
  } catch (e) {
    console.warn('[FCM Enhanced] updateNotificationLog failed (non-fatal):', { logId, status, err: String((e as any)?.message || e) });
    return;
  }

  console.log(`[FCM Enhanced] Updated notification log: ${logId}`, {
    status,
    successCount: result.successCount,
    failureCount: result.failureCount,
    errorCount: result.errors?.length || 0
  });

  return updatedLog;
}

// Split incoming tokens into Expo vs FCM candidates, and validate FCM tokens
function splitTokens(tokens: string[]): { expoTokens: string[]; fcmCandidates: string[] } {
  const unique = [...new Set(tokens.filter(Boolean))];
  const expoTokens: string[] = [];
  const fcmCandidates: string[] = [];
  for (const t of unique) {
    if (isExpoPushToken(t)) expoTokens.push(t);
    else fcmCandidates.push(t);
  }
  return { expoTokens, fcmCandidates };
}

// Validate and clean FCM tokens (does not consider Expo tokens)
async function validateFcmTokens(tokens: string[]): Promise<string[]> {
  if (!tokens || tokens.length === 0) return [];
  
  // Remove duplicates first
  const uniqueTokens = [...new Set(tokens)];
  
  // Use the enhanced FCM token validation from firebase.ts
  const validTokens = uniqueTokens.filter(token => {
    if (!token) return false;
    
    const validation = validateFCMToken(token);
    if (!validation.valid) {
      console.warn(`[FCM Enhanced] Invalid token filtered: ${validation.reason}`);
      return false;
    }
    
    return true;
  });

  if (validTokens.length !== uniqueTokens.length) {
    console.warn(`[FCM Enhanced] Filtered out ${uniqueTokens.length - validTokens.length} invalid tokens`);
  }

  return validTokens;
}

// Enhanced send to multiple tokens with comprehensive logging
export async function sendToTokensEnhanced(
  tokens: string[], 
  payload: PushNotificationPayload,
  options: NotificationOptions = {}
): Promise<DeliveryResult> {
  
  // We support both Expo and FCM tokens. Firebase readiness is only required for FCM branch.

  // Validate inputs
  if (!payload.title || !payload.body) {
    throw new Error('Title and body are required for push notifications');
  }

  // Split tokens into Expo vs FCM, then validate FCM
  const { expoTokens, fcmCandidates } = splitTokens(tokens || []);
  const validFcmTokens = await validateFcmTokens(fcmCandidates);
  const combinedTokens = [...expoTokens, ...validFcmTokens];
  if (combinedTokens.length === 0) {
    console.warn('[FCM Enhanced] No valid tokens provided (after Expo/FCM split)');
    return {
      success: false,
      logId: '',
      successCount: 0,
      failureCount: 0,
      totalTargets: 0,
      errors: [{ error: 'No valid tokens provided' }]
    };
  }

  // Create log entry
  const notificationLog = await createNotificationLog(
    'TOKEN',
    payload,
    options,
    combinedTokens
  );

  try {
    // Update status to sending
    await updateNotificationLog(notificationLog.id, 'SENDING', {});
    // Aggregate results from Expo and FCM branches
    let aggSuccess = 0;
    let aggFailure = 0;
    const aggErrors: any[] = [];
    let lastFcmResponse: any | undefined;

    // 1) Expo branch
    if (expoTokens.length > 0) {
      console.log(`[Notifications] Sending via Expo to ${expoTokens.length} tokens`, { logId: notificationLog.id });
      try {
        const expoResult = await sendExpoNotifications(expoTokens, payload, { priority: options.priority });
        aggSuccess += expoResult.successCount;
        aggFailure += expoResult.failureCount;
        if (expoResult.errors.length) aggErrors.push(...expoResult.errors);
        if (expoResult.invalidTokens.length) {
          try {
            const cleanup = await prisma.device.updateMany({ where: { pushToken: { in: expoResult.invalidTokens } }, data: { pushToken: null } });
            console.log(`[Notifications] Cleaned up ${cleanup.count} invalid Expo tokens`);
          } catch (e) {
            console.warn('[Notifications] Failed to cleanup Expo tokens (non-fatal):', String((e as any)?.message || e));
          }
        }
      } catch (e: any) {
        aggFailure += expoTokens.length;
        aggErrors.push({ provider: 'expo', error: e?.message || String(e) });
      }
    }

    // 2) FCM branch
    if (validFcmTokens.length > 0) {
      if (!isFirebaseReady()) {
        console.error('[FCM Enhanced] Firebase is not ready for FCM send');
        aggFailure += validFcmTokens.length;
        aggErrors.push({ provider: 'fcm', error: 'Firebase is not properly initialized' });
      } else {
        const messaging = getMessaging();

        const fcmMessage: any = {
          tokens: validFcmTokens,
          notification: { title: payload.title, body: payload.body },
          data: payload.data || {},
          android: {
            priority: options.priority === 'high' ? 'high' : 'normal',
            notification: {
              ...(payload.image && { imageUrl: payload.image }),
              channelId: 'default',
              sound: 'default'
            }
          },
          apns: {
            headers: { 'apns-priority': options.priority === 'high' ? '10' : '5' },
            payload: { aps: { sound: 'default', badge: 1 } }
          }
        };
        if (payload.image) fcmMessage.notification.image = payload.image;

        console.log(`[FCM Enhanced] Sending via FCM to ${validFcmTokens.length} tokens`, { logId: notificationLog.id });
        const response = await messaging.sendEachForMulticast(fcmMessage);
        lastFcmResponse = response;

        const errors: any[] = [];
        const invalidTokens: string[] = [];
        await Promise.all(
          response.responses.map(async (r: { success: boolean; error?: any }, idx: number) => {
            if (!r.success && r.error) {
              const error = r.error;
              const token = validFcmTokens[idx];
              errors.push({
                provider: 'fcm',
                token: token.substring(0, 20) + '...',
                error: error.message || error.code || 'Unknown error',
                code: error.errorInfo?.code || error.code
              });
              const errorCode = error.errorInfo?.code || error.code || '';
              if (
                errorCode.includes('registration-token-not-registered') ||
                errorCode.includes('invalid-argument') ||
                errorCode.includes('invalid-registration-token')
              ) {
                invalidTokens.push(token);
              }
            }
          })
        );

        if (invalidTokens.length) {
          try {
            const cleanupResult = await prisma.device.updateMany({ where: { pushToken: { in: invalidTokens } }, data: { pushToken: null } });
            console.log(`[FCM Enhanced] Cleaned up ${cleanupResult.count} invalid FCM tokens from database`);
          } catch (cleanupError) {
            console.error(`[FCM Enhanced] Failed to cleanup invalid tokens:`, cleanupError);
          }
        }

        aggSuccess += response.successCount;
        aggFailure += response.failureCount;
        if (errors.length) aggErrors.push(...errors);
      }
    }

    // Determine final status across both providers
    let finalStatus = 'SUCCESS';
    if (aggFailure > 0) finalStatus = aggSuccess > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';

    await updateNotificationLog(notificationLog.id, finalStatus, {
      successCount: aggSuccess,
      failureCount: aggFailure,
      errors: aggErrors,
      ...(lastFcmResponse && { fcmResponse: lastFcmResponse })
    });

    return {
      success: aggSuccess > 0,
      logId: notificationLog.id,
      successCount: aggSuccess,
      failureCount: aggFailure,
      totalTargets: combinedTokens.length,
      errors: aggErrors,
      ...(lastFcmResponse && { fcmResponse: lastFcmResponse })
    };

  } catch (error: any) {
    console.error(`[FCM Enhanced] Send failed:`, error);
    
    // Update log with error
    await updateNotificationLog(notificationLog.id, 'FAILED', {
      successCount: 0,
      failureCount: combinedTokens.length,
      errors: [{ error: error.message }]
    });

    return {
      success: false,
      logId: notificationLog.id,
      successCount: 0,
      failureCount: combinedTokens.length,
      totalTargets: combinedTokens.length,
      errors: [{ error: error.message }]
    };
  }
}

// Enhanced send to user with comprehensive logging
export async function sendToUserEnhanced(
  userId: string, 
  payload: PushNotificationPayload,
  options: NotificationOptions = {}
): Promise<DeliveryResult> {
  
  console.log(`[FCM Enhanced] Sending to user: ${userId}`, {
    title: payload.title,
    sourceController: options.sourceController,
    sourceAction: options.sourceAction
  });

  // Get user's device tokens
  const devices = await prisma.device.findMany({ 
    where: { 
      userId, 
      pushToken: { not: null } 
    }, 
    select: { pushToken: true } 
  });

  const tokens = devices
    .map(d => d.pushToken!)
    .filter(Boolean);

  if (tokens.length === 0) {
    console.warn(`[FCM Enhanced] No push tokens found for user: ${userId}`);
    
    // Still create a log entry for tracking
    const notificationLog = await createNotificationLog(
      'USER',
      payload,
      options,
      [],
      userId
    );

    await updateNotificationLog(notificationLog.id, 'FAILED', {
      successCount: 0,
      failureCount: 0,
      errors: [{ error: 'No push tokens found for user' }]
    });

    return {
      success: false,
      logId: notificationLog.id,
      successCount: 0,
      failureCount: 0,
      totalTargets: 0,
      errors: [{ error: 'No push tokens found for user' }]
    };
  }

  // Use sendToTokensEnhanced with user context
  const result = await sendToTokensEnhanced(tokens, payload, {
    ...options,
    sourceAction: options.sourceAction || `send-to-user-${userId}`
  });

  // Update the log to reflect this was a user-targeted send
  if (result.logId) {
    try {
      await prisma.pushNotificationLog.update({
        where: { id: result.logId },
        data: {
          deliveryType: 'USER',
          targetUserId: userId,
          targetTokens: tokens
        }
      });
    } catch (e) {
      console.warn('[FCM Enhanced] Failed to update pushNotificationLog with user context (non-fatal):', e);
    }
  } else {
    console.warn('[FCM Enhanced] No logId returned from token send; skipping user-context log update.');
  }

  return result;
}

// Enhanced send to topic with comprehensive logging
export async function sendToTopicEnhanced(
  topic: string, 
  payload: PushNotificationPayload,
  options: NotificationOptions = {}
): Promise<DeliveryResult> {
  
  console.log(`[FCM Enhanced] Sending to topic: ${topic}`, {
    title: payload.title,
    sourceController: options.sourceController,
    sourceAction: options.sourceAction
  });

  // Create log entry
  const notificationLog = await createNotificationLog(
    'TOPIC',
    payload,
    options,
    undefined,
    undefined,
    topic
  );

  try {
    // Update status to sending
    await updateNotificationLog(notificationLog.id, 'SENDING', {});

    const messaging = getMessaging();
    
    // Prepare FCM message for topic
    const fcmMessage: any = {
      topic,
      notification: { 
        title: payload.title, 
        body: payload.body
      },
      data: payload.data || {},
      android: { 
        priority: options.priority === 'high' ? 'high' : 'normal',
        notification: {
          ...(payload.image && { imageUrl: payload.image }),
          channelId: 'default',
          sound: 'default'
        }
      },
      apns: { 
        headers: { 
          'apns-priority': options.priority === 'high' ? '10' : '5' 
        },
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
    };

    // Add image if provided
    if (payload.image) {
      fcmMessage.notification.image = payload.image;
    }

    // Send to topic
    const response = await messaging.send(fcmMessage);
    
    console.log(`[FCM Enhanced] Topic message sent successfully`, {
      logId: notificationLog.id,
      topic,
      messageId: response
    });

    // Update log with success
    await updateNotificationLog(notificationLog.id, 'SUCCESS', {
      successCount: 1, // Topic sends don't provide exact delivery counts
      failureCount: 0,
      fcmMessageId: response,
      fcmResponse: { messageId: response }
    });

    return {
      success: true,
      logId: notificationLog.id,
      successCount: 1,
      failureCount: 0,
      totalTargets: 1,
      errors: [],
      fcmMessageId: response
    };

  } catch (error: any) {
    console.error(`[FCM Enhanced] Topic send failed:`, error);
    
    // Update log with error
    await updateNotificationLog(notificationLog.id, 'FAILED', {
      successCount: 0,
      failureCount: 1,
      errors: [{ error: error.message }]
    });

    return {
      success: false,
      logId: notificationLog.id,
      successCount: 0,
      failureCount: 1,
      totalTargets: 1,
      errors: [{ error: error.message }]
    };
  }
}

// Enhanced topic subscription with logging
export async function subscribeToTopicEnhanced(
  tokens: string[], 
  topic: string,
  options: NotificationOptions = {}
): Promise<{ success: boolean; logId?: string; errors: any[] }> {
  
  const { fcmCandidates } = splitTokens(tokens);
  const validTokens = await validateFcmTokens(fcmCandidates);
  if (validTokens.length === 0) {
    console.warn(`[FCM Enhanced] No valid tokens for topic subscription: ${topic}`);
    return { success: false, errors: [{ error: 'No valid tokens provided' }] };
  }

  console.log(`[FCM Enhanced] Subscribing ${validTokens.length} tokens to topic: ${topic}`);

  try {
    const messaging = getMessaging();
    await messaging.subscribeToTopic(validTokens, topic);
    
    console.log(`[FCM Enhanced] Successfully subscribed to topic: ${topic}`, {
      tokenCount: validTokens.length
    });

    return { success: true, errors: [] };
    
  } catch (error: any) {
    console.error(`[FCM Enhanced] Topic subscription failed:`, error);
    return { 
      success: false, 
      errors: [{ topic, error: error.message }] 
    };
  }
}

// Enhanced topic unsubscription with logging
export async function unsubscribeFromTopicEnhanced(
  tokens: string[], 
  topic: string,
  options: NotificationOptions = {}
): Promise<{ success: boolean; logId?: string; errors: any[] }> {
  
  const { fcmCandidates } = splitTokens(tokens);
  const validTokens = await validateFcmTokens(fcmCandidates);
  if (validTokens.length === 0) {
    console.warn(`[FCM Enhanced] No valid tokens for topic unsubscription: ${topic}`);
    return { success: false, errors: [{ error: 'No valid tokens provided' }] };
  }

  console.log(`[FCM Enhanced] Unsubscribing ${validTokens.length} tokens from topic: ${topic}`);

  try {
    const messaging = getMessaging();
    await messaging.unsubscribeFromTopic(validTokens, topic);
    
    console.log(`[FCM Enhanced] Successfully unsubscribed from topic: ${topic}`, {
      tokenCount: validTokens.length
    });

    return { success: true, errors: [] };
    
  } catch (error: any) {
    console.error(`[FCM Enhanced] Topic unsubscription failed:`, error);
    return { 
      success: false, 
      errors: [{ topic, error: error.message }] 
    };
  }
}

// Get notification analytics
export async function getNotificationAnalytics(
  filters: {
    deliveryType?: string;
    status?: string;
    sourceController?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}
) {
  const where: any = {};
  
  if (filters.deliveryType) where.deliveryType = filters.deliveryType;
  if (filters.status) where.status = filters.status;
  if (filters.sourceController) where.sourceController = filters.sourceController;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [logs, stats] = await Promise.all([
    // Get recent logs
    prisma.pushNotificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 100,
      include: {
        user: {
          select: { id: true, mobileNumber: true }
        }
      }
    }),
    
    // Get aggregated stats
    prisma.pushNotificationLog.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _sum: { 
        successCount: true, 
        failureCount: true,
        totalTargets: true 
      }
    })
  ]);

  return { logs, stats };
}

// Backwards compatibility - keep original function names but with enhanced logging
export const sendToTokens = sendToTokensEnhanced;
export const sendToUser = sendToUserEnhanced;
export const sendToTopic = sendToTopicEnhanced;
export const subscribeToTopic = subscribeToTopicEnhanced;
export const unsubscribeFromTopic = unsubscribeFromTopicEnhanced;