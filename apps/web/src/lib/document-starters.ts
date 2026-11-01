import type { TipTapDocument } from "./document-files";

function starter(title: string, sections: string[]): TipTapDocument {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...sections.flatMap((section) => [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section }] },
        { type: "paragraph" },
      ]),
    ],
  };
}

export const DOCUMENT_STARTERS = [
  { id: "meeting-notes", title: "Meeting notes", description: "Capture the agenda, decisions, and next steps.", content: starter("Meeting notes", ["Date and attendees", "Agenda", "Discussion", "Decisions", "Action items"]) },
  { id: "project-plan", title: "Project plan", description: "Align your team on goals, milestones, and ownership.", content: starter("Project plan", ["Goal", "Scope", "Milestones", "Owners", "Risks and open questions"]) },
  { id: "weekly-update", title: "Weekly update", description: "Share progress, blockers, and what comes next.", content: starter("Weekly update", ["Highlights", "Progress", "Blockers", "Next week"]) },
] satisfies Array<{ id: string; title: string; description: string; content: TipTapDocument }>;
