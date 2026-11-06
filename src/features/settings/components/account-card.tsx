import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ManageAccountButton } from "./manage-account-button";

export function AccountCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
        <CardDescription>
          Change your email, password and sign-in methods, or delete your account. Deleting it
          removes all your documents, chats and tasks from DocChat.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ManageAccountButton />
      </CardContent>
    </Card>
  );
}
