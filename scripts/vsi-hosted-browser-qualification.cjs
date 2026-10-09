/* eslint-disable @typescript-eslint/no-require-imports -- Explicitly invoked hosted synthetic qualification; importing this module never performs I/O or provider calls. */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServerClient } = require("@supabase/ssr");
const { chromium } = require("playwright");
const { cases } = require("./vsi-real-provider-qualification.cjs");

const MAX_QUESTIONS = 12, CEILING_USD = 3, REQUEST_RESERVATION_USD = 0.25;
const UI_CASE_IDS = ["general-writing", "current-weather", "repair-kpi"];
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function stageOrigin(value) {
  const url = new URL(value);
  assert(url.protocol === "https:" && /^[a-z0-9-]+\.vercel\.app$/i.test(url.hostname), "stage_must_be_https_vercel_deployment");
  assert(!url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash, "stage_origin_only");
  return url.origin;
}
function validateConfig(config) {
  assert(config && config.synthetic === true, "explicit_synthetic_config_required");
  const origin = stageOrigin(config.origin);
  assert(Array.isArray(config.allowedStageOrigins) && config.allowedStageOrigins.map(stageOrigin).includes(origin), "exact_stage_origin_allowlist_required");
  const api = new URL(config.apiUrl);
  assert(api.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(api.hostname) && !api.username && !api.password && !api.port && api.pathname === "/" && !api.search && !api.hash, "explicit_https_supabase_origin_required");
  assert(typeof config.anonKey === "string" && config.anonKey.length > 20, "anon_key_required");
  assert(config.serviceKey === undefined && config.dbUrl === undefined && config.openaiKey === undefined, "runner_does_not_accept_admin_or_provider_credentials");
  assert(Array.isArray(config.allowedWorkspaceIds) && config.allowedWorkspaceIds.length === 2 && new Set(config.allowedWorkspaceIds).size === 2 && config.allowedWorkspaceIds.every(uuid), "exactly_two_synthetic_workspaces_required");
  assert(Array.isArray(config.actors) && config.actors.length >= 2 && config.actors.length <= 3, "two_or_three_synthetic_actors_required");
  for (const actor of config.actors) {
    assert(uuid(actor.id) && config.allowedWorkspaceIds.includes(actor.workspaceId), "actor_must_belong_to_explicit_workspace_allowlist");
    assert(typeof actor.email === "string" && /^(?:synthetic|vsi)[a-z0-9._+-]*@(?:[a-z0-9-]+\.)*example\.invalid$/i.test(actor.email), "synthetic_example_invalid_identity_required");
    assert(typeof actor.password === "string" && actor.password.length >= 16, "synthetic_password_required");
  }
  assert(new Set(config.actors.map(actor => actor.id)).size === config.actors.length, "distinct_actors_required");
  assert(new Set(config.actors.map(actor => actor.workspaceId)).size === 2, "actors_must_cover_both_allowed_workspaces");
  if (config.vercelShareUrl) {
    const share = new URL(config.vercelShareUrl);
    assert(share.origin === origin && !share.username && !share.password, "share_url_must_target_exact_stage");
  }
  for (const cookie of config.contextCookies || []) {
    assert(cookie && /^_vercel/.test(cookie.name) && typeof cookie.value === "string", "only_explicit_vercel_protection_cookies_may_be_supplied");
    assert((!cookie.domain || cookie.domain === new URL(origin).hostname) && (!cookie.url || new URL(cookie.url).origin === origin), "protection_cookies_must_be_origin_scoped");
  }
  if (config.confirmNote) {
    const proposal = config.confirmNote;
    assert(config.actors.some(actor => actor.id === proposal.actorId) && uuid(proposal.conversationId) && uuid(proposal.exchangeId), "explicit_note_confirmation_identity_required");
    assert(typeof proposal.expectedContent === "string" && proposal.expectedContent.length > 0 && proposal.expectedContent.length <= 1800, "exact_note_content_required");
  }
  return { ...config, origin, apiUrl: api.origin };
}
function readConfig(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && (stat.mode & 0o777) === 0o600, "config_must_be_regular_private_0600_file");
  if (process.getuid) assert.equal(stat.uid, process.getuid(), "config_must_be_owned_by_caller");
  return validateConfig(JSON.parse(fs.readFileSync(file, "utf8")));
}
function selectCases(full) {
  const selected = UI_CASE_IDS.map(id => cases.find(item => item.id === id));
  assert(selected.every(Boolean), "required_ui_cases_missing");
  if (full) selected.push(...cases.filter(item => !UI_CASE_IDS.includes(item.id)));
  assert(selected.length <= MAX_QUESTIONS && selected.length * REQUEST_RESERVATION_USD <= CEILING_USD, "qualification_budget_exceeded");
  return selected;
}
function actorForCase(config, item) {
  if (item.actor === 0) return config.actors[0];
  const actor = config.actors.find(candidate => candidate.workspaceId !== config.actors[0].workspaceId);
  assert(actor, "second_workspace_actor_required");
  return actor;
}
function sanitizer(config) {
  const secrets = [config.anonKey, config.vercelShareUrl, process.env.VERCEL_OIDC_TOKEN, ...config.actors.flatMap(actor => [actor.email, actor.password]), ...(config.contextCookies || []).map(cookie => cookie.value)].filter(Boolean);
  return value => {
    let result = String(value ?? "");
    for (const secret of secrets) result = result.split(secret).join("[redacted]");
    return result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
      .replace(/([?&](?:_vercel_share|token|key|apikey|password|signature|authorization)=)[^&#\s]+/gi, "$1[redacted]");
  };
}
function citationView(citation, sanitize) {
  return Object.fromEntries(["id", "title", "url", "sourceType", "sourceId", "evidenceDate", "retrievedAt", "excerpt"]
    .filter(key => citation[key] !== undefined).map(key => [key, citation[key] === null ? null : sanitize(citation[key])]));
}
function responseChecks(item, exchange) {
  const checks = [];
  assert(exchange && uuid(exchange.id) && typeof exchange.answer === "string" && exchange.answer.trim().length > 20, "answer_missing_or_empty");
  assert(Array.isArray(exchange.citations), "citation_list_missing"); checks.push("answer_returned");
  if (item.id === "general-writing") {
    assert.equal(exchange.citations.length, 0, "general_question_should_not_require_business_evidence"); checks.push("general_without_business_evidence");
  }
  if (item.id === "current-weather") {
    const web = exchange.citations.filter(source => source.sourceType === "web");
    assert(web.length > 0, "live_question_requires_web_citation");
    for (const source of web) {
      assert(/^https?:\/\//.test(source.url), "live_source_url_missing");
      assert(Number.isFinite(Date.parse(source.retrievedAt)), "live_lookup_timestamp_missing");
      assert(Math.abs(Date.now() - Date.parse(source.retrievedAt)) < 15 * 60_000, "live_lookup_timestamp_not_current");
    }
    checks.push("web_source_and_current_lookup_timestamp");
  }
  if (!item.id.startsWith("general-") && item.id !== "current-weather" && !["missing-cause"].includes(item.id)) {
    assert(exchange.citations.some(source => source.sourceType !== "web"), "business_question_missing_business_citation"); checks.push("business_source_cited");
  }
  return checks;
}

async function main(configPath, outputDirectory, { full = false, validateOnly = false } = {}) {
  const config = readConfig(configPath), selected = selectCases(full), sanitize = sanitizer(config);
  assert(path.isAbsolute(outputDirectory), "absolute_output_directory_required");
  const planned = { synthetic: true, origin: config.origin, caseIds: selected.map(item => item.id), maximumNewQuestions: selected.length,
    reservationPerRequestUsd: REQUEST_RESERVATION_USD, reservedWorstCaseUsd: selected.length * REQUEST_RESERVATION_USD, ceilingUsd: CEILING_USD };
  if (validateOnly) { console.log(JSON.stringify({ ...planned, validatedOnly: true, networkCalls: 0 })); return planned; }
  assert(!fs.existsSync(path.join(outputDirectory, "results.json")), "fresh_output_directory_required_do_not_rerun_paid_cases_implicitly");
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 }); fs.chmodSync(outputDirectory, 0o700);
  const report = { ...planned, model: "gpt-6-luna", startedAt: new Date().toISOString(), dispatchedQuestions: 0,
    reservedWorstCaseUsd: 0, estimatedWorkspaceCostDeltaUsd: 0, providerTokenAccounting: "Collect authoritative vsi_cost_events separately; browser receives workspace cost totals.",
    questions: [], failures: [], usage: [], browserErrors: [], humanReviewRequired: true, imageProcessorE2E: false };
  const save = () => fs.writeFileSync(path.join(outputDirectory, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  const sessions = new Map(), baseline = new Map(), seenRequests = new Set(); let browser;
  const oidcHeaders = () => process.env.VERCEL_OIDC_TOKEN ? { "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN } : {};
  const fail = (phase, error, caseId) => report.failures.push({ phase, ...(caseId ? { caseId } : {}), message: sanitize(error instanceof Error ? error.message : error) });
  function claimQuestion(state, body) {
    assert(state.activeCase && body.message === state.activeCase.question, "only_current_approved_case_may_be_sent");
    assert(uuid(body.requestId) && !seenRequests.has(body.requestId), "runner_never_automatically_retries_provider_questions");
    assert(report.dispatchedQuestions < MAX_QUESTIONS && (report.dispatchedQuestions + 1) * REQUEST_RESERVATION_USD <= CEILING_USD, "runner_question_or_spending_ceiling_reached");
    seenRequests.add(body.requestId); report.dispatchedQuestions++; report.reservedWorstCaseUsd = report.dispatchedQuestions * REQUEST_RESERVATION_USD;
    state.requestId = body.requestId; state.lastDispatchAt = Date.now(); save();
  }
  function assertMutation(state, pathname, body, fromBrowser = false) {
    assert(body && body.expectedWorkspaceId === state.actor.workspaceId && config.allowedWorkspaceIds.includes(body.expectedWorkspaceId), "mutation_workspace_mismatch");
    if (pathname === "/api/vsi/conversations") {
      assert(state.activeCase, "chat_creation_outside_selected_case");
      assert(++state.createdChats <= selected.length, "excess_chat_creation_blocked"); return;
    }
    const match = pathname.match(/^\/api\/vsi\/conversations\/([0-9a-f-]+)\/(messages|remember)$/i);
    assert(match && state.ownedChats.has(match[1]), "only_runner_owned_chat_mutations_allowed");
    if (match[2] === "remember") {
      assert(!fromBrowser && state.noteConfirmation && state.noteConfirmation.conversationId === match[1]
        && state.noteConfirmation.exchangeId === body.exchangeId && body.confirm === true, "only_explicit_exact_note_confirmation_allowed");
      return;
    }
    claimQuestion(state, body);
    if (fromBrowser) assert(state.mode === "ui", "unexpected_browser_question");
  }
  async function api(state, route, method = "GET", body) {
    const url = new URL(`/api/vsi${route}`, config.origin);
    if (method === "GET") url.searchParams.set("workspaceId", state.actor.workspaceId);
    else assertMutation(state, url.pathname, { ...body, expectedWorkspaceId: state.actor.workspaceId });
    const response = await state.context.request.fetch(url.href, { method, headers: { origin: config.origin, "content-type": "application/json", ...oidcHeaders() },
      ...(method !== "GET" ? { data: { ...body, expectedWorkspaceId: state.actor.workspaceId } } : {}), timeout: 210_000, maxRedirects: 0 });
    let data; try { data = await response.json(); } catch { throw new Error(`api_non_json_${response.status()}_check_deployment_protection`); }
    if (data.workspaceId !== undefined) assert.equal(data.workspaceId, state.actor.workspaceId, "response_workspace_mismatch");
    if (response.status() >= 400) throw new Error(`api_${response.status()}_${sanitize(data.code || "unavailable")}: ${sanitize(data.error || data.message || "Request failed")}`);
    assert.equal(data.workspaceId, state.actor.workspaceId, "successful_response_workspace_required");
    if (method === "POST" && route === "/conversations") { assert(uuid(data.conversation?.id), "created_chat_id_missing"); state.ownedChats.add(data.conversation.id); }
    return data;
  }
  async function usage(state, phase) {
    const data = await api(state, "/usage"), budget = data.workspaceBudget;
    assert(budget && Number.isFinite(budget.spentUsd) && Number.isFinite(budget.reservedUsd), "measurable_workspace_spending_required");
    const previous = baseline.get(state.actor.workspaceId);
    if (!previous) { assert.equal(budget.reservedUsd, 0, "synthetic_workspace_has_inflight_requests"); baseline.set(state.actor.workspaceId, budget); }
    else assert.equal(budget.periodStart, previous.periodStart, "cost_period_changed_stop_and_reconcile");
    const starting = baseline.get(state.actor.workspaceId);
    const delta = Math.max(0, budget.spentUsd + budget.reservedUsd - starting.spentUsd - starting.reservedUsd);
    state.costDelta = delta;
    report.estimatedWorkspaceCostDeltaUsd = [...sessions.values()].reduce((sum, entry) => sum + (entry.costDelta || 0), 0);
    report.usage.push({ workspace: state.label, phase, at: new Date().toISOString(), usedQuestions: data.used, spentUsd: budget.spentUsd,
      reservedUsd: budget.reservedUsd, periodStart: budget.periodStart, deltaUsd: delta });
    assert(report.estimatedWorkspaceCostDeltaUsd + REQUEST_RESERVATION_USD <= CEILING_USD, "measured_spending_ceiling_reached");
    save();
  }
  async function session(actor, label) {
    const cookieJar = new Map();
    const authFetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert(url.origin === config.apiUrl && ["/auth/v1/token", "/auth/v1/user"].includes(url.pathname), "auth_transport_outside_explicit_supabase");
      return fetch(input, { ...init, redirect: "error" });
    };
    const client = createServerClient(config.apiUrl, config.anonKey, { global: { fetch: authFetch }, auth: { autoRefreshToken: false, detectSessionInUrl: false },
      cookies: { getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(cookie => cookieJar.set(cookie.name, cookie.value)) } });
    const login = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
    assert(!login.error && login.data.user?.id === actor.id && login.data.user.email?.toLowerCase() === actor.email.toLowerCase(), `synthetic_authentication_failed_${login.error?.status || "identity"}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const state = { actor, label, context, page: await context.newPage(), ownedChats: new Set(), createdChats: 0, activeCase: null, costDelta: 0 };
    await context.addCookies((config.contextCookies || []).map(cookie => ({ name: cookie.name, value: cookie.value, url: config.origin, httpOnly: true, secure: true, sameSite: "Lax" })));
    await context.addCookies([...cookieJar].map(([name, value]) => ({ name, value, url: config.origin, secure: true, sameSite: "Lax" })));
    await context.addCookies([{ name: "vaeroex_workspace_id", value: actor.workspaceId, url: config.origin, secure: true, sameSite: "Lax" }]);
    await context.route("**/*", async route => {
      try {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== config.origin) return route.abort();
        const headers = { ...request.headers(), ...oidcHeaders() };
        if (!["GET", "HEAD"].includes(request.method())) {
          assert.equal(request.method(), "POST", "unexpected_browser_mutation_method");
          const body = request.postDataJSON(); assertMutation(state, url.pathname, body, true);
          if (url.pathname === "/api/vsi/conversations") {
            const response = await route.fetch({ headers, maxRedirects: 0 });
            if (response.status() === 201) { const data = await response.json(); assert.equal(data.workspaceId, actor.workspaceId); assert(uuid(data.conversation?.id)); state.ownedChats.add(data.conversation.id); }
            return route.fulfill({ response });
          }
        }
        const workspace = url.searchParams.get("workspaceId");
        assert(!workspace || workspace === actor.workspaceId, "browser_lookup_wrong_workspace");
        return route.continue({ headers });
      } catch (error) { fail("browser_request_guard", error, state.activeCase?.id); save(); return route.abort(); }
    });
    state.page.setDefaultTimeout(210_000); state.page.on("pageerror", error => { report.browserErrors.push(sanitize(error.message)); save(); });
    if (config.vercelShareUrl) await state.page.goto(config.vercelShareUrl, { waitUntil: "domcontentloaded" });
    await usage(state, "before");
    return state;
  }
  async function uiQuestion(state, item, width) {
    await state.page.setViewportSize({ width, height: 1000 });
    await state.page.goto(`${config.origin}/app/si`, { waitUntil: "domcontentloaded" });
    await state.page.getByRole("heading", { name: "Vaeroex Super Intelligence", exact: true }).waitFor();
    await state.page.getByRole("button", { name: "New chat", exact: true }).click();
    assert.equal(await state.page.locator('input[type="file"]').count(), 0, "chat_must_remain_text_only");
    await state.page.getByLabel("Message Vaeroex", { exact: true }).fill(item.question);
    const responsePromise = state.page.waitForResponse(response => new URL(response.url()).origin === config.origin && /\/api\/vsi\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await state.page.getByRole("button", { name: "Send", exact: true }).click();
    const response = await responsePromise; let data;
    try { data = await response.json(); } catch { throw new Error(`ui_non_json_${response.status()}`); }
    assert.equal(response.status(), 200, `ui_answer_${response.status()}_${sanitize(data.code || "unavailable")}: ${sanitize(data.error || "")}`);
    assert.equal(data.workspaceId, state.actor.workspaceId, "ui_answer_workspace_mismatch");
    assert(state.ownedChats.has(data.conversation?.id), "ui_answer_requires_runner_owned_chat");
    await state.page.getByText("Answer saved.", { exact: true }).waitFor();
    const article = state.page.getByRole("article").last();
    assert((await article.innerText()).includes(item.question), "rendered_question_missing");
    if (data.exchange.citations.length) {
      await article.locator("details summary").click();
      assert(await article.getByText(/Checked:/).count(), "rendered_source_timestamp_missing");
    }
    assert(await state.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "horizontal_overflow");
    await state.page.screenshot({ path: path.join(outputDirectory, `${item.id}-${width}.png`), fullPage: true });
    return data;
  }
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    for (const [index, actor] of [config.actors[0], actorForCase(config, { actor: 2 })].entries()) sessions.set(actor.id, await session(actor, index ? "workspace-b" : "workspace-a"));
    for (const [index, item] of selected.entries()) {
      const actor = actorForCase(config, item), state = sessions.get(actor.id);
      const pacingMs = Math.max(0, 7000 - (Date.now() - (state.lastDispatchAt || 0)));
      if (pacingMs) await new Promise(resolve => setTimeout(resolve, pacingMs));
      state.activeCase = item; state.requestId = null; state.mode = index < 3 ? "ui" : "api";
      await usage(state, `before:${item.id}`);
      const started = Date.now(), row = { id: item.id, question: item.question, expectedQuality: item.expect, workspace: state.label, transport: state.mode, humanGrade: null };
      try {
        let data;
        if (state.mode === "ui") data = await uiQuestion(state, item, item.id === "current-weather" ? 390 : 1440);
        else {
          const created = await api(state, "/conversations", "POST", { title: `Synthetic qualification: ${item.id}` });
          data = await api(state, `/conversations/${created.conversation.id}/messages`, "POST", { message: item.question, requestId: randomUUID() });
        }
        row.answer = sanitize(data.exchange?.answer); row.citations = (data.exchange?.citations || []).map(source => citationView(source, sanitize));
        row.conversationId = data.conversation?.id; row.exchangeId = data.exchange?.id; row.checks = responseChecks(item, data.exchange);
        const persisted = await api(state, `/conversations/${data.conversation.id}`);
        const saved = persisted.exchanges.find(exchange => exchange.id === data.exchange.id);
        assert(saved && saved.answer === data.exchange.answer && saved.userMessage === item.question, "persisted_transcript_does_not_match_answer");
        row.checks.push("authenticated_persisted_transcript_matches"); row.transportCompleted = true;
        if (state.mode === "ui") {
          await state.page.reload({ waitUntil: "domcontentloaded" }); await state.page.getByRole("article").first().waitFor();
          assert((await state.page.getByRole("article").first().innerText()).includes(item.question), "browser_reopen_missing_question");
          row.checks.push("browser_reopened_saved_chat");
        }
      } catch (error) { row.transportCompleted = false; row.failure = sanitize(error instanceof Error ? error.message : error); fail("case", error, item.id); }
      finally { row.latencyMs = Date.now() - started; row.requestId = state.requestId || null; report.questions.push(row); state.activeCase = null; await usage(state, `after:${item.id}`); save(); }
      console.log(JSON.stringify({ case: item.id, completed: row.transportCompleted, dispatched: report.dispatchedQuestions, estimatedWorkspaceCostDeltaUsd: report.estimatedWorkspaceCostDeltaUsd }));
      if (!row.transportCompleted && index < 3) throw new Error("required_browser_case_failed_stop_before_more_provider_calls");
    }
    if (config.confirmNote) {
      const proposal = config.confirmNote, state = sessions.get(proposal.actorId);
      assert(state, "note_actor_must_be_one_of_the_qualified_workspace_owners");
      const detail = await api(state, `/conversations/${proposal.conversationId}`);
      const exchange = detail.exchanges.find(item => item.id === proposal.exchangeId);
      assert(detail.conversation.id === proposal.conversationId && exchange?.rememberProposal?.content === proposal.expectedContent, "explicit_note_proposal_no_longer_matches");
      state.ownedChats.add(proposal.conversationId); state.noteConfirmation = proposal;
      const confirmed = await api(state, `/conversations/${proposal.conversationId}/remember`, "POST", { exchangeId: proposal.exchangeId, confirm: true });
      state.noteConfirmation = null; assert(uuid(confirmed.noteId), "confirmed_note_id_missing");
      const refreshed = await api(state, `/conversations/${proposal.conversationId}`);
      assert.equal(refreshed.exchanges.find(item => item.id === proposal.exchangeId)?.savedNoteId, confirmed.noteId, "confirmed_note_link_not_persisted");
      report.noteConfirmation = { workspace: state.label, conversationId: proposal.conversationId, exchangeId: proposal.exchangeId, noteId: confirmed.noteId, exactProposalMatched: true };
    }
    const lastBusiness = report.questions.find(row => row.id === "repair-kpi" && row.transportCompleted);
    if (lastBusiness) {
      const state = sessions.get(config.actors[0].id);
      for (const width of [1440, 390]) {
        await state.page.setViewportSize({ width, height: 1000 }); await state.page.goto(`${config.origin}/app/si?chat=${lastBusiness.conversationId}`);
        await state.page.getByRole("article").first().waitFor(); await state.page.getByRole("article").first().locator("details summary").click();
        assert(await state.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "final_screenshot_horizontal_overflow");
        await state.page.screenshot({ path: path.join(outputDirectory, `final-business-${width}.png`), fullPage: true });
      }
    }
    assert.equal(report.browserErrors.length, 0, "browser_runtime_errors");
  } catch (error) { fail("runner", error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.passedTransportChecks = report.failures.length === 0 && report.questions.length === selected.length;
    save(); if (browser) await browser.close();
  }
  if (!report.passedTransportChecks) process.exitCode = 1;
  return report;
}

module.exports = { validateConfig, readConfig, selectCases, actorForCase, sanitizer, responseChecks, main, MAX_QUESTIONS, CEILING_USD, REQUEST_RESERVATION_USD };
if (require.main === module) {
  const args = process.argv.slice(2), flags = args.filter(value => value.startsWith("--")), positional = args.filter(value => !value.startsWith("--"));
  assert(flags.every(value => ["--full", "--validate-only"].includes(value)) && positional.length === 2, "Usage: node scripts/vsi-hosted-browser-qualification.cjs PRIVATE_CONFIG OUTPUT_DIRECTORY [--full] [--validate-only]");
  main(positional[0], positional[1], { full: flags.includes("--full"), validateOnly: flags.includes("--validate-only") }).catch(error => { console.error(`Qualification setup failed: ${error.name || "Error"}. Inspect the private configuration; no credentials are printed.`); process.exitCode = 1; });
}
