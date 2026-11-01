"use client";

import React, { useState } from "react";
import { signOut } from "next-auth/react";

interface SignOutButtonProps {
  className?: string;
  redirectTo?: string;
}

export function SignOutButton({
  className = "btn btn-ghost text-xs text-text-muted hover:text-danger py-1.5 px-3 border border-border-subtle hover:border-status-danger-border transition-colors",
  redirectTo = "/",
}: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut({ callbackUrl: redirectTo });
  };

  return (
    <button
      type="button"
      id="signout-button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={className}
    >
      {isSigningOut ? "Signing out..." : "Sign out"}
    </button>
  );
}
