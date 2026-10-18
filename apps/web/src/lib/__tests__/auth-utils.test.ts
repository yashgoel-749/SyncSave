import {
  hashPassword,
  verifyPassword,
  registerSchema,
  loginSchema,
} from "../auth-utils";

describe("Password Hashing & Verification", () => {
  it("should securely hash a plaintext password with bcrypt", async () => {
    const password = "mySecurePassword123!";
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toEqual(password);
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("should return true when verifying the correct password against hash", async () => {
    const password = "correctPassword123!";
    const hash = await hashPassword(password);
    const isValid = await verifyPassword(password, hash);

    expect(isValid).toBe(true);
  });

  it("should return false when verifying an incorrect password against hash", async () => {
    const password = "correctPassword123!";
    const hash = await hashPassword(password);
    const isValid = await verifyPassword("wrongPassword123!", hash);

    expect(isValid).toBe(false);
  });
});

describe("Registration Schema Validation", () => {
  it("should accept valid registration input", () => {
    const input = {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "password123",
    };
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada@example.com");
      expect(result.data.name).toBe("Ada Lovelace");
    }
  });

  it("should accept registration without optional name", () => {
    const input = {
      email: "Ada.Lovelace@Example.Com",
      password: "password123",
    };
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada.lovelace@example.com");
    }
  });

  it("should reject invalid email format", () => {
    const input = {
      email: "not-an-email",
      password: "password123",
    };
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("should reject password with less than 8 characters", () => {
    const input = {
      email: "ada@example.com",
      password: "short",
    };
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues || (result.error as any).errors || [];
      expect(issues[0]?.message).toMatch(/at least 8 characters/);
    }
  });
});

describe("Login Schema Validation", () => {
  it("should accept valid login input and normalize email to lowercase", () => {
    const input = {
      email: "User@Domain.COM",
      password: "somePassword123",
    };
    const result = loginSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@domain.com");
    }
  });

  it("should reject empty password", () => {
    const input = {
      email: "user@domain.com",
      password: "",
    };
    const result = loginSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
