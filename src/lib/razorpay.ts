import crypto from 'crypto';
import axios from 'axios';

export function razorpayEnabled() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayKeyId() {
  return process.env.RAZORPAY_KEY_ID || '';
}

function authHeader() {
  const id = process.env.RAZORPAY_KEY_ID || '';
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  const token = Buffer.from(`${id}:${secret}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

export async function createRazorpayOrder(args: { amountPaise: number; currency: string; receipt: string; notes?: Record<string, any> }) {
  const res = await axios.post('https://api.razorpay.com/v1/orders', {
    amount: args.amountPaise,
    currency: args.currency,
    receipt: args.receipt,
    notes: args.notes || {}
  }, {
    headers: { 'Content-Type': 'application/json', ...authHeader() }
  });
  return res.data as { id: string; amount: number; currency: string };
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${orderId}|${paymentId}`);
  const digest = hmac.digest('hex');
  return digest === signature;
}
