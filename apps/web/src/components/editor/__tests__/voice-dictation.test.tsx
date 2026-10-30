import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import VoiceDictation from "../VoiceDictation";
import EditorToolbar from "../EditorToolbar";
import type { BrowserSpeechRecognition } from "@/hooks/useSpeechRecognition";

class FakeRecognition implements BrowserSpeechRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: BrowserSpeechRecognition["onstart"] = null;
  onend: BrowserSpeechRecognition["onend"] = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onresult: BrowserSpeechRecognition["onresult"] = null;
  start = jest.fn(() => this.onstart?.());
  stop = jest.fn();
  abort = jest.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  results(...values: Array<{ text: string; final: boolean }>) {
    this.onresult?.({ results: values.map(({ text, final }) => ({ isFinal: final, 0: { transcript: text } })) });
  }
}

const editors: Editor[] = [];
const browserProperties = [
  [window, "SpeechRecognition"],
  [window, "webkitSpeechRecognition"],
  [window, "isSecureContext"],
  [navigator, "onLine"],
  [document, "hidden"],
] satisfies Array<[object, string]>;
const originalProperties = browserProperties.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));

function createEditor() {
  const editor = new Editor({ extensions: [StarterKit], content: "<p>Existing text</p>" });
  editor.commands.setTextSelection(9);
  editors.push(editor);
  return editor;
}

function openDialog(editor = createEditor()) {
  const view = render(<VoiceDictation editor={editor} documentId="doc-test" />);
  fireEvent.click(screen.getByRole("button", { name: "Voice to text" }));
  return { ...view, editor };
}

async function startListening() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Listening…"));
  const recognition = FakeRecognition.instances[FakeRecognition.instances.length - 1];
  if (!recognition) throw new Error("No microphone session was created");
  return recognition;
}

