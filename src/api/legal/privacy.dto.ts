import { IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class CreatePrivacyDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string; // HTML content

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}

export class UpdatePrivacyDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}