import * as bcrypt from 'bcrypt';

const DEFAULT_ROUNDS = parseInt(process.env.MPIN_SALT_ROUNDS || '10', 10);

export function isBcryptHash(value?: string | null) {
  return !!value && value.startsWith('$2');
}

export async function hashMpin(raw: string, rounds: number = DEFAULT_ROUNDS): Promise<string> {
  if (!raw) throw new Error('MPIN empty');
  return bcrypt.hash(raw, rounds);
}

export async function verifyMpin(raw: string, stored?: string | null): Promise<boolean> {
  if (!raw || !stored) return false;
  if (!isBcryptHash(stored)) {
    // Legacy fallback (plaintext). Accept match but caller should migrate.
    return raw === stored;
  }
  try { return await bcrypt.compare(raw, stored); } catch { return false; }
}
