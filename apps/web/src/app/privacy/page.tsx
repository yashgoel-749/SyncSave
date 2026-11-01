import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LogoLink } from "@/components/Logo";
import { CONTACT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What to know about account data, shared documents, offline storage, and dictation in the SyncSpace beta.",
};

export default function PrivacyPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
        <LogoLink size="sm" />
        <Link href="/contact" className="btn btn-ghost text-sm">Contact</Link>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Beta privacy notice</h1>
        <aside aria-label="Prelaunch review notice" className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-6 text-text-secondary leading-relaxed">
          <strong className="text-text-primary">Prelaunch review required.</strong> This notice describes the current beta, not a completed legal or security review. Hosting details, data-handling procedures, and legal requirements need review before a production launch. Do not use this beta for sensitive or regulated information.
        </aside>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Account and document data</h2>
          <p className="text-text-secondary leading-relaxed">The app stores account details such as your email and name, password hashes for password sign-in, documents, whiteboard data, workspace membership, sharing permissions, invitations, and in-app notifications. These records support sign-in, editing, and collaboration. When configured, Google sign-in also uses provider account information.</p>
          <p className="text-text-secondary leading-relaxed">Document content and collaboration updates are sent to the application and collaboration services. People with access to a document can see its shared content. Treat invitation links as secrets. This beta does not claim end-to-end encryption.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Cookies and storage on your device</h2>
          <p className="text-text-secondary leading-relaxed">Sign-in uses session cookies. The editor uses browser storage, including IndexedDB, for local document state. A service worker caches app resources and visited pages for offline use.</p>
          <p className="text-text-secondary leading-relaxed">Local data can remain on a shared device after you sign out. After syncing and keeping a separate copy of important work, clear this site&apos;s browser data if you need to remove local copies. Clearing browser storage can delete unsynced edits. Offline storage is not a cloud backup guarantee.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Voice dictation</h2>
          <p className="text-text-secondary leading-relaxed">Dictation is optional and requires microphone permission and consent in the dialog. Your browser may send audio to its speech provider. SyncSpace does not record or store audio. The transcript preview stays on your device until you choose Insert text; inserted text is saved and shared like any other edit.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Snapshots, comments, files, and the demo</h2>
          <p className="text-text-secondary leading-relaxed">Shared text snapshots, comments, and mention references use the document&apos;s collaboration storage. Everyone with document viewing access can read those records, including future link recipients. Record authors are editable shared metadata, not verified attribution. Removing a record from a panel does not guarantee removal from stored collaboration history or other copies.</p>
          <p className="text-text-secondary leading-relaxed">Imported files become new documents and use normal document storage. Exports download document text to your device. The <Link href="/demo" className="text-action underline underline-offset-4">local editor demo</Link> does not save or send editor content. See <Link href="/help" className="text-action underline underline-offset-4">Help</Link> for supported formats and limits.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Deletion, hosting, and questions</h2>
          <p className="text-text-secondary leading-relaxed">Moving a document to trash is not the same as deleting every copy. Copies may remain with collaborators, in browser storage, or in service storage. This beta does not promise a fixed retention period or immediate deletion from all copies.</p>
          <p className="text-text-secondary leading-relaxed">This notice does not provide a verified list of hosting providers or subprocessors, or claim security certifications. For deployment details, access or deletion requests, or privacy questions, email <a href={SUPPORT_EMAIL_HREF} className="text-action underline underline-offset-4 break-all">{CONTACT_EMAIL}</a>. Do not include passwords or confidential documents.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}
