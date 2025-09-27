
import prisma from '../../lib/prisma';
import { CreateCommentDto, UpdateCommentDto } from './comments.dto';

type RepliesInclude = {
  include: {
    user: { 
      select: { 
        id: true,
        profile: {
          select: {
            fullName: true,
            profilePhotoUrl: true
          }
        }
      } 
    },
    replies?: RepliesInclude | boolean;
  };
  orderBy: { createdAt: 'asc' };
} | boolean;

const recursiveReplies = (depth = 5): RepliesInclude => {
  if (depth === 0) return false;
  return {
    include: {
      user: { 
        select: { 
          id: true,
          profile: {
            select: {
              fullName: true,
              profilePhotoUrl: true
            }
          }
        } 
      },
      replies: recursiveReplies(depth - 1)
    },
    orderBy: { createdAt: 'asc' }
  };
};

export const createComment = async (commentDto: CreateCommentDto) => {
  const { content, userId, articleId, shortNewsId, parentId } = commentDto;

  // If replying, ensure parent exists and belongs to same target
  if (parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parentId } });
    if (!parent) throw new Error('Parent comment not found');
    if (articleId && parent.articleId !== articleId) {
      throw new Error('Parent comment belongs to different article');
    }
    if (shortNewsId && (parent as any).shortNewsId !== shortNewsId) {
      throw new Error('Parent comment belongs to different short news');
    }
  } else {
    // Direct comment (parentId = null): Check if user already has a direct comment
    if (shortNewsId) {
      const existingDirectComment = await prisma.comment.findFirst({
        where: {
          userId,
          shortNewsId,
          parentId: null // Direct comment only
        }
      });
      
      if (existingDirectComment) {
        throw new Error('You have already posted a direct comment on this short news. You can only reply to existing comments.');
      }
    }
    
    if (articleId) {
      const existingDirectComment = await prisma.comment.findFirst({
        where: {
          userId,
          articleId,
          parentId: null // Direct comment only
        }
      });
      
      if (existingDirectComment) {
        throw new Error('You have already posted a direct comment on this article. You can only reply to existing comments.');
      }
    }
  }

  const data: any = { content, userId };
  if (articleId) data.articleId = articleId;
  if (shortNewsId) data.shortNewsId = shortNewsId;
  if (parentId) data.parentId = parentId;

  return prisma.comment.create({ 
    data,
    include: {
      user: { 
        select: { 
          id: true,
          profile: {
            select: {
              fullName: true,
              profilePhotoUrl: true
            }
          }
        } 
      }
    }
  });
};

export interface GetCommentsParams {
  articleId?: string;
  shortNewsId?: string;
  depth?: number;
}

export const getComments = async ({ articleId, shortNewsId, depth = 5 }: GetCommentsParams) => {
  const where: any = {};
  if (articleId) where.articleId = articleId;
  if (shortNewsId) where.shortNewsId = shortNewsId;

  const comments = await prisma.comment.findMany({
    where,
    include: {
      user: { 
        select: { 
          id: true,
          profile: {
            select: {
              fullName: true,
              profilePhotoUrl: true
            }
          }
        } 
      },
      replies: recursiveReplies(depth)
    },
    orderBy: { createdAt: 'desc' }
  });
  return comments.filter(c => !c.parentId);
};

export const updateComment = async (id: string, commentDto: UpdateCommentDto) => {
  return prisma.comment.update({
    where: { id },
    data: { content: commentDto.content }
  });
};

export const deleteComment = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    await tx.comment.deleteMany({ where: { parentId: id } });
    return tx.comment.delete({ where: { id } });
  });
};
