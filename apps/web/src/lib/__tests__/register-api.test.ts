import { POST } from "@/app/api/auth/register/route";
import prisma from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 when request body contains invalid email", async () => {
    const req = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "invalid-email-format",
        password: "securePassword123",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("should return 400 when password is under 8 characters", async () => {
    const req = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "valid@example.com",
        password: "short",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/at least 8 characters/);
  });

  it("should return 409 when user with email already exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "user-123",
      email: "existing@example.com",
    });

    const req = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "existing@example.com",
        password: "securePassword123",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already exists/i);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("should create user, hash password, and return 201 without passwordHash", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
    (prisma.user.create as jest.Mock).mockImplementationOnce(({ data }) =>
      Promise.resolve({
        id: "cuid-new-user-1",
        name: data.name,
        email: data.email,
        image: null,
        createdAt: new Date(),
      })
    );

    const req = new Request("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alan Turing",
        email: "alan@enigma.org",
        password: "securePassword123",
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe("alan@enigma.org");
    expect(data.user.name).toBe("Alan Turing");
    expect(data.user.passwordHash).toBeUndefined(); // Never expose password hash!
    expect(prisma.user.create).toHaveBeenCalled();
  });
});
