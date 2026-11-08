import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { authAppearance } from "@/features/public/clerk-appearance";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a free DocChat account: upload your documents and ask your first question.",
};

export default function SignUpPage() {
  return <SignUp appearance={authAppearance} />;
}
