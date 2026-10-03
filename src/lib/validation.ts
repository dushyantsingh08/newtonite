import { z } from 'zod';
import { WorkItemStatus, WorkItemPriority } from '@/types';

export const createWorkItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().min(1, 'Description is required'),
  teamId: z.string().cuid(),
  priority: z.nativeEnum(WorkItemPriority),
  dueAt: z.string().datetime().nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

export const updateWorkItemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  priority: z.nativeEnum(WorkItemPriority).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  expectedVersion: z.number().int().positive(),
});

export const transitionSchema = z.object({
  to: z.nativeEnum(WorkItemStatus),
  expectedVersion: z.number().int().positive(),
});

export const claimSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

export const commentSchema = z.object({
  text: z.string().min(1, 'Comment text is required'),
});

export const approveSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
