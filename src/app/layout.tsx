import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Newsreader } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/lib/routes";
import "./globals.css";

// Serif for document names and document text only (font-serif). opsz keeps the 10px previews
// and the large headings each in their optical size.
const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: "DocChat",
  description: "Ask questions about your documents and get answers with cited sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider
          appearance={{ theme: shadcn }}
          signInUrl={routes.signIn}
          signUpUrl={routes.signUp}
          signInFallbackRedirectUrl={routes.library}
          signUpFallbackRedirectUrl={routes.library}
          afterSignOutUrl={routes.home}
        >
          <TooltipProvider>{children}</TooltipProvider>
          {/* No theme provider yet, so pin it: "system" would follow the OS into dark toasts. */}
          <Toaster position="bottom-right" theme="light" />
        </ClerkProvider>
      </body>
    </html>
  );
}
