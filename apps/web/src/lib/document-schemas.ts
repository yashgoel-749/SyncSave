import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required")
    .max(50, "Workspace name must be 50 characters or less"),
  description: z
    .string()
    .trim()
    .max(200, "Description must be 200 characters or less")
    .optional(),
});

export const addWorkspaceMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address"),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const createDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .max(100, "Title must be 100 characters or less")
    .optional(),
  workspaceId: z.string().trim().optional(),
  content: z.string().optional(),
});

export const updateDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(100, "Title must be 100 characters or less")
    .optional(),
  content: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  clientUpdatedAt: z.string().optional(),
});

export const documentQuerySchema = z.object({
  workspaceId: z.string().optional(),
  search: z.string().optional(),
  filter: z.enum(["all", "recent", "archived", "trash"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentQueryParams = z.infer<typeof documentQuerySchema>;
