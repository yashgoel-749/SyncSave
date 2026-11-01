"use client";

import { useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Footer } from "@/components/Footer";
import { LogoLink } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";

const SAMPLE_CONTENT = "<h2>A space to try your next idea</h2><p>This is a local sample. Select some text and try <strong>bold</strong>, <em>italic</em>, or a heading.</p><p>Type here to make it your own. Reset restores this sample.</p>";
const FORMAT_BUTTON_CLASS = "btn btn-ghost text-sm aria-pressed:bg-brand-500/15 aria-pressed:text-action";

export default function DemoPage() {
  const [resetCount, setResetCount] = useState(0);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2] }, link: false })],
    content: SAMPLE_CONTENT,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Local demo document",
        "aria-multiline": "true",
        "aria-describedby": "demo-notice",
        class: "min-h-64 outline-none",
      },
    },
  });

  const reset = () => {
    if (!editor) return;
    editor.commands.setContent(SAMPLE_CONTENT);
    setResetCount((count) => count + 1);
  };

  return (
    <>
      <header className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
        <LogoLink size="sm" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/help" className="btn btn-ghost text-sm">Help</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-6">
        <div className="space-y-4">
          <p className="text-sm text-action font-medium">No account needed</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Try the local editor</h1>
          <p id="demo-notice" className="text-text-secondary leading-relaxed">A real TipTap editor, running in this tab only. Your demo edits are not saved or sent to the server. Reloading or leaving this page loses them. This is not a collaboration, dictation, whiteboard, or offline-sync demo.</p>
        </div>
        <section aria-label="Interactive local editor" className="rounded-xl border border-border-subtle bg-surface-1 overflow-hidden">
          <div role="group" aria-label="Demo formatting" className="flex flex-wrap gap-2 border-b border-border-subtle bg-surface-2 p-3">
            <button type="button" disabled={!editor} aria-pressed={editor?.isActive("paragraph") ?? false} onClick={() => editor?.chain().focus().setParagraph().run()} className={FORMAT_BUTTON_CLASS}>Paragraph</button>
            <button type="button" disabled={!editor} aria-pressed={editor?.isActive("heading", { level: 1 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} className={FORMAT_BUTTON_CLASS}>Heading 1</button>
            <button type="button" disabled={!editor} aria-pressed={editor?.isActive("heading", { level: 2 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className={FORMAT_BUTTON_CLASS}>Heading 2</button>
            <button type="button" disabled={!editor} aria-pressed={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()} className={`${FORMAT_BUTTON_CLASS} font-bold`}>Bold</button>
            <button type="button" disabled={!editor} aria-pressed={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()} className={`${FORMAT_BUTTON_CLASS} italic`}>Italic</button>
            <button type="button" disabled={!editor} onClick={reset} className="btn btn-secondary text-sm sm:ml-auto">Reset sample</button>
          </div>
          <div className="p-5 sm:p-8 tiptap-editor-canvas">
            {!editor && <p role="status" className="text-text-secondary">Loading local editor…</p>}
            <EditorContent editor={editor} />
          </div>
        </section>
        <p role="status" className="text-sm text-text-secondary">{resetCount > 0 ? `Sample reset (${resetCount}). Demo edits are not saved.` : "Ready to try formatting. Demo edits are not saved."}</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/register" className="btn btn-primary">Create an account</Link>
          <Link href="/help" className="text-sm text-action underline underline-offset-4">Read about collaboration and offline limits</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
