import {
  normalizeRect,
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
  distanceToSegment,
  simplifyPoints,
  pointsToSvgPath,
  pointsBounds,
  hitTestShape,
  translateShape,
  findShapeAt,
  sortShapes,
  nextZIndex,
  isShape,
  shapesToSvg,
  arrowHead,
  unionRects,
  MIN_ZOOM,
  MAX_ZOOM,
  type Shape,
  type PathShape,
  type RectShape,
  type LineShape,
  type TextShape,
  type EllipseShape,
} from "../whiteboard-utils";

const base = {
  stroke: "#fff",
  fill: "transparent",
  strokeWidth: 2,
  opacity: 1,
  z: 1,
  createdBy: "usr_1",
  createdAt: 1,
};

const rect: RectShape = { ...base, id: "r1", type: "rect", x: 10, y: 10, w: 100, h: 50, radius: 4 };
const filledRect: RectShape = { ...rect, id: "r2", fill: "#f00" };
const ellipse: EllipseShape = { ...base, id: "e1", type: "ellipse", x: 0, y: 0, w: 100, h: 100 };
const line: LineShape = { ...base, id: "l1", type: "line", x: 0, y: 0, w: 100, h: 0, x1: 0, y1: 0, x2: 100, y2: 0 };
const path: PathShape = {
  ...base,
  id: "p1",
  type: "path",
  x: 0,
  y: 0,
  w: 50,
  h: 50,
  points: [0, 0, 25, 25, 50, 50],
};
const text: TextShape = { ...base, id: "t1", type: "text", x: 200, y: 200, w: 0, h: 0, text: "Hello", fontSize: 20 };

