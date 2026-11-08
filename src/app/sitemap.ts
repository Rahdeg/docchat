import type { MetadataRoute } from "next";

import { APP_ORIGIN } from "@/lib/app-url";
import { indexablePaths } from "@/lib/routes";

// Public pages only (indexablePaths in src/lib/routes.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  return indexablePaths.map((path) => ({ url: `${APP_ORIGIN}${path === "/" ? "" : path}` }));
}
