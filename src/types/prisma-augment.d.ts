import { PrismaClient } from '@prisma/client';

// Temporary augmentation because generated client typings did not include cellLevelCapacity delegate.
// Remove this file once Prisma generator includes the model.
declare module '@prisma/client' {
  interface PrismaClient {
    cellLevelCapacity: any;
  }
}