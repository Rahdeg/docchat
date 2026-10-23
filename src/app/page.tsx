import Link from "next/link";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

// Signed-in visitors never see this page: the proxy redirects them to /library.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl px-4 py-4 md:px-8">
        <Logo />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Answers from your documents,{" "}
          <span className="rounded-sm bg-highlight box-decoration-clone px-1 text-highlight-foreground">
            with the sources to prove it.
          </span>
        </h1>
        <p className="max-w-xl text-lg text-pretty text-muted-foreground">
          Upload your files, ask questions in plain language, and see the exact passage behind every
          answer.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="lg" nativeButton={false} render={<Link href={routes.signUp} />}>
            Get started
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={routes.signIn} />}
          >
            Sign in
          </Button>
        </div>
      </main>
    </div>
  );
}
