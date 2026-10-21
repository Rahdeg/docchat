import { loadEnvConfig } from "@next/env";

// Import this first: scripts run outside Next, and `@/lib/env` reads process.env on import.
loadEnvConfig(process.cwd());
