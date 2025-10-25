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
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  orgRegd?: string | null; // Registration line, e.g., Regd. No: 4396 / 2022 under Trust Act 1882, Govt. of India, NCT Delhi
  authorizedSignatoryName?: string | null;
  authorizedSignatoryTitle?: string | null;
  hrciLogoUrl?: string | null;
  stampRoundUrl?: string | null;
};

export type AppointmentLetterData = {
  letterNo: string; // e.g., HRCI/APPT/2025/000123
  letterDate: string; // formatted date
  // Recipient
  recipientSalutation?: string; // Mr./Ms.
  memberName: string;
  recipientAddress1?: string | null;
  recipientAddress2?: string | null;
  // Subject & role
  subjectLine: string; // full subject text
  designationName: string; // e.g., District Member / State Coordinator
  cellName?: string | null;
  level: string; // OrgLevel text
  jurisdiction?: string; // e.g., Hyderabad / Telangana
  effectiveFrom?: string | null; // formatted date
  validityPeriod?: string | null; // e.g., One Year / Two Years
  // Optional card snapshot
  cardNumber?: string | null;
  validityTo?: string | null; // formatted date
  // Extras
  mobileNumber?: string | null;
  placeLine?: string | null; // e.g., District shown near date
  // Additional fields
  joiningDate?: string | null;
  memberCreatedDate?: string | null;
  locationDisplay?: string | null;
};

export function buildAppointmentLetterHtml(org: OrgPublic, data: AppointmentLetterData): string {
  const distPath = path.resolve(__dirname, '../../templates/appointment_letter.html');
  const srcPath = path.resolve(process.cwd(), 'src/templates/appointment_letter.html');
  const templatePath = fs.existsSync(distPath) ? distPath : (fs.existsSync(srcPath) ? srcPath : distPath);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Appointment letter template not found at ${templatePath}`);
  }
  let html = fs.readFileSync(templatePath, 'utf8');

  const fullAddress = [org.addressLine1, org.addressLine2, org.city, org.state && String(org.state).toUpperCase(), org.pincode, org.country]
    .filter(Boolean)
    .join(', ');

  const replace = (id: string, value: string) => {
    // Replace text content for any element containing the given id, regardless of attribute order
    // Matches: <... id="ID" ...>old text<
    const pattern = new RegExp(`(<[^>]*\\bid=\\"${id}\\"[^>]*>)(.*?)(<)`, 'g');
    html = html.replace(pattern, `$1${value}$3`);
  };

  // Header
  replace('orgName', escapeHtml(org.orgName || ''));
  replace('orgRegd', escapeHtml(org.orgRegd || ''));
  replace('orgHeadOffice', escapeHtml(fullAddress || ''));
  replace('orgEmail', escapeHtml(org.email || ''));
  replace('orgWebsite', escapeHtml(org.website || ''));
  replace('orgPhone', escapeHtml(org.phone || ''));
  // Meta
  replace('refNo', escapeHtml(data.letterNo));
  replace('letterDate', escapeHtml(data.letterDate));
  replace('placeLine', escapeHtml(data.placeLine || ''));
  // Recipient & subject
  replace('salutationPrefix', escapeHtml(data.recipientSalutation || 'Mr./Ms.'));
  replace('recipientName', escapeHtml(data.memberName));
  replace('recipientAddress1', escapeHtml(data.recipientAddress1 || ''));
  replace('recipientAddress2', escapeHtml(data.recipientAddress2 || ''));
  replace('subjectLine', escapeHtml(data.subjectLine));
  // Body placeholders
  replace('designationName', escapeHtml(data.designationName));
  replace('jurisdictionSubject', escapeHtml(data.jurisdiction || ''));
  replace('effectiveFrom', escapeHtml(data.effectiveFrom || ''));
  replace('validityPeriod', escapeHtml(data.validityPeriod || ''));
  // Additional member info in details table
  replace('cellName', escapeHtml(data.cellName || ''));
  replace('level', escapeHtml(data.level || ''));
  // Optional extras
  replace('cardNumber', escapeHtml(data.cardNumber || ''));
  replace('validityTo', escapeHtml(data.validityTo || ''));
  replace('mobileNumber', escapeHtml(data.mobileNumber || ''));
  replace('joiningDate', escapeHtml(data.joiningDate || ''));
  replace('memberCreatedDate', escapeHtml(data.memberCreatedDate || ''));
  replace('locationDisplay', escapeHtml(data.locationDisplay || ''));
  // Signatory
  replace('signName', escapeHtml(org.authorizedSignatoryName || ''));
  replace('signTitle', escapeHtml(org.authorizedSignatoryTitle || ''));

  if (org.hrciLogoUrl) {
    html = html.replace('id="orgLogo" class="logo" src=""', `id="orgLogo" class="logo" src="${escapeAttr(org.hrciLogoUrl)}"`);
  }
  if (org.stampRoundUrl) {
    html = html.replace('id="stampRound" class="stamp" src=""', `id="stampRound" class="stamp" src="${escapeAttr(org.stampRoundUrl)}"`);
  }
  return html;
}

export async function generateAppointmentLetterPdf(org: OrgPublic, data: AppointmentLetterData): Promise<Buffer> {
  const puppeteer = await import('puppeteer');

  const inlineIfPossible = async (url?: string | null): Promise<string | undefined> => {
    const raw = (url ?? '').toString().trim();
    if (!raw) return undefined;
    if (/^data:/i.test(raw)) return raw;
    const base = (process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').toString().replace(/\/$/, '');
    const absUrl = raw.startsWith('/') && base ? `${base}${raw}` : raw;
    try {
      const resp = await axios.get(absUrl, { responseType: 'arraybuffer', maxRedirects: 5, validateStatus: () => true });
      if (resp.status >= 200 && resp.status < 400) {
        const ctype = (resp.headers['content-type'] as string) || 'image/png';
        const b64 = Buffer.from(resp.data).toString('base64');
        return `data:${ctype};base64,${b64}`;
      }
    } catch {}
    return absUrl;
  };

  const orgInline: OrgPublic = { ...org };
  if (org.hrciLogoUrl) orgInline.hrciLogoUrl = await inlineIfPossible(org.hrciLogoUrl);
  if (org.stampRoundUrl) orgInline.stampRoundUrl = await inlineIfPossible(org.stampRoundUrl);

  let html = buildAppointmentLetterHtml(orgInline, data);

  const execPath =
    (process.env.PUPPETEER_EXECUTABLE_PATH && String(process.env.PUPPETEER_EXECUTABLE_PATH)) ||
    (process.env.GOOGLE_CHROME_BIN && String(process.env.GOOGLE_CHROME_BIN)) ||
    undefined;
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], executablePath: execPath });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: ['networkidle0'] });
  await page.emulateMediaType('print');
  const pdfData = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' }, scale: 0.96 });
  await browser.close();
  return Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string) { return s.replace(/"/g, '&quot;'); }
