
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCommentDto {
  @IsNotEmpty()
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  userId?: string; // Set automatically from JWT token

  // Polymorphic target (exactly one required at runtime)
  @IsOptional()
  @IsString()
  articleId?: string;

  @IsOptional()
  @IsString()
  shortNewsId?: string;

  @IsOptional()
  @IsString()
  parentId?: string; // For nested comments/replies
}

export class UpdateCommentDto {
  @IsOptional()
  @IsString()
  content?: string;
}

export function validatePolymorphicTarget(dto: CreateCommentDto) {
  const hasArticle = !!dto.articleId;
  const hasShort = !!dto.shortNewsId;
  if ((hasArticle && hasShort) || (!hasArticle && !hasShort)) {
    return 'Exactly one of articleId or shortNewsId must be provided';
  }
  return null;
}
