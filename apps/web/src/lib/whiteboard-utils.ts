/**
 * Pure helpers for the collaborative whiteboard.
 * No DOM / React / Yjs imports — safe to unit test and to run on the server.
 */

export type WhiteboardTool =
  | "select"
  | "hand"
  | "pen"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "eraser";

export type ShapeType = "path" | "rect" | "ellipse" | "line" | "arrow" | "text";

export interface ShapeStyle {
  stroke: string;
  fill: string; // "transparent" or a color
  strokeWidth: number;
  opacity: number;
}

interface ShapeBase extends ShapeStyle {
  id: string;
  type: ShapeType;
  /** Top-left of the shape's bounding box (world coordinates). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; higher renders on top. */
  z: number;
  createdBy: string;
  createdAt: number;
}

export interface PathShape extends ShapeBase {
  type: "path";
  /** Flat list of absolute world points [x0, y0, x1, y1, …]. */
  points: number[];
}

export interface RectShape extends ShapeBase {
  type: "rect";
  radius: number;
}

export interface EllipseShape extends ShapeBase {
  type: "ellipse";
}

export interface LineShape extends ShapeBase {
  type: "line" | "arrow";
  /** Start point. */
  x1: number;
  y1: number;
  /** End point. */
  x2: number;
  y2: number;
}

export interface TextShape extends ShapeBase {
  type: "text";
  text: string;
  fontSize: number;
}

export type Shape = PathShape | RectShape | EllipseShape | LineShape | TextShape;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  /** World-space translation applied before scaling (screen = world * zoom + offset). */
  x: number;
  y: number;
  zoom: number;
}

export const WHITEBOARD_COLORS = [
  "#f4f4f5", // zinc-100 (white ink on dark canvas)
  "#8b7cf6", // brand violet
  "#34d399", // emerald
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#f472b6", // pink
  "#fb7185", // rose
  "#22d3ee", // cyan
] as const;

export const STROKE_WIDTHS = [2, 4, 8] as const;

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export const DEFAULT_STYLE: ShapeStyle = {
  stroke: WHITEBOARD_COLORS[0],
  fill: "transparent",
  strokeWidth: 4,
  opacity: 1,
};

/* ------------------------------------------------------------------ */
/* IDs                                                                 */
/* ------------------------------------------------------------------ */

export function createShapeId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  ).slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalises two corner points into a rect with non-negative size. */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

/**
 * Zooms around a fixed screen point so the world point under the cursor stays put.
 */
