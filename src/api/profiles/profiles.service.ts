
import { PrismaClient } from '@prisma/client';
import { CreateProfileDto, UpdateProfileDto } from './profiles.dto';

const prisma = new PrismaClient();

function parseDate(dateString: string): Date | null {
  if (!dateString) return null;
  const parts = dateString.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!parts) return null;
  const isoDate = `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}T00:00:00.000Z`;
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? null : date;
}

export async function getProfileByUserId(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    include: {
      state: true,
      district: true,
      mandal: true,
      profilePhotoMedia: true,
    },
  });
  if (!profile) throw new Error('Profile not found for the specified user.');
  return profile;
}

export async function upsertProfile(userId: string, data: CreateProfileDto) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found.');
  
  const dob = data.dob ? parseDate(data.dob) : undefined;
  
  // Handle profile photo logic: if one is set, clear the other
  let profilePhotoUrl: string | null | undefined = data.profilePhotoUrl;
  let profilePhotoMediaId: string | null | undefined = data.profilePhotoMediaId;
  
  if (data.profilePhotoUrl && data.profilePhotoMediaId) {
    // If both provided, prioritize profilePhotoUrl and clear profilePhotoMediaId
    profilePhotoMediaId = null;
  } else if (data.profilePhotoUrl) {
    // If profilePhotoUrl is set, clear profilePhotoMediaId
    profilePhotoMediaId = null;
  } else if (data.profilePhotoMediaId) {
    // If profilePhotoMediaId is set, clear profilePhotoUrl
    profilePhotoUrl = null;
  }
  
  // Build update payload - replace all fields (complete update)
  const updatePayload: any = {
    fullName: data.fullName ?? null,
    gender: data.gender ?? null,
    dob: dob ?? null,
    maritalStatus: data.maritalStatus ?? null,
    bio: data.bio ?? null,
    profilePhotoUrl: profilePhotoUrl ?? null,
    profilePhotoMediaId: profilePhotoMediaId ?? null,
    emergencyContactNumber: data.emergencyContactNumber ?? null,
    address: data.address ?? null,
    stateId: data.stateId === '' ? null : (data.stateId ?? null),
    districtId: data.districtId === '' ? null : (data.districtId ?? null),
    mandalId: data.mandalId === '' ? null : (data.mandalId ?? null),
    assemblyId: data.assemblyId === '' ? null : (data.assemblyId ?? null),
    villageId: data.villageId === '' ? null : (data.villageId ?? null),
    occupation: data.occupation ?? null,
    education: data.education ?? null,
    socialLinks: data.socialLinks ?? null,
  };
  
  // Create payload for new profile creation
  const createPayload = {
    userId,
    fullName: data.fullName ?? null,
    gender: data.gender ?? null,
    dob: dob ?? null,
    maritalStatus: data.maritalStatus ?? null,
    bio: data.bio ?? null,
    profilePhotoUrl: profilePhotoUrl ?? null,
    profilePhotoMediaId: profilePhotoMediaId ?? null,
    emergencyContactNumber: data.emergencyContactNumber ?? null,
    address: data.address ?? null,
    stateId: (data.stateId === '' ? null : data.stateId) ?? null,
    districtId: (data.districtId === '' ? null : data.districtId) ?? null,
    mandalId: (data.mandalId === '' ? null : data.mandalId) ?? null,
    assemblyId: (data.assemblyId === '' ? null : data.assemblyId) ?? null,
    villageId: (data.villageId === '' ? null : data.villageId) ?? null,
    occupation: data.occupation ?? null,
    education: data.education ?? null,
    socialLinks: data.socialLinks ?? null,
  };
  
  return prisma.userProfile.upsert({
    where: { userId },
    update: updatePayload,
    create: createPayload,
    include: {
      state: true,
      district: true,
      mandal: true,
      profilePhotoMedia: true,
    },
  });
}

// Keep createProfile for backward compatibility
export async function createProfile(userId: string, data: CreateProfileDto) {
  return upsertProfile(userId, data);
}

export async function updateProfile(userId: string, data: UpdateProfileDto) {
  const dob = data.dob ? parseDate(data.dob) : undefined;
  
  // Handle profile photo logic: if one is set, clear the other
  let profilePhotoUrl: string | null | undefined = data.profilePhotoUrl;
  let profilePhotoMediaId: string | null | undefined = data.profilePhotoMediaId;
  
  if (data.profilePhotoUrl && data.profilePhotoMediaId) {
    // If both provided, prioritize profilePhotoUrl and clear profilePhotoMediaId
    profilePhotoMediaId = null;
  } else if (data.profilePhotoUrl) {
    // If profilePhotoUrl is set, clear profilePhotoMediaId
    profilePhotoMediaId = null;
  } else if (data.profilePhotoMediaId) {
    // If profilePhotoMediaId is set, clear profilePhotoUrl
    profilePhotoUrl = null;
  }
  
  // Build update payload - replace all fields (complete update)
  const updateData: any = {
    fullName: data.fullName ?? null,
    gender: data.gender ?? null,
    dob: dob ?? null,
    maritalStatus: data.maritalStatus ?? null,
    bio: data.bio ?? null,
    profilePhotoUrl: profilePhotoUrl ?? null,
    profilePhotoMediaId: profilePhotoMediaId ?? null,
    emergencyContactNumber: data.emergencyContactNumber ?? null,
    address: data.address ?? null,
    stateId: data.stateId === '' ? null : (data.stateId ?? null),
    districtId: data.districtId === '' ? null : (data.districtId ?? null),
    mandalId: data.mandalId === '' ? null : (data.mandalId ?? null),
    assemblyId: data.assemblyId === '' ? null : (data.assemblyId ?? null),
    villageId: data.villageId === '' ? null : (data.villageId ?? null),
    occupation: data.occupation ?? null,
    education: data.education ?? null,
    socialLinks: data.socialLinks ?? null,
  };
  
  try {
    return await prisma.userProfile.update({
      where: { userId },
      data: updateData,
      include: {
        state: true,
        district: true,
        mandal: true,
        profilePhotoMedia: true,
      },
    });
  } catch (error) {
    throw new Error('Profile not found for the specified user.');
  }
}

export async function deleteProfile(userId: string) {
  try {
    await prisma.userProfile.delete({ where: { userId } });
    return { success: true };
  } catch (e) {
    throw new Error('Profile not found for the specified user.');
  }
}

export async function listProfiles(page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [items, total] = await Promise.all([
    prisma.userProfile.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { state: true, district: true, mandal: true, profilePhotoMedia: true },
    }),
    prisma.userProfile.count(),
  ]);
  const totalPages = Math.ceil(total / pageSize) || 1;
  return { items, total, page, pageSize, totalPages };
}
