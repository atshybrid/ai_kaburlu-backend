import { Request, Response } from 'express';
import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTermsDto, UpdateTermsDto } from './terms.dto';
import { 
  getActiveTerms, 
  getAllTerms, 
  getTermsById, 
  createTerms, 
  updateTerms, 
  deleteTerms, 
  activateTerms 
} from './terms.service';

// Public endpoint - Get active terms
export const getActiveTermsController = async (req: Request, res: Response) => {
  try {
    const { language = 'en' } = req.query as { language?: string };
    const terms = await getActiveTerms(language);
    
    if (!terms) {
      return res.status(404).json({ 
        success: false, 
        message: `No active terms and conditions found for language: ${language}` 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: terms 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};

// Public endpoint - Get active terms as HTML
export const getActiveTermsHtmlController = async (req: Request, res: Response) => {
  try {
    const { language = 'en' } = req.query as { language?: string };
    const terms = await getActiveTerms(language);
    
    if (!terms) {
      return res.status(404).send(`
        <html>
          <head><title>Terms and Conditions Not Found</title></head>
          <body>
            <h1>Terms and Conditions Not Found</h1>
            <p>No active terms and conditions found for language: ${language}</p>
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
          <title>${terms.title}</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
            h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
            .meta { background: #f8f9fa; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <h1>${terms.title}</h1>
          <div class="meta">
            <p><strong>Version:</strong> ${terms.version}</p>
            <p><strong>Effective Date:</strong> ${terms.effectiveAt ? new Date(terms.effectiveAt).toLocaleDateString() : 'Not specified'}</p>
            <p><strong>Last Updated:</strong> ${new Date(terms.updatedAt).toLocaleDateString()}</p>
          </div>
          <div class="content">
            ${terms.content}
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
          <p>An error occurred while loading the terms and conditions.</p>
        </body>
      </html>
    `);
  }
};

// Admin endpoints
export const getAllTermsController = async (req: Request, res: Response) => {
  try {
    const { language } = req.query as { language?: string };
    const terms = await getAllTerms(language);
    res.status(200).json({ success: true, data: terms });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getTermsByIdController = async (req: Request, res: Response) => {
  try {
    const terms = await getTermsById(req.params.id);
    res.status(200).json({ success: true, data: terms });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createTermsController = async (req: Request, res: Response) => {
  try {
    // Allow posting a structured JSON and transform it to title + HTML content
    const transformed = transformStructuredTermsPayload(req.body);
    const input = transformed ?? req.body;

    const createTermsDto = plainToClass(CreateTermsDto, input);
    const errors = await validate(createTermsDto);
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const createdBy = (req as any).user?.id;
    const terms = await createTerms(createTermsDto, createdBy);
    
    res.status(201).json({ 
      success: true, 
      message: 'Terms and Conditions created successfully', 
      data: terms 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateTermsController = async (req: Request, res: Response) => {
  try {
    // Accept structured JSON on update as well and transform
    const transformed = transformStructuredTermsPayload(req.body);
    const input = transformed ?? req.body;
    const updateTermsDto = plainToClass(UpdateTermsDto, input);
    const errors = await validate(updateTermsDto);
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const terms = await updateTerms(req.params.id, updateTermsDto);
    
    res.status(200).json({ 
      success: true, 
      message: 'Terms and Conditions updated successfully', 
      data: terms 
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ---------- helpers ----------

// Detects and transforms a structured terms document JSON into
// the shape expected by our DTOs: { title, content (HTML), language?, effectiveAt?, version? }
function transformStructuredTermsPayload(body: any): { title: string; content: string; language?: string; effectiveAt?: string; version?: string } | null {
  try {
    if (!body || typeof body !== 'object') return null;
    // Heuristic: if client sends appName or sections array, treat as structured
    const isStructured = !!(body.appName || body.sections || body.policyType || body.styling);
    if (!isStructured) return null;

    const appName: string = body.appName || 'App';
    const policyType: string = body.policyType || 'Terms and Conditions';
    const title = body.title || `${appName} - ${policyType}`;
  const language: string | undefined = body.language || undefined;
  const effectiveCandidate: string | undefined = body.effectiveDate || body.effectiveAt || undefined;
  const effectiveAt: string | undefined = normalizeIsoDateOrUndefined(effectiveCandidate);
    const version: string | undefined = body.version || undefined;

    const html = renderTermsHtmlFromStructured({
      appName,
      policyType,
      effectiveDate: effectiveAt,
      sections: Array.isArray(body.sections) ? body.sections : [],
      meta: body.meta,
      styling: body.styling,
    });

    return { title, content: html, language, effectiveAt, version };
  } catch {
    return null;
  }
}

function renderTermsHtmlFromStructured(doc: any): string {
  const theme = doc?.styling?.theme || {};
  const fonts = doc?.styling?.fonts || {};
  const colors = {
    primary: theme.primaryColor || '#007bff',
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
      <title>${escapeHtml(doc?.appName || 'App')} - ${escapeHtml(doc?.policyType || 'Terms and Conditions')}</title>
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
        <h1>${escapeHtml(doc?.appName || 'App')} - ${escapeHtml(doc?.policyType || 'Terms and Conditions')}</h1>
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

export const deleteTermsController = async (req: Request, res: Response) => {
  try {
    const result = await deleteTerms(req.params.id);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const activateTermsController = async (req: Request, res: Response) => {
  try {
    const terms = await activateTerms(req.params.id);
    res.status(200).json({ 
      success: true, 
      message: 'Terms and Conditions activated successfully', 
      data: terms 
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};