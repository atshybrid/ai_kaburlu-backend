import crypto from 'crypto';
import axios from 'axios';

export interface RazorpayOrderParams {
  amountMinor: number; // integer in minor units
  currency: string;
  receipt: string;
  notes?: Record<string, any>;
}

export interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
}

const RZ_BASE = 'https://api.razorpay.com/v1';

function authHeader() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

export async function createRazorpayOrder(params: RazorpayOrderParams): Promise<RazorpayOrderResponse> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay keys not configured');
  }
  const res = await axios.post(`${RZ_BASE}/orders`, {
    amount: params.amountMinor,
    currency: params.currency,
    receipt: params.receipt,
    notes: params.notes || {}
  }, { headers: { ...authHeader() } });
  return res.data;
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  const h = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return h === signature;
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const h = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return h === signature;
}
