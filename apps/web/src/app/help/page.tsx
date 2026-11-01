import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LogoLink } from "@/components/Logo";
import { CONTACT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help",
  description: "Get started with editing, snapshots, comments, imports, sharing, offline work, and voice dictation in the SyncSpace beta.",
};

export default function HelpPage() {
  return (
    <>
      <header className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
        <LogoLink size="sm" />
        <Link href="/contact" className="btn btn-ghost text-sm">Contact</Link>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-10">
        <div className="space-y-4">
          <p className="text-sm text-action font-medium">Public beta help</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Write, share, and work offline</h1>
          <p className="text-text-secondary leading-relaxed">Try the <Link href="/demo" className="text-action underline underline-offset-4">local editor demo</Link> without an account, or <Link href="/register" className="text-action underline underline-offset-4">create an account</Link> to use documents and collaboration.</p>
        </div>
        <section id="editor" className="space-y-3">
          <h2 className="text-xl font-semibold">Create and edit a document</h2>
          <p className="text-text-secondary leading-relaxed">Sign in, open the dashboard, and create or open a document. Use the editor toolbar for headings, bold, italic, lists, and links. The document also has a whiteboard view. Viewers can read, while editing requires an owner or editor role.</p>
          <p className="text-text-secondary leading-relaxed">Edits sync automatically when a connection is available. Check the save and connection indicators; a local change does not prove that a server copy is current.</p>
        </section>
        <section id="sharing" className="space-y-3">
          <h2 className="text-xl font-semibold">Share with a collaborator</h2>
          <p className="text-text-secondary leading-relaxed">If you own a document, open Share, enter an email address, and choose Editor or Viewer. Send the generated invitation link to the intended person. Treat that link as a secret. Use the share dialog to review access, change roles, remove collaborators, or revoke pending invitations.</p>
          <p className="text-text-secondary leading-relaxed">Live collaboration needs a working connection to the collaboration service. Removing access does not erase copies that someone already saved.</p>
        </section>
        <section id="offline" className="space-y-3">
          <h2 className="text-xl font-semibold">Work offline without mistaking sync for backup</h2>
          <p className="text-text-secondary leading-relaxed">Open the document online first so the app can load it and initialize local storage. While the loaded editor is offline, changes can stay in this browser&apos;s IndexedDB. Reconnect and check the sync indicators before closing the document.</p>
          <p className="text-text-secondary leading-relaxed">First-time access, sign-in, invitations, and some actions still need a connection. Reloading offline depends on cached resources and browser storage. Private browsing, blocked storage, clearing site data, or browser eviction can remove local edits. There is no cloud backup guarantee. Keep a separate copy of important work.</p>
        </section>
        <section id="dictation" className="space-y-3">
          <h2 className="text-xl font-semibold">Turn speech into text</h2>
          <ol className="list-decimal pl-5 space-y-2 text-text-secondary leading-relaxed">
            <li>With editing access, open Voice to text from the editor toolbar.</li>
            <li>Read the speech-processing notice and give consent for the session.</li>
            <li>Choose English (India), English (US), or Hindi (India). Select Start listening and allow microphone access.</li>
            <li>Select Stop listening, then review and correct the transcript preview.</li>
            <li>Select Insert text to add the preview after your current selection without deleting existing text.</li>
          </ol>
          <p className="text-text-secondary leading-relaxed">Dictation needs a supported browser, HTTPS or localhost, and an internet connection. Language support depends on the browser. Listening stops after 90 seconds and the preview is limited to 10,000 characters. Closing the dialog discards the preview and stops listening.</p>
          <p className="text-text-secondary leading-relaxed">Your browser may send audio to its speech provider. SyncSpace does not record or store audio. Preview text stays on your device until insertion; inserted text is saved and shared like a normal edit. If dictation is unavailable, continue typing.</p>
        </section>
        <section id="document-tools" aria-labelledby="document-tools-heading" className="rounded-xl border border-border-subtle bg-surface-1 p-6 sm:p-8 space-y-5">
          <h2 id="document-tools-heading" className="text-xl font-semibold">Document tools in beta</h2>
          <p className="text-text-secondary leading-relaxed">Use the Sun/Moon control to switch between light and dark mode. Your preference stays in this browser. Outline shows H1, H2, and H3 in a left sidebar; select a heading to scroll to it. On small screens, Outline opens a side panel and More opens the less-used formatting controls. Find searches literal text.</p>
          <div className="space-y-2">
            <h3 className="font-semibold">Shared text snapshots</h3>
            <p className="text-text-secondary leading-relaxed">Open History to save a named, text-only snapshot. Whiteboards are not included. Restore creates a safety snapshot first, then applies the selected text as a new collaborative edit. Concurrent or offline edits can still merge. This is not an exact global rollback or a cloud backup.</p>
            <p className="text-text-secondary leading-relaxed">Everyone who can view the document can read its snapshots and comments, including future link recipients. Do not save private content in these shared records. Editors can change or remove records, so attribution is not a verified audit trail. Removal from the panel does not guarantee erasure from stored collaboration history or other copies.</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Document-level comments and @mentions</h3>
            <p className="text-text-secondary leading-relaxed">Open Comments to discuss the whole document and mention available collaborators. Comments are document-level, not anchored to selected text. Mentions appear in the document discussion only, with no email notifications. Viewers can read comments but cannot post or resolve them.</p>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Templates, import, and export</h3>
            <p className="text-text-secondary leading-relaxed">On the dashboard, select Templates or Import. Import TXT or JSON files to create a new document without overwriting existing work. Imports require UTF-8 text or supported TipTap JSON, up to 256 KiB including the converted document structure. PDF, DOCX, and HTML imports are not supported.</p>
            <p className="text-text-secondary leading-relaxed">In the editor, select Export for PDF, DOCX, TXT, Markdown, HTML, or TipTap JSON. PDF opens your browser&apos;s print dialog: choose Save as PDF to save a file. DOCX and HTML preserve supported headings, text styles, lists, quotes, code, and links. TXT is plain text. Markdown preserves supported formatting, with inline HTML for underline.</p>
            <p className="text-text-secondary leading-relaxed">Exports capture current document content, including local edits, but exclude snapshots, comments, and whiteboard drawings. Unsupported formatting produces an error rather than a partial download. JSON preserves raw document content. Use the whiteboard toolbar for its separate export.</p>
          </div>
        </section>
        <section id="shortcuts" className="space-y-3">
          <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
          <p className="text-text-secondary leading-relaxed">While the editor has focus, use Ctrl+B for bold, Ctrl+I for italic, Ctrl+U for underline, and Ctrl+Z to undo. Use Command instead of Ctrl on macOS. In Find, Enter moves to the next match and Shift+Enter moves to the previous match.</p>
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Need help with a beta issue?</h2>
          <p className="text-text-secondary leading-relaxed">If sync is pending, keep the editor open, reconnect, and check the status details. Do not clear browser storage while you have unsynced work. If access changed, ask the document owner to review your role.</p>
          <p className="text-text-secondary leading-relaxed">Email <a href={SUPPORT_EMAIL_HREF} className="text-action underline underline-offset-4 break-all">{CONTACT_EMAIL}</a> with reproduction steps, your browser, and the visible status. Do not include passwords, invitation tokens, or confidential documents. See <Link href="/contact" className="text-action underline underline-offset-4">Contact</Link> for reporting guidance.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}
