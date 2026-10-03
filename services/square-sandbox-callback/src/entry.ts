import "server-only";

import { runSquareSandboxPortalCommand } from "./server";

// A dedicated executable entry is required: ncc's internal module object cannot
// be compared with require.main. Library imports remain inert for local tests.
process.on("uncaughtException", () => { process.exit(78); });
process.on("unhandledRejection", () => { process.exit(78); });
void runSquareSandboxPortalCommand().catch(() => { process.exitCode = 78; });
