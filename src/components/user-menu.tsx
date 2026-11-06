"use client";

import { UserButton } from "@clerk/nextjs";
import { SettingsIcon } from "lucide-react";

import { routes } from "@/lib/routes";

// Clerk's user button, with DocChat's Settings above "Manage account" and "Sign out".
export function UserMenu() {
  return (
    <UserButton showName>
      <UserButton.MenuItems>
        <UserButton.Link
          label="Settings"
          labelIcon={<SettingsIcon className="size-4" />}
          href={routes.settings}
        />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
