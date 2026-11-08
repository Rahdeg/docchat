import type { SignIn } from "@clerk/nextjs";

// Clerk's sign-in and sign-up forms in DocChat's paper style (docs/design/public/sign-in.html),
// on top of the shadcn theme set in AuthProvider: ink primary button, 8px radius, Geist, 44px
// fields, our border colour, and no card of its own (the white panel is the paper).
//
// Style objects, not Tailwind classes: Clerk's own rules (box-shadow borders, card padding)
// outrank utility classes here, while objects merge into those rules. Values are theme tokens.
// Fields and social buttons draw their border with a box-shadow that Clerk sets in a
// [data-variant] rule at 11% opacity; "&&&" (the class three times) outranks it, and the
// focus ring is restated so keyboard focus still shows.
const field = {
  "&&&": {
    height: "44px",
    // Clerk caps fields at 2.25rem.
    maxHeight: "none",
    borderRadius: "var(--radius)",
    fontSize: "15px",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    boxShadow: "0 0 0 1px var(--border-strong)",
  },
  "&&&:focus, &&&:focus-visible": {
    boxShadow: "0 0 0 1px var(--ring), 0 0 0 4px color-mix(in srgb, var(--ring) 20%, transparent)",
  },
};

export const authAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorInput: "var(--card)",
    colorBorder: "var(--border-strong)",
    colorMutedForeground: "var(--muted-foreground)",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "15px",
  },
  options: { socialButtonsVariant: "blockButton" },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      maxWidth: "none",
      border: "none",
      borderRadius: 0,
      boxShadow: "none",
      overflow: "visible",
    },
    card: {
      padding: 0,
      gap: "20px",
      border: "none",
      borderRadius: 0,
      boxShadow: "none",
      backgroundColor: "transparent",
    },
    header: { alignItems: "flex-start", textAlign: "left", gap: "6px" },
    headerTitle: { fontSize: "26px", fontWeight: 600, letterSpacing: "-0.02em" },
    headerSubtitle: { fontSize: "15px", color: "var(--muted-foreground)" },
    main: { gap: "20px" },
    // One button per row, as in the design ("Continue with GitHub", then Google).
    socialButtons: { display: "flex", flexDirection: "column", gap: "10px" },
    socialButtonsBlockButton: { ...field, fontWeight: 500 },
    socialButtonsBlockButtonText: { fontSize: "15px", fontWeight: 500 },
    dividerText: { fontSize: "13px", color: "var(--muted-foreground)" },
    dividerLine: { backgroundColor: "var(--border)" },
    formFieldLabel: { fontSize: "14px", fontWeight: 500, color: "var(--foreground)" },
    formFieldInput: { ...field, paddingInline: "12px" },
    formButtonPrimary: {
      height: "44px",
      borderRadius: "var(--radius)",
      fontSize: "15px",
      fontWeight: 500,
      boxShadow: "none",
    },
    buttonArrowIcon: { display: "none" },
    footer: { background: "transparent", backgroundImage: "none", paddingTop: 0 },
    footerAction: { justifyContent: "center" },
    footerActionText: { fontSize: "15px", color: "var(--muted-foreground)" },
    footerActionLink: {
      fontSize: "15px",
      fontWeight: 500,
      color: "var(--foreground)",
      textDecoration: "underline",
      textUnderlineOffset: "2px",
    },
  },
} satisfies NonNullable<React.ComponentProps<typeof SignIn>["appearance"]>;
