import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Aporetic — Markets vs. Meteorologists";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#0a0f1e",
          color: "#f1f5f9",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "32px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "6px",
              height: "64px",
            }}
          >
            <div style={{ width: "18px", height: "24px", backgroundColor: "#8b5cf6", borderRadius: "4px" }} />
            <div style={{ width: "18px", height: "44px", backgroundColor: "#8b5cf6", borderRadius: "4px" }} />
            <div style={{ width: "18px", height: "64px", backgroundColor: "#8b5cf6", borderRadius: "4px" }} />
            <div style={{ width: "18px", height: "38px", backgroundColor: "#38bdf8", borderRadius: "4px" }} />
            <div style={{ width: "18px", height: "18px", backgroundColor: "#38bdf8", borderRadius: "4px" }} />
          </div>
        </div>
        <div style={{ display: "flex", fontSize: "72px", fontWeight: 700, letterSpacing: "-2px" }}>
          Aporetic
        </div>
        <div style={{ display: "flex", fontSize: "34px", color: "#94a3b8", marginTop: "24px" }}>
          Markets vs. Meteorologists
        </div>
        <div style={{ display: "flex", fontSize: "26px", color: "#64748b", marginTop: "48px" }}>
          Who calls the daily high better — markets or meteorologists?
        </div>
      </div>
    ),
    size
  );
}
