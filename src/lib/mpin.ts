import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export async function hashMpin(raw: string): Promise<string> {
  if (!raw) throw new Error('MPIN empty');
  return bcrypt.hash(raw, SALT_ROUNDS);
}

export async function verifyMpin(raw: string, hashed?: string | null): Promise<boolean> {
  if (!raw || !hashed) return false;
  // If hashed accidentally stored in plain (legacy), fallback compare direct equality
  if (!hashed.startsWith('$2')) return raw === hashed;
  return bcrypt.compare(raw, hashed);
}
