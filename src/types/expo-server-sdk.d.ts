declare module 'expo-server-sdk' {
  export class Expo {
    static isExpoPushToken(token: string): boolean;
    chunkPushNotifications(messages: any[]): any[][];
    sendPushNotificationsAsync(messages: any[]): Promise<any[]>;
  }
  export interface ExpoPushMessage {
    to: string | string[];
    sound?: string | null;
    title?: string;
    body?: string;
    data?: Record<string, any>;
    channelId?: string;
    priority?: 'default' | 'normal' | 'high' | 'max' | 'min';
  }
  export interface ExpoPushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
  }
}
