export function normalizeMobileNumber(input: any): string {
  const digits = String(input || '').replace(/\D+/g, '');
  if (!digits) return '';

  // India-focused normalization used across the codebase:
  // - Remove non-digits
  // - If a country/trunk prefix is present, keep the last 10 digits
  if (digits.startsWith('91') && digits.length > 10) return digits.slice(-10);
  if (digits.startsWith('0') && digits.length > 10) return digits.slice(-10);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function buildUserMobileLookupWhere(input: any) {
  const norm = normalizeMobileNumber(input);
  if (!norm) {
    const raw = String(input || '').trim();
    return raw ? ({ mobileNumber: raw } as const) : ({ mobileNumber: '' } as const);
  }

  // Support legacy stored formats (e.g. +91XXXXXXXXXX, 0XXXXXXXXXX, with spaces) by suffix matching.
  return {
    OR: [{ mobileNumber: norm }, { mobileNumber: { endsWith: norm } }],
  } as const;
}
