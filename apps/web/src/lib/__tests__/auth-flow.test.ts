import { authConfig } from "@/auth.config";
import { loginSchema, verifyPassword, hashPassword } from "@/lib/auth-utils";

jest.setTimeout(15000);

describe("Credentials Authentication Logic", () => {
  it("should validate and authorize valid credentials", async () => {
    const rawPassword = "myStrongPassword2026!";
    const passwordHash = await hashPassword(rawPassword);

    const mockUser = {
      id: "usr_123",
      email: "test@syncspace.dev",
      name: "Sync User",
      image: null,
      passwordHash,
    };

    const parsed = loginSchema.safeParse({
      email: "test@syncspace.dev",
      password: rawPassword,
    });
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const isValid = await verifyPassword(parsed.data.password, mockUser.passwordHash);
      expect(isValid).toBe(true);
    }
  });

  it("should reject invalid password for existing user", async () => {
    const rawPassword = "myStrongPassword2026!";
    const passwordHash = await hashPassword(rawPassword);

    const isValid = await verifyPassword("wrongPasswordGuess", passwordHash);
    expect(isValid).toBe(false);
  });
});

describe("Auth.js Session & Token Callbacks", () => {
  it("should populate token fields in jwt callback", () => {
    const jwtCallback = authConfig.callbacks?.jwt;
    expect(jwtCallback).toBeDefined();

    if (jwtCallback) {
      const token = {};
      const user = {
        id: "usr_abc",
        email: "alice@example.com",
        name: "Alice",
        image: "https://avatar.example.com/alice.png",
      };

      const resultToken = jwtCallback({
        token,
        user: user as any,
        account: null as any,
        profile: undefined,
        trigger: "signIn",
        isNewUser: false,
        session: undefined,
      });

      expect(resultToken).toMatchObject({
        id: "usr_abc",
        email: "alice@example.com",
        name: "Alice",
        picture: "https://avatar.example.com/alice.png",
      });
    }
  });

  it("should populate session.user from token in session callback", async () => {
    const sessionCallback = authConfig.callbacks?.session;
    expect(sessionCallback).toBeDefined();

    if (sessionCallback) {
      const session = {
        user: {
          id: "",
          email: "",
          emailVerified: null,
        },
        expires: new Date(Date.now() + 3600000).toISOString(),
      };

      const token = {
        id: "usr_abc",
        email: "alice@example.com",
        name: "Alice",
        picture: "https://avatar.example.com/alice.png",
      };

      const resultSession = (await sessionCallback({
        session: session as any,
        token: token as any,
        user: {} as any,
        newSession: null,
        trigger: "update",
      })) as any;

      expect(resultSession.user.id).toBe("usr_abc");
      expect(resultSession.user.email).toBe("alice@example.com");
      expect(resultSession.user.name).toBe("Alice");
      expect(resultSession.user.image).toBe("https://avatar.example.com/alice.png");
    }
  });
});

describe("Route Protection & Unauthorized Access Enforcement", () => {
  const authorizedCallback = authConfig.callbacks?.authorized;

  it("should deny access to protected route (/dashboard) when unauthenticated", () => {
    expect(authorizedCallback).toBeDefined();
    if (!authorizedCallback) return;

    const req = {
      nextUrl: new URL("http://localhost:3000/dashboard"),
    };

    const isAuthorized = authorizedCallback({
      auth: null,
      request: req as any,
    });

    expect(isAuthorized).toBe(false);
  });

  it("should allow access to protected route (/dashboard) when authenticated", () => {
    if (!authorizedCallback) return;

    const req = {
      nextUrl: new URL("http://localhost:3000/dashboard"),
    };

    const mockSession = {
      user: { id: "usr_123", email: "user@syncspace.dev" },
      expires: "2099-01-01",
    };

    const isAuthorized = authorizedCallback({
      auth: mockSession as any,
      request: req as any,
    });

    expect(isAuthorized).toBe(true);
  });

  it("should redirect logged-in user away from /login to /dashboard", () => {
    if (!authorizedCallback) return;

    const req = {
      nextUrl: new URL("http://localhost:3000/login"),
    };

    const mockSession = {
      user: { id: "usr_123", email: "user@syncspace.dev" },
      expires: "2099-01-01",
    };

    const response = authorizedCallback({
      auth: mockSession as any,
      request: req as any,
    });

    // When logged in, it redirects via Response.redirect
    expect(response).toBeInstanceOf(Response);
    if (response instanceof Response) {
      expect([302, 307]).toContain(response.status);
      expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
    }
  });

  it("should allow unauthenticated visitor to view public landing page", () => {
    if (!authorizedCallback) return;

    const req = {
      nextUrl: new URL("http://localhost:3000/"),
    };

    const isAuthorized = authorizedCallback({
      auth: null,
      request: req as any,
    });

    expect(isAuthorized).toBe(true);
  });
});
