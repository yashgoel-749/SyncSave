import { GET as getDocs, POST as createDoc } from "@/app/api/documents/route";
import {
  GET as getDocById,
  PATCH as patchDocById,
  DELETE as deleteDocById,
} from "@/app/api/documents/[id]/route";
import { POST as restoreDocById } from "@/app/api/documents/[id]/restore/route";
import { GET as getWorkspaces, POST as createWs } from "@/app/api/workspaces/route";
import { auth } from "@/auth";
import * as docService from "@/lib/document-service";
import * as wsService from "@/lib/workspace-service";

jest.mock("@/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/document-service", () => ({
  listDocuments: jest.fn(),
  createDocument: jest.fn(),
  getDocument: jest.fn(),
  updateDocument: jest.fn(),
  softDeleteDocument: jest.fn(),
  permanentDeleteDocument: jest.fn(),
  restoreDocument: jest.fn(),
}));

jest.mock("@/lib/workspace-service", () => {
  const actual = jest.requireActual("@/lib/workspace-service");
  return {
    ...actual,
    getUserWorkspaces: jest.fn(),
    createWorkspace: jest.fn(),
    getWorkspace: jest.fn(),
  };
});

describe("Document & Workspace API Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/documents", () => {
    it("should return 401 when user is not authenticated", async () => {
      (auth as jest.Mock).mockResolvedValueOnce(null);

      const req = new Request("http://localhost:3000/api/documents");
      const res = await getDocs(req);

      expect(res.status).toBe(401);
    });

    it("should return 200 with document list when authenticated", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({
        user: { id: "usr_1" },
      });
      (docService.listDocuments as jest.Mock).mockResolvedValueOnce({
        documents: [{ id: "doc_1", title: "Doc 1" }],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });

      const req = new Request("http://localhost:3000/api/documents?page=1&filter=all");
      const res = await getDocs(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.documents.length).toBe(1);
    });
  });

  describe("POST /api/documents", () => {
    it("should return 401 when not authenticated", async () => {
      (auth as jest.Mock).mockResolvedValueOnce(null);

      const req = new Request("http://localhost:3000/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Doc" }),
      });
      const res = await createDoc(req);
      expect(res.status).toBe(401);
    });

    it("should return 201 with created document when input is valid", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({
        user: { id: "usr_1" },
      });
      (docService.createDocument as jest.Mock).mockResolvedValueOnce({
        id: "doc_new",
        title: "Project Outline",
        ownerId: "usr_1",
      });

      const req = new Request("http://localhost:3000/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Project Outline" }),
      });
      const res = await createDoc(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.document.title).toBe("Project Outline");
    });
  });

  describe("GET /api/documents/[id]", () => {
    it("should return 403 when access is forbidden", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_intruder" } });
      (docService.getDocument as jest.Mock).mockRejectedValueOnce(
        new wsService.AuthorizationError("Forbidden")
      );

      const req = new Request("http://localhost:3000/api/documents/doc_secret");
      const res = await getDocById(req, { params: Promise.resolve({ id: "doc_secret" }) });

      expect(res.status).toBe(403);
    });

    it("should return 200 with document when authorized", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_owner" } });
      (docService.getDocument as jest.Mock).mockResolvedValueOnce({
        id: "doc_ok",
        title: "My Notes",
        userRole: "OWNER",
      });

      const req = new Request("http://localhost:3000/api/documents/doc_ok");
      const res = await getDocById(req, { params: Promise.resolve({ id: "doc_ok" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.document.title).toBe("My Notes");
    });
  });

  describe("PATCH /api/documents/[id]", () => {
    it("should update document title and return 200", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_owner" } });
      (docService.updateDocument as jest.Mock).mockResolvedValueOnce({
        id: "doc_1",
        title: "Renamed Title",
      });

      const req = new Request("http://localhost:3000/api/documents/doc_1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed Title" }),
      });
      const res = await patchDocById(req, { params: Promise.resolve({ id: "doc_1" }) });

      expect(res.status).toBe(200);
      expect(docService.updateDocument).toHaveBeenCalledWith(
        "doc_1",
        "usr_owner",
        { title: "Renamed Title" }
      );
    });
  });

  describe("DELETE /api/documents/[id]", () => {
    it("should soft delete document by default", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_owner" } });

      const req = new Request("http://localhost:3000/api/documents/doc_1", {
        method: "DELETE",
      });
      const res = await deleteDocById(req, { params: Promise.resolve({ id: "doc_1" }) });

      expect(res.status).toBe(200);
      expect(docService.softDeleteDocument).toHaveBeenCalledWith("doc_1", "usr_owner");
    });

    it("should permanently delete when permanent=true query parameter is present", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_owner" } });

      const req = new Request("http://localhost:3000/api/documents/doc_1?permanent=true", {
        method: "DELETE",
      });
      const res = await deleteDocById(req, { params: Promise.resolve({ id: "doc_1" }) });

      expect(res.status).toBe(200);
      expect(docService.permanentDeleteDocument).toHaveBeenCalledWith("doc_1", "usr_owner");
    });
  });

  describe("POST /api/documents/[id]/restore", () => {
    it("should restore soft-deleted document", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_owner" } });

      const req = new Request("http://localhost:3000/api/documents/doc_1/restore", {
        method: "POST",
      });
      const res = await restoreDocById(req, { params: Promise.resolve({ id: "doc_1" }) });

      expect(res.status).toBe(200);
      expect(docService.restoreDocument).toHaveBeenCalledWith("doc_1", "usr_owner");
    });
  });

  describe("/api/workspaces routes", () => {
    it("should list workspaces for authenticated user", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_1" } });
      (wsService.getUserWorkspaces as jest.Mock).mockResolvedValueOnce([
        { id: "ws_1", name: "Workspace 1" },
      ]);

      const res = await getWorkspaces();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.workspaces.length).toBe(1);
    });

    it("should create new workspace when valid", async () => {
      (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "usr_1" } });
      (wsService.createWorkspace as jest.Mock).mockResolvedValueOnce({
        id: "ws_created",
        name: "New WS",
      });

      const req = new Request("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New WS" }),
      });
      const res = await createWs(req);

      expect(res.status).toBe(201);
      expect(wsService.createWorkspace).toHaveBeenCalledWith("usr_1", {
        name: "New WS",
      });
    });
  });
});
