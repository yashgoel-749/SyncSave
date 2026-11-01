import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DemoPage from "../page";

describe("local TipTap demo", () => {
  const rectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
  const boundsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

  beforeAll(() => {
    // JSDOM has no layout. Keep TipTap real and supply only the missing browser geometry.
    const bounds = document.createElement("div").getBoundingClientRect();
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [bounds] });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => bounds });
  });

  afterAll(() => {
    if (rectsDescriptor) Object.defineProperty(Range.prototype, "getClientRects", rectsDescriptor);
    else Reflect.deleteProperty(Range.prototype, "getClientRects");
    if (boundsDescriptor) Object.defineProperty(Range.prototype, "getBoundingClientRect", boundsDescriptor);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });

  it("loads a real editable sample and resets local edits without network or persistence", async () => {
    const requests = jest.spyOn(globalThis, "fetch");
    const localWrites = jest.spyOn(Storage.prototype, "setItem");
    const databaseOpens = jest.spyOn(indexedDB, "open");
    try {
      const { unmount } = render(<DemoPage />);
      const textbox = await screen.findByRole("textbox", { name: "Local demo document" });
      expect(textbox).toHaveAttribute("contenteditable", "true");
      expect(textbox.querySelector("h2")).toHaveTextContent("A space to try your next idea");
      expect(textbox.querySelector("strong")).toHaveTextContent("bold");
      expect(textbox.querySelector("em")).toHaveTextContent("italic");

      textbox.innerHTML = "<p>My unsaved demo edit</p>";
      fireEvent.input(textbox, { inputType: "insertText", data: "My unsaved demo edit" });
      await waitFor(() => expect(textbox).toHaveTextContent("My unsaved demo edit"));
      fireEvent.click(screen.getByRole("button", { name: "Reset sample" }));
      await waitFor(() => expect(textbox.querySelector("h2")).toHaveTextContent("A space to try your next idea"));
      expect(textbox).not.toHaveTextContent("My unsaved demo edit");
      expect(screen.getByRole("status")).toHaveTextContent("Sample reset (1)");

      unmount();
      render(<DemoPage />);
      const freshTextbox = await screen.findByRole("textbox", { name: "Local demo document" });
      expect(freshTextbox).not.toHaveTextContent("My unsaved demo edit");
      expect(requests).not.toHaveBeenCalled();
      expect(localWrites).not.toHaveBeenCalled();
      expect(databaseOpens).not.toHaveBeenCalled();
    } finally {
      requests.mockRestore();
      localWrites.mockRestore();
      databaseOpens.mockRestore();
    }
  });

  it("formats the sample with real TipTap commands and no collaboration claims", async () => {
    render(<DemoPage />);
    const textbox = await screen.findByRole("textbox", { name: "Local demo document" });
    for (const name of ["Paragraph", "Heading 1", "Heading 2", "Bold", "Italic"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed");
    }
    fireEvent.click(screen.getByRole("button", { name: "Heading 1" }));
    await waitFor(() => expect(textbox.querySelector("h1")).toHaveTextContent("A space to try your next idea"));
    fireEvent.click(screen.getByRole("button", { name: "Paragraph" }));
    await waitFor(() => expect(textbox.querySelector("p")).toHaveTextContent("A space to try your next idea"));
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText(/not saved or sent to the server/)).toHaveTextContent("This is not a collaboration, dictation, whiteboard, or offline-sync demo.");
  });
});
