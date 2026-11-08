import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/content/site";
import { HeroComposition } from "@/features/public/components/compositions";
import { MetricCards } from "@/features/public/components/metric-cards";
import { inkLink, outlineLink } from "@/features/public/components/site-header";
import { MCP_URL } from "@/lib/app-url";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: answers from your documents, with the sources to prove it` },
  description: site.description,
  alternates: { canonical: routes.home },
};

const container = "mx-auto w-full max-w-[1264px] px-4 md:px-8";
const h2 = "font-serif text-[32px] leading-[1.15] font-medium tracking-[-0.015em] md:text-[40px]";

const steps = [
  {
    title: "Upload",
    text: "Drop in PDFs, Markdown or text files. DocChat reads them page by page and remembers where every passage sits.",
  },
  {
    title: "Ask",
    text: "Ask the way you’d ask a friend who read it all. Narrow it to one document, or search everything at once.",
  },
  {
    title: "Check",
    text: "Click any numbered citation and the sentence behind it lights up. If your documents don’t cover something, DocChat says so.",
  },
];

const promises = [
  {
    title: "Private by default.",
    text: "Files are only reachable through your signed-in account, never by a public link.",
  },
  {
    title: "Delete means delete.",
    text: "Remove a document, or your whole account, and its text, passages and chats go with it.",
  },
  {
    title: "Documents are data, not instructions.",
    text: "Text hidden inside a file can’t make DocChat do anything you didn’t ask for.",
  },
  {
    title: "No tracking cookies.",
    text: "We count visits and measure page speed with Vercel’s cookie-free analytics. It never sees your documents, questions or answers.",
  },
];

// Signed-out visitors only: the proxy sends signed-in visitors to /library before this renders,
// so the page reads no session and is prerendered in full.
export default function LandingPage() {
  return (
    <>
      <section
        aria-labelledby="hero-title"
        className={cn(
          container,
          "flex flex-wrap items-center gap-7 pt-5 pb-16 md:gap-14 md:pt-14 md:pb-24",
        )}
      >
        <div className="flex max-w-[540px] flex-[1_1_440px] flex-col gap-[18px] md:gap-6">
          <h1
            id="hero-title"
            className="font-serif text-[42px] leading-[1.05] font-medium tracking-[-0.02em] md:text-[64px] md:leading-[1.04] md:tracking-[-0.025em]"
          >
            Ask your documents. Check every answer.
          </h1>
          <p className="max-w-[470px] text-secondary-text md:text-[19px] md:leading-[1.6]">
            Upload a contract, a policy or your course notes and ask questions in plain English.
            Every answer points to the exact sentence it came from
            <span className="hidden md:inline">, so you never have to take it on trust</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={routes.signUp}
              prefetch={false}
              className={cn(
                inkLink,
                "h-[50px] w-full justify-center rounded-[10px] px-[22px] md:h-12 md:w-auto",
              )}
            >
              Get started free
            </Link>
            <Link
              href="#how"
              className={cn(outlineLink, "hidden h-12 rounded-[10px] px-5 md:flex")}
            >
              See how it works
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            PDF, Markdown and text files. Your files stay private.
          </p>
        </div>
        <HeroComposition />
      </section>

      <section id="how" aria-labelledby="how-title" className="border-y border-border bg-card">
        <div className={cn(container, "flex flex-col gap-12 py-16 md:py-[88px]")}>
          <h2 id="how-title" className={cn(h2, "max-w-[620px]")}>
            Three steps from a pile of paper to an answer you can check
          </h2>
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-10">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border-[1.5px] border-foreground font-semibold",
                    i === steps.length - 1 && "bg-highlight text-highlight-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="text-secondary-text">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="checked"
        aria-labelledby="checked-title"
        className={cn(container, "flex flex-wrap gap-10 py-16 md:gap-14 md:py-24")}
      >
        <div className="flex max-w-[420px] flex-[1_1_340px] flex-col gap-4">
          <h2 id="checked-title" className={h2}>
            Measured, not promised
          </h2>
          <p className="text-secondary-text">
            DocChat is tested against question sets with known answers every time it changes. These
            are the latest results.
          </p>
          <Link
            href={routes.howWeTest}
            className="w-fit rounded-sm font-medium underline underline-offset-2 hover:text-muted-foreground"
          >
            Read how it&apos;s tested
          </Link>
        </div>
        <MetricCards />
      </section>

      <section aria-labelledby="more-title" className="border-y border-border bg-panel">
        <div className={cn(container, "flex flex-col gap-10 py-16 md:py-[88px]")}>
          <h2 id="more-title" className={cn(h2, "max-w-[640px]")}>
            More than answers
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-6">
            <div className="flex flex-col gap-3.5 rounded-[3px] border border-border bg-card p-[26px]">
              <h3 className="text-xl font-semibold">Turn documents into to-do lists</h3>
              <p className="text-secondary-text">
                “Turn my tenancy agreement into a move-in checklist.” DocChat suggests tasks with
                due dates, each linked to its clause. Nothing is added until you tick and approve
                it.
              </p>
              <div
                aria-hidden
                className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 text-sm"
              >
                {["Check, sign and return the inventory", "Register for council tax"].map((t) => (
                  <span key={t} className="flex items-center gap-2.5">
                    <span className="size-3.5 shrink-0 rounded-[3px] bg-primary" />
                    {t}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">By 8 Nov</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3.5 rounded-[3px] border border-border bg-card p-[26px]">
              <h3 className="text-xl font-semibold">Use it from Claude and other AI apps</h3>
              <p className="text-secondary-text">
                Connect Claude Desktop, Claude Code or Cursor over MCP, sign in, and your AI
                assistant can search your documents and tasks, with sources.
              </p>
              <p className="rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-[13px] break-all text-secondary-text">
                <span className="sr-only">For example, in Claude Code: </span>
                claude mcp add --transport http docchat {MCP_URL}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="privacy"
        aria-labelledby="privacy-title"
        className={cn(container, "flex flex-wrap gap-8 py-16 md:gap-14 md:py-24")}
      >
        <h2 id="privacy-title" className={cn(h2, "max-w-[420px] flex-[1_1_340px]")}>
          Your documents stay yours
        </h2>
        <ul className="flex flex-[2_1_520px] flex-col">
          {promises.map((p) => (
            <li key={p.title} className="border-b border-border py-[18px]">
              <strong className="font-semibold">{p.title}</strong>{" "}
              <span className="text-secondary-text">{p.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        data-inverted
        aria-labelledby="cta-title"
        className="bg-primary text-primary-foreground"
      >
        <div
          className={cn(container, "flex flex-wrap items-center gap-x-10 gap-y-6 py-16 md:py-20")}
        >
          <h2 id="cta-title" className={cn(h2, "flex-[1_1_420px]")}>
            Ask your first question in under a minute.
          </h2>
          <Link
            href={routes.signUp}
            prefetch={false}
            className="flex h-[50px] items-center rounded-[10px] bg-highlight px-6 font-semibold text-highlight-foreground transition-colors hover:bg-highlight/90 motion-reduce:transition-none"
          >
            Get started free
          </Link>
        </div>
      </section>
    </>
  );
}
