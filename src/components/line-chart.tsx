"use client";

// Generic SVG line chart used by the implied-temp-over-time and
// multi-horizon accuracy sections. X-axis renders reversed (high → 0)
// to read as "hours until resolution".

export interface Series {
  name:    string;
  color:   string;
  dashed?: boolean;
  points:  { x: number; y: number }[];
}

interface Props {
  series:      Series[];
  xLabel:      string;
  yUnit:       string;
  yZeroFloor?: boolean; // force y-axis to start at 0 (for error charts)
}

const ML = 46;
const MR = 12;
const MT = 10;
const MB = 44;
const W  = 600;
const H  = 260;
const PW = W - ML - MR;
const PH = H - MT - MB;

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const step = Math.max(1, Math.ceil(span / count));
  const ticks: number[] = [];
  for (let v = Math.floor(min); v <= Math.ceil(max); v += step) ticks.push(v);
  return ticks;
}

export default function LineChart({ series, xLabel, yUnit, yZeroFloor = false }: Props) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return null;

  const xMax = Math.max(...allPoints.map((p) => p.x));
  const xMin = 0;
  const yVals = allPoints.map((p) => p.y);
  let yMin = yZeroFloor ? 0 : Math.floor(Math.min(...yVals)) - 1;
  let yMax = Math.ceil(Math.max(...yVals)) + 1;
  if (yMax - yMin < 4) { yMax += 1; yMin = yZeroFloor ? 0 : yMin - 1; }

  // Reversed x: high hours on the left, 0 on the right
  const px = (x: number) => ML + ((xMax - x) / (xMax - xMin || 1)) * PW;
  const py = (y: number) => MT + PH - ((y - yMin) / (yMax - yMin)) * PH;

  const yTicks = niceTicks(yMin, yMax);
  const xTicks = niceTicks(0, xMax, 6).filter((v) => v <= xMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 260 }} aria-label={xLabel}>
      {/* Grid */}
      {yTicks.map((v) => (
        <line key={`y${v}`} x1={ML} y1={py(v)} x2={W - MR} y2={py(v)}
          stroke="#1e293b" strokeDasharray="3 3" strokeWidth={1} />
      ))}
      {yTicks.map((v) => (
        <text key={`yl${v}`} x={ML - 6} y={py(v) + 4} textAnchor="end" fontSize={11} fill="#64748b">
          {v}{yUnit}
        </text>
      ))}

      {/* X-axis labels */}
      {xTicks.map((v) => (
        <text key={`xl${v}`} x={px(v)} y={H - MB + 16} textAnchor="middle" fontSize={11}
          fill="#64748b" fontFamily="var(--font-geist-mono)">
          {v}h
        </text>
      ))}
      <text x={ML + PW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#475569">
        {xLabel}
      </text>

      {/* Series */}
      {series.map((s) => {
        const pts = [...s.points].sort((a, b) => b.x - a.x);
        if (pts.length === 0) return null;
        const path = pts.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
        return (
          <g key={s.name}>
            <polyline points={path} fill="none" stroke={s.color} strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round" strokeLinecap="round" />
            {pts.length === 1 && (
              <circle cx={px(pts[0].x)} cy={py(pts[0].y)} r={3.5} fill={s.color} />
            )}
          </g>
        );
      })}

      {/* Legend */}
      {series.map((s, i) => (
        <g key={`lg-${s.name}`}>
          <line x1={ML + i * 130} y1={MT + 2} x2={ML + i * 130 + 16} y2={MT + 2}
            stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} />
          <text x={ML + i * 130 + 21} y={MT + 6} fontSize={11} fill={s.color}>
            {s.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
