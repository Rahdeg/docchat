import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";

import { site } from "@/content/site";
import { APP_ORIGIN } from "@/lib/app-url";
import { env } from "@/lib/env";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: { type: "website", siteName: site.name, locale: "en_GB" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#e8ebee" };

// Vercel Web Analytics and Speed Insights: page views and Core Web Vitals, without cookies or
// cross-site identifiers. Their scripts and beacons are on our own origin (/_vercel/*), so the
// CSP needs nothing new. Only on Vercel, where those routes exist; not in Docker, CI or dev.
const onVercel = !!env.VERCEL_ENV;

// No ClerkProvider here: it wraps only the (app) and (auth) groups (src/components/auth-provider.tsx),
// so the public and error pages ship no Clerk JavaScript.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        {onVercel ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
