import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import EditorToolbar from "../EditorToolbar";
import DocumentEditor from "../DocumentEditor";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}));

// Mock TipTap react
jest.mock("@tiptap/react", () => {
  return {
    useEditor: jest.fn(({ content }) => {
      let isBold = false;
      let isItalic = false;
      return {
        isFocused: false,
        commands: {
          focus: jest.fn(),
        },
        can: () => ({
          undo: () => true,
          redo: () => true,
        }),
        isActive: (name: string) => {
          if (name === "bold") return isBold;
          if (name === "italic") return isItalic;
          return false;
        },
        getAttributes: () => ({ href: "" }),
        chain: () => ({
          focus: () => ({
            undo: () => ({ run: jest.fn() }),
            redo: () => ({ run: jest.fn() }),
            setParagraph: () => ({ run: jest.fn() }),
            toggleHeading: () => ({ run: jest.fn() }),
            toggleBold: () => ({
              run: () => {
                isBold = !isBold;
              },
            }),
            toggleItalic: () => ({
              run: () => {
                isItalic = !isItalic;
              },
            }),
            toggleUnderline: () => ({ run: jest.fn() }),
            toggleStrike: () => ({ run: jest.fn() }),
            toggleCode: () => ({ run: jest.fn() }),
            toggleBulletList: () => ({ run: jest.fn() }),
            toggleOrderedList: () => ({ run: jest.fn() }),
            toggleBlockquote: () => ({ run: jest.fn() }),
            toggleCodeBlock: () => ({ run: jest.fn() }),
            extendMarkRange: () => ({
              unsetLink: () => ({ run: jest.fn() }),
              setLink: () => ({ run: jest.fn() }),
            }),
            unsetLink: () => ({ run: jest.fn() }),
          }),
        }),
        setEditable: jest.fn(),
        getJSON: () => content || { type: "doc", content: [] },
      };
    }),
    EditorContent: () => <div data-testid="mock-prosemirror-canvas" />,
  };
});

describe("DocumentEditor & EditorToolbar Components", () => {
  const baseDoc = {
    id: "doc_test_1",
    title: "Project Architecture",
    content: JSON.stringify({ type: "doc", content: [] }),
    isArchived: false,
    updatedAt: "2026-10-22T12:00:00.000Z",
    owner: { id: "usr_alice", name: "Alice Developer", email: "alice@example.com" },
    workspace: { id: "ws_eng", name: "Engineering" },
    userRole: "OWNER",
  };

  describe("EditorToolbar", () => {
    it("should render read-only indicator when readOnly is true", () => {
      render(<EditorToolbar editor={null} readOnly={true} />);

      expect(screen.getByText("Read-only view")).toBeInTheDocument();
      expect(
        screen.getByText(/Editing is disabled for your permission level/i)
      ).toBeInTheDocument();
    });

    it("should render formatting buttons when editor is editable", () => {
      const mockEditor = {
        can: () => ({ undo: () => true, redo: () => true }),
        isActive: () => false,
        getAttributes: () => ({}),
        chain: () => ({
          focus: () => ({
            undo: () => ({ run: jest.fn() }),
            redo: () => ({ run: jest.fn() }),
            setParagraph: () => ({ run: jest.fn() }),
            toggleHeading: () => ({ run: jest.fn() }),
            toggleBold: () => ({ run: jest.fn() }),
            toggleItalic: () => ({ run: jest.fn() }),
            toggleUnderline: () => ({ run: jest.fn() }),
            toggleStrike: () => ({ run: jest.fn() }),
            toggleCode: () => ({ run: jest.fn() }),
            toggleBulletList: () => ({ run: jest.fn() }),
            toggleOrderedList: () => ({ run: jest.fn() }),
            toggleBlockquote: () => ({ run: jest.fn() }),
            toggleCodeBlock: () => ({ run: jest.fn() }),
          }),
        }),
      } as any;

      render(<EditorToolbar editor={mockEditor} readOnly={false} />);

      expect(screen.getByTitle("Paragraph")).toBeInTheDocument();
      expect(screen.getByTitle("Heading 1")).toBeInTheDocument();
      expect(screen.getByTitle("Heading 2")).toBeInTheDocument();
      expect(screen.getByTitle("Heading 3")).toBeInTheDocument();
      expect(screen.getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
      expect(screen.getByTitle("Italic (Ctrl+I)")).toBeInTheDocument();
      expect(screen.getByTitle("Underline (Ctrl+U)")).toBeInTheDocument();
      expect(screen.getByTitle("Bullet List")).toBeInTheDocument();
      expect(screen.getByTitle("Numbered List")).toBeInTheDocument();
      expect(screen.getByTitle("Code Block")).toBeInTheDocument();
    });
  });

  describe("DocumentEditor Permissions & Lifecycle", () => {
    it("should render editable title and allow editing for OWNER", () => {
      render(<DocumentEditor document={baseDoc} userId="usr_alice" />);

      const titleInput = screen.getByDisplayValue("Project Architecture") as HTMLInputElement;
      expect(titleInput).not.toBeDisabled();
      expect(screen.getByText("OWNER")).toBeInTheDocument();
      expect(screen.getByText("Saved")).toBeInTheDocument();
      expect(screen.getByTestId("mock-prosemirror-canvas")).toBeInTheDocument();
    });

    it("should disable title editing and show VIEWER role badge in read-only mode", () => {
      const viewerDoc = {
        ...baseDoc,
        userRole: "VIEWER",
      };

      render(<DocumentEditor document={viewerDoc} userId="usr_eve" />);

      const titleInput = screen.getByDisplayValue("Project Architecture") as HTMLInputElement;
      expect(titleInput).toBeDisabled();
      expect(screen.getByText("VIEWER")).toBeInTheDocument();
      expect(screen.getByText("Read-only view")).toBeInTheDocument();
    });

    it("should display breadcrumbs with Workspace and Dashboard links", () => {
      render(<DocumentEditor document={baseDoc} userId="usr_alice" />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getAllByText("Engineering")[0]).toBeInTheDocument();
      expect(screen.getByDisplayValue("Project Architecture")).toBeInTheDocument();
    });

    it("should update title on input change and show Unsaved changes state", () => {
      render(<DocumentEditor document={baseDoc} userId="usr_alice" />);

      const titleInput = screen.getByDisplayValue("Project Architecture");
      fireEvent.change(titleInput, { target: { value: "Updated Roadmap 2026" } });

      expect(titleInput).toHaveValue("Updated Roadmap 2026");
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });
});
