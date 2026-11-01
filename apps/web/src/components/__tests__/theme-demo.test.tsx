import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DemoPage from "@/app/demo/page";
import { setTheme, THEME_STORAGE_KEY } from "@/lib/theme";

it("changes the demo theme without remounting TipTap or saving its document", async () => {
  setTheme("dark");
  const fetchSpy = jest.spyOn(globalThis, "fetch");
  const writes = jest.spyOn(Storage.prototype, "setItem");
  const databaseOpens = jest.spyOn(indexedDB, "open");
  try {
    render(<DemoPage />);
    const document = await screen.findByRole("textbox", { name: "Local demo document" });
    document.innerHTML = "<p>Keep this unsaved draft</p>";
    fireEvent.input(document, { inputType: "insertText", data: "Keep this unsaved draft" });
    await waitFor(() => expect(document).toHaveTextContent("Keep this unsaved draft"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(screen.getByRole("textbox", { name: "Local demo document" })).toBe(document);
    expect(document).toHaveTextContent("Keep this unsaved draft");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(databaseOpens).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
    writes.mockRestore();
    databaseOpens.mockRestore();
  }
});
