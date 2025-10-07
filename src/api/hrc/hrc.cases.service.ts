import prisma from '../../lib/prisma';
import { CasePriority, CaseStatus } from './hrc.dto';

// Minimal service layer encapsulating case logic. Uses (prisma as any) to avoid stale type issues.
const p: any = prisma as any;

function generateReferenceCode() {
  return 'CASE-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function createCase(params: {
  title: string;
  description: string;
  priority?: CasePriority;
  reporterVolunteerId: string; // HrcVolunteerProfile.id
  teamId?: string;
  assignedToVolunteerId?: string;
  locationStateId?: string;
  locationDistrictId?: string;
  locationMandalId?: string;
}) {
  const referenceCode = generateReferenceCode();
  const data: any = {
    referenceCode,
    title: params.title,
    description: params.description,
    priority: params.priority || 'MEDIUM',
    reporterId: params.reporterVolunteerId,
    teamId: params.teamId,
    assignedToId: params.assignedToVolunteerId,
    locationStateId: params.locationStateId,
    locationDistrictId: params.locationDistrictId,
    locationMandalId: params.locationMandalId
  };
  return p.hrcCase.create({ data });
}

export async function listCases(filters: {
  status?: CaseStatus;
  priority?: CasePriority;
  teamId?: string;
  reporterId?: string;
  assignedToId?: string;
  skip?: number;
  take?: number;
}) {
  return p.hrcCase.findMany({
    where: {
      status: filters.status,
      priority: filters.priority,
      teamId: filters.teamId,
      reporterId: filters.reporterId,
      assignedToId: filters.assignedToId
    },
    orderBy: { createdAt: 'desc' },
    skip: filters.skip || 0,
    take: filters.take || 25,
    select: {
      id: true,
      referenceCode: true,
      title: true,
      priority: true,
      status: true,
      teamId: true,
      assignedToId: true,
      reporterId: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

export async function getCaseById(id: string) {
  return p.hrcCase.findUnique({
    where: { id },
    include: {
      reporter: { select: { id: true, userId: true } },
      assignedTo: { select: { id: true, userId: true } },
      updates: { orderBy: { createdAt: 'asc' } },
      attachments: true
    }
  });
}

export async function addCaseUpdate(params: { caseId: string; authorVolunteerId?: string; note?: string; newStatus?: CaseStatus }) {
  const theCase = await p.hrcCase.findUnique({ where: { id: params.caseId } });
  if (!theCase) throw new Error('Case not found');
  const update = await p.hrcCaseUpdate.create({
    data: {
      caseId: params.caseId,
      authorId: params.authorVolunteerId,
      note: params.note,
      statusFrom: params.newStatus ? theCase.status : null,
      statusTo: params.newStatus || null
    }
  });
  if (params.newStatus && params.newStatus !== theCase.status) {
    await p.hrcCase.update({ where: { id: theCase.id }, data: { status: params.newStatus } });
  }
  return update;
}

export async function assignCase(params: { caseId: string; teamId?: string; assignedToVolunteerId?: string }) {
  const theCase = await p.hrcCase.findUnique({ where: { id: params.caseId } });
  if (!theCase) throw new Error('Case not found');
  return p.hrcCase.update({
    where: { id: params.caseId },
    data: {
      teamId: params.teamId ?? theCase.teamId,
      assignedToId: params.assignedToVolunteerId ?? theCase.assignedToId
    }
  });
}

export async function changeCaseStatus(params: { caseId: string; status: CaseStatus; note?: string; authorVolunteerId?: string }) {
  const theCase = await p.hrcCase.findUnique({ where: { id: params.caseId } });
  if (!theCase) throw new Error('Case not found');
  const update = await p.hrcCaseUpdate.create({
    data: {
      caseId: params.caseId,
      authorId: params.authorVolunteerId,
      note: params.note,
      statusFrom: theCase.status,
      statusTo: params.status
    }
  });
  await p.hrcCase.update({ where: { id: params.caseId }, data: { status: params.status, closedAt: ['RESOLVED','CLOSED','REJECTED'].includes(params.status) ? new Date() : null } });
  return update;
}

export async function addAttachment(params: { caseId: string; url: string; mimeType?: string; uploadedByVolunteerId?: string }) {
  return p.hrcCaseAttachment.create({
    data: {
      caseId: params.caseId,
      url: params.url,
      mimeType: params.mimeType,
      uploadedById: params.uploadedByVolunteerId
    }
  });
}
