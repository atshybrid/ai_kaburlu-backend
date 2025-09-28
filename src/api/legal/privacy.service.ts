import prisma from '../../lib/prisma';
import { CreatePrivacyDto, UpdatePrivacyDto } from './privacy.dto';

// Get active privacy policy (public access)
export async function getActivePrivacy(language: string = 'en') {
  return await prisma.privacyPolicy.findFirst({
    where: { 
      isActive: true,
      language 
    },
    orderBy: { effectiveAt: 'desc' }
  });
}

// Get all privacy policies (admin access)
export async function getAllPrivacy(language?: string) {
  const where: any = {};
  if (language) where.language = language;

  return await prisma.privacyPolicy.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

// Get privacy by ID
export async function getPrivacyById(id: string) {
  const privacy = await prisma.privacyPolicy.findUnique({
    where: { id }
  });
  
  if (!privacy) {
    throw new Error('Privacy Policy not found');
  }
  
  return privacy;
}

// Create new privacy policy
export async function createPrivacy(data: CreatePrivacyDto, createdBy?: string) {
  // If setting as active, deactivate all other policies for this language
  if (data.isActive) {
    await prisma.privacyPolicy.updateMany({
      where: { 
        language: data.language || 'en',
        isActive: true 
      },
      data: { isActive: false }
    });
  }

  return await prisma.privacyPolicy.create({
    data: {
      title: data.title,
      content: data.content,
      version: data.version || '1.0',
      isActive: data.isActive || false,
      language: data.language || 'en',
      effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : null,
      createdBy
    }
  });
}

// Update privacy policy
export async function updatePrivacy(id: string, data: UpdatePrivacyDto) {
  // Check if exists
  const existing = await prisma.privacyPolicy.findUnique({
    where: { id }
  });
  
  if (!existing) {
    throw new Error('Privacy Policy not found');
  }

  // If setting as active, deactivate all other policies for this language (use target language if provided, else existing)
  if (data.isActive) {
    const targetLanguage = data.language ?? existing.language;
    await prisma.privacyPolicy.updateMany({
      where: { 
        language: targetLanguage,
        isActive: true,
        id: { not: id }
      },
      data: { isActive: false }
    });
  }

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.version !== undefined) updateData.version = data.version;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.effectiveAt !== undefined) updateData.effectiveAt = data.effectiveAt ? new Date(data.effectiveAt) : null;
  // When activating and effectiveAt not supplied, set to now (mirrors activate endpoint)
  if (data.isActive && data.effectiveAt === undefined) {
    updateData.effectiveAt = new Date();
  }

  return await prisma.privacyPolicy.update({
    where: { id },
    data: updateData
  });
}

// Delete privacy policy
export async function deletePrivacy(id: string) {
  const existing = await prisma.privacyPolicy.findUnique({
    where: { id }
  });
  
  if (!existing) {
    throw new Error('Privacy Policy not found');
  }

  await prisma.privacyPolicy.delete({
    where: { id }
  });
  
  return { success: true, message: 'Privacy Policy deleted successfully' };
}

// Activate specific privacy policy version
export async function activatePrivacy(id: string) {
  const privacy = await getPrivacyById(id);
  
  // Deactivate all other policies for this language
  await prisma.privacyPolicy.updateMany({
    where: { 
      language: privacy.language,
      isActive: true 
    },
    data: { isActive: false }
  });

  // Activate this policy
  return await prisma.privacyPolicy.update({
    where: { id },
    data: { 
      isActive: true,
      effectiveAt: new Date()
    }
  });
}