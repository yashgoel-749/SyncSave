import { render, screen, within } from "@testing-library/react";
import { Footer } from "../Footer";
import ContactPage from "@/app/contact/page";
import HelpPage from "@/app/help/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { CONTACT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/site";

describe("public beta pages", () => {
  it("uses the exact contact address and an encoded issue-report subject", () => {
    expect(CONTACT_EMAIL).toBe("goelyash749@gmail.com");
    expect(SUPPORT_EMAIL_HREF).toBe("mailto:goelyash749@gmail.com?subject=SyncSpace%3A%20report%20an%20issue");
  });

  it("links the footer to all public pages, the actual repository, and visible email", () => {
    render(<Footer />);
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", SUPPORT_EMAIL_HREF);
    expect(footer.getByRole("link", { name: "SyncSave source on GitHub" })).toHaveAttribute("href", "https://github.com/yashgoel-749/SyncSave");
    for (const [name, href] of [
      ["Contact", "/contact"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Help", "/help"],
      ["Local editor demo", "/demo"],
    ]) {
      expect(footer.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(footer.getByText(/not a cloud backup guarantee/)).toBeInTheDocument();
  });

  it("offers mailto reporting without asking for secrets or a confidential document", () => {
    render(<ContactPage />);
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", SUPPORT_EMAIL_HREF);
    expect(main.getByText(/Do not email passwords, invitation tokens, or confidential documents/)).toBeInTheDocument();
    expect(main.getByText(/does not submit a form/)).toBeInTheDocument();
  });

  it.each([
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
  ])("shows a prelaunch review notice on %s", (_name, Page) => {
    render(<Page />);
    expect(screen.getByRole("complementary", { name: "Prelaunch review notice" })).toHaveTextContent("Prelaunch review required.");
    expect(within(screen.getByRole("main")).getByText(/not a cloud backup guarantee/)).toBeInTheDocument();
  });

  it("explains shipped tools and their sharing, recovery, and file limits", () => {
    render(<HelpPage />);
    expect(screen.getByRole("heading", { name: "Turn speech into text" })).toBeInTheDocument();
    expect(screen.getByText(/Your browser may send audio to its speech provider/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share with a collaborator" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work offline without mistaking sync for backup" })).toBeInTheDocument();
    const tools = within(screen.getByRole("region", { name: "Document tools in beta" }));
    expect(tools.getByText(/named, text-only snapshot/)).toBeInTheDocument();
    expect(tools.getByText(/new collaborative edit/)).toBeInTheDocument();
    expect(tools.getByText(/document-level, not anchored to selected text/)).toBeInTheDocument();
    expect(tools.getByText(/discussion only, with no email notifications/)).toBeInTheDocument();
    expect(tools.getByText(/Export for PDF, DOCX, TXT, Markdown, HTML, or TipTap JSON/)).toBeInTheDocument();
    expect(tools.getByText(/choose Save as PDF to save a file/)).toBeInTheDocument();
    expect(tools.getByText(/exclude snapshots, comments, and whiteboard drawings/)).toBeInTheDocument();
    expect(tools.getByText(/future link recipients/)).toBeInTheDocument();
  });
});
