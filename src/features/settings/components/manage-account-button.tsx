"use client";

import { useClerk } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";

// Opens Clerk's UserProfile: email, password, sign-in methods, and deleting the account.
export function ManageAccountButton() {
  const clerk = useClerk();
  return (
    <Button variant="outline" className="w-fit" onClick={() => clerk.openUserProfile()}>
      Manage account
    </Button>
  );
}
