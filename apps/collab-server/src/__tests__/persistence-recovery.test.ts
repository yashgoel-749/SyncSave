import * as Y from "yjs";

jest.mock("@syncspace/db", () => ({
  PrismaClient: jest.fn(() => ({
    document: { findUnique: jest.fn(), update: jest.fn() },
  })),
}));

import { DocumentManager, prisma } from "../documentManager";

type DatabaseWrite = (args: { where: { id: string }; data: { yjsState: Uint8Array; content?: string; updatedAt: Date } }) => Promise<{ id: string }>;

describe("Cloud persistence recovery", () => {
  let manager: DocumentManager;
  let doc: Y.Doc;
  const write = prisma.document.update as unknown as jest.MockedFunction<DatabaseWrite>;

  beforeEach(() => {
    jest.useFakeTimers();
    write.mockReset();
    manager = new DocumentManager();
    doc = new Y.Doc();
    manager.docs.set("cloud-test", doc);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    manager.docs.delete("cloud-test");
    doc.destroy();
  });

  it("retries a failed database save without requiring another edit", async () => {
    write.mockRejectedValueOnce(new Error("Database temporarily unavailable"));
    write.mockResolvedValueOnce({ id: "cloud-test" });
    doc.getText("text").insert(0, "Keep this edit");
    manager.scheduleSave("cloud-test", doc);
    await jest.advanceTimersByTimeAsync(1500);
    expect(write).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(2);
    const saved = new Y.Doc();
    Y.applyUpdate(saved, write.mock.calls[1][0].data.yjsState);
    expect(saved.getText("text").toString()).toBe("Keep this edit");
    saved.destroy();
  });

  it("never overlaps database writes when several flushes wait for an older save", async () => {
    let finishFirst: () => void = () => { throw new Error("First write not started"); };
    let finishSecond: () => void = () => { throw new Error("Second write not started"); };
    let active = 0;
    let maxActive = 0;
    write.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const call = write.mock.calls.length;
      if (call === 1) await new Promise<void>((resolve) => { finishFirst = resolve; });
      if (call === 2) {
        doc.getText("text").insert(doc.getText("text").length, " third");
        manager.scheduleSave("cloud-test", doc, 60000);
        await new Promise<void>((resolve) => { finishSecond = resolve; });
      }
      active--;
      return { id: "cloud-test" };
    });
    doc.getText("text").insert(0, "first");
    manager.scheduleSave("cloud-test", doc, 60000);
    const first = manager.flushDocument("cloud-test", doc);
    doc.getText("text").insert(5, " second");
    manager.scheduleSave("cloud-test", doc, 60000);
    const second = manager.flushDocument("cloud-test", doc);
    const third = manager.flushDocument("cloud-test", doc);
    finishFirst();
    await first;
    await Promise.resolve();
    finishSecond();
    await Promise.all([second, third]);
    expect(maxActive).toBe(1);
    const saved = new Y.Doc();
    const lastWrite = write.mock.calls[write.mock.calls.length - 1][0];
    Y.applyUpdate(saved, lastWrite.data.yjsState);
    expect(saved.getText("text").toString()).toBe("first second third");
    saved.destroy();
  });

  it("persists an empty JSON document instead of retaining deleted content", async () => {
    write.mockResolvedValue({ id: "cloud-test" });
    const paragraph = new Y.XmlElement("paragraph");
    const fragment = doc.getXmlFragment("default");
    fragment.push([paragraph]);
    paragraph.push([new Y.XmlText("remove me")]);
    fragment.delete(0, 1);
    manager.scheduleSave("cloud-test", doc);
    await manager.flushDocument("cloud-test", doc);
    expect(JSON.parse(write.mock.calls[0][0].data.content ?? "null")).toEqual({ type: "doc", content: [] });
  });

  it("establishes a binary baseline after JSON hydration without an edit", async () => {
    (prisma.document.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "baseline-test", deletedAt: null, yjsState: null,
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Imported content" }] }] }),
    });
    write.mockResolvedValue({ id: "baseline-test" });
    const loaded = await manager.getOrLoadDocument("baseline-test");
    try {
      await jest.advanceTimersByTimeAsync(1500);
      const saved = new Y.Doc();
      Y.applyUpdate(saved, write.mock.calls[0][0].data.yjsState);
      expect(saved.getXmlFragment("default").toString()).toContain("Imported content");
      saved.destroy();
    } finally {
      manager.docs.delete("baseline-test");
      loaded.destroy();
    }
  });

  it("does not evict an idle document while its database save is in flight", async () => {
    let finish: () => void = () => { throw new Error("Write not started"); };
    write.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ id: "cloud-test" }); }));
    doc.getText("text").insert(0, "pending");
    manager.scheduleSave("cloud-test", doc);
    const saving = manager.flushDocument("cloud-test", doc);
    const eviction = manager.evictDocument("cloud-test", doc);
    expect(manager.docs.get("cloud-test")).toBe(doc);
    finish();
    await saving;
    expect(await eviction).toBe(true);
  });
});
