"use client";

import React from "react";
import { arrowHead, pointsToSvgPath, type Shape } from "@/lib/whiteboard-utils";

interface ShapeViewProps {
  shape: Shape;
  /** Render semi-transparent (used for other users' in-progress strokes). */
  ghost?: boolean;
  /** Skip rendering (used while the inline text editor is open for this shape). */
  hidden?: boolean;
  className?: string;
}

/**
 * Renders a single whiteboard shape as SVG. Memoised: the whiteboard re-renders on
 * every pointer move, but a shape's element only changes when its data does.
 */
export const ShapeView = React.memo(function ShapeView({ shape, ghost, hidden, className }: ShapeViewProps) {
  if (hidden) return null;

  const opacity = ghost ? Math.min(shape.opacity, 0.5) : shape.opacity;
  const common = {
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    opacity,
    className,
    "data-shape-id": shape.id,
  };

  switch (shape.type) {
    case "path":
      return <path d={pointsToSvgPath(shape.points)} fill="none" {...common} />;
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={Math.max(shape.w, 0.01)}
          height={Math.max(shape.h, 0.01)}
          rx={shape.radius}
          fill={shape.fill}
          fillOpacity={shape.fill === "transparent" ? 0 : 0.28}
          {...common}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={shape.x + shape.w / 2}
          cy={shape.y + shape.h / 2}
          rx={Math.max(shape.w / 2, 0.01)}
          ry={Math.max(shape.h / 2, 0.01)}
          fill={shape.fill}
          fillOpacity={shape.fill === "transparent" ? 0 : 0.28}
          {...common}
        />
      );
    case "line":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...common} />;
    case "arrow": {
      const size = Math.max(10, shape.strokeWidth * 3.5);
      const [a, b] = arrowHead(shape.x1, shape.y1, shape.x2, shape.y2, size);
      return (
        <g {...common} fill="none">
          <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
          <polyline points={`${a.x},${a.y} ${shape.x2},${shape.y2} ${b.x},${b.y}`} />
        </g>
      );
    }
    case "text": {
      const lines = shape.text.split("\n");
      return (
        <text
          x={shape.x}
          y={shape.y}
          fill={shape.stroke}
          fontSize={shape.fontSize}
          fontFamily="var(--font-sans)"
          opacity={opacity}
          className={className}
          data-shape-id={shape.id}
          style={{ whiteSpace: "pre" }}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={shape.x} dy={i === 0 ? shape.fontSize : shape.fontSize * 1.35}>
              {line || " "}
            </tspan>
          ))}
        </text>
      );
    }
    default:
      return null;
  }
});
