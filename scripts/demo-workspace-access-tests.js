const fs = require("fs");
const path = require("path");

const root = process.cwd();
let failures = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function walk(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(absolute, entry.name);
    const relativePath = path.relative(root, entryPath);

    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
      return [];
    }

    if (entry.isDirectory()) {
      return walk(relativePath);
    }

    return [relativePath];
  });
}

function check(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`OK: ${message}`);
  }
}

const workspaceContext = read("lib/workspaces/current.ts");
check(workspaceContext.includes("isVaeroexAdminUser"), "Workspace context checks Vaeroex internal/admin authorization.");
check(workspaceContext.includes("isDemoWorkspaceRecord"), "Workspace context identifies demo workspaces before exposing them.");
check(
  workspaceContext.includes("canAccessDemoWorkspace") &&
    workspaceContext.includes("visibleRows") &&
    workspaceContext.includes("!isDemoWorkspaceRecord(workspace)"),
  "Workspace context filters demo memberships out for non-internal users."
);
check(workspaceContext.includes("visibleRows.find"), "Active workspace membership is resolved only from visible workspace rows.");

const workspaceActions = read("lib/workspaces/actions.ts");
check(workspaceActions.includes("isVaeroexAdminUser"), "Workspace switch action checks Vaeroex internal/admin authorization.");
check(workspaceActions.includes("isDemoWorkspaceRecord"), "Workspace switch action identifies demo workspaces.");
check(
  workspaceActions.includes("isDemoWorkspaceRecord(workspace) && !isVaeroexAdminUser(user)"),
  "Workspace switch action denies direct demo selection for non-internal users."
);

const demoActions = read("app/app/demo/actions.ts");
check(demoActions.includes("requireDemoWorkspaceAccess"), "Demo actions use one shared internal access guard.");
check(
  /export async function createDemoWorkspaceAction\(\) \{[\s\S]*requireDemoWorkspaceAccess\(user, "create a sample business environment"\)/.test(demoActions),
  "Creating a demo workspace requires internal access."
);
check(
  /export async function openDemoWorkspaceAction\(\) \{[\s\S]*requireDemoWorkspaceAccess\(user, "open a sample business environment"\)/.test(demoActions),
  "Opening a demo workspace requires internal access."
);
check(
  /export async function createFreshDemoWorkspaceAction\(\) \{[\s\S]*requireDemoWorkspaceAccess\(user, "create a fresh sample business environment"\)/.test(demoActions),
  "Creating a fresh demo workspace requires internal access."
);
check(
  /export async function resetDemoWorkspaceAction\(\) \{[\s\S]*requireDemoWorkspaceAccess\(user, "reset a sample business environment"\)/.test(demoActions),
  "Resetting a demo workspace requires internal access."
);

const onboarding = read("components/app/OnboardingChecklist.tsx");
check(!onboarding.includes("explore a separate demo workspace"), "Customer onboarding no longer suggests demo workspace access.");
check(!onboarding.includes("Want to see Vaeroex with data?"), "Customer onboarding no longer renders a demo callout.");
check(!onboarding.includes("The demo workspace is separate from customer workspaces"), "Customer onboarding no longer describes demo workspace exploration.");

const helpContent = read("lib/help/content.ts");
check(!helpContent.includes("Using the demo workspace"), "Customer Help Center no longer exposes a demo workspace article.");

const appShell = read("components/app/AppShell.tsx");
check(appShell.includes("Sample Business Environment"), "Internal users still see the sample business environment label.");

const demoStatusAllowedFiles = new Set([
  "app/app/admin/workspaces/page.tsx",
  "app/app/demo/actions.ts",
  "components/app/AppShell.tsx",
  "lib/billing/get-subscription-status.ts",
  "lib/billing/plans.ts",
  "lib/demo/workspace-demo.ts"
]);

const unexpectedDemoStatusFiles = walk("app")
  .concat(walk("components"), walk("lib"))
  .filter((file) => read(file).includes('subscription_status === "demo"') || read(file).includes('subscription_status: "demo"'))
  .filter((file) => !demoStatusAllowedFiles.has(file));

check(
  unexpectedDemoStatusFiles.length === 0,
  `No setup, onboarding, or customer workflow creates or exposes demo workspace status unexpectedly.${unexpectedDemoStatusFiles.length ? ` Found: ${unexpectedDemoStatusFiles.join(", ")}` : ""}`
);

if (failures > 0) {
  console.error(`Demo workspace access regression checks failed: ${failures}`);
  process.exit(1);
}

console.log("Demo workspace access regression checks passed.");
