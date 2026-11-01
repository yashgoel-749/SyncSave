import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { observeCloudPersistence, persistedStateCovers, type CloudPersistenceStatus } from "../cloud-persistence";

describe("Cloud state coverage", () => {
  it("detects deletion-only changes despite an unchanged state vector", () => {
    const doc = new Y.Doc({ gc: false });
    doc.getText("text").insert(0, "keep delete");
    const persisted = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    doc.getText("text").delete(4, 7);
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    expect(persistedStateCovers(persisted, Y.encodeStateAsUpdate(doc))).toBe(false);
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    expect(persistedStateCovers(Y.encodeStateAsUpdate(server), Y.encodeStateAsUpdate(doc))).toBe(true);
    doc.destroy();
    server.destroy();
  });

  it("accepts collaborator supersets and includes whiteboard changes", () => {
    const doc = new Y.Doc();
    doc.getText("text").insert(0, "hello");
    const captured = Y.encodeStateAsUpdate(doc);
    doc.getMap("whiteboard").set("shape", { x: 12 });
    const newer = Y.encodeStateAsUpdate(doc);
    expect(persistedStateCovers(newer, captured)).toBe(true);
    expect(persistedStateCovers(captured, newer)).toBe(false);
    doc.destroy();
  });
});

describe("Cloud persistence observer", () => {
  let doc: Y.Doc;
  let provider: WebsocketProvider;
  let stop: () => void;
  let latest: CloudPersistenceStatus;
  const read = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  const originalFetch = global.fetch;
  const snapshot = (bytes = Y.encodeStateAsUpdate(doc)) => new Response(new Uint8Array(bytes));

  beforeEach(() => {
    jest.useFakeTimers();
    read.mockReset();
    global.fetch = read;
    doc = new Y.Doc();
    doc.getText("text").insert(0, "first");
    provider = new WebsocketProvider("ws://localhost:1234", "test", doc, { connect: false, disableBc: true });
    clearInterval(provider._checkInterval);
    provider.wsconnected = true;
    provider.synced = true;
    stop = observeCloudPersistence({ doc, provider, documentId: "test", onStatus: (status) => { latest = status; } });
  });
  afterEach(() => {
    stop();
    provider.wsconnected = false;
    provider.destroy();
    doc.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("verifies initial database state and stops polling until another edit", async () => {
    read.mockResolvedValue(snapshot());
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("saved");
    expect(read).toHaveBeenCalledWith("/api/documents/test/persistence", expect.objectContaining({ cache: "no-store" }));
    await jest.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(1);
    doc.getText("text").insert(5, " newer");
    expect(latest.kind).toBe("pending");
    read.mockResolvedValue(snapshot());
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("saved");
  });

  it("never accepts an older reply after a deletion", async () => {
    let resolve: (response: Response) => void = () => { throw new Error("Request not started"); };
    const old = snapshot();
    read.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await jest.advanceTimersByTimeAsync(2000);
    doc.getText("text").delete(0, 1);
    resolve(old);
    await jest.advanceTimersByTimeAsync(0);
    expect(latest.kind).toBe("pending");
    read.mockResolvedValue(snapshot());
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("saved");
  });

  it("rejects old connection replies and checks afresh after reconnect", async () => {
    let resolve: (response: Response) => void = () => { throw new Error("Request not started"); };
    read.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await jest.advanceTimersByTimeAsync(2000);
    provider.wsconnected = false;
    provider.emit("status", [{ status: "disconnected" }]);
    resolve(snapshot());
    await jest.advanceTimersByTimeAsync(0);
    expect(latest.kind).toBe("offline");
    await jest.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue(snapshot());
    provider.wsconnected = true;
    provider.emit("status", [{ status: "connected" }]);
    await jest.advanceTimersByTimeAsync(0);
    expect(latest.kind).toBe("saved");
  });

  it("retries absent snapshots and failed reads without a new edit", async () => {
    read.mockResolvedValueOnce(new Response(null, { status: 204 }));
    read.mockRejectedValueOnce(new Error("Database unavailable"));
    read.mockResolvedValueOnce(snapshot());
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("pending");
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("failed");
    await jest.advanceTimersByTimeAsync(4000);
    expect(latest.kind).toBe("saved");
  });

  it("does not verify a corrupt snapshot", async () => {
    read.mockResolvedValue(new Response(new Uint8Array([255])));
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("failed");
  });

  it("stops polling after access denial and ignores replies after disposal", async () => {
    read.mockResolvedValue(new Response(null, { status: 403 }));
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("failed");
    await jest.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(1);
    stop();
    doc.getText("text").insert(0, "disposed");
    expect(latest.kind).toBe("failed");
  });

  it("ignores an in-flight response after disposal", async () => {
    let resolve: (response: Response) => void = () => { throw new Error("Request not started"); };
    read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("checking");
    stop();
    resolve(snapshot());
    await jest.advanceTimersByTimeAsync(0);
    expect(latest.kind).toBe("checking");
  });

  it("waits for synchronization and retries a valid but outdated database snapshot", async () => {
    provider.synced = false;
    await jest.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    const outdated = snapshot();
    doc.getText("text").delete(0, 1);
    read.mockResolvedValueOnce(outdated);
    read.mockResolvedValueOnce(snapshot());
    provider.synced = true;
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("pending");
    await jest.advanceTimersByTimeAsync(2000);
    expect(latest.kind).toBe("saved");
  });
});
