import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LogoLink } from "@/components/Logo";
import { CONTACT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Report a SyncSpace beta issue or ask for help.",
};

export default function ContactPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
        <LogoLink size="sm" />
        <Link href="/help" className="btn btn-ghost text-sm">Help</Link>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <div className="space-y-4">
          <p className="text-sm text-action font-medium">Public beta</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Contact SyncSpace</h1>
          <p className="text-text-secondary leading-relaxed max-w-2xl">Found a bug, need help, or have feedback? Email the project maintainer. There is no guaranteed response time during beta.</p>
        </div>
        <section aria-labelledby="report-heading" className="rounded-xl border border-border-subtle bg-surface-1 p-6 sm:p-8 space-y-4">
          <h2 id="report-heading" className="text-xl font-semibold">Report an issue</h2>
          <p className="text-text-secondary leading-relaxed">Do not email passwords, invitation tokens, or confidential documents. Remove personal information from screenshots and error messages.</p>
          <a href={SUPPORT_EMAIL_HREF} className="text-action underline underline-offset-4 break-all">{CONTACT_EMAIL}</a>
          <p className="text-sm text-text-secondary">This link opens your email app with a report-issue subject. It does not submit a form.</p>
          <ul className="list-disc pl-5 space-y-2 text-text-secondary text-sm leading-relaxed">
            <li>Describe what you expected and what happened.</li>
            <li>Include the steps to reproduce the issue and your browser and device.</li>
            <li>For sync problems, include the visible save or connection status and whether you were offline.</li>
          </ul>
        </section>
        <p className="text-text-secondary leading-relaxed">For privacy or account-deletion questions, use the same email address. See the <Link href="/privacy" className="text-action underline underline-offset-4">beta privacy notice</Link> before sharing personal information.</p>
      </main>
      <Footer />
    </>
  );
}
