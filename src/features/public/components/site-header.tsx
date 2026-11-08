import Link from "next/link";

import { Logo } from "@/components/logo";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: `${routes.home}#how`, label: "How it works" },
  { href: `${routes.home}#checked`, label: "Why trust it" },
  { href: `${routes.home}#privacy`, label: "Privacy" },
];

export const outlineLink =
  "flex items-center rounded-lg border border-border-strong bg-card font-medium text-foreground transition-colors hover:text-muted-foreground motion-reduce:transition-none";
export const inkLink =
  "flex items-center rounded-lg bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/85 motion-reduce:transition-none";

// The public pages' header (docs/design/public/landing.html). On phones: logo and Sign in.
export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-[1264px] flex-wrap items-center gap-x-7 gap-y-4 px-4 py-3.5 md:px-8 md:py-6">
      <Link href={routes.home} className="rounded-md">
        <Logo size="lg" />
      </Link>
      <nav aria-label="Main" className="hidden gap-6 text-[15px] md:flex">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm text-secondary-text transition-colors hover:text-muted-foreground motion-reduce:transition-none"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex gap-2.5">
        {/* No prefetch: the auth pages' code includes Clerk's components, which the public
            pages shouldn't download until someone actually goes to sign in. */}
        <Link
          href={routes.signIn}
          prefetch={false}
          className={cn(outlineLink, "h-11 px-3.5 text-[15px] md:h-10 md:px-4")}
        >
          Sign in
        </Link>
        <Link
          href={routes.signUp}
          prefetch={false}
          className={cn(inkLink, "hidden h-10 px-4 text-[15px] md:flex")}
        >
          Get started free
        </Link>
      </div>
    </header>
  );
}
