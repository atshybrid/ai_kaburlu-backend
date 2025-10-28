// Centralized environment resolver with simple dev/prod switching
// Usage: import this module at app start to normalize process.env

type EnvType = 'dev' | 'prod' | 'development' | 'production' | string;

function isProdEnv(envType?: EnvType) {
  const v = String(envType || '').toLowerCase();
  return v === 'prod' || v === 'production';
}

export interface AppConfig {
  envType: EnvType;
  isProd: boolean;
  databaseUrl?: string;
  baseUrl?: string;
  razorpay?: {
    keyId?: string;
    keySecret?: string;
    webhookSecret?: string;
    callbackBaseUrl?: string;
  };
}

// Resolve variables based on ENV_TYPE (preferred) or NODE_ENV
const envType: EnvType = (process.env.ENV_TYPE as EnvType) || (process.env.NODE_ENV as EnvType) || 'development';
const prod = isProdEnv(envType);

// Pick DB URL: prefer explicit DEV_/PROD_ vars, else fallback to DATABASE_URL
const resolvedDbUrl = prod
  ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DEV_DATABASE_URL || process.env.DATABASE_URL);

// Pick BASE URL similarly
const resolvedBaseUrl = prod
  ? (process.env.PROD_BASE_URL || process.env.BASE_URL)
  : (process.env.DEV_BASE_URL || process.env.BASE_URL);

// Razorpay: resolve keys and webhook secret per env
const resolvedRazorpayKeyId = prod
  ? (process.env.PROD_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID)
  : (process.env.DEV_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID);

const resolvedRazorpayKeySecret = prod
  ? (process.env.PROD_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
  : (process.env.DEV_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);

const resolvedRazorpayWebhookSecret = prod
  ? (process.env.PROD_RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET)
  : (process.env.DEV_RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET);

const resolvedPaymentCallbackBaseUrl = prod
  ? (process.env.PROD_PAYMENT_CALLBACK_BASE_URL || process.env.PAYMENT_CALLBACK_BASE_URL)
  : (process.env.DEV_PAYMENT_CALLBACK_BASE_URL || process.env.PAYMENT_CALLBACK_BASE_URL);

// Normalize into process.env for libraries that read directly (Prisma, etc.)
if (resolvedDbUrl && process.env.DATABASE_URL !== resolvedDbUrl) {
  process.env.DATABASE_URL = resolvedDbUrl;
}
if (resolvedBaseUrl && process.env.BASE_URL !== resolvedBaseUrl) {
  process.env.BASE_URL = resolvedBaseUrl;
}
if (resolvedRazorpayKeyId) process.env.RAZORPAY_KEY_ID = resolvedRazorpayKeyId;
if (resolvedRazorpayKeySecret) process.env.RAZORPAY_KEY_SECRET = resolvedRazorpayKeySecret;
if (resolvedRazorpayWebhookSecret) process.env.RAZORPAY_WEBHOOK_SECRET = resolvedRazorpayWebhookSecret;
if (resolvedPaymentCallbackBaseUrl) process.env.PAYMENT_CALLBACK_BASE_URL = resolvedPaymentCallbackBaseUrl;

export const config: AppConfig = {
  envType,
  isProd: prod,
  databaseUrl: resolvedDbUrl,
  baseUrl: resolvedBaseUrl,
  razorpay: {
    keyId: resolvedRazorpayKeyId,
    keySecret: resolvedRazorpayKeySecret,
    webhookSecret: resolvedRazorpayWebhookSecret,
    callbackBaseUrl: resolvedPaymentCallbackBaseUrl,
  }
};

export default config;
