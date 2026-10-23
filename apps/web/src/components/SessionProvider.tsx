"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import React, { useEffect } from "react";

export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Suppress benign offline ClientFetchError in dev overlay when user simulates offline mode in DevTools
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const firstArg = args[0] as { name?: string; message?: string } | undefined;
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

      if (
        isOffline &&
        (firstArg?.name === "ClientFetchError" ||
          (typeof firstArg?.message === "string" && firstArg.message.includes("Failed to fetch")) ||
          (typeof args[0] === "string" && args[0].includes("ClientFetchError")))
      ) {
        console.warn("[SyncSpace Offline] Session refresh skipped while offline:", firstArg?.message || firstArg);
        return;
      }

      originalConsoleError.apply(console, args);
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, []);

  return (
    <NextAuthSessionProvider
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
