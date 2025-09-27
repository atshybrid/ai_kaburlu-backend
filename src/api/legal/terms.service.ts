import prisma from '../../lib/prisma';
import { CreateTermsDto, UpdateTermsDto } from './terms.dto';

// Get active terms and conditions (public access)
export async function getActiveTerms(language: string = 'en') {
  return await prisma.termsAndConditions.findFirst({
    where: { 
      isActive: true,
      language 
    },
    orderBy: { effectiveAt: 'desc' }
  });
}

// Get all terms and conditions (admin access)
export async function getAllTerms(language?: string) {
  const where: any = {};
  if (language) where.language = language;

  return await prisma.termsAndConditions.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

// Get terms by ID
export async function getTermsById(id: string) {
  const terms = await prisma.termsAndConditions.findUnique({
    where: { id }
  });
  
  if (!terms) {
    throw new Error('Terms and Conditions not found');
  }
  
  return terms;
}

// Create new terms and conditions
export async function createTerms(data: CreateTermsDto, createdBy?: string) {
  // If setting as active, deactivate all other terms for this language
  if (data.isActive) {
    await prisma.termsAndConditions.updateMany({
      where: { 
        language: data.language || 'en',
        isActive: true 
      },
      data: { isActive: false }
    });
  }

  return await prisma.termsAndConditions.create({
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

// Update terms and conditions
export async function updateTerms(id: string, data: UpdateTermsDto) {
  // Check if exists
  const existing = await prisma.termsAndConditions.findUnique({
    where: { id }
  });
  
  if (!existing) {
    throw new Error('Terms and Conditions not found');
  }

  // If setting as active, deactivate all other terms for this language
  if (data.isActive) {
    await prisma.termsAndConditions.updateMany({
      where: { 
        language: existing.language,
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

  return await prisma.termsAndConditions.update({
    where: { id },
    data: updateData
  });
}

// Delete terms and conditions
export async function deleteTerms(id: string) {
  const existing = await prisma.termsAndConditions.findUnique({
    where: { id }
  });
  
  if (!existing) {
    throw new Error('Terms and Conditions not found');
  }

  await prisma.termsAndConditions.delete({
    where: { id }
  });
  
  return { success: true, message: 'Terms and Conditions deleted successfully' };
}

// Activate specific terms version
export async function activateTerms(id: string) {
  const terms = await getTermsById(id);
  
  // Deactivate all other terms for this language
  await prisma.termsAndConditions.updateMany({
    where: { 
      language: terms.language,
      isActive: true 
    },
    data: { isActive: false }
  });

  // Activate this terms
  return await prisma.termsAndConditions.update({
    where: { id },
    data: { 
      isActive: true,
      effectiveAt: new Date()
    }
  });
}