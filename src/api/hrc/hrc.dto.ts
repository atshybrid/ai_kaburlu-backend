import { IsString, IsOptional, IsEnum, IsArray, ArrayNotEmpty, IsInt, Min, IsIn, IsUUID } from 'class-validator';

// Prisma enums are not imported directly (codegen naming may differ in runtime build). Use string unions for DTO validation.
export const TeamScopeLevelValues = ['GLOBAL','COUNTRY','STATE','DISTRICT','MANDAL'] as const;
export type TeamScopeLevel = typeof TeamScopeLevelValues[number];

export const PaymentPurposeValues = ['ID_CARD_ISSUE','ID_CARD_RENEW','DONATION','OTHER'] as const;
export type PaymentPurpose = typeof PaymentPurposeValues[number];

// Case enums (mirror Prisma enums with string literals for DTO layer)
export const CaseStatusValues = ['NEW','UNDER_REVIEW','IN_PROGRESS','ESCALATED','RESOLVED','CLOSED','REJECTED'] as const;
export type CaseStatus = typeof CaseStatusValues[number];
export const CasePriorityValues = ['LOW','MEDIUM','HIGH','URGENT'] as const;
export type CasePriority = typeof CasePriorityValues[number];

// Teams
export class CreateHrcTeamDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(TeamScopeLevelValues)
  scopeLevel!: TeamScopeLevel;

  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() stateId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() mandalId?: string;
}

// Volunteer onboarding
export const VolunteerHierarchyLevelValues = ['NHRC','SHRC','DISTRICT','MANDAL','VILLAGE'] as const;
export type VolunteerHierarchyLevel = typeof VolunteerHierarchyLevelValues[number];

export class VolunteerOnboardDto {
  // If omitted we'll derive from auth user
  @IsOptional() @IsString() userId?: string;

  // Initial team memberships
  @IsOptional() @IsArray() @ArrayNotEmpty() teamIds?: string[];

  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() aadhaarNumber?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() pincode?: string;
}

export class VolunteerOnboardDtoExtended {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() teamIds?: string[];
  @IsOptional() @IsString() bio?: string;
  @IsOptional() @IsString() aadhaarNumber?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() pincode?: string;
  // Hierarchy additions
  @IsOptional() @IsIn(VolunteerHierarchyLevelValues) hierarchyLevel?: VolunteerHierarchyLevel;
  @IsOptional() @IsString() countryCode?: string; // required when hierarchyLevel provided
  @IsOptional() @IsString() stateId?: string;     // required for SHRC and below
  @IsOptional() @IsString() districtId?: string;  // required for DISTRICT and below
  @IsOptional() @IsString() mandalId?: string;    // required for MANDAL and VILLAGE
  @IsOptional() @IsString() villageName?: string; // only for VILLAGE (no dedicated model yet)
}

// Payment order (for ID card or donation)
export class PaymentOrderRequestDto {
  @IsIn(PaymentPurposeValues)
  purpose!: PaymentPurpose;

  // For ID card: optionally specify team or location to resolve fee
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() mandalId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() stateId?: string;

  // For donation override (if purpose = DONATION)
  @IsOptional() @IsInt() @Min(1) amountMinorOverride?: number;
  @IsOptional() @IsString() currency?: string; // default INR
}

// ID card issuance after payment success
export class IdCardIssueDto {
  @IsString()
  paymentTransactionId!: string; // internal txn reference

  @IsOptional() @IsString() providerPaymentId?: string; // Razorpay payment id
  @IsOptional() @IsString() providerSignature?: string; // Razorpay signature

  @IsOptional() @IsInt() @Min(1) renewalIntervalMonths?: number; // override if needed
}

// Fee resolution direct test helper
export class FeeResolutionQueryDto {
  @IsIn(PaymentPurposeValues)
  purpose!: PaymentPurpose;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() mandalId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() stateId?: string;
}

// ---------------------------
// CASE MANAGEMENT DTOs
// ---------------------------
export class CreateCaseDto {
  @IsString() title!: string;
  @IsString() description!: string;
  @IsOptional() @IsIn(CasePriorityValues) priority?: CasePriority;
  // optional initial assignment
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() assignedToVolunteerId?: string;
  // optional geo scope
  @IsOptional() @IsString() locationStateId?: string;
  @IsOptional() @IsString() locationDistrictId?: string;
  @IsOptional() @IsString() locationMandalId?: string;
}

export class ListCasesQueryDto {
  @IsOptional() @IsIn(CaseStatusValues) status?: CaseStatus;
  @IsOptional() @IsIn(CasePriorityValues) priority?: CasePriority;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() reporterId?: string;
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @IsInt() @Min(0) skip?: number;
  @IsOptional() @IsInt() @Min(1) take?: number;
}

export class CaseUpdateDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsIn(CaseStatusValues) newStatus?: CaseStatus;
}

export class CaseAssignDto {
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() assignedToVolunteerId?: string;
}

export class CaseStatusChangeDto {
  @IsIn(CaseStatusValues) status!: CaseStatus;
  @IsOptional() @IsString() note?: string;
}

export class CaseAttachmentDto {
  @IsString() url!: string;
  @IsOptional() @IsString() mimeType?: string;
}
