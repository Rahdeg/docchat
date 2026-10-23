import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/lib/routes";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocChat",
  description: "Ask questions about your documents and get answers with cited sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
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
        </ClerkProvider>
      </body>
    </html>
  );
}
