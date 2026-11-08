import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { authAppearance } from "@/features/public/clerk-appearance";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <SignIn appearance={authAppearance} />;
}
