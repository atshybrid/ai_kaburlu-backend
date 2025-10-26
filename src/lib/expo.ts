import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export function isExpoPushToken(token: string): boolean {
  try {
    return typeof token === 'string' && Expo.isExpoPushToken(token);
  } catch {
    return false;
  }
}

export async function sendExpoNotifications(
  tokens: string[],
  payload: { title: string; body: string; image?: string; data?: Record<string, any> },
  options?: { priority?: 'low' | 'normal' | 'high' }
): Promise<{ successCount: number; failureCount: number; errors: any[]; invalidTokens: string[] }> {
  const expo = new Expo();

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
    channelId: 'default',
    priority: options?.priority === 'high' ? 'high' : 'default',
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const errors: any[] = [];
  const invalidTokens: string[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          successCount += 1;
        } else {
          failureCount += 1;
          const toField = chunk[idx]?.to as string | string[] | undefined;
          const token = Array.isArray(toField) ? (toField[0] || 'unknown') : (toField || 'unknown');
          const errCode = (ticket as any)?.details?.error || ticket.message || 'unknown';
          errors.push({ provider: 'expo', token: token.substring(0, 20) + '...', error: errCode });
          // Mark only token-related errors for cleanup (do not remove tokens for credential or payload errors)
          if (['DeviceNotRegistered', 'BadDeviceToken'].includes(String((ticket as any)?.details?.error))) {
            if (token && Expo.isExpoPushToken(token)) invalidTokens.push(token);
          }
        }
      });
    } catch (e: any) {
      // Whole chunk failed
      failureCount += chunk.length;
      errors.push({ provider: 'expo', error: e?.message || String(e) });
      // Don't assume all are invalid; rely on future attempts/cleanup
    }
  }

  return { successCount, failureCount, errors, invalidTokens };
}
