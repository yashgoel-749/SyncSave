"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import {
  WHITEBOARD_COLORS,
  STROKE_WIDTHS,
  DEFAULT_STYLE,
  MIN_ZOOM,
  MAX_ZOOM,
  createShapeId,
  normalizeRect,
  screenToWorld,
  zoomViewportAt,
  simplifyPoints,
  pointsBounds,
  getShapeBounds,
  findShapeAt,
  translateShape,
  sortShapes,
  nextZIndex,
  isShape,
  shapesToSvg,
  unionRects,
  clamp,
  type Shape,
  type PathShape,
  type TextShape,
  type WhiteboardTool,
  type Viewport,
  type Point,
  type Rect,
} from "@/lib/whiteboard-utils";
import { ShapeView } from "./ShapeView";
import { ConfirmDialog } from "@/components/ui/Modal";

/** Name of the shared Y.Map inside the document's Y.Doc. */
export const WHITEBOARD_MAP_KEY = "whiteboard";

export interface WhiteboardUser {
  id: string;
  name: string;
  color: string;
}

interface WhiteboardProps {
  ydoc: Y.Doc;
  provider: WebsocketProvider | null;
  user: WhiteboardUser;
  canEdit: boolean;
  title?: string;
  /** When false (board hidden behind another view) keyboard shortcuts are ignored. */
  active?: boolean;
}

interface RemoteCursor {
  clientId: number;
  x: number;
  y: number;
  tool: WhiteboardTool;
  name: string;
  color: string;
  draft?: Shape | null;
}

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; originX: number; originY: number }
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; id: string; lastX: number; lastY: number; moved: boolean }
  | { kind: "erase" };

const TOOL_SHORTCUTS: Array<{ tool: WhiteboardTool; key: string; label: string }> = [
  { tool: "select", key: "V", label: "Select" },
  { tool: "hand", key: "H", label: "Pan" },
  { tool: "pen", key: "P", label: "Pen" },
  { tool: "rect", key: "R", label: "Rectangle" },
  { tool: "ellipse", key: "O", label: "Ellipse" },
  { tool: "line", key: "L", label: "Line" },
  { tool: "arrow", key: "A", label: "Arrow" },
  { tool: "text", key: "T", label: "Text" },
  { tool: "eraser", key: "E", label: "Eraser" },
];

