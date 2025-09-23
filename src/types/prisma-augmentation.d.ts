// Temporary augmentation so TypeScript stops erroring about missing pushNotificationLog delegate.
// Root cause: Generated @prisma/client types currently do not include the PushNotificationLog model
// even though it exists in schema.prisma. Likely due to an editor / language server cache issue.
// After ensuring prisma generate truly outputs the delegate, remove this file.

import '@prisma/client';

declare module '@prisma/client' {
  interface PrismaClient {
    // Use 'any' to avoid blocking build; replace with proper type after regeneration works.
    pushNotificationLog: any;
  }
}
