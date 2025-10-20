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

export async function createRazorpayPaymentLink(args: {
  amountPaise: number;
  currency?: string;
  description?: string;
  reference_id?: string;
  customer?: { name?: string; contact?: string; email?: string };
  notify?: { sms?: boolean; email?: boolean };
  notes?: Record<string, any>;
}) {
  const payload: any = {
    amount: args.amountPaise,
    currency: args.currency || 'INR',
    description: args.description || 'Advertisement Payment',
    reference_id: args.reference_id,
    customer: args.customer,
    notify: args.notify || { sms: true, email: true },
    notes: args.notes || {},
  };
  const res = await axios.post('https://api.razorpay.com/v1/payment_links', payload, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return res.data as { id: string; short_url: string; status: string };
}

export async function getRazorpayPaymentLink(linkId: string) {
  const res = await axios.get(`https://api.razorpay.com/v1/payment_links/${linkId}`, {
    headers: { ...authHeader() },
  });
  return res.data as { id: string; status: string; amount: number; currency: string; short_url?: string; reference_id?: string };
}

export async function cancelRazorpayPaymentLink(linkId: string) {
  const res = await axios.post(`https://api.razorpay.com/v1/payment_links/${linkId}/cancel`, {}, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return res.data as { id: string; status: string };
}

export async function getRazorpayOrderPayments(orderId: string) {
  const res = await axios.get(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
    headers: { ...authHeader() },
  });
  // Returns { count: number, items: Payment[] }
  return res.data as { count: number; items: Array<{ id: string; status: string; amount: number; method?: string }> };
}

export async function updateRazorpayPaymentLink(linkId: string, data: any) {
  const res = await axios.patch(`https://api.razorpay.com/v1/payment_links/${linkId}`, data, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return res.data as any;
}

export async function listRazorpayPaymentLinks(params?: any) {
  const res = await axios.get('https://api.razorpay.com/v1/payment_links', {
    headers: { ...authHeader() },
    params,
  });
  return res.data as { count: number; items: any[] };
}

export async function notifyRazorpayPaymentLink(linkId: string, via: 'sms' | 'email') {
  const res = await axios.post(`https://api.razorpay.com/v1/payment_links/${linkId}/notify_by/${via}`, {}, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return res.data as any;
}

export function verifyRazorpayWebhookSignature(payload: string, signature: string) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  return digest === signature;
}
