export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timeoutId: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    // @ts-expect-error clear timer
    clearTimeout(timeoutId);
    return result as T;
  } catch (e) {
    // @ts-expect-error clear timer
    if (timeoutId) clearTimeout(timeoutId);
    throw e;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
