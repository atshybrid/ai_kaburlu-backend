import fs from 'fs';
import path from 'path';
import axios from 'axios';

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
  hrciLogoUrl?: string | null;
  stampRoundUrl?: string | null;
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
  qrDataUrl?: string; // data:image/png;base64,... for receipt verification
};

export function buildDonationReceiptHtml(org: OrgPublic, data: DonationReceiptData): string {
  // Resolve template path for both dev (src) and prod (dist)
  const distPath = path.resolve(__dirname, '../../templates/donation_receipt.html');
  const srcPath = path.resolve(process.cwd(), 'src/templates/donation_receipt.html');
  const templatePath = fs.existsSync(distPath) ? distPath : (fs.existsSync(srcPath) ? srcPath : distPath);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Receipt template not found at ${templatePath}`);
  }
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

  // Inject logo and stamp if provided (toggle display via setting src and removing display:none)
  if (org.hrciLogoUrl) {
    html = html.replace('id="orgLogo" class="logo" src=""', `id="orgLogo" class="logo" src="${escapeAttr(org.hrciLogoUrl)}"`);
  }
  if (org.stampRoundUrl) {
    html = html.replace('id="stampRound" class="stamp" src=""', `id="stampRound" class="stamp" src="${escapeAttr(org.stampRoundUrl)}"`);
  }

  // Inject QR code if provided
  if (data.qrDataUrl) {
    html = html.replace('id="qrCode" class="qr" src=""', `id="qrCode" class="qr" src="${escapeAttr(data.qrDataUrl)}"`);
  }

  return html;
}

export async function generateDonationReceiptPdf(org: OrgPublic, data: DonationReceiptData): Promise<Buffer> {
  // Lazy import puppeteer only when needed
  const puppeteer = await import('puppeteer');
  // Try to inline external images as data URLs to avoid network/CORS issues in headless Chrome
  const inlineIfPossible = async (url?: string | null): Promise<string | undefined> => {
    const raw = (url ?? '').toString().trim();
    if (!raw) return undefined;
    if (/^data:/i.test(raw)) return raw; // already data URL
    const base = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').toString().replace(/\/$/, '');
    const absUrl = raw.startsWith('/') && base ? `${base}${raw}` : raw;
    try {
      const resp = await axios.get(absUrl, { responseType: 'arraybuffer', maxRedirects: 5, validateStatus: () => true });
      const status = resp.status;
      if (status >= 200 && status < 400) {
        const ctype = (resp.headers['content-type'] as string) || 'image/png';
        const b64 = Buffer.from(resp.data).toString('base64');
        return `data:${ctype};base64,${b64}`;
      }
    } catch {
      // swallow and fallback to original URL
    }
    return absUrl;
  };

  const orgInline: OrgPublic = { ...org };
  if (org.hrciLogoUrl) orgInline.hrciLogoUrl = await inlineIfPossible(org.hrciLogoUrl);
  if (org.stampRoundUrl) orgInline.stampRoundUrl = await inlineIfPossible(org.stampRoundUrl);

  let html = buildDonationReceiptHtml(orgInline, data);

  // Choose an executable path if provided by environment (Render/other PaaS), else let Puppeteer find the downloaded Chrome.
  // Supported envs: PUPPETEER_EXECUTABLE_PATH (official), or GOOGLE_CHROME_BIN (Heroku-like).
  const execPath =
    (process.env.PUPPETEER_EXECUTABLE_PATH && String(process.env.PUPPETEER_EXECUTABLE_PATH)) ||
    (process.env.GOOGLE_CHROME_BIN && String(process.env.GOOGLE_CHROME_BIN)) ||
    undefined;
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: execPath,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: ['networkidle0'] });
  await page.emulateMediaType('print');
  const pdfData = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  await browser.close();
  // Puppeteer returns a Uint8Array; ensure we return a Node Buffer
  return Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;');
}
function formatDate(d: Date) {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
