// The first focusable element on public pages: jumps past the header to <main id="main">.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Skip to content
    </a>
  );
}
