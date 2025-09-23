// TypeScript Language Server Restart Helper
// This file helps force TypeScript to recognize the updated Prisma types

import { PrismaClient } from '@prisma/client';

// Re-export the prisma instance with proper typing
const prismaWithTypes = new PrismaClient();

// Verify PushNotificationLog model exists
type PushNotificationLogModel = typeof prismaWithTypes.pushNotificationLog;

export { prismaWithTypes, type PushNotificationLogModel };