import Link from "next/link";

import { site } from "@/content/site";
import { routes } from "@/lib/routes";

const footerLink =
  "rounded-sm text-secondary-text underline underline-offset-2 transition-colors hover:text-muted-foreground motion-reduce:transition-none";

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1264px] flex-wrap gap-x-7 gap-y-3 px-4 py-8 text-sm text-muted-foreground md:px-8">
      <span>
        {site.name}, built in public by {site.author}
      </span>
      <a href={site.links.x} className={footerLink} rel="me noopener">
        Follow the build on X
      </a>
      <a href={site.links.github} className={footerLink} rel="me noopener">
        Source on GitHub
      </a>
      <Link href={routes.howWeTest} className={footerLink}>
        How it&apos;s tested
      </Link>
      <Link href={`${routes.home}#privacy`} className={`${footerLink} sm:ml-auto`}>
        Privacy
      </Link>
    </footer>
  );
}
