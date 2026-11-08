import type { MetadataRoute } from "next";

import { APP_ORIGIN } from "@/lib/app-url";
import { routes } from "@/lib/routes";

// Crawl the public pages only. Signed-in pages are also noindex ((app)/layout.tsx).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        routes.library,
        routes.chat,
        routes.tasks,
        routes.settings,
        routes.mcp,
        "/api/",
        "/.well-known/",
      ],
    },
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
  };
}
