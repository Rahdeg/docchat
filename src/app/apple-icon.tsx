import { ImageResponse } from "next/og";

import { brand } from "./_og/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The logo mark for iOS home screens (which round the corners themselves).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: brand.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 84, height: 28, borderRadius: 10, background: brand.highlight }} />
    </div>,
    size,
  );
}
