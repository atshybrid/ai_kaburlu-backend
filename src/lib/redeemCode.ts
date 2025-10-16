import { randomInt } from 'crypto';

const ADJECTIVES = ['BRAVE','SWIFT','CALM','BOLD','RAPID','HAPPY','LUCKY','SMART','NOBLE','WISE','FRESH','BRIGHT','PURE','KEEN','TRUE','SOLID','GRAND','HONEST','STABLE','FIRM'];
const NOUNS = ['LION','TIGER','EAGLE','WOLF','PANDA','COBRA','HORSE','HAWK','BEAR','OTTER','FALCON','RAVEN','BISON','JAGUAR','ORCA','MAMBA','RHINO','YAK','IBEX','LYNX'];

function pick<T>(arr: T[]): T { return arr[randomInt(0, arr.length)]; }

export function generateRedeemCode(): string {
  const adj = pick(ADJECTIVES); const noun = pick(NOUNS); const num = String(randomInt(100, 1000));
  return `${adj}-${noun}-${num}`;
}

export function generateRedeemCodes(count = 5): string[] {
  const out = new Set<string>();
  while (out.size < count) out.add(generateRedeemCode());
  return Array.from(out);
}

export function checksumLetter(input: string): string {
  const sum = Buffer.from(input).reduce((acc, b) => acc + b, 0);
  return String.fromCharCode('A'.charCodeAt(0) + (sum % 26));
}

export function generateRedeemCodeWithCheck(): string {
  const base = generateRedeemCode();
  return `${base}-${checksumLetter(base)}`;
}
