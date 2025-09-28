import { Request, Response } from 'express';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePrivacyDto, UpdatePrivacyDto } from './privacy.dto';
import { 
  getActivePrivacy, 
  getAllPrivacy, 
  getPrivacyById, 
  createPrivacy, 
  updatePrivacy, 
  deletePrivacy, 
  activatePrivacy 
} from './privacy.service';

// Public endpoint - Get active privacy policy
export const getActivePrivacyController = async (req: Request, res: Response) => {
  try {
    const { language = 'en' } = req.query as { language?: string };
    const privacy = await getActivePrivacy(language);
    
    if (!privacy) {
      return res.status(404).json({ 
        success: false, 
        message: `No active privacy policy found for language: ${language}` 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: privacy 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// Public endpoint - Get active privacy policy as HTML
export const getActivePrivacyHtmlController = async (req: Request, res: Response) => {
  try {
    const { language = 'en' } = req.query as { language?: string };
    const privacy = await getActivePrivacy(language);
    
    if (!privacy) {
      return res.status(404).send(`
        <html>
          <head><title>Privacy Policy Not Found</title></head>
          <body>
            <h1>Privacy Policy Not Found</h1>
            <p>No active privacy policy found for language: ${language}</p>
          </body>
        </html>
      `);
    }

    const html = `
      <!DOCTYPE html>
      <html lang="${language}">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${privacy.title}</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
            h1 { color: #333; border-bottom: 2px solid #28a745; padding-bottom: 10px; }
            .meta { background: #f8f9fa; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <h1>${privacy.title}</h1>
          <div class="meta">
            <p><strong>Version:</strong> ${privacy.version}</p>
            <p><strong>Effective Date:</strong> ${privacy.effectiveAt ? new Date(privacy.effectiveAt).toLocaleDateString() : 'Not specified'}</p>
            <p><strong>Last Updated:</strong> ${new Date(privacy.updatedAt).toLocaleDateString()}</p>
          </div>
          <div class="content">
            ${privacy.content}
          </div>
        </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>Error</h1>
          <p>An error occurred while loading the privacy policy.</p>
        </body>
      </html>
    `);
  }
};

// Admin endpoints
export const getAllPrivacyController = async (req: Request, res: Response) => {
  try {
    const { language } = req.query as { language?: string };
    const privacy = await getAllPrivacy(language);
    res.status(200).json({ success: true, data: privacy });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getPrivacyByIdController = async (req: Request, res: Response) => {
  try {
    const privacy = await getPrivacyById(req.params.id);
    res.status(200).json({ success: true, data: privacy });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createPrivacyController = async (req: Request, res: Response) => {
  try {
    // Allow posting a structured JSON and transform it to title + HTML content
    const transformed = transformStructuredPrivacyPayload(req.body);
    const input = transformed ?? req.body;

    const createPrivacyDto = plainToClass(CreatePrivacyDto, input);
    const errors = await validate(createPrivacyDto);
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

  const createdBy = (req as any).user?.id;
  const privacy = await createPrivacy(createPrivacyDto, createdBy);
    
    res.status(201).json({ 
      success: true, 
      message: 'Privacy Policy created successfully', 
      data: privacy 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updatePrivacyController = async (req: Request, res: Response) => {
  try {
    // Accept structured JSON on update as well and transform
    const transformed = transformStructuredPrivacyPayload(req.body);
    const input = transformed ?? req.body;
    const updatePrivacyDto = plainToClass(UpdatePrivacyDto, input);
    const errors = await validate(updatePrivacyDto);
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const privacy = await updatePrivacy(req.params.id, updatePrivacyDto);
    
    res.status(200).json({ 
      success: true, 
      message: 'Privacy Policy updated successfully', 
      data: privacy 
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deletePrivacyController = async (req: Request, res: Response) => {
  try {
    const result = await deletePrivacy(req.params.id);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const activatePrivacyController = async (req: Request, res: Response) => {
  try {
    const privacy = await activatePrivacy(req.params.id);
    res.status(200).json({ 
      success: true, 
      message: 'Privacy Policy activated successfully', 
      data: privacy 
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------- helpers ----------

// Detects and transforms a structured privacy document JSON into
// the shape expected by our DTOs: { title, content (HTML), language?, effectiveAt? }
function transformStructuredPrivacyPayload(body: any): { title: string; content: string; language?: string; effectiveAt?: string; version?: string; isActive?: boolean } | null {
  try {
    if (!body || typeof body !== 'object') return null;
    // Accept two shapes:
    // A) Flat structured: { appName, policyType, sections, language, version, isActive, effectiveDate }
    // B) Nested structured: { privacyPolicy: { appName, ... many fields ... } }
    const nested = body.privacyPolicy && typeof body.privacyPolicy === 'object' ? body.privacyPolicy : null;
    const src: any = nested || body;
    const isStructured = !!(src.appName || src.sections || src.policyType || src.styling);
    if (!isStructured && !nested) return null;

    const appName: string = src.appName || 'App';
    const policyType: string = src.policyType || 'Privacy Policy';
    const title = src.title || `${appName} - ${policyType}`;
  const language: string | undefined = src.language || body.language || undefined;
  const effectiveCandidate: string | undefined = src.effectiveDate || src.effectiveAt || body.effectiveDate || body.effectiveAt || undefined;
  const effectiveAt: string | undefined = normalizeIsoDateOrUndefined(effectiveCandidate);
    const version: string | undefined = src.version || body.version || undefined;
  const isActive: boolean | undefined = typeof src.isActive === 'boolean' ? src.isActive : (typeof body.isActive === 'boolean' ? body.isActive : undefined);

    // If nested payload provided without explicit sections, synthesize sections from known keys
    let sections = Array.isArray(src.sections) ? src.sections : [];
    if (!sections.length && nested) {
      const pp = nested;
      const sec = [] as any[];
      const add = (title: string, content?: string | object) => {
        if (content === undefined || content === null) return;
        if (typeof content === 'string') sec.push({ title, content });
        else if (typeof content === 'object') {
          // flatten simple key->string pairs into bullet points
          const points = Object.entries(content as Record<string, any>)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => `${k}: ${v as string}`);
          if (points.length) sec.push({ title, points });
        }
      };
      add('Introduction', pp.introduction);
      add('Data Controller', (pp.dataController && typeof pp.dataController === 'object') ? `Name: ${pp.dataController.name || ''}; Email: ${pp.dataController.contactEmail || ''}; Address: ${pp.dataController.address || ''}`.trim() : undefined);
      add('Data Collected', pp.dataCollected);
      add('How We Use Data', pp.howWeUseData);
      add('Legal Bases for Processing', pp.legalBasesForProcessing);
      add('Sharing and Third Parties', pp.sharingAndThirdParties);
      add('Data Retention', pp.dataRetention);
      add('User Rights and Choices', pp.userRightsAndChoices);
      add('Security', pp.security);
      add('Children', pp.children);
      add('International Transfers', pp.internationalTransfers);
      add('Cookies and Tracking', pp.cookiesAndTracking);
      add('Advertising', pp.advertising);
      add('Permissions Explanation', pp.permissionsExplanation);
      add('Uploads, Transcription & Moderation', pp.policyForUploadsTranscriptionModeration);
      add('Links To Other Sites', pp.linksToOtherSites);
      add('Changes To Policy', pp.changesToPolicy);
      // Contact information block
      if (pp.contactInformation && typeof pp.contactInformation === 'object') {
        const ci = pp.contactInformation;
        sec.push({ title: 'Contact Information', points: Object.entries(ci).map(([k, v]) => `${k}: ${String(v)}`) });
      }
      sections = sec;
    }

    const html = renderPrivacyHtmlFromStructured({
      appName,
      policyType,
      effectiveDate: effectiveAt,
      sections,
      meta: src.meta || body.meta,
      styling: src.styling || body.styling,
    });

    return { title, content: html, language, effectiveAt, version, isActive };
  } catch {
    return null;
  }
}

function renderPrivacyHtmlFromStructured(doc: any): string {
  const theme = doc?.styling?.theme || {};
  const fonts = doc?.styling?.fonts || {};
  const colors = {
    primary: theme.primaryColor || '#0B5FFF',
    bg: theme.backgroundColor || '#FFFFFF',
    text: theme.textColor || '#121212',
    muted: theme.mutedTextColor || '#6B7280',
  };

  const headingFont = fonts.heading || 'Poppins, sans-serif';
  const bodyFont = fonts.body || 'Inter, system-ui, sans-serif';

  let eff = '';
  if (doc?.effectiveDate) {
    const d = new Date(doc.effectiveDate);
    if (!isNaN(d.getTime())) {
      eff = d.toLocaleDateString();
    }
  }

  const sectionsHtml = (doc?.sections || [])
    .map((s: any) => {
      const title = s?.title ? `<h2>${escapeHtml(s.title)}</h2>` : '';
      const content = s?.content ? `<p>${escapeHtml(s.content)}</p>` : '';
      const points = Array.isArray(s?.points) && s.points.length
        ? `<ul>${s.points.map((p: string) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '';
      const contact = s?.contact
        ? `<div class="contact">
            ${s.contact.email ? `<p><strong>Email:</strong> ${escapeHtml(s.contact.email)}</p>` : ''}
            ${s.contact.website ? `<p><strong>Website:</strong> ${escapeHtml(s.contact.website)}</p>` : ''}
            ${s.contact.company ? `<p><strong>Company:</strong> ${escapeHtml(s.contact.company)}</p>` : ''}
            ${s.contact.address ? `<p><strong>Address:</strong> ${escapeHtml(s.contact.address)}</p>` : ''}
          </div>`
        : '';
      return `<section>${title}${content}${points}${contact}</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(doc?.appName || 'App')} - ${escapeHtml(doc?.policyType || 'Privacy Policy')}</title>
      <style>
        :root {
          --primary: ${colors.primary};
          --bg: ${colors.bg};
          --text: ${colors.text};
          --muted: ${colors.muted};
        }
        body { margin:0; padding:0; background: var(--bg); color: var(--text); font-family: ${bodyFont}; }
        .container { max-width: 900px; margin: 0 auto; padding: 28px; }
        h1 { font-family: ${headingFont}; font-size: 28px; color: var(--primary); margin-bottom: 8px; }
        h2 { font-size: 20px; color: var(--primary); margin-top: 18px; }
        p { font-size: 16px; line-height: 1.6; }
        ul { margin-left: 18px; }
        .meta { color: var(--muted); margin-bottom: 16px; }
        .contact p { margin: 4px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${escapeHtml(doc?.appName || 'App')} - ${escapeHtml(doc?.policyType || 'Privacy Policy')}</h1>
        ${eff ? `<div class="meta"><strong>Effective Date:</strong> ${eff}</div>` : ''}
        ${sectionsHtml}
      </div>
    </body>
  </html>`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Returns the same string if it's ISO-like or a parseable date converted to ISO; otherwise undefined
function normalizeIsoDateOrUndefined(val?: string): string | undefined {
  if (!val || typeof val !== 'string') return undefined;
  // Accept ISO-8601-like (YYYY-MM-DD or full ISO) directly
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}