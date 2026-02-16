import { PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";

interface FilterEqPadProps {
  cutoff: number;
  resonance: number;
  onChange: (key: "cutoff" | "resonance", value: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
const invLerp = (min: number, max: number, value: number) =>
  max - min === 0 ? 0 : (value - min) / (max - min);

const CUT_MIN = 200;
const CUT_MAX = 10000;
const RES_MIN = 0.1;
const RES_MAX = 12;

const VIEW_W = 360;
const VIEW_H = 170;
const PAD_X = 16;
const PAD_Y = 14;

export function FilterEqPad({ cutoff, resonance, onChange }: FilterEqPadProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const xNorm = clamp(invLerp(CUT_MIN, CUT_MAX, cutoff), 0, 1);
  const yNorm = clamp(invLerp(RES_MIN, RES_MAX, resonance), 0, 1);

  const geometry = useMemo(() => {
    const w = VIEW_W - PAD_X * 2;
    const h = VIEW_H - PAD_Y * 2;
    const handleX = PAD_X + w * xNorm;
    const handleY = PAD_Y + h * (1 - yNorm);

    const points: string[] = [];
    const samples = 64;
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = PAD_X + w * t;

      const cutoffCenter = xNorm;
      const slope = 18 + yNorm * 12;
      const lowpassDrop = 1 / (1 + Math.exp((t - cutoffCenter) * slope));

      const bumpWidth = lerp(0.22, 0.06, yNorm);
      const bumpAmp = lerp(0.02, 0.42, yNorm);
      const bump = bumpAmp * Math.exp(-((t - cutoffCenter) ** 2) / (2 * bumpWidth * bumpWidth));

      const response = clamp(lowpassDrop + bump, 0.02, 1);
      const y = PAD_Y + h * (1 - response);
      points.push(`${x},${y}`);
    }

    return { w, h, handleX, handleY, points };
  }, [xNorm, yNorm]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const px = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const py = ((event.clientY - rect.top) / rect.height) * VIEW_H;

    const nx = clamp((px - PAD_X) / geometry.w, 0, 1);
    const ny = clamp(1 - (py - PAD_Y) / geometry.h, 0, 1);

    const nextCutoff = Math.round(lerp(CUT_MIN, CUT_MAX, nx));
    const nextRes = Number(lerp(RES_MIN, RES_MAX, ny).toFixed(2));

    onChange("cutoff", nextCutoff);
    onChange("resonance", nextRes);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromPointer(event);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) {
      return;
    }
    updateFromPointer(event);
  };

  const onPointerEnd = () => setDragging(false);

  return (
    <div className="filter-pad" aria-label="Filter EQ Pad">
      <div className="filter-pad-header">
        <span>Filter EQ</span>
        <span>
          Cutoff {Math.round(cutoff)} Hz | Q {resonance.toFixed(2)}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="filter-pad-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="filter-pad-bg" />
        <line x1={PAD_X} y1={VIEW_H - PAD_Y} x2={VIEW_W - PAD_X} y2={VIEW_H - PAD_Y} className="filter-axis" />
        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={VIEW_H - PAD_Y} className="filter-axis" />
        <polyline points={geometry.points.join(" ")} className="filter-curve" />
        <circle cx={geometry.handleX} cy={geometry.handleY} r={10} className="filter-handle" />
      </svg>
    </div>
  );
}

