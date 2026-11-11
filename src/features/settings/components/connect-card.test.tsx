// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectCard } from "./connect-card";

afterEach(cleanup);

const localNote = /needs DocChat's public HTTPS address/;

describe("ConnectCard", () => {
  it("shows the production server URL and the Claude Code command for it", () => {
    render(<ConnectCard mcpUrl="https://docchat.raheem.online/mcp" enabled />);

    expect(screen.getByLabelText("Server URL")).toHaveProperty(
      "value",
      "https://docchat.raheem.online/mcp",
    );
    expect(screen.getByLabelText("Claude Code command")).toHaveProperty(
      "value",
      "claude mcp add --transport http docchat https://docchat.raheem.online/mcp",
    );
    expect(screen.queryByText(localNote)).toBeNull();
  });

  it("warns that Claude Desktop can't reach a local copy", () => {
    render(<ConnectCard mcpUrl="http://localhost:3000/mcp" enabled />);

    expect(screen.getByText(localNote)).toBeTruthy();
  });

  it("shows no URL when MCP is off", () => {
    render(<ConnectCard mcpUrl="https://docchat.raheem.online/mcp" enabled={false} />);

    expect(screen.queryByLabelText("Server URL")).toBeNull();
    expect(screen.getByText(/turned off/)).toBeTruthy();
  });
});
