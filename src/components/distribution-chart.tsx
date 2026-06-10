"use client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Bucket {
  threshold:  number;
  capStrike:  number | null;
  strikeType: string;
  yesBid:     number;
  midpoint:   number;
}

interface ChartPoint {
  label:     string;
  kalshiPct: number;
  nwsPct:    number | null;
}

interface Props {
  buckets: Bucket[];
  nwsTemp: number | null;
}

// ─── Normal distribution helpers ─────────────────────────────────────────────

function normalPdf(x: number, mean: number, sigma: number): number {
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mean) ** 2) / (2 * sigma ** 2));
}

// Conservative midpoint for NWS curve evaluation — keeps open tails close to
// the boundary so they don't distort the bell shape (tail midpoints that are
// far from the mean would collapse all probability into the tail bucket).
function nwsMidpoint(b: Bucket): number {
  if (b.strikeType === "less")    return (b.capStrike ?? 85) - 2;
  if (b.strikeType === "greater") return b.threshold + 2;
  return (b.threshold + (b.capStrike ?? b.threshold + 1)) / 2;
}

// ─── Build chart data ─────────────────────────────────────────────────────────

// Buckets priced at >=99% or <=1% are not interesting and clutter the view.
// Keep the contiguous span from the first to the last "interesting" bucket
// (plus the bucket containing the NWS temp) so the axis stays coherent.
function filterDisplayBuckets(sorted: Bucket[], nwsTemp: number | null): Bucket[] {
  const containsNws = (b: Bucket) => {
    if (nwsTemp === null) return false;
    if (b.strikeType === "less")    return nwsTemp < (b.capStrike ?? Infinity);
    if (b.strikeType === "greater") return nwsTemp > b.threshold;
    return nwsTemp >= b.threshold && nwsTemp <= (b.capStrike ?? b.threshold);
  };
  const interesting = sorted.map((b) => (b.yesBid > 0.01 && b.yesBid < 0.99) || containsNws(b));
  const first = interesting.indexOf(true);
  if (first === -1) return sorted;
  const last = interesting.lastIndexOf(true);
  // Pad one bucket each side for context
  return sorted.slice(Math.max(0, first - 1), Math.min(sorted.length, last + 2));
}

function buildChartData(buckets: Bucket[], nwsTemp: number | null): ChartPoint[] {
  const all    = [...buckets].sort((a, b) => a.midpoint - b.midpoint);
  const sorted = filterDisplayBuckets(all, nwsTemp);
  // Normalize against ALL buckets so displayed probabilities stay truthful
  const totalKalshi = all.reduce((s, b) => s + b.yesBid, 0);

  let nwsNorm: (number | null)[] = sorted.map(() => null);
  if (nwsTemp !== null) {
    const sigma  = 3;
    // Normalize the curve over ALL buckets, then display the visible subset
    const rawAll = all.map((b) => normalPdf(nwsMidpoint(b), nwsTemp, sigma));
    const total  = rawAll.reduce((s, p) => s + p, 0);
    if (total > 0) {
      nwsNorm = sorted.map((b) => {
        const p = rawAll[all.indexOf(b)];
        return Math.round((p / total) * 1000) / 10;
      });
    }
  }

  return sorted.map((b, i) => {
    let label: string;
    if (b.strikeType === "less")         label = `<${b.capStrike}°`;
    else if (b.strikeType === "greater") label = `>${b.threshold}°`;
    else                                 label = `${b.threshold}–${b.capStrike}°`;

    return {
      label,
      kalshiPct: totalKalshi > 0 ? Math.round((b.yesBid / totalKalshi) * 1000) / 10 : 0,
      nwsPct:    nwsNorm[i],
    };
  });
}

// ─── SVG chart ────────────────────────────────────────────────────────────────

const ML = 42;   // margin left
const MR = 12;   // margin right
const MT = 8;    // margin top
const MB = 40;   // margin bottom
const W  = 600;
const H  = 280;
const PW = W - ML - MR;  // plot width
const PH = H - MT - MB;  // plot height

function yGridTicks(yMax: number): number[] {
  const step = yMax <= 20 ? 5 : yMax <= 50 ? 10 : 15;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);
  return ticks;
}

export default function DistributionChart({ buckets, nwsTemp }: Props) {
  const data = buildChartData(buckets, nwsTemp);
  if (data.length === 0) return null;

  const n    = data.length;
  const slot = PW / n;
  const bw   = Math.min(slot * 0.65, 64);

  const allPcts = data.flatMap((d) => [d.kalshiPct, d.nwsPct ?? 0]);
  const rawMax  = Math.max(...allPcts, 1);
  const yMax    = Math.ceil(rawMax / 10) * 10 + 5;

  const bx  = (i: number) => ML + i * slot + (slot - bw) / 2;
  const cy  = (i: number) => ML + i * slot + slot / 2;
  const ys  = (pct: number) => MT + PH - (pct / yMax) * PH;
  const bh  = (pct: number) => (pct / yMax) * PH;

  const ticks = yGridTicks(yMax);

  // NWS polyline points (only where nwsPct is non-null)
  const linePoints = data
    .map((d, i) => (d.nwsPct !== null ? `${cy(i)},${ys(d.nwsPct)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: 280 }}
      aria-label="Market distribution vs NWS forecast"
    >
      {/* Grid lines */}
      {ticks.map((v) => (
        <line
          key={v}
          x1={ML} y1={ys(v)} x2={W - MR} y2={ys(v)}
          stroke="#1e293b" strokeDasharray="3 3" strokeWidth={1}
        />
      ))}

      {/* Y-axis labels */}
      {ticks.map((v) => (
        <text key={v} x={ML - 5} y={ys(v) + 4} textAnchor="end" fontSize={11} fill="#64748b">
          {v}%
        </text>
      ))}

      {/* Kalshi bars */}
      {data.map((d, i) => (
        d.kalshiPct > 0 && (
          <rect
            key={i}
            x={bx(i)} y={ys(d.kalshiPct)}
            width={bw} height={bh(d.kalshiPct)}
            fill="#8b5cf6" fillOpacity={0.9}
            rx={3} ry={3}
          />
        )
      ))}

      {/* NWS line */}
      {nwsTemp !== null && linePoints && (
        <polyline
          points={linePoints}
          fill="none" stroke="#38bdf8" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round"
        />
      )}

      {/* NWS dots */}
      {nwsTemp !== null && data.map((d, i) =>
        d.nwsPct !== null ? (
          <circle key={i} cx={cy(i)} cy={ys(d.nwsPct)} r={4} fill="#38bdf8" />
        ) : null
      )}

      {/* X-axis labels */}
      {data.map((d, i) => (
        <text
          key={i}
          x={cy(i)} y={H - MB + 16}
          textAnchor="middle" fontSize={12}
          fill="#64748b" fontFamily="var(--font-geist-mono)"
        >
          {d.label}
        </text>
      ))}

      {/* Legend */}
      <rect x={ML} y={H - 12} width={10} height={10} fill="#8b5cf6" rx={2} />
      <text x={ML + 14} y={H - 4} fontSize={12} fill="#a78bfa">Kalshi</text>

      {nwsTemp !== null && (
        <>
          <line x1={ML + 68} y1={H - 7} x2={ML + 82} y2={H - 7} stroke="#38bdf8" strokeWidth={2} />
          <circle cx={ML + 75} cy={H - 7} r={3.5} fill="#38bdf8" />
          <text x={ML + 86} y={H - 4} fontSize={12} fill="#7dd3fc">NWS Model</text>
        </>
      )}
    </svg>
  );
}
