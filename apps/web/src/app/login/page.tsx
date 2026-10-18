"use client";

import React, { useState, useTransition, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    urlError === "CredentialsSignin"
      ? "Invalid email or password. Please check your credentials."
      : urlError
      ? "Authentication failed. Please try again."
      : null
  );
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [isPending, startTransition] = useTransition();
  const [isGitHubPending, setIsGitHubPending] = useState(false);

  const validate = () => {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errors.email = "Email address is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Please enter a valid email address";
    }

    if (!password) {
      errors.password = "Password is required";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!validate()) return;

    startTransition(async () => {
      try {
        const result = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
          callbackUrl,
        });

        if (result?.error) {
          setErrorMessage("Invalid email or password. Please verify your credentials.");
        } else {
          router.push(callbackUrl);
          router.refresh();
        }
      } catch {
        setErrorMessage("An unexpected network error occurred. Please try again.");
      }
    });
  };

  const handleGitHubSignIn = async () => {
    setIsGitHubPending(true);
    setErrorMessage(null);
    try {
      await signIn("github", { callbackUrl });
    } catch {
      setErrorMessage("Could not connect to GitHub. Please try again or use email sign-in.");
      setIsGitHubPending(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Brand Header */}
      <div className="text-center mb-8">
        <div className="inline-flex justify-center mb-3">
          <Logo size="md" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in to access your offline-first collaborative workspace
        </p>
      </div>

      {/* Card */}
      <div className="card p-6 sm:p-8 backdrop-blur-xl border border-border-subtle bg-bg-card/70 shadow-2xl relative">
        {/* Glow accent */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-primary/10 rounded-full blur-3xl pointer-events-none" />

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-6 p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3 animate-in fade-in duration-200"
          >
            <svg
              className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="flex-1 text-xs leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-wider text-text-secondary mb-1.5"
            >
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              disabled={isPending || isGitHubPending}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              placeholder="you@example.com"
              className={`w-full px-3.5 py-2.5 rounded-lg bg-bg-surface/80 border text-sm text-text-primary placeholder:text-text-muted focus:outline-none transition-colors ${
                fieldErrors.email
                  ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  : "border-border-subtle focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              }`}
            />
            {fieldErrors.email && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-text-secondary"
              >
                Password
              </label>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                disabled={isPending || isGitHubPending}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                placeholder="••••••••"
                className={`w-full px-3.5 py-2.5 rounded-lg bg-bg-surface/80 border text-sm text-text-primary placeholder:text-text-muted focus:outline-none transition-colors pr-10 ${
                  fieldErrors.password
                    ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    : "border-border-subtle focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary p-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1.5 text-xs text-red-400">{fieldErrors.password}</p>
            )}
          </div>

          <button
            type="submit"
            id="login-submit-btn"
            disabled={isPending || isGitHubPending}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-primary hover:bg-brand-secondary text-white font-medium text-sm transition-all duration-200 shadow-md shadow-brand-primary/20 hover:shadow-brand-primary/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isPending ? (
              <>
                <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Signing in...</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border-subtle" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-bg-card px-2 text-text-muted">Or continue with</span>
          </div>
        </div>

        {/* GitHub OAuth Button */}
        <button
          type="button"
          id="github-login-btn"
          onClick={handleGitHubSignIn}
          disabled={isPending || isGitHubPending}
          className="w-full py-2.5 px-4 rounded-lg bg-bg-surface/90 hover:bg-bg-surface border border-border-subtle hover:border-border-strong text-text-primary text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isGitHubPending ? (
            <svg className="animate-spin w-4 h-4 text-text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          )}
          <span>Continue with GitHub</span>
        </button>

        {/* Footer Note */}
        <p className="mt-6 text-center text-xs text-text-muted">
          Don&apos;t have an account?{" "}
          <Link
            href={`/register${callbackUrl !== "/dashboard" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
            className="text-brand-secondary hover:text-brand-primary font-medium hover:underline transition-colors"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-16 bg-bg-dark relative overflow-hidden">
      {/* Background radial gradient */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-primary/5 rounded-full blur-[140px] pointer-events-none" />
      <Suspense
        fallback={
          <div className="w-full max-w-md mx-auto h-96 card flex items-center justify-center">
            <div className="animate-spin w-8 h-8 rounded-full border-2 border-brand-primary border-t-transparent" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
