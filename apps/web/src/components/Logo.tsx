import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

interface LogoProps extends ComponentPropsWithoutRef<"div"> {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const sizeMap = {
  sm: { icon: 28, text: "text-lg" },
  md: { icon: 36, text: "text-xl" },
  lg: { icon: 48, text: "text-2xl" },
};

export function Logo({ size = "md", showText = true, className = "", ...rest }: LogoProps) {
  const { icon, text } = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 ${className}`} {...rest}>
      {/* Icon mark */}
      <div
        className="relative flex-shrink-0 rounded-xl"
        style={{ width: icon, height: icon }}
      >
        <div
          className="absolute inset-0 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 opacity-90"
          aria-hidden="true"
        />
        <svg
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 w-full h-full p-[20%]"
        >
          {/* Two overlapping document pages */}
          <rect x="4" y="7" width="18" height="22" rx="2.5" fill="white" fillOpacity="0.85" />
          <rect x="10" y="4" width="18" height="22" rx="2.5" fill="white" fillOpacity="0.5" />
          {/* Sync arrow */}
          <path
            d="M8 15.5 Q13 11 18 15.5 Q23 20 28 15.5"
            stroke="url(#sg)"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <defs>
            <linearGradient id="sg" x1="8" y1="15.5" x2="28" y2="15.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#a78bfa" />
              <stop offset="1" stopColor="#34d399" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showText && (
        <span className={`font-bold tracking-tight ${text} gradient-text`}>
          SyncSpace
        </span>
      )}
    </div>
  );
}

export function LogoLink({ size, showText, className }: LogoProps) {
  return (
    <Link href="/" className={`inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-md ${className ?? ""}`}>
      <Logo size={size} showText={showText} />
    </Link>
  );
}
