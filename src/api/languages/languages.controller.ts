
import { Request, Response } from 'express';
import { getLanguages, createLanguage } from './languages.service';
import { withTimeout } from '../../lib/promiseTimeout';
import { CreateLanguageDto } from './languages.dto';
import { validate } from 'class-validator';

export const getLanguagesController = async (req: Request, res: Response) => {
  try {
    // Guard against long DB stalls in PaaS: respond 503 quickly on DB timeout
    const timeoutMs = Number(process.env.API_DB_TIMEOUT_MS || 3000);
    const languages = await withTimeout(getLanguages(), timeoutMs, 'getLanguages');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min client cache
    res.status(200).json({ success: true, data: languages });
  } catch (error) {
    const msg = (error as any)?.message || 'Internal server error';
    const isTimeout = msg.includes('timeout');
    res.status(isTimeout ? 503 : 500).json({ success: false, message: isTimeout ? 'Service temporarily unavailable (DB timeout)' : 'Internal server error' });
  }
};

export const createLanguageController = async (req: Request, res: Response) => {
  try {
    const createLanguageDto = new CreateLanguageDto(req.body.name, req.body.code);

    const errors = await validate(createLanguageDto);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const language = await createLanguage(createLanguageDto);
    res.status(201).json({ success: true, message: 'Language created successfully', data: language });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