beforeEach(() => {
  FakeRecognition.instances = [];
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  jest.spyOn(global, "fetch").mockImplementation(async () => new Response(JSON.stringify({ user: { role: "EDITOR" } }), { status: 200 }));
});

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  browserProperties.forEach(([target, key], index) => {
    const descriptor = originalProperties[index];
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("voice dictation", () => {
  it("requires explicit speech-processing consent and never starts on opening", () => {
    openDialog();
    expect(screen.getByText(/browser may send audio/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start listening" })).toBeDisabled();
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["unsupported", "insecure", "offline"])("keeps typing available when dictation is %s", (reason) => {
    if (reason === "unsupported") Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    if (reason === "insecure") Object.defineProperty(window, "isSecureContext", { value: false });
    if (reason === "offline") Object.defineProperty(navigator, "onLine", { value: false });
    const { editor } = openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Start listening" })).toBeDisabled();
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(editor.isEditable).toBe(true);
  });

  it("supports the prefixed browser API and the selected language", async () => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRecognition });
    openDialog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hi-IN" } });
    const recognition = await startListening();
    expect(recognition.lang).toBe("hi-IN");
  });

  it("keeps interim and completed speech private until explicit insertion, without duplicates", async () => {
    const { editor } = openDialog();
    const recognition = await startListening();
    act(() => recognition.results({ text: "Hello", final: false }));
    expect(screen.getByText("Recognizing: Hello")).toBeInTheDocument();
    expect(editor.getText()).toBe("Existing text");
    act(() => recognition.results({ text: "Hello", final: true }, { text: "world", final: false }));
    act(() => recognition.results({ text: "Hello", final: true }, { text: "world", final: true }));
    act(() => recognition.results({ text: "Hello", final: true }, { text: "world", final: true }));
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("Hello world");
    expect(screen.getByRole("button", { name: "Insert text" })).toBeDisabled();
    expect(editor.getText()).toBe("Existing text");
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    act(() => recognition.onend?.());
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getText()).toBe("ExistingHello world text");
    expect(fetch).toHaveBeenCalledTimes(2);
    editor.commands.undo();
    expect(editor.getText()).toBe("Existing text");
  });

  it("inserts literal markup without executing HTML or deleting selected text", async () => {
    const { editor } = openDialog();
    editor.commands.setTextSelection({ from: 1, to: 9 });
    const markup = '<img src=x onerror="alert(1)"><script>bad()</script>';
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: markup } });
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.getText()).toBe(`Existing${markup} text`);
    expect(editor.view.dom.querySelector("img, script")).toBeNull();
  });

  it("uses the current mapped cursor after another edit, not a stale saved offset", async () => {
    const { editor } = openDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: "spoken" } });
    act(() => editor.commands.insertContentAt(1, { type: "text", text: "Remote " }));
    editor.commands.setTextSelection(16);
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await waitFor(() => expect(editor.getText()).toBe("Remote Existingspoken text"));
  });

  it("retains the preview instead of silently dropping text at a non-text selection", async () => {
    const editor = createEditor();
    editor.commands.setContent("<hr><p>Existing text</p>");
    editor.commands.setNodeSelection(0);
    const before = editor.getJSON();
    openDialog(editor);
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: "keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await screen.findByRole("alert");
    expect(editor.getJSON()).toEqual(before);
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("keep my draft");
  });

  it.each(["Discard", "Close voice dictation", "Escape"])("%s stops the microphone and discards the preview", async (action) => {
    const { editor } = openDialog();
    const recognition = await startListening();
    act(() => recognition.results({ text: "private draft", final: true }));
    const lateResult = recognition.onresult;
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(recognition.abort).toHaveBeenCalled();
    act(() => lateResult?.({ results: [{ isFinal: true, 0: { transcript: "late speech" } }] }));
    expect(editor.getText()).toBe("Existing text");
    fireEvent.click(screen.getByRole("button", { name: "Voice to text" }));
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it.each(["hidden", "offline", "pagehide"])("stops listening on %s without automatically restarting", async (reason) => {
    openDialog();
    const recognition = await startListening();
    act(() => {
      if (reason === "hidden") {
        Object.defineProperty(document, "hidden", { value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event(reason));
      }
    });
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Microphone off");
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it.each(["not-allowed", "audio-capture", "network", "language-not-supported", "no-speech"])("handles speech errors (%s) and retains completed text", async (error) => {
    openDialog();
    const recognition = await startListening();
    act(() => recognition.results({ text: "keep this", final: true }));
    act(() => recognition.onerror?.({ error }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Microphone off");
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("keep this");
    expect(recognition.abort).toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500])("does not start the microphone when permission verification returns %s", async (status) => {
    jest.mocked(fetch).mockResolvedValue(new Response("{}", { status }));
    openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    await screen.findByRole("alert");
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it.each(["viewer", "malformed", "network"])("fails closed on %s access checks", async (reason) => {
    if (reason === "network") jest.mocked(fetch).mockRejectedValue(new Error("offline"));
    else jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(reason === "viewer" ? { user: { role: "VIEWER" } } : { role: "EDITOR" })));
    const { editor } = openDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: "private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await screen.findByRole("alert");
    expect(editor.getText()).toBe("Existing text");
  });

  it("rechecks permission on insertion after dictation was allowed", async () => {
    const { editor } = openDialog();
    const recognition = await startListening();
    act(() => recognition.results({ text: "private draft", final: true }));
    act(() => recognition.onend?.());
    jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user: { role: "VIEWER" } })));
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    await screen.findByRole("alert");
    expect(editor.getText()).toBe("Existing text");
  });

  it("never starts a microphone after a pending access check finishes on a closed dialog", async () => {
    let resolveRequest: (response: Response) => void = () => {};
    jest.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await act(async () => resolveRequest(new Response(JSON.stringify({ user: { role: "EDITOR" } }))));
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("never inserts text after a pending access check finishes on a closed dialog", async () => {
    let resolveRequest: (response: Response) => void = () => {};
    jest.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    const { editor } = openDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: "private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await act(async () => resolveRequest(new Response(JSON.stringify({ user: { role: "EDITOR" } }))));
    expect(editor.getText()).toBe("Existing text");
  });

  it("stops an active session when a periodic check detects a role downgrade", async () => {
    jest.useFakeTimers();
    openDialog();
    const recognition = await startListening();
    jest.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ user: { role: "VIEWER" } })));
    await act(async () => jest.advanceTimersByTimeAsync(15_000));
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Microphone off");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("bounds microphone sessions even if the browser never sends an end event", async () => {
    jest.useFakeTimers();
    openDialog();
    const recognition = await startListening();
    await act(async () => jest.advanceTimersByTimeAsync(90_000));
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Stopping");
    await act(async () => jest.advanceTimersByTimeAsync(3_000));
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Microphone off");
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("bounds previews and does not prolong a stopped session on repeated results", async () => {
    jest.useFakeTimers();
    openDialog();
    const recognition = await startListening();
    act(() => recognition.results({ text: "x".repeat(12_000), final: true }));
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("x".repeat(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent("limit");
    await act(async () => jest.advanceTimersByTimeAsync(2_000));
    act(() => recognition.results({ text: "x".repeat(13_000), final: true }));
    await act(async () => jest.advanceTimersByTimeAsync(1_000));
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Microphone off");
  });

  it("appends a new session to a corrected preview without duplicating previous speech", async () => {
    openDialog();
    const first = await startListening();
    act(() => first.results({ text: "first words", final: true }));
    act(() => first.onend?.());
    fireEvent.change(screen.getByRole("textbox", { name: "Transcript preview" }), { target: { value: "Corrected words" } });
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    await waitFor(() => expect(FakeRecognition.instances).toHaveLength(2));
    const second = FakeRecognition.instances[1];
    act(() => second.results({ text: "more words", final: true }));
    act(() => second.results({ text: "more words", final: true }));
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("Corrected words more words");
  });

  it.each(["whiteboard", "revoked", "manual offline"])("stops the microphone when the toolbar is %s", async (reason) => {
    const editor = createEditor();
    const { rerender } = render(<EditorToolbar editor={editor} documentId="doc-test" dictationEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Voice to text" }));
    const recognition = await startListening();
    rerender(<EditorToolbar editor={editor} documentId="doc-test" dictationEnabled={false} readOnly={reason === "revoked"} />);
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voice to text" })).not.toBeInTheDocument();
  });

  it("does not carry a microphone session or private preview into another document", async () => {
    const editor = createEditor();
    const { rerender } = render(<EditorToolbar editor={editor} documentId="first-doc" dictationEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Voice to text" }));
    const recognition = await startListening();
    act(() => recognition.results({ text: "private first document draft", final: true }));
    rerender(<EditorToolbar editor={editor} documentId="second-doc" dictationEnabled />);
    expect(recognition.abort).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voice to text" }));
    expect(screen.getByRole("textbox", { name: "Transcript preview" })).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("shares only explicitly inserted text through the real Yjs binding", async () => {
    const documentA = new Y.Doc();
    const documentB = new Y.Doc();
    const editorA = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: documentA })] });
    const editorB = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: documentB })] });
    editors.push(editorA, editorB);
    documentA.on("update", (update) => Y.applyUpdate(documentB, update));
    documentB.on("update", (update) => Y.applyUpdate(documentA, update));
    try {
      openDialog(editorA);
      const recognition = await startListening();
      act(() => recognition.results({ text: "Shared after approval", final: true }));
      expect(editorB.getText()).toBe("");
      act(() => recognition.onend?.());
      fireEvent.click(screen.getByRole("button", { name: "Insert text" }));
      await waitFor(() => expect(editorB.getText()).toBe("Shared after approval"));
      editorA.commands.undo();
      expect(editorB.getText()).toBe("");
    } finally {
      editorA.destroy();
      editorB.destroy();
      documentA.destroy();
      documentB.destroy();
    }
  });
});
