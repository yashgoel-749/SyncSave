import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SyncSpace — Collaborative Documents, Offline-First",
    template: "%s | SyncSpace",
  },
  description:
    "SyncSpace is a real-time collaborative document editor that works seamlessly offline. Write together, sync instantly, edit anywhere.",
  keywords: [
    "collaborative editor",
    "offline-first",
    "real-time documents",
    "team collaboration",
  ],
  authors: [{ name: "SyncSpace" }],
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  openGraph: {
    type: "website",
    siteName: "SyncSpace",
    title: "SyncSpace — Collaborative Documents, Offline-First",
    description:
      "Real-time collaborative editing with offline support. Your documents, always in sync.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SyncSpace",
    description: "Offline-first collaborative document editor.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#6d5ae6",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-dvh flex flex-col antialiased">{children}</body>
    </html>
  );
}