describe("whiteboard-utils", () => {
  describe("geometry", () => {
    it("normalizes rects drawn in any direction", () => {
      expect(normalizeRect(50, 60, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
      expect(normalizeRect(0, 0, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    });

    it("round-trips screen <-> world coordinates", () => {
      const vp = { x: 100, y: -40, zoom: 2 };
      const world = screenToWorld({ x: 300, y: 60 }, vp);
      expect(world).toEqual({ x: 100, y: 50 });
      expect(worldToScreen(world, vp)).toEqual({ x: 300, y: 60 });
    });

    it("zooms around the cursor so the point under it stays fixed", () => {
      const vp = { x: 0, y: 0, zoom: 1 };
      const cursor = { x: 200, y: 100 };
      const before = screenToWorld(cursor, vp);
      const next = zoomViewportAt(vp, cursor, 2);
      const after = screenToWorld(cursor, next);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(next.zoom).toBe(2);
    });

    it("clamps zoom to the allowed range", () => {
      const vp = { x: 0, y: 0, zoom: 1 };
      expect(zoomViewportAt(vp, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM);
      expect(zoomViewportAt(vp, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
    });

    it("computes distance to a segment", () => {
      expect(distanceToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
      expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBe(5); // beyond endpoint A
      expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5); // degenerate segment
    });

    it("computes arrow head wings behind the tip", () => {
      const [a, b] = arrowHead(0, 0, 100, 0, 10);
      expect(a.x).toBeLessThan(100);
      expect(b.x).toBeLessThan(100);
      expect(a.y).toBeCloseTo(-b.y);
    });

    it("unions rects and returns null for no rects", () => {
      expect(unionRects([])).toBeNull();
      expect(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 20, h: 20 }])).toEqual({
        x: 0,
        y: 0,
        w: 25,
        h: 25,
      });
    });
  });

  describe("freehand paths", () => {
    it("drops collinear points when simplifying", () => {
      const pts = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 10, 0];
      expect(simplifyPoints(pts, 0.5)).toEqual([0, 0, 10, 0]);
    });

    it("keeps corners when simplifying", () => {
      const pts = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10];
      expect(simplifyPoints(pts, 0.5)).toEqual([0, 0, 10, 0, 10, 10]);
    });

    it("returns short lists untouched", () => {
      expect(simplifyPoints([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
    });

    it("builds an SVG path with quadratic smoothing", () => {
      const d = pointsToSvgPath([0, 0, 10, 10, 20, 0]);
      expect(d.startsWith("M 0 0")).toBe(true);
      expect(d).toContain("Q 10 10 15 5");
      expect(d.endsWith("L 20 0")).toBe(true);
      expect(pointsToSvgPath([])).toBe("");
      expect(pointsToSvgPath([3, 3])).toContain("M 3 3");
    });

    it("computes bounds of a point list", () => {
      expect(pointsBounds([5, 5, -5, 10, 0, 0])).toEqual({ x: -5, y: 0, w: 10, h: 10 });
    });
  });

  describe("hit testing", () => {
    it("hits hollow rectangles only on their border", () => {
      expect(hitTestShape(rect, 10, 30, 2)).toBe(true); // left edge
      expect(hitTestShape(rect, 60, 35, 2)).toBe(false); // interior
      expect(hitTestShape(filledRect, 60, 35, 2)).toBe(true); // filled interior
      expect(hitTestShape(rect, 500, 500, 2)).toBe(false);
    });

    it("hits ellipses on the ring or inside when filled", () => {
      expect(hitTestShape(ellipse, 100, 50, 2)).toBe(true); // right edge
      expect(hitTestShape(ellipse, 50, 50, 2)).toBe(false); // centre of hollow ellipse
      expect(hitTestShape({ ...ellipse, fill: "#0f0" }, 50, 50, 2)).toBe(true);
    });

    it("hits lines and paths near their segments", () => {
      expect(hitTestShape(line, 50, 2, 2)).toBe(true);
      expect(hitTestShape(line, 50, 20, 2)).toBe(false);
      expect(hitTestShape(path, 25, 26, 2)).toBe(true);
      expect(hitTestShape(path, 0, 40, 2)).toBe(false);
    });

    it("hits text by its estimated box", () => {
      expect(hitTestShape(text, 210, 210, 2)).toBe(true);
      expect(hitTestShape(text, 100, 100, 2)).toBe(false);
    });

    it("finds the topmost shape under a point", () => {
      const topRect: RectShape = { ...filledRect, id: "top", z: 5 };
      const shapes = sortShapes([topRect, filledRect]);
      expect(findShapeAt(shapes, 60, 35)?.id).toBe("top");
      expect(findShapeAt(shapes, 900, 900)).toBeNull();
    });
  });

  describe("shape ops", () => {
    it("translates every shape kind", () => {
      expect(translateShape(rect, 5, -5)).toMatchObject({ x: 15, y: 5 });
      expect(translateShape(line, 1, 1)).toMatchObject({ x1: 1, y1: 1, x2: 101, y2: 1 });
      expect(translateShape(path, 2, 2).points).toEqual([2, 2, 27, 27, 52, 52]);
      expect(translateShape(text, 0, 10)).toMatchObject({ x: 200, y: 210 });
    });

    it("sorts by z then creation time and computes the next z", () => {
      const a: Shape = { ...rect, id: "a", z: 2, createdAt: 2 };
      const b: Shape = { ...rect, id: "b", z: 1, createdAt: 9 };
      const c: Shape = { ...rect, id: "c", z: 2, createdAt: 1 };
      expect(sortShapes([a, b, c]).map((s) => s.id)).toEqual(["b", "c", "a"]);
      expect(nextZIndex([a, b, c])).toBe(3);
      expect(nextZIndex([])).toBe(1);
    });

    it("validates shapes coming over the wire", () => {
      expect(isShape(rect)).toBe(true);
      expect(isShape(line)).toBe(true);
      expect(isShape(text)).toBe(true);
      expect(isShape({ id: "x", type: "rect", x: 0, y: 0 })).toBe(false);
      expect(isShape({ id: "x", type: "unicorn", x: 0, y: 0 })).toBe(false);
      expect(isShape(null)).toBe(false);
      expect(isShape("nope")).toBe(false);
    });
  });

  describe("export", () => {
    it("serialises shapes to a cropped standalone SVG", () => {
      const { svg, width, height } = shapesToSvg([rect, line, text, path, ellipse], { padding: 10 });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toContain("<rect");
      expect(svg).toContain("<line");
      expect(svg).toContain("<text");
      expect(svg).toContain("<path");
      expect(svg).toContain("<ellipse");
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });

    it("escapes text content", () => {
      const evil: TextShape = { ...text, text: '<script>alert("x")</script>' };
      const { svg } = shapesToSvg([evil]);
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&lt;script&gt;");
    });

    it("produces a non-empty canvas for an empty board", () => {
      const { width, height } = shapesToSvg([]);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });
  });
});
