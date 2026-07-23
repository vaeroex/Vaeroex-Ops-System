const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const policy = read("lib/product/conversational-vaeroex.ts");
const appShell = read("components/app/AppShell.tsx");
const askPage = read("app/app/ask/page.tsx");
const agentsPage = read("app/app/agents/page.tsx");
const agentsActions = read("app/app/agents/actions.ts");
const contextualActions = read("app/app/contextual-ask/actions.ts");
const searchRoute = read("app/api/search/route.ts");
const globalSearch = read("components/app/GlobalSearch.tsx");

assert.match(policy, /import "server-only"/, "the conversational policy must remain server-only");
assert.match(policy, /VAEROEX_CONVERSATIONAL_POLICY/, "future conversational access must use its own explicit policy variable");
assert.match(policy, /premium_conversational_v1/, "future conversational access must require the approved premium policy value");
assert.doesNotMatch(policy, /NEXT_PUBLIC_/, "the conversational policy must not be controlled by a client-exposed variable");
assert.match(appShell, /isPremiumConversationalVaeroexEnabled\(\)[\s\S]*href:\s*"\/app\/ask"/, "Ask navigation must be hidden by default and available only to the future premium policy");
assert.match(askPage, /if \(!isPremiumConversationalVaeroexEnabled\(\)\) redirect\("\/app\/intelligence"\)/, "direct Version 1 Ask visits must return to Intelligence");
assert.match(askPage, /params\.run[\s\S]*redirect\(`\/app\/agents/, "bookmarked historical results must remain readable in the result viewer");
assert.match(agentsPage, /redirect\("\/app\/intelligence"\)/, "the legacy result route must not become a new-question surface");
assert.doesNotMatch(agentsPage, /href="\/app\/ask"|pathname:\s*"\/app\/ask"|return_path" value=\{`\/app\/ask/, "historical result controls must not send Version 1 users back into Ask");

const postStart = searchRoute.indexOf("export async function POST");
const postPolicyGate = searchRoute.indexOf("if (!isPremiumConversationalVaeroexEnabled())", postStart);
const postRequestParsing = searchRoute.indexOf("request.json()", postStart);
assert.ok(postStart >= 0 && postPolicyGate > postStart, "the generative POST route must enforce the conversational policy");
assert.ok(postRequestParsing < 0 || postPolicyGate < postRequestParsing, "the disabled POST route must fail before parsing or provider work");
assert.match(searchRoute, /export async function GET/, "deterministic GET Search must remain available");
assert.match(agentsActions, /workflow\.key === "ask_vaeroex"[\s\S]*!isPremiumConversationalVaeroexEnabled\(\)/, "legacy Ask server actions must fail closed");
assert.match(contextualActions, /if \(!isPremiumConversationalVaeroexEnabled\(\)\)/, "embedded conversational actions must fail closed");

assert.match(globalSearch, /fetch\(`\/api\/search\?q=/, "Search must continue to use deterministic GET requests");
assert.doesNotMatch(globalSearch, /method:\s*"POST"/, "Search must not invoke conversational generation");
assert.match(globalSearch, /searchParams\.get\("ask"\) === "1"[\s\S]{0,180}router\.replace\("\/app\/intelligence"/, "legacy Ask query links must resolve to Intelligence");

for (const file of [
  "app/app/page.tsx",
  "app/app/kpis/page.tsx",
  "components/intelligence/PrestigeOperationsPanel.tsx",
  "components/operations/ManagedRecordList.tsx"
]) {
  assert.doesNotMatch(read(file), /ContextualAskVaeroex/, `${file} must not expose embedded freeform conversation in Version 1`);
}

for (const file of [
  "lib/help/content.ts",
  "lib/billing/plans.ts",
  "components/app/ThemeControls.tsx",
  "lib/legal/content.ts",
  "app/app/crm/page.tsx",
  "app/app/files/actions.ts"
]) {
  assert.doesNotMatch(read(file), /\/app\/ask|Search and Ask Vaeroex/, `${file} must not advertise the retired Version 1 experience`);
}

assert.match(read("components/app/AskVaeroexWorkspace.tsx"), /method:\s*"POST"/, "the future premium conversational workspace must remain available for later qualification");
assert.match(read("components/app/AskVaeroexResponse.tsx"), /ExecutiveIntelligenceAnswer/, "the dormant premium renderer must remain intact");
assert.match(read("lib/search/ask-session.ts"), /ASK_MAX_FOLLOW_UPS = 5/, "the dormant premium session boundary must remain intact");

console.log("Ask Vaeroex Version 1 retirement regression tests passed.");
