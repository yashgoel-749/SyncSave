import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DashboardView from "../DashboardView";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const workspaces = [
  { id: "ws-1", name: "Research", description: "Team research notes", ownerId: "user-1" },
  { id: "ws-2", name: "Product", description: null, ownerId: "user-1" },
];
const document = {
  id: "doc-1",
  title: "Planning notes",
  preview: "A real document preview",
  ownerId: "user-1",
  workspaceId: "ws-1",
  isArchived: false,
  deletedAt: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  _count: { collaborators: 2 },
};
const fetchMock = jest.fn();

function response(documents = [document], total = documents.length, totalPages = 1) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ documents, pagination: { total, totalPages } }),
  });
}

async function dashboard(initialWorkspaceId?: string) {
  render(<DashboardView initialWorkspaces={workspaces} userId="user-1" initialWorkspaceId={initialWorkspaceId} />);
  await screen.findByRole("link", { name: "Planning notes" });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => response());
  global.fetch = fetchMock;
});

it("uses real workspaces and one set of pressed navigation buttons", async () => {
  await dashboard("ws-2");
  expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveValue("ws-2");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Research", "Product"]);
  const navigation = screen.getByRole("navigation", { name: "Document navigation" });
  expect(within(navigation).getAllByRole("button")).toHaveLength(4);
  expect(within(navigation).getByRole("button", { name: "All documents", pressed: true })).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/documents?workspaceId=ws-2&filter=all&page=1&limit=24",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it.each([
  ["Recent", "recent"],
  ["Archived", "archived"],
  ["Trash", "trash"],
])("%s navigation updates the existing query and heading", async (label, filter) => {
  await dashboard();
  const navigation = screen.getByRole("navigation", { name: "Document navigation" });
  fireEvent.click(within(navigation).getByRole("button", { name: label }));
  expect(within(navigation).getByRole("button", { name: label, pressed: true })).toBeInTheDocument();
  expect(within(navigation).getByRole("button", { name: "All documents", pressed: false })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    `/api/documents?workspaceId=ws-1&filter=${filter}&page=1&limit=24`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));
});

it("collapses navigation in flow without a dialog, extra fetch, or loss of selection", async () => {
  await dashboard();
  const disclosure = screen.getByRole("button", { name: "Research · All documents" });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(disclosure).toHaveAttribute("aria-controls", "dashboard-navigation");
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recent", exact: true }));
  await screen.findByRole("link", { name: "Planning notes" });
  const requests = fetchMock.mock.calls.length;
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(disclosure).toHaveTextContent("Research · Recent");
  fireEvent.click(disclosure);
  expect(screen.getByRole("button", { name: "Recent", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(fetchMock).toHaveBeenCalledTimes(requests);
});

it("retains filter/search across workspace changes and aborts superseded requests", async () => {
  await dashboard();
  const firstSignal: AbortSignal = fetchMock.mock.calls[0][1].signal;
  fireEvent.click(screen.getByRole("button", { name: "Recent", exact: true }));
  await screen.findByRole("link", { name: "Planning notes" });
  expect(firstSignal.aborted).toBe(true);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search documents" }), { target: { value: " plan " } });
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/documents?workspaceId=ws-1&filter=recent&search=plan&page=1&limit=24",
    expect.anything(),
  ));
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace" }), { target: { value: "ws-2" } });
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/documents?workspaceId=ws-2&filter=recent&search=plan&page=1&limit=24",
    expect.anything(),
  ));
  expect(screen.getByRole("searchbox", { name: "Search documents" })).toHaveValue(" plan ");
  expect(screen.getByRole("button", { name: "Recent", exact: true })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/documents?workspaceId=ws-2&filter=recent&page=1&limit=24",
    expect.anything(),
  ));
});

it("keeps keyboard search focus and debounce instead of fetching every keystroke", async () => {
  await dashboard();
  fireEvent.keyDown(window, { key: "/" });
  const search = screen.getByRole("searchbox", { name: "Search documents" });
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: "p" } });
  fireEvent.change(search, { target: { value: "plan" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/documents?workspaceId=ws-1&filter=all&search=plan&page=1&limit=24",
    expect.anything(),
  );
});

it("renders actual previews/sharing and loads more with the selected query", async () => {
  fetchMock.mockImplementation((url: string) => url.includes("page=2")
    ? response([document, { ...document, id: "doc-2", title: "Follow-up" }], 2, 2)
    : response([document], 2, 2));
  await dashboard();
  expect(screen.getByText(document.preview)).toBeInTheDocument();
  expect(screen.getByText("2 shared")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 2 documents in Research");
  fireEvent.click(screen.getByRole("button", { name: "Load more (1 remaining)" }));
  await screen.findByRole("link", { name: "Follow-up" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 2 documents in Research");
  expect(fetchMock).toHaveBeenLastCalledWith("/api/documents?workspaceId=ws-1&filter=all&page=2&limit=24");
  expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument();
});

it("keeps rename and archive actions attached to real documents", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Rename", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Rename document" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Document title" }), { target: { value: "Updated plan" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(screen.getByRole("link", { name: "Updated plan" })).toHaveAttribute("href", "/documents/doc-1");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ title: "Updated plan" }),
  })));
  fireEvent.click(screen.getByRole("button", { name: "Archive", exact: true }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ isArchived: true }),
  })));
  expect(screen.queryByRole("link", { name: "Updated plan" })).not.toBeInTheDocument();
});

it("preserves moving documents to trash", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Move to trash" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1", { method: "DELETE" });
  expect(screen.queryByRole("link", { name: "Planning notes" })).not.toBeInTheDocument();
});

it("preserves trash restoration", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Trash", exact: true }));
  await screen.findByRole("button", { name: "Restore document" });
  fireEvent.click(screen.getByRole("button", { name: "Restore document" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1/restore", { method: "POST" });
  expect(screen.queryByRole("link", { name: "Planning notes" })).not.toBeInTheDocument();
});

it("requires confirmation before permanent deletion", async () => {
  await dashboard();
  fireEvent.click(screen.getByRole("button", { name: "Trash", exact: true }));
  await screen.findByRole("button", { name: "Permanently delete" });
  fireEvent.click(screen.getByRole("button", { name: "Permanently delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete permanently?" });
  expect(fetchMock).not.toHaveBeenCalledWith("/api/documents/doc-1?permanent=true", expect.anything());
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1?permanent=true", { method: "DELETE" }));
});
