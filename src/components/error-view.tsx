"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { routes } from "@/lib/routes";

// A short id to quote when reporting a problem. Server errors carry Next's digest, which also
// appears in the server logs; errors thrown in the browser get a random one, logged with the
// error in the console. The message and stack are never shown: in production they can hold
// details the visitor shouldn't see.
export function errorReference(error: unknown): string | null {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string") {
    return error.digest;
  }
  return null;
}

type ErrorViewProps = { error: unknown; retry: () => void; inset?: boolean };

export function ErrorView({ error, retry, inset }: ErrorViewProps) {
  const [reference] = useState(
    () => errorReference(error) ?? crypto.randomUUID().replaceAll("-", "").slice(0, 10),
  );

  useEffect(() => {
    console.error(`[ref ${reference}]`, error);
  }, [error, reference]);

  return (
    <ProblemPage title="Something went wrong" reference={reference} onRetry={retry} inset={inset} />
  );
}

type ProblemPageProps = {
  title: string;
  text?: string;
  reference?: string;
  onRetry?: () => void;
  // Not-found shows Library and Home links instead of "Try again".
  links?: boolean;
  // Inside the signed-in layout: no header (the sidebar has the logo) and no <main> (the
  // sidebar inset is one).
  inset?: boolean;
};

const outline =
  "flex h-10 items-center rounded-lg border border-border-strong bg-card px-4 text-[15px] font-medium text-foreground transition-colors hover:text-muted-foreground motion-reduce:transition-none";
const ink =
  "flex h-10 items-center rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/85 motion-reduce:transition-none";

// A sheet of paper on the desk with the message: not-found, error and global-error.
export function ProblemPage({ title, text, reference, onRetry, links, inset }: ProblemPageProps) {
  const Body = inset ? "div" : "main";
  return (
    <div data-site className={inset ? "flex flex-1 flex-col" : "flex min-h-svh flex-1 flex-col"}>
      {inset ? null : (
        <header className="px-4 py-3.5 md:px-8 md:py-6">
          <Link href={routes.home} className="inline-flex rounded-md">
            <Logo size="lg" />
          </Link>
        </header>
      )}
      <Body id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-20 md:pt-16">
        <div className="flex w-full max-w-[520px] flex-col gap-5 rounded-[3px] border border-border-strong bg-card p-8 shadow-sheet md:p-10">
          <h1 className="font-serif text-[34px] leading-[1.1] font-medium tracking-[-0.02em] md:text-[40px]">
            {title}
          </h1>
          <p className="text-secondary-text">
            {text ??
              "DocChat hit a problem showing this page. Your documents are safe. Try again, and if it keeps happening, quote the reference below."}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {onRetry ? (
              <button type="button" onClick={onRetry} className={ink}>
                Try again
              </button>
            ) : null}
            {links ? (
              <>
                <Link href={routes.library} prefetch={false} className={ink}>
                  Go to your library
                </Link>
                <Link href={routes.home} className={outline}>
                  Home
                </Link>
              </>
            ) : (
              <a href={routes.home} className={outline}>
                Home
              </a>
            )}
          </div>
          {reference ? (
            <p className="text-sm text-muted-foreground">
              Reference: <span className="tabular-nums select-all">{reference}</span>
            </p>
          ) : null}
        </div>
      </Body>
    </div>
  );
}
