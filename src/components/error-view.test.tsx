// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorView, errorReference } from "./error-view";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function serverError(message: string, digest: string) {
  return Object.assign(new Error(message), { digest });
}

describe("errorReference", () => {
  it("uses Next's digest for server errors", () => {
    expect(errorReference(serverError("boom", "2894473048"))).toBe("2894473048");
  });

  it("has none for errors thrown in the browser, or non-errors", () => {
    expect(errorReference(new Error("boom"))).toBeNull();
    expect(errorReference("boom")).toBeNull();
  });
});

describe("ErrorView", () => {
  it("shows the reference and Try again, never the message or stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = serverError("password=hunter2 at db.ts:12", "2894473048");
    const retry = vi.fn();
    const { container } = render(<ErrorView error={error} retry={retry} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(screen.getByText("2894473048")).toBeTruthy();
    expect(container.textContent).not.toContain("hunter2");
    expect(container.textContent).not.toContain(error.stack?.split("\n")[1]?.trim() ?? "@@");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("gives a browser error a short random reference and logs it with the error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("secret detail");
    render(<ErrorView error={error} retry={() => {}} />);

    const reference = screen.getByText(/^[0-9a-f]{10}$/).textContent;
    expect(log).toHaveBeenCalledWith(`[ref ${reference}]`, error);
    expect(screen.queryByText(/secret detail/)).toBeNull();
  });

  it("inside the app, renders no <main> of its own (the sidebar inset is one)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<ErrorView error={new Error("x")} retry={() => {}} inset />);
    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
  });
});
