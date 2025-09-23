// Import enhanced FCM functions and re-export for backwards compatibility
import { 
  sendToTokensEnhanced, 
  sendToUserEnhanced, 
  sendToTopicEnhanced,
  subscribeToTopicEnhanced,
  unsubscribeFromTopicEnhanced,
  getNotificationAnalytics,
  type PushNotificationPayload,
  type NotificationOptions,
  type DeliveryResult
} from './fcm-enhanced';

// Legacy function signatures for backwards compatibility
export async function sendToTokens(
  tokens: string[], 
  payload: { title: string; body: string; image?: string; data?: Record<string, string> }
) {
  const result = await sendToTokensEnhanced(tokens, payload, {
    sourceController: 'legacy-fcm',
    sourceAction: 'sendToTokens'
  });
  
  // Return legacy format
  return {
    successCount: result.successCount,
    failureCount: result.failureCount,
    errors: result.errors
  };
}

export async function sendToUser(
  userId: string, 
  payload: { title: string; body: string; image?: string; data?: Record<string, string> }
) {
  const result = await sendToUserEnhanced(userId, payload, {
    sourceController: 'legacy-fcm',
    sourceAction: 'sendToUser'
  });
  
  // Return legacy format
  return {
    successCount: result.successCount,
    failureCount: result.failureCount,
    errors: result.errors
  };
}

export async function sendToTopic(
  topic: string, 
  payload: { title: string; body: string; image?: string; data?: Record<string, string> }
) {
  const result = await sendToTopicEnhanced(topic, payload, {
    sourceController: 'legacy-fcm',
    sourceAction: 'sendToTopic'
  });
  
  // Return legacy format (messageId for topic sends)
  return result.fcmMessageId;
}

export async function subscribeToTopic(tokens: string[], topic: string) {
  const result = await subscribeToTopicEnhanced(tokens, topic, {
    sourceController: 'legacy-fcm',
    sourceAction: 'subscribeToTopic'
  });
  
  return { success: result.success };
}

export async function unsubscribeFromTopic(tokens: string[], topic: string) {
  const result = await unsubscribeFromTopicEnhanced(tokens, topic, {
    sourceController: 'legacy-fcm',
    sourceAction: 'unsubscribeFromTopic'
  });
  
  return { success: result.success };
}

// Re-export enhanced functions and types for new implementations
export {
  sendToTokensEnhanced,
  sendToUserEnhanced,
  sendToTopicEnhanced,
  subscribeToTopicEnhanced,
  unsubscribeFromTopicEnhanced,
  getNotificationAnalytics,
  type PushNotificationPayload,
  type NotificationOptions,
  type DeliveryResult
};
