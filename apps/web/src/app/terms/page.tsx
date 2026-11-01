import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LogoLink } from "@/components/Logo";
import { CONTACT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "Beta terms",
  description: "Beta limitations and responsible use of SyncSpace.",
};

export default function TermsPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
        <LogoLink size="sm" />
        <Link href="/contact" className="btn btn-ghost text-sm">Contact</Link>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Beta terms and limitations</h1>
        <aside aria-label="Prelaunch review notice" className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-6 text-text-secondary leading-relaxed">
          <strong className="text-text-primary">Prelaunch review required.</strong> These are practical beta-use guidelines, not finalized production terms or legal advice. Legal terms and operating policies need review before a production launch.
        </aside>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">An experimental service</h2>
          <p className="text-text-secondary leading-relaxed">SyncSpace is a beta collaborative editor. Features can change, fail, or become unavailable. There is no promised uptime, support response time, recovery window, or service-level agreement. Planned features in <Link href="/help" className="text-action underline underline-offset-4">Help</Link> are not release commitments.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Keep your own copies</h2>
          <p className="text-text-secondary leading-relaxed">Offline editing and synchronization are not a cloud backup guarantee. Browser storage can be cleared or evicted. Disconnections, access changes, or beta bugs can prevent edits from reaching the server. Keep a separate copy of important work and check the editor&apos;s connection and save status before closing it.</p>
          <p className="text-text-secondary leading-relaxed">Do not rely on this beta as the only place to store confidential, regulated, or business-critical information.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Your content and sharing choices</h2>
          <p className="text-text-secondary leading-relaxed">Your content remains yours. Only upload or share content you are entitled to use. The app processes content to provide editing, storage, and collaboration. Review who has access before sharing a document or an invitation link. Recipients may keep their own copies, even after access is removed.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Use the beta responsibly</h2>
          <ul className="list-disc pl-5 space-y-2 text-text-secondary leading-relaxed">
            <li>Protect your password and invitation links.</li>
            <li>Do not try to access another person&apos;s account or documents without permission.</li>
            <li>Do not use the service for unlawful content, harassment, spam, or attacks on the service.</li>
            <li>Report suspected security problems privately without including other people&apos;s data.</li>
          </ul>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Privacy and contact</h2>
          <p className="text-text-secondary leading-relaxed">Read the <Link href="/privacy" className="text-action underline underline-offset-4">beta privacy notice</Link> for local storage, shared data, and optional dictation. For help or questions about these guidelines, email <a href={SUPPORT_EMAIL_HREF} className="text-action underline underline-offset-4 break-all">{CONTACT_EMAIL}</a>. Do not email passwords or confidential documents.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}
