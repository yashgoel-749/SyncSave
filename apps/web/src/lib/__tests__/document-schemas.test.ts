import {
  createWorkspaceSchema,
  addWorkspaceMemberSchema,
  createDocumentSchema,
  updateDocumentSchema,
  documentQuerySchema,
} from "../document-schemas";

describe("Document & Workspace Schemas Validation", () => {
  describe("createWorkspaceSchema", () => {
    it("should accept valid workspace name and description", () => {
      const result = createWorkspaceSchema.safeParse({
        name: "Engineering Team",
        description: "Primary engineering workspace",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty workspace name", () => {
      const result = createWorkspaceSchema.safeParse({
        name: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("should reject workspace name exceeding 50 characters", () => {
      const result = createWorkspaceSchema.safeParse({
        name: "A".repeat(51),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("addWorkspaceMemberSchema", () => {
    it("should accept valid email and default role to MEMBER", () => {
      const result = addWorkspaceMemberSchema.safeParse({
        email: "colleague@syncspace.dev",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe("MEMBER");
        expect(result.data.email).toBe("colleague@syncspace.dev");
      }
    });

    it("should accept valid ADMIN role", () => {
      const result = addWorkspaceMemberSchema.safeParse({
        email: "admin@syncspace.dev",
        role: "ADMIN",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe("ADMIN");
      }
    });

    it("should reject invalid email", () => {
      const result = addWorkspaceMemberSchema.safeParse({
        email: "not-an-email",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createDocumentSchema", () => {
    it("should accept valid document title and workspaceId", () => {
      const result = createDocumentSchema.safeParse({
        title: "Q4 Roadmap",
        workspaceId: "ws_12345",
      });
      expect(result.success).toBe(true);
    });

    it("should allow creating document with empty input (defaults applied in service)", () => {
      const result = createDocumentSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject title exceeding 100 characters", () => {
      const result = createDocumentSchema.safeParse({
        title: "T".repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateDocumentSchema", () => {
    it("should accept valid title update", () => {
      const result = updateDocumentSchema.safeParse({
        title: "Updated Title",
      });
      expect(result.success).toBe(true);
    });

    it("should accept archive flag update", () => {
      const result = updateDocumentSchema.safeParse({
        isArchived: true,
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty title string", () => {
      const result = updateDocumentSchema.safeParse({
        title: "  ",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("documentQuerySchema", () => {
    it("should parse and coerce query params with defaults", () => {
      const result = documentQuerySchema.safeParse({
        page: "2",
        limit: "15",
        filter: "recent",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(15);
        expect(result.data.filter).toBe("recent");
      }
    });

    it("should reject invalid filter type", () => {
      const result = documentQuerySchema.safeParse({
        filter: "unknown_filter",
      });
      expect(result.success).toBe(false);
    });
  });
});
