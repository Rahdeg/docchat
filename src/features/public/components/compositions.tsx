import { CitationChip } from "@/components/citation-chip";
import { cn } from "@/lib/utils";

// The paper-and-answer pictures on the landing and sign-in pages: a document sheet with the
// quoted clause highlighted, and the chat card that cites it. Pure HTML and CSS (no client
// JavaScript); each picture is one role="img" with a label, and its parts are hidden from
// assistive tech.

function Chip({ small }: { small?: boolean }) {
  return (
    <CitationChip
      index={1}
      featured
      className={cn(
        "rounded-[5px] align-[2px]",
        small
          ? "h-[18px] min-w-[18px] rounded-[4px] px-1 text-[10px]"
          : "h-5 min-w-5 px-[5px] text-[11px]",
      )}
    />
  );
}

function Question({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "self-end rounded-[11px_11px_3px_11px] bg-primary px-[11px] py-[7px] text-[13px] leading-[1.4] text-primary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Mark({ children }: { children: React.ReactNode }) {
  return <mark className="bg-highlight px-0.5 py-px text-highlight-foreground">{children}</mark>;
}

const label = "Example: an answer pointing to the clause it came from";

// Landing hero, desktop and tablet (from 768px): docs/design/public/landing.html.
function HeroWide() {
  return (
    <div
      role="img"
      aria-label={label}
      className="relative hidden h-[560px] min-w-0 flex-[1_1_520px] md:block"
    >
      <div
        aria-hidden
        className="absolute top-3.5 left-3.5 h-[480px] w-[380px] -rotate-4 rounded-[3px] border border-border bg-surface-sunken"
      />
      <div
        aria-hidden
        className="absolute top-0 left-0 h-[480px] w-[380px] -rotate-[1.5deg] overflow-hidden rounded-[3px] border border-border-strong bg-card p-[30px] font-serif text-[13px] leading-[1.65] text-secondary-text shadow-hero-sheet"
      >
        <div className="mb-1 text-[15px] font-semibold text-foreground">
          Assured shorthold tenancy agreement
        </div>
        <div className="mb-4 text-[11px] text-muted-foreground">Page 3</div>
        <p className="mb-2.5">
          <span className="font-semibold text-foreground">7. Rent review.</span> 7.1 The rent stated
          in clause 2.1 applies from the start date.
        </p>
        <p className="mb-2.5">
          7.2 The Landlord may increase the rent once during the fixed term, no earlier than six
          months after the start date.
        </p>
        <p className="mb-2.5">
          7.3 Any increase applies from the next rent payment date after notice is given.
        </p>
        <p className="mb-2.5">
          <Mark>
            7.4 The Landlord must give the Tenant not less than one month&apos;s notice in writing
            of any rent increase.
          </Mark>
        </p>
        <p className="mb-2.5">
          7.5 If a notice does not follow this clause, the Tenant may write asking for it to be
          withdrawn.
        </p>
        <p>
          <span className="font-semibold text-foreground">8. Repairs.</span> 8.1 The Landlord must
          keep in repair the structure and exterior of the property.
        </p>
      </div>

      <svg
        aria-hidden
        width="600"
        height="560"
        viewBox="0 0 600 560"
        className="pointer-events-none absolute top-0 left-0 overflow-visible text-foreground"
      >
        <path
          d="M 392 404 C 430 360, 410 300, 352 286"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <circle cx="352" cy="286" r="4" fill="currentColor" />
      </svg>

      <div
        aria-hidden
        className="absolute top-[330px] left-[210px] flex w-[398px] flex-col gap-3.5 rounded-[14px] border border-border-strong bg-card p-[18px] shadow-hero-card"
      >
        <Question className="max-w-[88%] rounded-[12px_12px_3px_12px] px-[13px] py-[9px] text-sm leading-[1.45]">
          How much notice does my landlord need to give before raising the rent?
        </Question>
        <div className="text-[15px] leading-[1.6]">
          At least <strong className="font-semibold">one month, in writing</strong> <Chip />
        </div>
        <div className="border-t border-muted pt-2.5 text-xs text-muted-foreground">
          Source 1: Tenancy agreement, page 3
        </div>
      </div>
    </div>
  );
}

// Landing hero on phones: docs/design/public/landing-mobile.html.
function HeroNarrow() {
  return (
    <div role="img" aria-label={label} className="relative h-[330px] w-full md:hidden">
      <div
        aria-hidden
        className="absolute top-2 left-2 h-60 w-[300px] -rotate-3 rounded-[3px] border border-border bg-surface-sunken"
      />
      <div
        aria-hidden
        className="absolute top-0 left-0 h-60 w-[300px] -rotate-1 overflow-hidden rounded-[3px] border border-border-strong bg-card p-5 font-serif text-xs leading-[1.6] text-secondary-text"
      >
        <div className="mb-2.5 text-[13px] font-semibold text-foreground">
          Tenancy agreement, page 3
        </div>
        <p className="mb-2">
          7.3 Any increase applies from the next rent payment date after notice is given.
        </p>
        <p>
          <Mark>
            7.4 The Landlord must give the Tenant not less than one month&apos;s notice in writing
            of any rent increase.
          </Mark>
        </p>
      </div>
      <div
        aria-hidden
        className="absolute top-40 right-0 flex w-[290px] flex-col gap-2 rounded-xl border border-border-strong bg-card px-3.5 py-3 shadow-desk-card"
      >
        <Question>How much notice before a rent rise?</Question>
        <span className="text-sm">
          One month, in writing <Chip small />
        </span>
      </div>
    </div>
  );
}

export function HeroComposition() {
  return (
    <>
      <HeroWide />
      <HeroNarrow />
    </>
  );
}

// The sign-in page's desk panel: docs/design/public/sign-in.html.
export function DeskComposition() {
  return (
    <div
      role="img"
      aria-label="Example: an answer citing the notice clause of a contract"
      className="relative h-[300px]"
    >
      <div
        aria-hidden
        className="absolute top-2.5 left-2.5 h-[270px] w-[340px] -rotate-3 rounded-[3px] border border-border bg-surface-sunken"
      />
      <div
        aria-hidden
        className="absolute top-0 left-0 h-[270px] w-[340px] -rotate-1 overflow-hidden rounded-[3px] border border-border-strong bg-card p-6 font-serif text-[12.5px] leading-[1.65] text-secondary-text shadow-desk-sheet"
      >
        <div className="mb-3 text-sm font-semibold text-foreground">Contract of employment</div>
        <p className="mb-2">
          8. Notice.{" "}
          <Mark>
            8.1 After probation, either party may end your employment by giving four weeks&apos;
            notice in writing.
          </Mark>
        </p>
        <p className="mb-2">
          8.2 After five years of service, the notice the Company must give increases by one week
          for each further complete year.
        </p>
        <p>8.3 The Company may pay you in lieu of notice.</p>
      </div>
      <div
        aria-hidden
        className="absolute top-[170px] left-[190px] flex w-[334px] flex-col gap-2.5 rounded-xl border border-border-strong bg-card px-4 py-3.5 shadow-desk-card"
      >
        <Question>How much notice do I give?</Question>
        <span className="text-sm">
          Four weeks, in writing <Chip small />
        </span>
      </div>
    </div>
  );
}
