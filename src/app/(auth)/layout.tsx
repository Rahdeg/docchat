import Link from "next/link";
import { Suspense } from "react";

import { CitationChip } from "@/components/citation-chip";
import { Logo } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/lib/routes";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-2">
      <section className="flex flex-col gap-8 bg-primary px-6 py-8 text-primary-foreground sm:px-10 lg:justify-between lg:p-12">
        <Link href={routes.home} className="w-fit">
          <Logo inverted />
        </Link>

        <div className="flex max-w-lg flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
            Answers from your documents,{" "}
            <span className="rounded-sm bg-highlight box-decoration-clone px-1 text-highlight-foreground">
              with the sources to prove it.
            </span>
          </h1>
          <p className="text-primary-foreground/70">
            Upload your files, ask in plain language, and check every answer against the passage it
            came from.
          </p>
        </div>

        {/* Hidden on phones so the form stays near the top. */}
        <Card className="hidden max-w-lg sm:flex">
          <CardHeader>
            <CardDescription>How many days of leave do new starters get?</CardDescription>
          </CardHeader>
          <CardContent className="leading-7">
            New starters get 25 days of annual leave plus bank holidays{" "}
            <CitationChip index={1} source="employee-handbook.pdf" page={2} />
          </CardContent>
        </Card>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        {/* Clerk's components read the URL (usePathname), which Cache Components streams in. */}
        <Suspense fallback={<Skeleton className="h-120 w-full max-w-100 rounded-xl" />}>
          {children}
        </Suspense>
      </section>
    </main>
  );
}
