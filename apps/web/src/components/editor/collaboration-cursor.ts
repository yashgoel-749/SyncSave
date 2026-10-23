import { Extension } from "@tiptap/core";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { WebsocketProvider } from "y-websocket";

export interface CollaborationCursorOptions {
  provider: WebsocketProvider | null;
  user?: {
    name: string;
    color: string;
  };
}

export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: "collaborationCursor",

  addOptions() {
    return {
      provider: null,
      user: {
        name: "Anonymous",
        color: "#3b82f6",
      },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.provider || !this.options.provider.awareness) {
      return [];
    }

    return [
      yCursorPlugin(this.options.provider.awareness, {
        cursorBuilder: (user: { name?: string; color?: string }) => {
          const cursor = document.createElement("span");
          cursor.classList.add("collaboration-cursor__caret");
          cursor.setAttribute(
            "style",
            `border-color: ${user.color || "#3b82f6"}`
          );

          const label = document.createElement("div");
          label.classList.add("collaboration-cursor__label");
          label.setAttribute(
            "style",
            `background-color: ${user.color || "#3b82f6"}`
          );
          label.insertBefore(
            document.createTextNode(user.name || "Anonymous"),
            null
          );

          cursor.insertBefore(label, null);
          return cursor;
        },
      }),
    ];
  },
});
