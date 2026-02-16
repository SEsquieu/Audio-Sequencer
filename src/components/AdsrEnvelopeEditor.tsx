import { PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";

type AdsrKey = "attack" | "decay" | "sustain" | "release";
type HandleKind = AdsrKey | null;

interface AdsrEnvelopeEditorProps {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  onChange: (key: AdsrKey, value: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
const invLerp = (min: number, max: number, value: number) =>
  max - min === 0 ? 0 : (value - min) / (max - min);

const ATTACK_MIN = 0;
const ATTACK_MAX = 0.5;
const DECAY_MIN = 0.01;
const DECAY_MAX = 0.8;
const SUSTAIN_MIN = 0;
const SUSTAIN_MAX = 1;
const RELEASE_MIN = 0.01;
const RELEASE_MAX = 1;

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 170;
const PAD_X = 20;
const PAD_TOP = 14;
const PAD_BOTTOM = 20;
const MIN_SEG = 16;

export function AdsrEnvelopeEditor({ attack, decay, sustain, release, onChange }: AdsrEnvelopeEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<HandleKind>(null);

  const geometry = useMemo(() => {
    const x0 = PAD_X;
    const xEnd = VIEW_WIDTH - PAD_X;
    const yTop = PAD_TOP;
    const yBottom = VIEW_HEIGHT - PAD_BOTTOM;
    const innerW = xEnd - x0;
    const segmentMax = innerW * 0.36;

    const attackSeg = lerp(MIN_SEG, segmentMax, clamp(invLerp(ATTACK_MIN, ATTACK_MAX, attack), 0, 1));
    const decaySeg = lerp(MIN_SEG, segmentMax, clamp(invLerp(DECAY_MIN, DECAY_MAX, decay), 0, 1));
    const releaseSeg = lerp(MIN_SEG, segmentMax, clamp(invLerp(RELEASE_MIN, RELEASE_MAX, release), 0, 1));

    const attackX = x0 + attackSeg;
    const decayX = clamp(attackX + decaySeg, x0 + MIN_SEG * 2, xEnd - MIN_SEG * 2);
    const releaseX = clamp(xEnd - releaseSeg, decayX + MIN_SEG, xEnd - MIN_SEG);
    const sustainY = lerp(yBottom, yTop, clamp(invLerp(SUSTAIN_MIN, SUSTAIN_MAX, sustain), 0, 1));

    return { x0, xEnd, yTop, yBottom, innerW, segmentMax, attackX, decayX, releaseX, sustainY };
  }, [attack, decay, release, sustain]);

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT,
    };
  };

  const updateByPointer = (kind: HandleKind, x: number, y: number) => {
    const { x0, xEnd, yTop, yBottom, segmentMax, attackX, decayX, releaseX } = geometry;

    if (kind === "attack") {
      const nextX = clamp(x, x0 + MIN_SEG, decayX - MIN_SEG);
      const seg = clamp(nextX - x0, MIN_SEG, segmentMax);
      const nextAttack = lerp(ATTACK_MIN, ATTACK_MAX, clamp(invLerp(MIN_SEG, segmentMax, seg), 0, 1));
      onChange("attack", Number(nextAttack.toFixed(3)));
      return;
    }

    if (kind === "decay") {
      const nextX = clamp(x, attackX + MIN_SEG, releaseX - MIN_SEG);
      const seg = clamp(nextX - attackX, MIN_SEG, segmentMax);
      const nextDecay = lerp(DECAY_MIN, DECAY_MAX, clamp(invLerp(MIN_SEG, segmentMax, seg), 0, 1));
      onChange("decay", Number(nextDecay.toFixed(3)));
      return;
    }

    if (kind === "release") {
      const nextX = clamp(x, decayX + MIN_SEG, xEnd - MIN_SEG);
      const seg = clamp(xEnd - nextX, MIN_SEG, segmentMax);
      const nextRelease = lerp(RELEASE_MIN, RELEASE_MAX, clamp(invLerp(MIN_SEG, segmentMax, seg), 0, 1));
      onChange("release", Number(nextRelease.toFixed(3)));
      return;
    }

    if (kind === "sustain") {
      const nextY = clamp(y, yTop, yBottom);
      const nextSustain = lerp(SUSTAIN_MIN, SUSTAIN_MAX, clamp(invLerp(yBottom, yTop, nextY), 0, 1));
      onChange("sustain", Number(nextSustain.toFixed(3)));
    }
  };

  const onPointerDown = (kind: HandleKind) => (event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(kind);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) {
      return;
    }
    const point = pointFromEvent(event);
    updateByPointer(dragging, point.x, point.y);
  };

  const onPointerEnd = () => setDragging(null);

  const sustainHandleX = (geometry.decayX + geometry.releaseX) / 2;
  const pathD = `M ${geometry.x0} ${geometry.yBottom}
    L ${geometry.attackX} ${geometry.yTop}
    L ${geometry.decayX} ${geometry.sustainY}
    L ${geometry.releaseX} ${geometry.sustainY}
    L ${geometry.xEnd} ${geometry.yBottom}`;

  return (
    <div className="adsr-editor" aria-label="ADSR Envelope Editor">
      <div className="adsr-header">
        <span>Envelope (ADSR)</span>
        <span>
          A {attack.toFixed(2)} D {decay.toFixed(2)} S {sustain.toFixed(2)} R {release.toFixed(2)}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="adsr-svg"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} className="adsr-bg" />
        <line x1={geometry.x0} y1={geometry.yBottom} x2={geometry.xEnd} y2={geometry.yBottom} className="adsr-axis" />
        <line x1={geometry.x0} y1={geometry.yTop} x2={geometry.x0} y2={geometry.yBottom} className="adsr-axis" />

        <path
          d={`M ${geometry.x0} ${geometry.yBottom}
            L ${geometry.attackX} ${geometry.yTop}
            L ${geometry.decayX} ${geometry.sustainY}
            L ${geometry.releaseX} ${geometry.sustainY}
            L ${geometry.xEnd} ${geometry.yBottom}
            L ${geometry.xEnd} ${geometry.yBottom}
            L ${geometry.x0} ${geometry.yBottom} Z`}
          className="adsr-fill"
        />
        <path d={pathD} className="adsr-line" />

        <circle
          cx={geometry.attackX}
          cy={geometry.yTop}
          r={10}
          className="adsr-hit"
          onPointerDown={onPointerDown("attack")}
        />
        <circle
          cx={geometry.decayX}
          cy={geometry.sustainY}
          r={10}
          className="adsr-hit"
          onPointerDown={onPointerDown("decay")}
        />
        <circle
          cx={sustainHandleX}
          cy={geometry.sustainY}
          r={10}
          className="adsr-hit"
          onPointerDown={onPointerDown("sustain")}
        />
        <circle
          cx={geometry.releaseX}
          cy={geometry.sustainY}
          r={10}
          className="adsr-hit"
          onPointerDown={onPointerDown("release")}
        />
      </svg>
    </div>
  );
}

