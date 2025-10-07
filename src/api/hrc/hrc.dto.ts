import { IsString, IsOptional, IsEnum, IsArray, ArrayNotEmpty, IsInt, Min, IsIn } from 'class-validator';

// Prisma enums are not imported directly (codegen naming may differ in runtime build). Use string unions for DTO validation.
export const TeamScopeLevelValues = ['GLOBAL','COUNTRY','STATE','DISTRICT','MANDAL'] as const;
export type TeamScopeLevel = typeof TeamScopeLevelValues[number];

export const PaymentPurposeValues = ['ID_CARD_ISSUE','ID_CARD_RENEW','DONATION','OTHER'] as const;
export type PaymentPurpose = typeof PaymentPurposeValues[number];

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
