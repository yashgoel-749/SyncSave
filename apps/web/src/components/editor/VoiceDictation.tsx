"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { z } from "zod";
import { Modal } from "@/components/ui/Modal";
import { MAX_DICTATION_CHARACTERS, useSpeechRecognition } from "@/hooks/useSpeechRecognition";

const permissionSchema = z.object({
  user: z.object({ role: z.enum(["OWNER", "EDITOR", "VIEWER", "ADMIN", "MEMBER"]) }),
});

interface VoiceDictationProps {
  editor: Editor;
  documentId: string;
}

function DictationDialog({ editor, documentId, onClose }: VoiceDictationProps & { onClose: () => void }) {
  const speech = useSpeechRecognition();
  const [language, setLanguage] = useState("en-IN");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const privacyId = useId();
  const previewId = useId();
  const active = speech.phase !== "idle";
  const { cancel } = speech;

  const checkPermission = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/collab-token`, {
        cache: "no-store",
        signal,
      });
      if (signal.aborted) return false;
      if (!response.ok) {
        setPermissionError(response.status === 401 || response.status === 403 || response.status === 404
          ? "Your editing access is no longer available. Close this dialog and refresh the document."
          : "Could not verify editing access. Check your connection and try again.");
        return false;
      }
      const data: unknown = await response.json();
      if (signal.aborted) return false;
      const permission = permissionSchema.safeParse(data);
      if (!permission.success || permission.data.user.role === "VIEWER" || !editor.isEditable || editor.isDestroyed) {
        setPermissionError("Editing is not allowed. Close this dialog and refresh the document.");
        return false;
      }
      return true;
    } catch {
      if (!signal.aborted) setPermissionError("Could not verify editing access. Check your connection and try again.");
      return false;
    }
  }, [documentId, editor]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      if (!(await checkPermission(controller.signal)) && !controller.signal.aborted) cancel();
      checking = false;
    }, 15_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [active, checkPermission, cancel]);

  const begin = async () => {
    if (busy || active || !consent || speech.availability !== "available" || document.hidden) return;
    setBusy(true);
    setPermissionError(null);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const allowed = await checkPermission(controller.signal);
    if (controller.signal.aborted) return;
    if (allowed && !document.hidden) speech.start(language);
    setBusy(false);
  };

  const insert = async () => {
    if (busy || active || !speech.transcript.trim()) return;
    setBusy(true);
    setPermissionError(null);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const allowed = await checkPermission(controller.signal);
    if (controller.signal.aborted) return;
    if (allowed) {
      // Insert literal text after the current selection; never parse speech as HTML or replace selected text.
      const inserted = editor.chain().focus().command(({ tr }) => {
        if (!tr.selection.$to.parent.isTextblock) return false;
        tr.insertText(speech.transcript, tr.selection.to);
        return tr.docChanged;
      }).run();
      if (inserted) {
        onClose();
        return;
      }
      setPermissionError("Text could not be inserted here. Close the dialog, choose a text position, and try again.");
    }
    setBusy(false);
  };

  const availabilityMessage = {
    checking: "Checking browser support…",
    available: null,
    unsupported: "Voice dictation is not supported in this browser. Try a supported browser such as Chrome, or continue typing.",
    insecure: "Voice dictation requires HTTPS (or localhost during development). You can continue typing.",
    offline: "Voice dictation requires an internet connection. You can still edit existing preview text.",
  }[speech.availability];

  return (
    <Modal open onClose={onClose} labelledBy={titleId} size="lg">
      <div className="p-5 sm:p-6 space-y-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <h3 id={titleId} className="font-semibold text-text-primary">Voice to text</h3>
          <button type="button" onClick={onClose} data-modal-close aria-label="Close voice dictation" className="btn btn-ghost px-2 py-1">✕</button>
        </div>
        <p id={privacyId} className="text-xs text-text-secondary leading-relaxed">
          Your browser may send audio to its speech provider for transcription. SyncSpace does not record or store audio.
          This preview stays on this device until you click Insert text; inserted text is shared and saved like normal edits.
        </p>
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={consent} disabled={active || busy} onChange={(event) => setConsent(event.target.checked)} aria-describedby={privacyId} className="mt-0.5 accent-brand-500" />
          I agree to my browser&apos;s speech processing for this session.
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-36 text-xs text-text-secondary space-y-1">
            <span>Dictation language</span>
            <select value={language} disabled={active || busy} onChange={(event) => setLanguage(event.target.value)} className="input">
              <option value="en-IN">English (India)</option>
              <option value="en-US">English (US)</option>
              <option value="hi-IN">Hindi (India)</option>
            </select>
          </label>
          {active ? (
            <button type="button" onClick={speech.stop} disabled={speech.phase === "stopping"} className="btn btn-danger text-xs px-4 py-2">Stop listening</button>
          ) : (
            <button type="button" onClick={() => void begin()} disabled={busy || !consent || speech.availability !== "available"} className="btn btn-primary text-xs px-4 py-2">Start listening</button>
          )}
        </div>
        <p role="status" className="text-xs text-text-secondary">
          {busy ? "Checking editing access…" : speech.phase === "starting" ? "Waiting for microphone permission…"
            : speech.phase === "listening" ? "Listening… Speak clearly."
              : speech.phase === "stopping" ? "Stopping… Finishing your transcript." : "Microphone off. Review your text before inserting."}
        </p>
        {availabilityMessage && <p className="text-xs text-text-muted">{availabilityMessage}</p>}
        {(permissionError || speech.error) && <p role="alert" className="text-xs text-red-400">{permissionError || speech.error}</p>}
        <div className="space-y-2">
          <label htmlFor={previewId} className="text-xs font-medium text-text-secondary">Transcript preview</label>
          <textarea id={previewId} value={speech.transcript} onChange={(event) => speech.setTranscript(event.target.value)} disabled={active || busy} maxLength={MAX_DICTATION_CHARACTERS} rows={6} placeholder="Your completed transcript will appear here. Stop listening to make corrections." className="input resize-y w-full" />
          {speech.interim && <p className="text-xs text-text-muted break-words">Recognizing: {speech.interim}</p>}
          <p className="text-[11px] text-text-muted">{speech.transcript.length.toLocaleString()} / 10,000 characters · Listening stops after 90 seconds. Language availability depends on your browser.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost text-xs px-4 py-2">Discard</button>
          <button type="button" onClick={() => void insert()} disabled={active || busy || !speech.transcript.trim()} className="btn btn-primary text-xs px-4 py-2">Insert text</button>
        </div>
        <p className="text-[11px] text-text-muted">Text is inserted after your current selection without deleting existing content. Escape or closing this dialog discards the preview and stops listening.</p>
      </div>
    </Modal>
  );
}

export default function VoiceDictation({ editor, documentId }: VoiceDictationProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(true)} title="Voice to text" aria-label="Voice to text" aria-haspopup="dialog" disabled={!editor.isEditable || editor.isDestroyed} className="h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:opacity-30">
        <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm-7-3a7 7 0 0014 0m-7 7v4m-4 0h8" />
        </svg>
        <span>Dictate</span>
      </button>
      {open && <DictationDialog key={documentId} editor={editor} documentId={documentId} onClose={close} />}
    </>
  );
}
