import React from "react";
import { TextDecoder, TextEncoder } from "node:util";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DashboardView from "../DashboardView";
import { DOCUMENT_STARTERS } from "@/lib/document-starters";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const workspace = { id: "ws-1", name: "Team", description: null, ownerId: "user-1" };
const created = { id: "new-1", title: "Created", ownerId: "user-1", updatedAt: new Date().toISOString(), workspaceId: "ws-1", isArchived: false, deletedAt: null };
const fetchMock = jest.fn();

function file(name: string, text: string) {
  const selected = new File([text], name, { type: "text/plain" });
  Object.defineProperty(selected, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return selected;
}

async function dashboard() {
  render(<DashboardView initialWorkspaces={[workspace]} userId="user-1" />);
  await screen.findByText("No documents yet");
}

beforeAll(() => {
  Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true });
  Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder, configurable: true });
});
beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve({
    ok: true,
    json: async () => init?.method === "POST" ? { document: created } : { documents: [], pagination: { total: 0, totalPages: 1 } },
  }));
  global.fetch = fetchMock;
});

it("keeps New document an immediate blank POST without opening a dialog", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "New document" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/documents", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Untitled Document", workspaceId: "ws-1" }) }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/new-1"));
});

it("offers first-use steps and a real help link", async () => {
  await dashboard();
  expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Read the getting-started guide" })).toHaveAttribute("href", "/help");
});

it("creates a template through the existing creation API and prevents repeat clicks", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  const dialog = screen.getByRole("dialog", { name: "Start from a template" });
  const choice = within(dialog).getByRole("button", { name: /Meeting notes/ });
  fireEvent.click(choice);
  fireEvent.click(choice);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/documents", expect.objectContaining({ body: JSON.stringify({ title: "Meeting notes", workspaceId: "ws-1", content: JSON.stringify(DOCUMENT_STARTERS[0].content) }) }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/new-1"));
});

it("keeps validation errors visible, clears file input, and allows retry", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  const dialog = screen.getByRole("dialog", { name: "Import a document" });
  const input = within(dialog).getByLabelText("Document file");
  fireEvent.change(input, { target: { files: [file("bad.json", "{}")] } });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Unsupported document");
  expect(input).toHaveValue("");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  fireEvent.change(input, { target: { files: [file("Notes.txt", "hello\nworld")] } });
  await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/new-1"));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(post?.[1].body)).toMatchObject({ title: "Notes", workspaceId: "ws-1", content: JSON.stringify({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "hello" }] },
    { type: "paragraph", content: [{ type: "text", text: "world" }] },
  ] }) });
});

it("rolls back failed imports, shows the API error in the dialog, and permits retry", async () => {
  await dashboard();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve({ ok: init?.method !== "POST", json: async () => ({ error: "Storage unavailable" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  const dialog = screen.getByRole("dialog", { name: "Import a document" });
  const input = within(dialog).getByLabelText("Document file");
  fireEvent.change(input, { target: { files: [file("Notes.txt", "hello")] } });
  fireEvent.change(input, { target: { files: [file("Notes.txt", "hello")] } });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Storage unavailable");
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "Notes" })).not.toBeInTheDocument();
  expect(input).toBeEnabled();
  expect(push).not.toHaveBeenCalled();
  fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: async () => ({ document: created }) }));
  fireEvent.change(input, { target: { files: [file("Notes.txt", "hello")] } });
  await waitFor(() => expect(push).toHaveBeenCalledWith("/documents/new-1"));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
});
