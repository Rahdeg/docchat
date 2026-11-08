import { ImageResponse } from "next/og";

import { site } from "@/content/site";
import { brand, ogFonts } from "./_og/brand";

export const alt = `${site.name}: ${site.tagline} Every answer points to the exact sentence it came from.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview for every page: a sheet of paper on the desk with the headline and one
// highlighted sentence. Generated at build time.
export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: brand.desk,
        padding: "56px 72px",
        fontFamily: "Geist",
        color: brand.ink,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 92,
          width: 1032,
          height: 500,
          background: brand.sunken,
          border: `1px solid ${brand.borderSoft}`,
          borderRadius: 4,
          transform: "rotate(-1.5deg)",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          background: brand.paper,
          border: `1px solid ${brand.border}`,
          borderRadius: 4,
          padding: "52px 64px",
          boxShadow: "0 30px 50px -30px rgba(29,36,51,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 11,
              background: brand.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 22, height: 8, borderRadius: 3, background: brand.highlight }} />
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.01em" }}>{site.name}</div>
        </div>
        <div
          style={{
            marginTop: 52,
            fontFamily: "Newsreader",
            fontSize: 84,
            lineHeight: 1.04,
            letterSpacing: "-0.025em",
            maxWidth: 900,
          }}
        >
          {site.tagline}
        </div>
        <div
          style={{ display: "flex", marginTop: "auto", fontSize: 30, color: brand.secondaryText }}
        >
          <span style={{ background: brand.highlight, color: brand.ink, padding: "2px 8px" }}>
            Every answer points to the exact sentence it came from.
          </span>
        </div>
      </div>
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
