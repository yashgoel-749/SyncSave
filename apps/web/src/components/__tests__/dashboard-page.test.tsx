import React from "react";
import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";

const authMock = jest.fn();
const workspacesMock = jest.fn();
const redirectMock = jest.fn();
const dashboardProps = jest.fn();

jest.mock("@/auth", () => ({ auth: () => authMock() }));
jest.mock("@/lib/workspace-service", () => ({ getUserWorkspaces: (id: string) => workspacesMock(id) }));
jest.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
jest.mock("@/components/DashboardView", () => ({
  __esModule: true,
  default: (props: unknown) => { dashboardProps(props); return <div>Document manager</div>; },
}));
jest.mock("@/components/NotificationBell", () => ({ NotificationBell: () => <button>Notifications</button> }));
jest.mock("@/components/SignOutButton", () => ({
  SignOutButton: ({ redirectTo }: { redirectTo: string }) => <button data-redirect={redirectTo}>Sign out</button>,
}));
jest.mock("@/components/ThemeToggle", () => ({ __esModule: true, default: () => <button>Toggle theme</button> }));

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1", name: "Alex Doe", email: "alex@example.com" } });
  workspacesMock.mockResolvedValue([
    { id: "ws-1", name: "Research", description: "Team notes", ownerId: "user-1", _count: { documents: 3, members: 2 } },
  ]);
  redirectMock.mockImplementation(() => { throw new Error("Redirect"); });
});

it("preserves server authentication, workspace data and header account controls", async () => {
  render(await DashboardPage({ searchParams: Promise.resolve({ workspaceId: "ws-1" }) }));
  expect(authMock).toHaveBeenCalledTimes(1);
  expect(workspacesMock).toHaveBeenCalledWith("user-1");
  expect(dashboardProps).toHaveBeenCalledWith({
    initialWorkspaces: [{ id: "ws-1", name: "Research", description: "Team notes", ownerId: "user-1", _count: { documents: 3, members: 2 } }],
    userId: "user-1",
    initialWorkspaceId: "ws-1",
  });
  expect(screen.getByRole("heading", { name: "Welcome back, Alex" })).toBeInTheDocument();
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute("data-redirect", "/");
});

it.each([null, { user: {} }])("redirects unauthenticated users before loading workspaces", async (session) => {
  authMock.mockResolvedValue(session);
  await expect(DashboardPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Redirect");
  expect(redirectMock).toHaveBeenCalledWith("/login?callbackUrl=/dashboard");
  expect(workspacesMock).not.toHaveBeenCalled();
  expect(dashboardProps).not.toHaveBeenCalled();
});
