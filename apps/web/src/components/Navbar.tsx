"use client";

import Link from "next/link";
import { useState } from "react";
import { LogoLink } from "@/components/Logo";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 glass border-b border-border-subtle"
      role="banner"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-8">
          {/* Logo */}
          <LogoLink size="sm" />

          {/* Desktop nav */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-1"
          >
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="btn btn-ghost text-sm"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/login" className="btn btn-ghost text-sm">
              Sign in
            </Link>
            <Link href="/auth/signup" className="btn btn-primary text-sm px-5 py-2">
              Get started free
            </Link>
          </div>

          {/* Mobile burger */}
          <button
            id="mobile-menu-toggle"
            aria-label="Toggle mobile menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="md:hidden btn btn-ghost p-2"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="sr-only">Menu</span>
            <div className="flex flex-col gap-1.5 w-5">
              <span
                className={`block h-0.5 bg-text-secondary rounded transition-all duration-300 ${
                  open ? "rotate-45 translate-y-2" : ""
                }`}
              />
              <span
                className={`block h-0.5 bg-text-secondary rounded transition-all duration-300 ${
                  open ? "opacity-0" : ""
                }`}
              />
              <span
                className={`block h-0.5 bg-text-secondary rounded transition-all duration-300 ${
                  open ? "-rotate-45 -translate-y-2" : ""
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        id="mobile-menu"
        className={`md:hidden border-t border-border-subtle overflow-hidden transition-all duration-300 ${
          open ? "max-h-80 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="flex flex-col p-4 gap-2" aria-label="Mobile navigation">
          {NAV_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="btn btn-ghost text-sm justify-start"
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          ))}
          <div className="border-t border-border-subtle pt-3 mt-1 flex flex-col gap-2">
            <Link href="/auth/login" className="btn btn-secondary text-sm">
              Sign in
            </Link>
            <Link href="/auth/signup" className="btn btn-primary text-sm">
              Get started free
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
