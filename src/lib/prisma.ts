
import { PrismaClient } from '@prisma/client';

// If the language server cache got stale, sometimes the new model delegate isn't picked up.
// We create a single PrismaClient instance and also export its type with an explicit interface
// reference so that usages like prisma.pushNotificationLog are recognized.

const prisma = new PrismaClient();

// Helper type to force TS to evaluate the delegate; accessing it here helps some LS versions.
// (No runtime effect; if it doesn't exist, this file would error during build.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type __PushNotificationLogDelegate = typeof prisma.pushNotificationLog; // keep at least one reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// type hint for MembershipKyc delegate intentionally omitted to avoid stale LS errors during generation

export default prisma;
