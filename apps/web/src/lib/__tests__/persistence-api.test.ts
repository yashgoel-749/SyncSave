import { GET } from "@/app/api/documents/[id]/persistence/route";
import { auth } from "@/auth";
import { verifyDocumentAccess } from "../document-service";
import { AuthorizationError, NotFoundError } from "../workspace-service";

jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("../document-service", () => ({ verifyDocumentAccess: jest.fn() }));

const session = auth as jest.Mock;
const access = verifyDocumentAccess as jest.Mock;
const get = () => GET(new Request("http://localhost/api/documents/test/persistence"), { params: Promise.resolve({ id: "test" }) });

describe("Authorized database readback", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    session.mockResolvedValue({ user: { id: "viewer" } });
  });

  it("returns exact persisted bytes using view permission and forbids caching", async () => {
    access.mockResolvedValue({ document: { yjsState: Buffer.from([0, 1, 2]) }, role: "VIEWER" });
    const response = await get();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2]));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(access).toHaveBeenCalledWith("test", "viewer", "VIEW");
  });

  it("does not claim persistence when no binary state exists", async () => {
    access.mockResolvedValue({ document: { yjsState: null } });
    expect((await get()).status).toBe(204);
  });

  it("requires authentication before checking access", async () => {
    session.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(access).not.toHaveBeenCalled();
  });

  it.each([[new AuthorizationError("Denied"), 403], [new NotFoundError("Missing"), 404]])("does not reveal unauthorized or missing state (%s)", async (error, status) => {
    access.mockRejectedValue(error);
    expect((await get()).status).toBe(status);
  });
});
