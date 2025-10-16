import fs from 'fs';
import path from 'path';

export type OrgPublic = {
  orgName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  pan?: string | null;
  eightyGNumber?: string | null;
  eightyGValidFrom?: Date | null;
  eightyGValidTo?: Date | null;
  authorizedSignatoryName?: string | null;
  authorizedSignatoryTitle?: string | null;
};

export type DonationReceiptData = {
  receiptNo: string;
  receiptDate: string; // formatted dd/mm/yyyy or ISO string
  donorName: string;
  donorAddress?: string;
  donorPan?: string;
  amount: string; // formatted amount e.g., 10,000
  mode: string; // UPI / Bank Transfer / Cheque
  purpose: string;
};

export async function generateDonationReceiptPdf(org: OrgPublic, data: DonationReceiptData): Promise<Buffer> {
  // Lazy import puppeteer only when needed
  const puppeteer = await import('puppeteer');
  const templatePath = path.resolve(__dirname, '../../templates/donation_receipt.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const fullAddress = [org.addressLine1, org.addressLine2, org.city, org.state && String(org.state).toUpperCase(), org.pincode, org.country]
    .filter(Boolean)
    .join(', ');

  const replace = (id: string, value: string) => {
    const pattern = new RegExp(`id=\"${id}\">.*?<`, 'g');
    html = html.replace(pattern, `id="${id}">${value}<`);
  };

  replace('orgName', escapeHtml(org.orgName || ''));
  replace('orgAddress', escapeHtml(fullAddress || ''));
  replace('receiptNo', escapeHtml(data.receiptNo));
  replace('receiptDate', escapeHtml(data.receiptDate));
  replace('donorName', escapeHtml(data.donorName));
  replace('donorAddress', escapeHtml(data.donorAddress || ''));
  replace('donorPan', data.donorPan ? `PAN: ${escapeHtml(data.donorPan)}` : '');
  replace('amount', escapeHtml(data.amount));
  replace('mode', `Mode: ${escapeHtml(data.mode)}`);
  replace('purpose', escapeHtml(data.purpose));
  replace('tName', escapeHtml(org.orgName || ''));
  replace('tPan', escapeHtml(org.pan || ''));
  replace('t80g', escapeHtml(org.eightyGNumber || ''));
  const vFrom = org.eightyGValidFrom ? formatDate(org.eightyGValidFrom) : '';
  const vTo = org.eightyGValidTo ? formatDate(org.eightyGValidTo) : '';
  replace('t80gValidity', vFrom || vTo ? `Valid from ${vFrom} to ${vTo}` : '');
  replace('signName', escapeHtml(org.authorizedSignatoryName || ''));
  replace('signTitle', escapeHtml(org.authorizedSignatoryTitle || ''));

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: ['networkidle0'] });
  await page.emulateMediaType('print');
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  await browser.close();
  return pdf;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatDate(d: Date) {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
