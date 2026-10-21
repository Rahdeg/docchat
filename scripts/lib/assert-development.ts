// Seeding wipes and rewrites rows, so it only ever runs against a local/dev database.
export function assertDevelopment(nodeEnv: string | undefined): void {
  if (nodeEnv !== "development") {
    throw new Error(
      `Refusing to seed: NODE_ENV is "${nodeEnv ?? "undefined"}", expected "development".`,
    );
  }
}
