import { PlugIcon } from "lucide-react";

import { CopyField } from "@/components/copy-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// "Connect your AI app" (docs/adr/0008): the MCP server's URL and how to add it to Claude Code
// and Claude Desktop. Claude Desktop connects from Claude's servers, so it needs the public
// HTTPS address; a local copy of DocChat only works with apps on the same machine.
export function ConnectCard({ mcpUrl, enabled }: { mcpUrl: string; enabled: boolean }) {
  const isPublic = mcpUrl.startsWith("https://");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugIcon className="size-4 text-secondary-text" aria-hidden />
          Connect your AI app
        </CardTitle>
        <CardDescription>
          Let Claude, Cursor or another app that supports MCP search your documents and manage your
          tasks. The app uses its own AI, so it doesn&rsquo;t count against your questions in
          DocChat.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {enabled ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Server URL</span>
              <CopyField value={mcpUrl} label="Server URL" />
            </div>

            <ol className="flex flex-col gap-4 text-sm">
              <li className="flex flex-col gap-2">
                <span className="font-medium">Claude Code</span>
                <span className="text-secondary-text">
                  Run this, then type <span className="font-medium text-foreground">/mcp</span> in
                  Claude Code to sign in:
                </span>
                <CopyField
                  value={`claude mcp add --transport http docchat ${mcpUrl}`}
                  label="Claude Code command"
                />
              </li>
              <li className="flex flex-col gap-1">
                <span className="font-medium">Claude Desktop</span>
                <span className="text-secondary-text">
                  Open Customize, then Connectors, choose Add custom connector, and paste the server
                  URL.
                  {isPublic
                    ? null
                    : " Claude Desktop connects from Claude's servers, so it needs DocChat's public HTTPS address, not this local one."}
                </span>
              </li>
              <li className="flex flex-col gap-1">
                <span className="font-medium">Other apps</span>
                <span className="text-secondary-text">
                  Add a remote MCP server (Streamable HTTP) with the server URL.
                </span>
              </li>
            </ol>

            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-secondary-text">
              DocChat will ask you to sign in and approve access. The app can then read your
              documents and tasks, add tasks and mark them done. It can&rsquo;t delete anything.
            </p>
          </>
        ) : (
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-secondary-text">
            Connecting AI apps is turned off for DocChat right now. Apps you&rsquo;ve already
            connected can&rsquo;t reach your documents until it&rsquo;s turned back on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
