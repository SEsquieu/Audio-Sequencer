import { PointerEvent as ReactPointerEvent, useRef, useState } from "react";

type ModKey = "detune" | "drive" | "vibratoRate" | "vibratoDepth";

interface SynthModPadsProps {
  detune: number;
  drive: number;
  vibratoRate: number;
  vibratoDepth: number;
  onChange: (key: ModKey, value: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
const invLerp = (min: number, max: number, value: number) =>
  max - min === 0 ? 0 : (value - min) / (max - min);

const W = 360;
const H = 145;
const PAD = 14;

const renderPad = (
  title: string,
  xLabel: string,
  yLabel: string,
  xNorm: number,
  yNorm: number,
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void,
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void,
  onPointerUp: () => void
) => {
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const x = PAD + innerW * xNorm;
  const y = PAD + innerH * (1 - yNorm);

  return (
    <div className="mod-pad-card">
      <div className="mod-pad-title">{title}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mod-pad-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={0} y={0} width={W} height={H} className="mod-pad-bg" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="mod-pad-axis" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className="mod-pad-axis" />
        <line x1={x} y1={PAD} x2={x} y2={H - PAD} className="mod-pad-cross" />
        <line x1={PAD} y1={y} x2={W - PAD} y2={y} className="mod-pad-cross" />
        <circle cx={x} cy={y} r={10} className="mod-pad-handle" />
        <text x={PAD + 4} y={PAD + 12} className="mod-pad-label">
          {yLabel}
        </text>
        <text x={W - PAD - 4} y={H - PAD - 4} textAnchor="end" className="mod-pad-label">
          {xLabel}
        </text>
      </svg>
    </div>
  );
};

export function SynthModPads({ detune, drive, vibratoRate, vibratoDepth, onChange }: SynthModPadsProps) {
  const harmonicsRef = useRef<SVGSVGElement | null>(null);
  const motionRef = useRef<SVGSVGElement | null>(null);
  const [draggingPad, setDraggingPad] = useState<"harmonics" | "motion" | null>(null);

  const pointFromEvent = (
    event: ReactPointerEvent<SVGSVGElement>,
    ref: { current: SVGSVGElement | null }
  ) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) {
      return { xNorm: 0, yNorm: 0 };
    }
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const py = ((event.clientY - rect.top) / rect.height) * H;
    const xNorm = clamp((px - PAD) / (W - PAD * 2), 0, 1);
    const yNorm = clamp(1 - (py - PAD) / (H - PAD * 2), 0, 1);
    return { xNorm, yNorm };
  };

  const updateHarmonics = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { xNorm, yNorm } = pointFromEvent(event, harmonicsRef);
    onChange("detune", Number(lerp(0, 30, xNorm).toFixed(2)));
    onChange("drive", Number(lerp(0, 1, yNorm).toFixed(3)));
  };

  const updateMotion = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { xNorm, yNorm } = pointFromEvent(event, motionRef);
    onChange("vibratoRate", Number(lerp(0, 12, xNorm).toFixed(2)));
    onChange("vibratoDepth", Number(lerp(0, 60, yNorm).toFixed(2)));
  };

  const detuneNorm = clamp(invLerp(0, 30, detune), 0, 1);
  const driveNorm = clamp(invLerp(0, 1, drive), 0, 1);
  const vibRateNorm = clamp(invLerp(0, 12, vibratoRate), 0, 1);
  const vibDepthNorm = clamp(invLerp(0, 60, vibratoDepth), 0, 1);

  return (
    <div className="mod-pads">
      {renderPad(
        "Harmonics",
        `Detune ${detune.toFixed(1)}c`,
        `Drive ${drive.toFixed(2)}`,
        detuneNorm,
        driveNorm,
        (event) => {
          event.preventDefault();
          harmonicsRef.current = event.currentTarget;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraggingPad("harmonics");
          updateHarmonics(event);
        },
        (event) => {
          if (draggingPad !== "harmonics") {
            return;
          }
          updateHarmonics(event);
        },
        () => setDraggingPad(null)
      )}
      {renderPad(
        "Motion",
        `Rate ${vibratoRate.toFixed(1)} Hz`,
        `Depth ${vibratoDepth.toFixed(1)}c`,
        vibRateNorm,
        vibDepthNorm,
        (event) => {
          event.preventDefault();
          motionRef.current = event.currentTarget;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraggingPad("motion");
          updateMotion(event);
        },
        (event) => {
          if (draggingPad !== "motion") {
            return;
          }
          updateMotion(event);
        },
        () => setDraggingPad(null)
      )}
    </div>
  );
}