export function zoomViewportAt(viewport: Viewport, screenPoint: Point, nextZoom: number): Viewport {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const world = screenToWorld(screenPoint, viewport);
  return {
    zoom,
    x: screenPoint.x - world.x * zoom,
    y: screenPoint.y - world.y * zoom,
  };
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Distance from point P to segment AB. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(px, py, ax, ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return distance(px, py, ax + t * dx, ay + t * dy);
}

/** Bounding box of a flat point list. */
export function pointsBounds(points: number[]): Rect {
  if (points.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Ramer–Douglas–Peucker simplification on a flat [x,y,…] list.
 * Keeps the stroke's shape while dropping redundant samples (smaller CRDT payload).
 */
export function simplifyPoints(points: number[], tolerance = 0.75): number[] {
  const n = points.length / 2;
  if (n <= 2 || tolerance <= 0) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    const ax = points[start * 2];
    const ay = points[start * 2 + 1];
    const bx = points[end * 2];
    const by = points[end * 2 + 1];
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i * 2], points[i * 2 + 1], ax, ay, bx, by);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

/**
 * Builds a smooth SVG path (`d` attribute) through a flat point list using
 * quadratic curves between midpoints — the classic "freehand ink" look.
 */
export function pointsToSvgPath(points: number[]): string {
  const n = points.length / 2;
  if (n === 0) return "";
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  if (n === 1) {
    // A dot: draw a tiny closed segment so stroke-linecap renders it.
    return `M ${fmt(points[0])} ${fmt(points[1])} L ${fmt(points[0] + 0.01)} ${fmt(points[1])}`;
  }
  if (n === 2) {
    return `M ${fmt(points[0])} ${fmt(points[1])} L ${fmt(points[2])} ${fmt(points[3])}`;
  }
  let d = `M ${fmt(points[0])} ${fmt(points[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const nx = points[(i + 1) * 2];
    const ny = points[(i + 1) * 2 + 1];
    const mx = (x + nx) / 2;
    const my = (y + ny) / 2;
    d += ` Q ${fmt(x)} ${fmt(y)} ${fmt(mx)} ${fmt(my)}`;
  }
  d += ` L ${fmt(points[(n - 1) * 2])} ${fmt(points[(n - 1) * 2 + 1])}`;
  return d;
}

/** Returns the two wing points of an arrow head ending at (x2, y2). */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number
): [Point, Point] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) },
    { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) },
  ];
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Approximate text box size used for hit testing and export. */
export function estimateTextSize(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    w: Math.max(fontSize * 0.6 * longest, fontSize),
    h: Math.max(lines.length, 1) * fontSize * 1.35,
  };
}

export function getShapeBounds(shape: Shape): Rect {
  switch (shape.type) {
    case "path":
      return pointsBounds(shape.points);
    case "line":
    case "arrow":
      return normalizeRect(shape.x1, shape.y1, shape.x2, shape.y2);
    case "text": {
      const size = estimateTextSize(shape.text, shape.fontSize);
      return { x: shape.x, y: shape.y, w: size.w, h: size.h };
    }
    default:
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
}

export function rectContains(rect: Rect, px: number, py: number, pad = 0): boolean {
  return (
    px >= rect.x - pad &&
    px <= rect.x + rect.w + pad &&
    py >= rect.y - pad &&
    py <= rect.y + rect.h + pad
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Union of several rects; returns null for an empty list. */
export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Hit test a world point against a shape. `tolerance` is in world units and
 * should scale with the inverse of the zoom so the hit area feels constant on screen.
 */
export function hitTestShape(shape: Shape, px: number, py: number, tolerance = 6): boolean {
  const pad = tolerance + shape.strokeWidth / 2;
  switch (shape.type) {
    case "path": {
      const bounds = pointsBounds(shape.points);
      if (!rectContains(bounds, px, py, pad)) return false;
      const pts = shape.points;
      if (pts.length === 2) return distance(px, py, pts[0], pts[1]) <= pad;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (distanceToSegment(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= pad) {
          return true;
        }
      }
      return false;
    }
    case "line":
    case "arrow":
      return distanceToSegment(px, py, shape.x1, shape.y1, shape.x2, shape.y2) <= pad;
    case "rect": {
      const bounds = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
      if (shape.fill !== "transparent") return rectContains(bounds, px, py, pad);
      // Hollow: hit the border band only
      const outside = rectContains(bounds, px, py, pad);
      const inside = rectContains(bounds, px, py, -pad);
      return outside && !inside;
    }
    case "ellipse": {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const rx = Math.max(shape.w / 2, 0.001);
      const ry = Math.max(shape.h / 2, 0.001);
      const norm = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2; // 1 on the ring
      const ringTolerance = pad / Math.min(rx, ry);
      if (shape.fill !== "transparent") return norm <= 1 + ringTolerance;
      return Math.abs(Math.sqrt(norm) - 1) <= ringTolerance;
    }
    case "text":
      return rectContains(getShapeBounds(shape), px, py, tolerance);
    default:
      return false;
  }
}

export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  switch (shape.type) {
    case "path": {
      const points = shape.points.slice();
      for (let i = 0; i < points.length; i += 2) {
        points[i] += dx;
        points[i + 1] += dy;
      }
      return { ...shape, x: shape.x + dx, y: shape.y + dy, points };
    }
    case "line":
    case "arrow":
      return {
        ...shape,
        x: shape.x + dx,
        y: shape.y + dy,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
      };
    default:
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
  }
}

/** Finds the topmost shape under a point. */
export function findShapeAt(shapes: Shape[], px: number, py: number, tolerance = 6): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hitTestShape(shapes[i], px, py, tolerance)) return shapes[i];
  }
  return null;
}

/** Sorts shapes for rendering: by z, then creation time for stability. */
export function sortShapes(shapes: Shape[]): Shape[] {
  return shapes.slice().sort((a, b) => a.z - b.z || a.createdAt - b.createdAt);
}

export function nextZIndex(shapes: Shape[]): number {
  let max = 0;
  for (const s of shapes) if (s.z > max) max = s.z;
  return max + 1;
}

/** Runtime validation for data arriving over the network. */
export function isShape(value: unknown): value is Shape {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.type !== "string") return false;
  if (typeof s.x !== "number" || typeof s.y !== "number") return false;
  switch (s.type) {
    case "path":
      return Array.isArray(s.points);
    case "line":
    case "arrow":
      return (
        typeof s.x1 === "number" &&
        typeof s.y1 === "number" &&
        typeof s.x2 === "number" &&
        typeof s.y2 === "number"
      );
    case "text":
      return typeof s.text === "string";
    case "rect":
    case "ellipse":
      return typeof s.w === "number" && typeof s.h === "number";
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shapeToSvgElement(shape: Shape): string {
  const common = `stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}" opacity="${shape.opacity}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (shape.type) {
    case "path":
      return `<path d="${pointsToSvgPath(shape.points)}" fill="none" ${common} />`;
    case "rect":
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.radius}" fill="${shape.fill}" ${common} />`;
    case "ellipse":
      return `<ellipse cx="${shape.x + shape.w / 2}" cy="${shape.y + shape.h / 2}" rx="${shape.w / 2}" ry="${shape.h / 2}" fill="${shape.fill}" ${common} />`;
    case "line":
      return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${common} />`;
    case "arrow": {
      const size = Math.max(10, shape.strokeWidth * 3.5);
      const [a, b] = arrowHead(shape.x1, shape.y1, shape.x2, shape.y2, size);
      return (
        `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" ${common} />` +
        `<polyline points="${a.x},${a.y} ${shape.x2},${shape.y2} ${b.x},${b.y}" fill="none" ${common} />`
      );
    }
    case "text": {
      const lines = shape.text.split("\n");
      const tspans = lines
        .map(
          (line, i) =>
            `<tspan x="${shape.x}" dy="${i === 0 ? shape.fontSize : shape.fontSize * 1.35}">${escapeXml(line) || " "}</tspan>`
        )
        .join("");
      return `<text x="${shape.x}" y="${shape.y}" fill="${shape.stroke}" font-size="${shape.fontSize}" font-family="Inter, system-ui, sans-serif" opacity="${shape.opacity}">${tspans}</text>`;
    }
    default:
      return "";
  }
}

/**
 * Serialises the board to a standalone SVG document, cropped to the content with
 * padding. Used for PNG/SVG export.
 */
export function shapesToSvg(
  shapes: Shape[],
  options: { padding?: number; background?: string } = {}
): { svg: string; width: number; height: number } {
  const padding = options.padding ?? 32;
  const background = options.background ?? "#0b0d14";
  const bounds = unionRects(shapes.map(getShapeBounds)) ?? { x: 0, y: 0, w: 400, h: 300 };
  const width = Math.max(1, Math.ceil(bounds.w + padding * 2));
  const height = Math.max(1, Math.ceil(bounds.h + padding * 2));
  const body = sortShapes(shapes).map(shapeToSvgElement).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x - padding} ${bounds.y - padding} ${width} ${height}">` +
    `<rect x="${bounds.x - padding}" y="${bounds.y - padding}" width="${width}" height="${height}" fill="${background}" />` +
    body +
    `</svg>`;
  return { svg, width, height };
}