const KEY_TO_TOOL: Record<string, WhiteboardTool> = {
  v: "select",
  "1": "select",
  h: "hand",
  p: "pen",
  "2": "pen",
  r: "rect",
  "3": "rect",
  o: "ellipse",
  "4": "ellipse",
  l: "line",
  "5": "line",
  a: "arrow",
  "6": "arrow",
  t: "text",
  "7": "text",
  e: "eraser",
  "8": "eraser",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function Whiteboard({ ydoc, provider, user, canEdit, title, active = true }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Per-client transaction origin so the UndoManager only tracks local changes.
  const localOrigin = useMemo(() => ({ client: "whiteboard" }), []);
  const ymap = useMemo(() => ydoc.getMap<Shape>(WHITEBOARD_MAP_KEY), [ydoc]);

  const [shapes, setShapes] = useState<Shape[]>(() => readShapes(ymap));
  const [tool, setToolState] = useState<WhiteboardTool>(canEdit ? "pen" : "hand");
  const [stroke, setStroke] = useState<string>(DEFAULT_STYLE.stroke);
  const [strokeWidth, setStrokeWidth] = useState<number>(DEFAULT_STYLE.strokeWidth);
  const [fillEnabled, setFillEnabled] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const interactionRef = useRef<Interaction>({ kind: "none" });
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<Shape | null>(null);
  const viewportRef = useRef(viewport);
  const toolRef = useRef(tool);
  const shapesRef = useRef(shapes);
  const cursorRafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<Point | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<Shape | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const effectiveTool: WhiteboardTool = !canEdit
    ? tool === "select" ? "select" : "hand"
    : spaceHeld
    ? "hand"
    : tool;

  const setTool = useCallback(
    (next: WhiteboardTool) => {
      if (!canEdit && next !== "hand" && next !== "select") return;
      setToolState(next);
      if (next !== "select") setSelectedId(null);
      if (next !== "text") setEditingTextId(null);
    },
    [canEdit]
  );

  /* ------------------------------------------------------------------ */
  /* Yjs binding                                                         */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const onChange = () => setShapes(readShapes(ymap));
    ymap.observe(onChange);
    onChange();
    return () => ymap.unobserve(onChange);
  }, [ymap]);

  const undoManager = useMemo(
    () =>
      new Y.UndoManager(ymap, {
        trackedOrigins: new Set([localOrigin]),
        captureTimeout: 400,
      }),
    [ymap, localOrigin]
  );

  useEffect(() => {
    const sync = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    undoManager.on("stack-item-added", sync);
    undoManager.on("stack-item-popped", sync);
    undoManager.on("stack-cleared", sync);
    sync();
    return () => {
      undoManager.off("stack-item-added", sync);
      undoManager.off("stack-item-popped", sync);
      undoManager.off("stack-cleared", sync);
      undoManager.destroy();
    };
  }, [undoManager]);

  const transact = useCallback(
    (fn: () => void) => {
      ydoc.transact(fn, localOrigin);
    },
    [ydoc, localOrigin]
  );

  const upsertShape = useCallback(
    (shape: Shape) => {
      if (!canEdit) return;
      transact(() => ymap.set(shape.id, shape));
    },
    [canEdit, transact, ymap]
  );

  const deleteShapes = useCallback(
    (ids: string[]) => {
      if (!canEdit || ids.length === 0) return;
      transact(() => ids.forEach((id) => ymap.delete(id)));
      setSelectedId((cur) => (cur && ids.includes(cur) ? null : cur));
      setEditingTextId((cur) => (cur && ids.includes(cur) ? null : cur));
    },
    [canEdit, transact, ymap]
  );

  /* ------------------------------------------------------------------ */
  /* Awareness: remote cursors & in-progress strokes                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!provider) return;
    const awareness = provider.awareness;
    const update = () => {
      const next: RemoteCursor[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const s = state as {
          user?: { userId?: string; name?: string; color?: string };
          wb?: { x: number; y: number; tool: WhiteboardTool; draft?: Shape | null };
        };
        if (!s?.wb || typeof s.wb.x !== "number") return;
        next.push({
          clientId,
          x: s.wb.x,
          y: s.wb.y,
          tool: s.wb.tool,
          name: s.user?.name || "Guest",
          color: s.user?.color || "#8b7cf6",
          draft: s.wb.draft && isShape(s.wb.draft) ? s.wb.draft : null,
        });
      });
      setRemoteCursors(next);
    };
    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
      awareness.setLocalStateField("wb", null);
    };
  }, [provider]);

  const broadcastCursor = useCallback(
    (point: Point | null, draftShape?: Shape | null) => {
      if (!provider) return;
      pendingCursorRef.current = point;
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null;
        const p = pendingCursorRef.current;
        provider.awareness.setLocalStateField(
          "wb",
          p ? { x: p.x, y: p.y, tool: toolRef.current, draft: draftShape ?? draftRef.current ?? null } : null
        );
      });
    },
    [provider]
  );

  /* ------------------------------------------------------------------ */
  /* Coordinate helpers                                                  */
  /* ------------------------------------------------------------------ */

  const getScreenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const getWorldPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point =>
      screenToWorld(getScreenPoint(e), viewportRef.current),
    [getScreenPoint]
  );

  const baseStyle = useCallback(
    () => ({
      stroke,
      fill: fillEnabled ? stroke : "transparent",
      strokeWidth,
      opacity: 1,
      createdBy: user.id,
      createdAt: Date.now(),
      z: nextZIndex(shapesRef.current),
    }),
    [stroke, fillEnabled, strokeWidth, user.id]
  );

  /* ------------------------------------------------------------------ */
  /* Pointer interactions                                                */
  /* ------------------------------------------------------------------ */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (editingTextId) {
        // Clicking the canvas while editing text commits the edit.
        setEditingTextId(null);
      }
      const screen = getScreenPoint(e);
      const world = screenToWorld(screen, viewportRef.current);
      const currentTool = effectiveTool;
      const isPanGesture = e.button === 1 || currentTool === "hand";

      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);

      if (isPanGesture) {
        interactionRef.current = {
          kind: "pan",
          startX: screen.x,
          startY: screen.y,
          originX: viewportRef.current.x,
          originY: viewportRef.current.y,
        };
        setIsDragging(true);
        return;
      }

      if (e.button !== 0) return;

      if (!canEdit) {
        if (currentTool === "select") {
          const hit = findShapeAt(shapesRef.current, world.x, world.y, 6 / viewportRef.current.zoom);
          setSelectedId(hit?.id ?? null);
        }
        return;
      }

      switch (currentTool) {
        case "pen": {
          const shape: PathShape = {
            id: createShapeId(),
            type: "path",
            x: world.x,
            y: world.y,
            w: 0,
            h: 0,
            points: [world.x, world.y],
            ...baseStyle(),
            fill: "transparent",
          };
          setDraft(shape);
          draftRef.current = shape;
          interactionRef.current = { kind: "draw", startX: world.x, startY: world.y };
          break;
        }
        case "rect":
        case "ellipse": {
          const shape: Shape =
            currentTool === "rect"
              ? { id: createShapeId(), type: "rect", x: world.x, y: world.y, w: 0, h: 0, radius: 6, ...baseStyle() }
              : { id: createShapeId(), type: "ellipse", x: world.x, y: world.y, w: 0, h: 0, ...baseStyle() };
          setDraft(shape);
          draftRef.current = shape;
          interactionRef.current = { kind: "draw", startX: world.x, startY: world.y };
          break;
        }
        case "line":
        case "arrow": {
          const shape: Shape = {
            id: createShapeId(),
            type: currentTool,
            x: world.x,
            y: world.y,
            w: 0,
            h: 0,
            x1: world.x,
            y1: world.y,
            x2: world.x,
            y2: world.y,
            ...baseStyle(),
            fill: "transparent",
          };
          setDraft(shape);
          draftRef.current = shape;
          interactionRef.current = { kind: "draw", startX: world.x, startY: world.y };
          break;
        }
        case "text": {
          const hit = findShapeAt(shapesRef.current, world.x, world.y, 6 / viewportRef.current.zoom);
          if (hit && hit.type === "text") {
            setSelectedId(hit.id);
            setEditingTextId(hit.id);
            return;
          }
          const fontSize = clamp(strokeWidth * 6, 16, 48);
          const shape: TextShape = {
            id: createShapeId(),
            type: "text",
            x: world.x,
            y: world.y - fontSize / 2,
            w: 0,
            h: 0,
            text: "",
            fontSize,
            ...baseStyle(),
            fill: "transparent",
          };
          upsertShape(shape);
          setSelectedId(shape.id);
          setEditingTextId(shape.id);
          break;
        }
        case "eraser": {
          interactionRef.current = { kind: "erase" };
          const hit = findShapeAt(shapesRef.current, world.x, world.y, 8 / viewportRef.current.zoom);
          if (hit) deleteShapes([hit.id]);
          break;
        }
        case "select":
        default: {
          const hit = findShapeAt(shapesRef.current, world.x, world.y, 6 / viewportRef.current.zoom);
          if (hit) {
            setSelectedId(hit.id);
            interactionRef.current = { kind: "move", id: hit.id, lastX: world.x, lastY: world.y, moved: false };
            setIsDragging(true);
          } else {
            setSelectedId(null);
          }
        }
      }
    },
    [baseStyle, canEdit, deleteShapes, editingTextId, effectiveTool, getScreenPoint, strokeWidth, upsertShape]
  );

  const flushMove = useCallback(() => {
    moveRafRef.current = null;
    const shape = pendingMoveRef.current;
    if (shape) {
      pendingMoveRef.current = null;
      upsertShape(shape);
    }
  }, [upsertShape]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const screen = getScreenPoint(e);
      const world = screenToWorld(screen, viewportRef.current);
      const interaction = interactionRef.current;

      switch (interaction.kind) {
        case "pan": {
          setViewport((vp) => ({
            ...vp,
            x: interaction.originX + (screen.x - interaction.startX),
            y: interaction.originY + (screen.y - interaction.startY),
          }));
          break;
        }
        case "draw": {
          const current = draftRef.current;
          if (!current) break;
          let next: Shape = current;
          if (current.type === "path") {
            const pts = current.points;
            const lastX = pts[pts.length - 2];
            const lastY = pts[pts.length - 1];
            // Skip micro-moves to keep the point list lean.
            if (Math.hypot(world.x - lastX, world.y - lastY) < 0.5 / viewportRef.current.zoom) break;
            const points = [...pts, world.x, world.y];
            const b = pointsBounds(points);
            next = { ...current, points, x: b.x, y: b.y, w: b.w, h: b.h };
          } else if (current.type === "rect" || current.type === "ellipse") {
            const r = e.shiftKey
              ? squareRect(interaction.startX, interaction.startY, world.x, world.y)
              : normalizeRect(interaction.startX, interaction.startY, world.x, world.y);
            next = { ...current, ...r };
          } else if (current.type === "line" || current.type === "arrow") {
            let x2 = world.x;
            let y2 = world.y;
            if (e.shiftKey) {
              // Snap to 45° increments
              const dx = x2 - current.x1;
              const dy = y2 - current.y1;
              const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
              const len = Math.hypot(dx, dy);
              x2 = current.x1 + Math.cos(angle) * len;
              y2 = current.y1 + Math.sin(angle) * len;
            }
            const r = normalizeRect(current.x1, current.y1, x2, y2);
            next = { ...current, x2, y2, ...r };
          }
          draftRef.current = next;
          setDraft(next);
          broadcastCursor(world, next);
          return;
        }
        case "move": {
          const dx = world.x - interaction.lastX;
          const dy = world.y - interaction.lastY;
          if (dx === 0 && dy === 0) break;
          interaction.lastX = world.x;
          interaction.lastY = world.y;
          interaction.moved = true;
          const existing =
            pendingMoveRef.current?.id === interaction.id
              ? pendingMoveRef.current
              : shapesRef.current.find((s) => s.id === interaction.id);
          if (!existing) break;
          pendingMoveRef.current = translateShape(existing, dx, dy);
          if (moveRafRef.current === null) {
            moveRafRef.current = requestAnimationFrame(flushMove);
          }
          break;
        }
        case "erase": {
          const hit = findShapeAt(shapesRef.current, world.x, world.y, 8 / viewportRef.current.zoom);
          if (hit) deleteShapes([hit.id]);
          break;
        }
        default:
          break;
      }
      broadcastCursor(world, null);
    },
    [broadcastCursor, deleteShapes, flushMove, getScreenPoint]
  );

  const endInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    interactionRef.current = { kind: "none" };
    setIsDragging(false);

    if (interaction.kind === "move") {
      if (moveRafRef.current !== null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      flushMove();
      return;
    }

    if (interaction.kind !== "draw") return;

    const current = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    broadcastCursor(null);
    if (!current) return;

    let final: Shape = current;
    if (current.type === "path") {
      const points = simplifyPoints(current.points, 0.6 / viewportRef.current.zoom);
      const b = pointsBounds(points);
      final = { ...current, points, x: b.x, y: b.y, w: b.w, h: b.h };
    } else if (current.type === "rect" || current.type === "ellipse") {
      if (current.w < 2 && current.h < 2) return; // accidental click
    } else if (current.type === "line" || current.type === "arrow") {
      if (Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < 2) return;
    }
    upsertShape(final);
    // After drawing a shape, stay on the tool (fast repeated drawing); shapes become selectable.
  }, [broadcastCursor, flushMove, upsertShape]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      endInteraction();
    },
    [endInteraction]
  );

  const onPointerLeave = useCallback(() => {
    if (interactionRef.current.kind === "none") broadcastCursor(null);
  }, [broadcastCursor]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!canEdit) return;
      const world = getWorldPoint(e);
      const hit = findShapeAt(shapesRef.current, world.x, world.y, 6 / viewportRef.current.zoom);
      if (hit && hit.type === "text") {
        setSelectedId(hit.id);
        setEditingTextId(hit.id);
      }
    },
    [canEdit, getWorldPoint]
  );

  /* ------------------------------------------------------------------ */
  /* Wheel: zoom (ctrl/cmd or pinch) and pan                              */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        setViewport((vp) => zoomViewportAt(vp, screen, vp.zoom * factor));
      } else {
        setViewport((vp) => ({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY }));
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ------------------------------------------------------------------ */
  /* Keyboard shortcuts                                                   */
  /* ------------------------------------------------------------------ */

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    const shape = shapesRef.current.find((s) => s.id === selectedId);
    if (!shape) return;
    const copy = translateShape(
      { ...shape, id: createShapeId(), createdAt: Date.now(), z: nextZIndex(shapesRef.current) },
      16,
      16
    );
    upsertShape(copy);
    setSelectedId(copy.id);
  }, [selectedId, upsertShape]);

  const fitToContent = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const bounds = unionRects(shapesRef.current.map(getShapeBounds));
    const { width, height } = container.getBoundingClientRect();
    if (!bounds || bounds.w === 0 || bounds.h === 0) {
      setViewport({ x: width / 2, y: height / 2, zoom: 1 });
      return;
    }
    const padding = 80;
    const zoom = clamp(
      Math.min((width - padding * 2) / bounds.w, (height - padding * 2) / bounds.h),
      MIN_ZOOM,
      MAX_ZOOM
    );
    setViewport({
      zoom,
      x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const center = { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    setViewport((vp) => zoomViewportAt(vp, center, vp.zoom * factor));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (key === " " && !spaceHeld) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (mod && key === "z") {
        if (!canEdit) return;
        e.preventDefault();
        if (e.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }
      if (mod && key === "y") {
        if (!canEdit) return;
        e.preventDefault();
        undoManager.redo();
        return;
      }
      if (mod && key === "d") {
        if (!canEdit) return;
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        zoomBy(1.2);
        return;
      }
      if (mod && key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.2);
        return;
      }
      if (mod && key === "0") {
        e.preventDefault();
        setViewport({ x: 0, y: 0, zoom: 1 });
        return;
      }
      if (mod) return;

      if (key === "escape") {
        if (interactionRef.current.kind === "draw") {
          interactionRef.current = { kind: "none" };
          draftRef.current = null;
          setDraft(null);
        }
        setSelectedId(null);
        setEditingTextId(null);
        return;
      }
      if ((key === "delete" || key === "backspace") && selectedId && canEdit) {
        e.preventDefault();
        deleteShapes([selectedId]);
        return;
      }
      if (key === "f" && e.shiftKey) {
        fitToContent();
        return;
      }
      const nextTool = KEY_TO_TOOL[key];
      if (nextTool) {
        setTool(nextTool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, canEdit, deleteShapes, duplicateSelected, fitToContent, selectedId, setTool, spaceHeld, undoManager, zoomBy]);

  /* ------------------------------------------------------------------ */
  /* Initial framing: centre an empty board, fit an existing one          */
  /* ------------------------------------------------------------------ */

  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    framedRef.current = true;
    if (shapes.length > 0) {
      fitToContent();
    } else {
      const { width, height } = container.getBoundingClientRect();
      setViewport({ x: Math.round(width / 2), y: Math.round(height / 2), zoom: 1 });
    }
  }, [shapes.length, fitToContent]);

  /* ------------------------------------------------------------------ */
  /* Export                                                               */
  /* ------------------------------------------------------------------ */

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const exportPng = useCallback(() => {
    if (shapesRef.current.length === 0) {
      showToast("Nothing to export yet");
      return;
    }
    const { svg, width, height } = shapesToSvg(shapesRef.current, { background: "#0b0d14" });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(png);
        link.download = `${(title || "whiteboard").replace(/[^\w\-]+/g, "_")}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        showToast("Exported as PNG");
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("Export failed");
    };
    img.src = url;
  }, [showToast, title]);

  const clearBoard = useCallback(() => {
    deleteShapes(shapesRef.current.map((s) => s.id));
    setConfirmClear(false);
    showToast("Board cleared");
  }, [deleteShapes, showToast]);

  /* ------------------------------------------------------------------ */
  /* Text editing                                                         */
  /* ------------------------------------------------------------------ */

  const editingShape = editingTextId
    ? (shapes.find((s) => s.id === editingTextId) as TextShape | undefined)
    : undefined;

  // Focus the inline editor when it opens (autoFocus is unreliable inside <foreignObject>).
  useEffect(() => {
    if (!editingTextId) return;
    const id = requestAnimationFrame(() => {
      const el = textEditorRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [editingTextId]);

  const commitTextEdit = useCallback(() => {
    if (!editingShape) {
      setEditingTextId(null);
      return;
    }
    if (editingShape.text.trim() === "") {
      deleteShapes([editingShape.id]);
    }
    setEditingTextId(null);
  }, [deleteShapes, editingShape]);

  /* ------------------------------------------------------------------ */
  /* Render                                                               */
  /* ------------------------------------------------------------------ */

  const selectedShape = selectedId ? shapes.find((s) => s.id === selectedId) : undefined;
  const selectedBounds: Rect | null = selectedShape ? getShapeBounds(selectedShape) : null;
  const zoomPercent = Math.round(viewport.zoom * 100);
  const gridSize = 24 * viewport.zoom;
  const showFillToggle = tool === "rect" || tool === "ellipse";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[560px] overflow-hidden rounded-xl border border-border-subtle bg-surface-0 select-none"
      data-testid="whiteboard"
    >
      {/* Canvas */}
      <svg
        ref={svgRef}
        className="wb-canvas absolute inset-0 w-full h-full"
        data-tool={effectiveTool}
        data-dragging={isDragging ? "true" : "false"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={`Collaborative whiteboard${title ? ` for ${title}` : ""}`}
      >
        <defs>
          <pattern
            id="wb-grid"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
            x={viewport.x % gridSize}
            y={viewport.y % gridSize}
          >
            <circle cx={1} cy={1} r={Math.max(0.6, 0.9 * viewport.zoom)} fill="hsl(224 12% 26%)" />
          </pattern>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="url(#wb-grid)" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {shapes.map((shape) => (
            <ShapeView
              key={shape.id}
              shape={shape}
              hidden={shape.id === editingTextId}
              className={effectiveTool === "select" ? "wb-shape-selectable" : undefined}
            />
          ))}

          {/* Remote in-progress strokes */}
          {remoteCursors.map(
            (c) => c.draft && <ShapeView key={`draft-${c.clientId}`} shape={c.draft} ghost />
          )}

          {/* Local draft */}
          {draft && <ShapeView shape={draft} />}

          {/* Selection outline */}
          {selectedBounds && (
            <rect
              x={selectedBounds.x - 6 / viewport.zoom}
              y={selectedBounds.y - 6 / viewport.zoom}
              width={selectedBounds.w + 12 / viewport.zoom}
              height={selectedBounds.h + 12 / viewport.zoom}
              rx={4 / viewport.zoom}
              fill="none"
              stroke="hsl(246 76% 65%)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* Inline text editor */}
          {editingShape && canEdit && (
            <foreignObject
              x={editingShape.x - 4}
              y={editingShape.y - 4}
              width={Math.max(240, editingShape.fontSize * 12)}
              height={Math.max(editingShape.fontSize * 1.6 * (editingShape.text.split("\n").length + 1), 60)}
              style={{ overflow: "visible" }}
            >
              <textarea
                ref={textEditorRef}
                value={editingShape.text}
                placeholder="Type…"
                onChange={(e) => upsertShape({ ...editingShape, text: e.target.value })}
                onBlur={commitTextEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitTextEdit();
                  }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                spellCheck={false}
                className="bg-transparent outline-none resize-none border border-dashed border-brand-400/60 rounded px-1 py-0.5 w-full h-full"
                style={{
                  color: editingShape.stroke,
                  fontSize: editingShape.fontSize,
                  lineHeight: 1.35,
                  fontFamily: "var(--font-sans)",
                  opacity: editingShape.opacity,
                }}
              />
            </foreignObject>
          )}

          {/* Remote cursors */}
          {remoteCursors.map((c) => (
            <g
              key={c.clientId}
              className="wb-remote-cursor"
              transform={`translate(${c.x} ${c.y}) scale(${1 / viewport.zoom})`}
              pointerEvents="none"
            >
              <path
                d="M 0 0 L 0 16 L 4.5 12.5 L 8 19 L 10.5 18 L 7 11.5 L 12.5 11.5 Z"
                fill={c.color}
                stroke="#0b0d14"
                strokeWidth={1}
              />
              <g transform="translate(14 14)">
                <rect
                  x={0}
                  y={0}
                  rx={4}
                  width={c.name.length * 6.5 + 12}
                  height={18}
                  fill={c.color}
                />
                <text x={6} y={12.5} fontSize={11} fontWeight={600} fill="#fff" fontFamily="var(--font-sans)">
                  {c.name}
                </text>
              </g>
            </g>
          ))}
        </g>
      </svg>

      {/* Empty state hint */}
      {shapes.length === 0 && !draft && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center animate-in fade-in zoom-in-95 duration-300">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-300 flex items-center justify-center mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-primary">
              {canEdit ? "A blank canvas, shared in real time" : "Nothing on the board yet"}
            </p>
            <p className="text-xs text-text-muted mt-1 max-w-xs">
              {canEdit
                ? "Draw, drop shapes, write notes. Everyone in this document sees it instantly."
                : "Shapes will appear here as collaborators draw."}
            </p>
            {canEdit && (
              <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-text-muted">
                <span className="kbd">P</span> pen
                <span className="kbd ml-1">R</span> rectangle
                <span className="kbd ml-1">T</span> text
                <span className="kbd ml-1">Space</span> pan
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tool rail */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-1.5 rounded-xl glass shadow-xl animate-in fade-in slide-in-from-right-4 duration-300">
        {TOOL_SHORTCUTS.filter((t) => canEdit || t.tool === "select" || t.tool === "hand").map((t) => (
          <ToolButton
            key={t.tool}
            active={effectiveTool === t.tool && !(spaceHeld && t.tool !== "hand")}
            label={`${t.label} (${t.key})`}
            onClick={() => setTool(t.tool)}
          >
            <ToolIcon tool={t.tool} />
          </ToolButton>
        ))}
      </div>

      {/* Style bar */}
      {canEdit && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-3 px-3 py-2 rounded-xl glass shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Stroke color">
            {WHITEBOARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={stroke === c}
                aria-label={`Color ${c}`}
                onClick={() => {
                  setStroke(c);
                  if (selectedShape) upsertShape({ ...selectedShape, stroke: c, fill: selectedShape.fill === "transparent" ? "transparent" : c });
                }}
                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                  stroke === c ? "border-white scale-110 shadow-[0_0_0_2px_hsl(246_68%_56%)]" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <span className="w-px h-5 bg-border-normal" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Stroke width">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={strokeWidth === w}
                aria-label={`Stroke width ${w}`}
                onClick={() => {
                  setStrokeWidth(w);
                  if (selectedShape) upsertShape({ ...selectedShape, strokeWidth: w });
                }}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  strokeWidth === w ? "bg-surface-4 text-text-primary" : "text-text-muted hover:bg-surface-3 hover:text-text-primary"
                }`}
              >
                <span className="rounded-full bg-current" style={{ width: w + 3, height: w + 3 }} />
              </button>
            ))}
          </div>
          {showFillToggle && (
            <>
              <span className="w-px h-5 bg-border-normal" />
              <button
                type="button"
                aria-pressed={fillEnabled}
                onClick={() => setFillEnabled((v) => !v)}
                className={`px-2 h-7 rounded-lg text-[11px] font-semibold transition-colors ${
                  fillEnabled ? "bg-surface-4 text-text-primary" : "text-text-muted hover:bg-surface-3 hover:text-text-primary"
                }`}
                title="Toggle fill"
              >
                Fill
              </button>
            </>
          )}
          {selectedShape && (
            <>
              <span className="w-px h-5 bg-border-normal" />
              <button
                type="button"
                onClick={duplicateSelected}
                className="px-2 h-7 rounded-lg text-[11px] font-semibold text-text-muted hover:bg-surface-3 hover:text-text-primary"
                title="Duplicate (Ctrl+D)"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => deleteShapes([selectedShape.id])}
                className="px-2 h-7 rounded-lg text-[11px] font-semibold text-red-400 hover:bg-red-500/10"
                title="Delete (Del)"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Top-right: history, zoom, export */}
      <div className="absolute right-3 top-3 flex items-center gap-1 p-1 rounded-xl glass shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
        {canEdit && (
          <>
            <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undoManager.undo()}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l6-6m-6 6l6 6" />
              </svg>
            </IconButton>
            <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => undoManager.redo()}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-6-6m6 6l-6 6" />
              </svg>
            </IconButton>
            <span className="w-px h-5 bg-border-normal mx-0.5" />
          </>
        )}
        <IconButton label="Zoom out (Ctrl+-)" onClick={() => zoomBy(1 / 1.2)}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </IconButton>
        <button
          type="button"
          onClick={() => setViewport((vp) => ({ ...vp, zoom: 1 }))}
          className="min-w-[44px] h-8 px-1.5 rounded-lg text-[11px] font-mono font-semibold text-text-secondary hover:bg-surface-3 hover:text-text-primary tabular-nums"
          title="Reset zoom (Ctrl+0)"
        >
          {zoomPercent}%
        </button>
        <IconButton label="Zoom in (Ctrl++)" onClick={() => zoomBy(1.2)}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </IconButton>
        <IconButton label="Fit to content (Shift+F)" onClick={fitToContent}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4m12-4v4h-4" />
          </svg>
        </IconButton>
        <span className="w-px h-5 bg-border-normal mx-0.5" />
        <IconButton label="Export as PNG" onClick={exportPng}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </IconButton>
        {canEdit && (
          <IconButton label="Clear board" onClick={() => setConfirmClear(true)} disabled={shapes.length === 0} danger>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </IconButton>
        )}
      </div>

      {/* Status chip */}
      <div className="absolute left-3 top-3 flex items-center gap-2 animate-in fade-in duration-300">
        <span className="badge badge-muted bg-surface-1/80 backdrop-blur">
          {shapes.length} {shapes.length === 1 ? "shape" : "shapes"}
        </span>
        {!canEdit && <span className="badge badge-amber">View only</span>}
        {remoteCursors.length > 0 && (
          <span className="badge badge-accent">
            {remoteCursors.length} {remoteCursors.length === 1 ? "person" : "people"} on the board
          </span>
        )}
      </div>

      {toast && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-surface-2 border border-border-normal text-xs text-text-primary shadow-xl animate-toast-in">
          {toast}
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear the whiteboard?"
        description="Every shape will be removed for all collaborators. You can undo this with Ctrl+Z while this tab stays open."
        confirmLabel="Clear board"
        tone="danger"
        onConfirm={clearBoard}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Helpers & small components                                              */
/* ---------------------------------------------------------------------- */

function readShapes(ymap: Y.Map<Shape>): Shape[] {
  const list: Shape[] = [];
  ymap.forEach((value) => {
    if (isShape(value)) list.push(value);
  });
  return sortShapes(list);
}

function squareRect(x1: number, y1: number, x2: number, y2: number): Rect {
  const size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const sx = x2 < x1 ? x1 - size : x1;
  const sy = y2 < y1 ? y1 - size : y1;
  return { x: sx, y: sy, w: size, h: size };
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
        active
          ? "bg-brand-500 text-white shadow-md shadow-brand-500/40"
          : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? "text-text-muted hover:text-red-400 hover:bg-red-500/10"
          : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function ToolIcon({ tool }: { tool: WhiteboardTool }) {
  const common = {
    className: "w-4.5 h-4.5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };
  switch (tool) {
    case "select":
      return (
        <svg {...common}>
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      );
    case "hand":
      return (
        <svg {...common}>
          <path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8" />
          <path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.9-5.7-2.3l-3.4-4.4a1.9 1.9 0 013-2.3L8 15" />
        </svg>
      );
    case "pen":
      return (
        <svg {...common}>
          <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
        </svg>
      );
    case "ellipse":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
        </svg>
      );
    case "line":
      return (
        <svg {...common}>
          <path d="M5 19L19 5" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 19L19 5M19 5h-7M19 5v7" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M5 6V4h14v2M12 4v16m-3 0h6" />
        </svg>
      );
    case "eraser":
      return (
        <svg {...common}>
          <path d="M20 20H9l-5-5a2 2 0 010-2.8L13.2 3a2 2 0 012.8 0l5 5a2 2 0 010 2.8L13 19" />
          <path d="M6 11l7 7" />
        </svg>
      );
    default:
      return null;
  }
}
