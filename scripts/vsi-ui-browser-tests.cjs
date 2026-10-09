/* eslint-disable @typescript-eslint/no-require-imports -- Hydrated synthetic UI qualification with loopback-only API fixtures. */
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
const { root, loadSource, React } = require("./integrations-ui-test-support");
const { renderToString } = require("react-dom/server");
const { VsiWorkspace } = loadSource("components/vsi/VsiWorkspace.tsx", { "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) } });
const { safeSourceUrl } = loadSource("components/vsi/contracts.ts");
const workspaceId = "10000000-0000-4000-8000-000000000001", now = "2026-10-08T18:00:00.000Z";
const chat = (id, count = 1) => ({ id, title: id === "closed" ? "Long-running project" : id === "warning" ? "Planning history" : "Private planning", exchangeCount: count, createdAt: now, updatedAt: now });
const exchange = (id, message = "Help me plan my week") => ({ id, userMessage: message, answer: "**Start with your priorities.**\n\n1. Choose three outcomes.\n2. Leave time for interruptions.", citations: [], createdAt: now });
const literalCode = "## Keep this code heading literal\n\n<img src=x onerror=alert('unsafe')>\n[Unsafe link](javascript:alert('unsafe'))";
const structuredAnswer = "## Repair turnaround\nThe latest KPI is **3.8 days** against a two-day target [B1].\n\n### What to check first\n1. Compare dated repair tickets.\n2. Confirm parts availability.\n\n```text\n" + literalCode + "\n```\n\nAfter the code, [the guide](https://untrusted.example/guide) stays plain text.\n![Not an attachment](https://untrusted.example/attachment.png)";
const briefTable = "## Corporate brief\n| Measure | Current | Next check |\n| --- | ---: | --- |\n| Repair turnaround | **3.8 days** | Match dated repair tickets [B1] |\n| Target | 2 days | Confirm parts availability |\n| Safe cell | <img src=x onerror=alert(1)> | [Guide](https://untrusted.example/) |";
const longExchanges = () => Array.from({ length: 20 }, (_, index) => ({ ...exchange(`long-${index}`, `Planning question ${index + 1}: what should our workshop check next?`),
  answer: index === 19 ? briefTable : `## Workshop planning ${index + 1}\nReview the dated repair tickets and compare the promised completion date with the actual collection date. The current records do not establish why a repair was late. [B1]\n\nChoose one owner to inspect the matched records, then update the team with what they show.`,
  citations: Array.from({ length: index === 19 ? 8 : 2 }, (_, source) => ({ id: `B${source + 1}`, title: `Workshop source ${source + 1}`, url: source === 4 || source === 5 ? `https://public.example.test/source-${source + 1}` : `/app/sources/workshop-${source + 1}`, sourceType: source === 4 || source === 5 ? "web" : "file", sourceId: source === 4 || source === 5 ? null : `workshop-${source + 1}`, evidenceDate: source === 4 || source === 6 ? null : now, evidenceDateKind: ["publication", "updated", "observation", "event"][source], retrievedAt: now, excerpt: source === 4 || source === 5 ? "Legacy generated web summary mixes unsupported reporting." : "Approved workshop record with dated repair details. ".repeat(4) })) }));
const stored = new Map(), answers = new Map();
let posts = [], noteSaves = 0, usageReads = 0, firstFailure = true, lost = false, serverError = null, releaseDelayedAnswer = null;
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vsi-ui-browser-"));
async function main() {
  assert.equal(safeSourceUrl("javascript:alert(1)"), null); assert.equal(safeSourceUrl("//evil.example/"), null);
  assert.equal(safeSourceUrl("https://user:pass@example.test/"), null); assert.equal(safeSourceUrl("/app/sources/file-1"), "/app/sources/file-1");
  const entry = path.join(output, "entry.tsx");
  fs.writeFileSync(entry, 'import React from "react"; import { hydrateRoot } from "react-dom/client"; import { VsiWorkspace } from "@/components/vsi/VsiWorkspace"; const props = JSON.parse(document.getElementById("props")!.textContent!); const app = hydrateRoot(document.getElementById("fixture")!, <VsiWorkspace {...props}/>); const originalReplace = history.replaceState.bind(history); history.replaceState = (...args) => { originalReplace(...args); queueMicrotask(() => app.render(<VsiWorkspace {...props} initialConversationId={new URL(location.href).searchParams.get("chat") || ""}/>)); };');
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({ mode: "production", context: root, target: "web", devtool: false, optimization: { minimize: false }, entry, output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(root, "node_modules"), "node_modules"], alias: { "@": root, "next/link": path.join(root, "scripts/test-stubs/current-integrations-link.tsx") } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = loadSource("tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, "components/vsi/**/*.{ts,tsx}")] })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  stored.set("old", { conversation: { ...chat("old"), title: "Historical idea" }, exchanges: [] });
  stored.set("closed", { conversation: chat("closed", 250), exchanges: [exchange("closed-1")] });
  stored.set("warning", { conversation: chat("warning", 225), exchanges: [exchange("warning-1")] });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const send = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ workspaceId, ...data })); };
      if (url.pathname === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(fs.readFileSync(path.join(output, "fixture.js"))); }
      if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (url.pathname.startsWith("/api/vsi")) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        assert.equal(body ? body.expectedWorkspaceId : url.searchParams.get("workspaceId"), workspaceId);
        if (lost) return send({ code: "workspace_mismatch", message: "Your workspace changed. Reload to continue." }, 409);
        const route = url.pathname.replace("/api/vsi", "");
        if (route === "/usage") { usageReads++; return send({ used: answers.size, limit: 100, remaining: 100 - answers.size, resetsAt: "2026-10-09T18:00:00.000Z", workspaceBudget: { spentUsd: 0.04, reservedUsd: 0, limitUsd: 100, periodStart: now } }); }
        if (route === "/conversations" && req.method === "GET") return send({ conversations: [...stored.values()].filter(value => (value.conversation.id === "old") === Boolean(url.searchParams.get("before"))).map(value => value.conversation), nextCursor: url.searchParams.get("before") ? null : "older-cursor", canEditBusinessNotes: true });
        if (route === "/conversations" && req.method === "POST") { const id = `chat-${stored.size}`; const value = { conversation: { ...chat(id, 0), title: body.title || "New chat" }, exchanges: [] }; stored.set(id, value); return send(value); }
        const [, , id, action] = route.split("/"); const value = stored.get(id); assert(value, "conversation exists");
        if (action === "messages") {
          if (body.message === "other tab filled this chat") { value.conversation.exchangeCount = 250; return send({ code: "thread_full", message: "This chat has reached 250 exchanges. Continue in a new chat." }, 409); }
          posts.push(body);
          if (body.message.startsWith("Keep my reading position")) await new Promise(resolve => { releaseDelayedAnswer = resolve; });
          let answer = answers.get(body.requestId);
          if (!answer) {
            answer = exchange(body.requestId, body.message);
            if (body.message.includes("remember")) answer.rememberProposal = { title: "Business focus", content: "We sell handmade furniture." };
            if (body.message.includes("evidence")) { answer.answer = structuredAnswer; answer.citations = [{ id: "B1", title: "Delivery record", url: "/app/sources/delivery", sourceType: "file", sourceId: "delivery", evidenceDate: "2026-10-01T00:00:00Z", retrievedAt: now, excerpt: "Deliveries fell 10%." }]; }
            value.exchanges.push(answer); value.conversation.exchangeCount++; answers.set(body.requestId, answer);
          }
          if (body.message === "retry safely" && firstFailure) { firstFailure = false; return send({ message: "Connection interrupted after saving. Retry to retrieve your answer." }, 503); }
          return send({ ...value, exchange: answer });
        }
        if (action === "remember") { assert.equal(body.confirm, true); const target = value.exchanges.find(item => item.id === body.exchangeId); assert(target.rememberProposal); if (!target.savedNoteId) noteSaves++; target.savedNoteId = "note-1"; return send({ noteId: "note-1" }); }
        if (action === "continue") { assert.equal(value.conversation.exchangeCount, 250); const next = { conversation: { ...chat("continued", 0), parentConversationId: id }, exchanges: [] }; stored.set("continued", next); return send(next); }
        if (req.method === "PATCH") { value.conversation.title = body.title; return send(value); }
        if (req.method === "DELETE") { stored.delete(id); return send({ deleted: true }); }
        return send({ ...value, canEditBusinessNotes: true });
      }
      const props = { workspaceId, workspaceName: "Synthetic furniture shop", userId: "synthetic-user", initialConversationId: url.searchParams.get("chat") || "" };
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VSI synthetic UI</title><style>${css}</style></head><body><div class="vaeroex-app-shell vaeroex-customer-workspace"><main class="workspace-main mx-auto max-w-6xl p-4"><div id="fixture">${renderToString(React.createElement(VsiWorkspace, props))}</div></main></div><script id="props" type="application/json">${JSON.stringify(props)}</script><script src="/fixture.js"></script></body></html>`);
    } catch (error) { serverError = error; res.writeHead(500); res.end("Fixture failed"); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin); await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button')?.disabled);
    assert.equal(usageReads, 0); await page.getByRole("button", { name: "Load older chats" }).click(); await page.getByRole("button", { name: /Historical idea/ }).waitFor(); assert.equal(await page.getByRole("button", { name: "Load older chats" }).count(), 0); assert.equal(await page.locator('input[type="file"]').count(), 0);
    const composer = page.getByRole("textbox", { name: "Message Vaeroex" });
    await composer.fill("Help me plan my week"); await composer.press("Shift+Enter"); assert.equal(posts.length, 0);
    await composer.press("Enter"); await page.getByText("Answer saved.", { exact: true }).waitFor();
    assert.equal(posts.length, 1); assert.equal(noteSaves, 0); assert.equal(await page.getByText("Start with your priorities.", { exact: true }).count(), 1);
    await composer.fill("retry safely"); await composer.press("Enter"); await page.getByRole("button", { name: "Retry this question" }).click();
    await page.getByText("Answer saved.", { exact: true }).waitFor(); assert.equal(posts[1].requestId, posts[2].requestId);
    assert.equal(await page.getByText("retry safely", { exact: true }).count(), 1);
    await composer.fill("remember this: We sell handmade furniture."); await composer.press("Enter");
    await page.getByRole("button", { name: "Confirm and save this note" }).waitFor(); assert.equal(noteSaves, 0);
    await page.getByRole("button", { name: "Confirm and save this note" }).click(); await page.getByText("Saved to Business Notes", { exact: true }).waitFor();
    assert.equal(noteSaves, 1); assert.equal(await page.getByRole("button", { name: "Confirm and save this note" }).count(), 0);
    await composer.fill("Explain the evidence"); await composer.press("Enter"); await page.getByText("Sources (1)", { exact: true }).click(); await page.getByRole("link", { name: "Delivery record" }).waitFor();
    assert.match(await page.getByRole("link", { name: "Delivery record" }).getAttribute("href"), /\/app\/sources/);
    assert.equal(await page.getByText("Evidence: Oct 1, 2026", { exact: true }).count(), 1);
    const renderedEvidence = page.getByRole("article").last();
    await renderedEvidence.getByRole("heading", { name: "Repair turnaround", exact: true }).waitFor();
    assert.equal(await renderedEvidence.getByRole("heading", { name: "What to check first", exact: true }).count(), 1, "headings must render without a blank line before following text");
    assert.equal(await renderedEvidence.locator("strong").innerText(), "3.8 days");
    assert.equal(await renderedEvidence.locator("ol.list-decimal li").count(), 2, "list may follow heading immediately");
    assert.equal(await renderedEvidence.locator("pre code").textContent(), literalCode, "fenced code keeps blank lines and literal Markdown/HTML");
    assert.equal(await renderedEvidence.getByRole("heading", { name: "Keep this code heading literal" }).count(), 0);
    assert.equal(await renderedEvidence.locator("img, iframe, video, audio, script").count(), 0, "model text never creates HTML or media");
    assert.equal(await renderedEvidence.locator("a").count(), 1, "only the separately verified source becomes a link");
    assert((await renderedEvidence.innerText()).includes("[the guide](https://untrusted.example/guide)"), "model-selected URLs stay literal");
    await page.getByRole("button", { name: "Rename", exact: true }).click(); await page.getByRole("textbox", { name: "Chat name" }).fill("Furniture project"); await page.getByRole("button", { name: "Save name" }).click();
    await page.getByRole("heading", { name: "Furniture project", exact: true }).waitFor(); await page.reload();
    await page.getByRole("heading", { name: "Furniture project", exact: true }).waitFor(); assert.equal(await page.getByText("retry safely", { exact: true }).count(), 1);
    for (const theme of ["light", "pulsar"]) for (const width of [1440, 390, 320]) {
      await page.evaluate(theme => { document.documentElement.className = theme === "pulsar" ? "pulsar dark" : ""; document.documentElement.dataset.theme = theme; }, theme);
      await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}`);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Your chats"] [aria-current="page"]')).backgroundColor === getComputedStyle(document.querySelector('[aria-label="Proposed Business Note"]')).backgroundColor);
      const colors = await page.evaluate(() => {
        const color = selector => getComputedStyle(document.querySelector(selector)).color;
        const background = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
        return { header: color("[data-vsi-workspace] h1"), note: color('[aria-label="Proposed Business Note"] p'), noteBackground: background('[aria-label="Proposed Business Note"]'), activeBackground: background('[aria-label="Your chats"] [aria-current="page"]') };
      });
      if (theme === "pulsar") {
        assert.equal(colors.header, "rgb(248, 250, 252)", "page title must use readable dark-theme foreground");
        assert.equal(colors.note, "rgb(184, 199, 232)", "note description must use dark-theme text");
        assert.match(colors.noteBackground, /^rgba\((?:30, 107, 255|37, 99, 235), 0\.(?:14|18)\)$/, "note must use a dark-theme highlight surface");
        assert.equal(colors.activeBackground, colors.noteBackground, "active chat uses the same themed highlight");
      }
      await page.screenshot({ path: path.join(output, `vsi-${theme}-${width}.png`), fullPage: true });
      await page.getByRole("region", { name: "Conversation", exact: true }).screenshot({ path: path.join(output, `vsi-answer-${theme}-${width}.png`) });
    }
    await page.getByRole("button", { name: "Usage", exact: true }).click(); await page.getByText(/4 of 100 questions/).waitFor(); assert.equal(usageReads, 1);
    assert.equal(await page.getByText(/Your oldest counted question leaves this window after Oct 9, 2026/).count(), 1, "rolling expiry must not imply available questions are blocked");
    assert.equal(await page.getByText(/Next question becomes available/).count(), 0);
    await composer.fill("other tab filled this chat"); await composer.press("Enter");
    await page.getByRole("button", { name: "Continue in a new chat" }).waitFor();
    assert.equal(await composer.count(), 0); await page.getByRole("button", { name: "Continue in a new chat" }).click();
    await composer.waitFor(); assert.equal(await composer.inputValue(), "other tab filled this chat");
    await page.getByRole("link", { name: "the original transcript" }).click(); await page.getByRole("button", { name: "Continue in a new chat" }).waitFor();
    await page.getByRole("button", { name: "Delete", exact: true }).click(); await page.getByRole("button", { name: "Delete this chat", exact: true }).click(); await page.getByText("Chat deleted.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Furniture project", { exact: true }).count(), 0);
    for (let index = 0; index < 24; index++) stored.set(`history-${index}`, { conversation: { ...chat(`history-${index}`), title: `Saved project ${index + 1}` }, exchanges: [] });
    for (const [width, height] of [[1440, 900], [390, 844], [320, 740]]) {
      stored.set("long", { conversation: { ...chat("long", 20), title: "Workshop planning · 20 exchanges" }, exchanges: longExchanges() });
      await page.setViewportSize({ width, height }); await page.goto(`${origin}/?chat=long`);
      await page.getByRole("heading", { name: "Workshop planning · 20 exchanges", exact: true }).waitFor();
      await page.evaluate(() => { document.documentElement.className = "pulsar dark"; document.documentElement.dataset.theme = "pulsar"; });
      const transcript = page.getByRole("region", { name: "Conversation transcript", exact: true }), panel = page.getByRole("region", { name: "Conversation", exact: true });
      await page.waitForFunction(() => { const node = document.getElementById("vsi-transcript"); return node && node.querySelectorAll("article").length === 20 && node.scrollHeight - node.scrollTop - node.clientHeight < 5; });
      const historyDisclosure = page.getByRole("complementary", { name: "Private chat history" }).locator("details");
      if (width < 1280) {
        assert.equal(await historyDisclosure.getAttribute("open"), null, "mobile history starts collapsed");
        await historyDisclosure.locator("summary").focus(); await page.keyboard.press("Enter");
      }
      const historyViewport = historyDisclosure.getByRole("navigation", { name: "Your chats" });
      assert(await historyViewport.evaluate(node => node.clientHeight <= Math.max(160, innerHeight * 0.45) + 1 && node.scrollHeight > node.clientHeight), "history stays scroll-bounded with many saved chats");
      if (width < 1280) { await historyDisclosure.locator("summary").focus(); await page.keyboard.press("Enter"); }
      assert.equal(await transcript.getByRole("article").count(), 20);
      assert(await transcript.evaluate(node => node.scrollHeight > node.clientHeight * 5), "twenty exchanges scroll inside a bounded transcript");
      assert(await panel.evaluate(node => node.clientHeight <= innerHeight), "conversation panel is bounded by the viewport");
      assert(await page.evaluate(() => document.documentElement.scrollHeight < innerHeight * 2), "page height does not grow with the whole transcript");
      const table = transcript.getByRole("table");
      assert.equal(await table.getByRole("columnheader").count(), 3); assert.equal(await table.getByRole("cell", { name: "3.8 days", exact: true }).count(), 1);
      assert.equal(await table.locator("img,a,script").count(), 0, "table cell HTML and model URLs remain inert");
      assert(await transcript.getByRole("region", { name: "Answer table" }).evaluate(node => node.scrollWidth >= node.clientWidth), "brief table has its own horizontal viewport");
      if (width < 1280) {
        const tableViewport = transcript.getByRole("region", { name: "Answer table" }); await tableViewport.focus(); await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector('[aria-label="Answer table"]').scrollLeft > 0);
        await tableViewport.evaluate(node => { node.scrollLeft = 0; });
      }
      await transcript.getByRole("article").last().getByText("Sources (8)", { exact: true }).click();
      const sourceList = transcript.getByRole("article").last().locator("details ol");
      assert.equal(await sourceList.getByRole("link").count(), 8);
      for (const label of ["Published", "Updated", "Event"]) assert.equal(await sourceList.getByText(`${label}: Oct 8, 2026`, { exact: true }).count(), 1, "source date type must remain distinct from lookup time");
      assert.equal(await sourceList.getByText("Observed: Oct 8, 2026, 6:00 PM UTC", { exact: true }).count(), 1, "observation timestamps preserve the observation clock and timezone separately from lookup time");
      assert.equal(await sourceList.getByText("Source date not provided", { exact: true }).count(), 1, "lookup time must not replace a missing source date");
      assert.equal(await sourceList.getByText("Evidence: Oct 8, 2026", { exact: true }).count(), 2, "existing source dates preserve their generic label");
      assert.equal(await sourceList.getByText(/^Checked: Oct 8, 2026/).count(), 8, "all sources separately show the lookup timestamp");
      assert.equal(await sourceList.getByText("Source date not established by this lookup", { exact: true }).count(), 1, "missing web date describes this lookup rather than claiming the page is undated");
      assert.equal(await sourceList.getByText("Legacy generated web summary mixes unsupported reporting.", { exact: true }).count(), 0, "persisted web excerpts cannot present model-generated cross-source claims as page evidence");
      assert.equal(await sourceList.getByText("Approved workshop record with dated repair details. ".repeat(4).trim(), { exact: true }).count(), 6, "authorized private record excerpts remain readable");
      const legacyWebCard = sourceList.locator("li").filter({ has: page.getByRole("link", { name: "Workshop source 6", exact: true }) });
      assert.equal(await legacyWebCard.getByRole("link").getAttribute("href"), "https://public.example.test/source-6");
      assert.equal(await legacyWebCard.getByText("Evidence: Oct 8, 2026", { exact: true }).count(), 1, "web date and source link stay visible when generated excerpt is hidden");
      assert(await sourceList.evaluate(node => node.clientHeight <= 288 && node.scrollHeight > node.clientHeight), "many source details stay in a bounded disclosure");
      await transcript.getByRole("article").last().getByText("Sources (8)", { exact: true }).click();
      await panel.screenshot({ path: path.join(output, `vsi-20-exchanges-${width}.png`) });
      await composer.fill(`Keep my reading position at ${width}`); await composer.press("Enter");
      await page.getByText("Vaeroex is preparing your answer…", { exact: true }).waitFor();
      await page.waitForFunction(() => { const node = document.getElementById("vsi-transcript"); return node.scrollHeight - node.scrollTop - node.clientHeight < 5; });
      await transcript.evaluate(node => { const anchor = node.querySelectorAll("article")[7]; node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - 12; });
      await transcript.focus(); await page.getByRole("button", { name: "Jump to latest", exact: true }).waitFor();
      const before = await transcript.evaluate(node => ({ top: node.scrollTop, anchor: node.querySelectorAll("article")[7].getBoundingClientRect().top - node.getBoundingClientRect().top }));
      assert(releaseDelayedAnswer, "fixture received the pending question"); releaseDelayedAnswer(); releaseDelayedAnswer = null;
      await page.getByRole("button", { name: "New answer · Jump to latest", exact: true }).waitFor();
      const after = await transcript.evaluate(node => ({ top: node.scrollTop, anchor: node.querySelectorAll("article")[7].getBoundingClientRect().top - node.getBoundingClientRect().top, focused: document.activeElement === node }));
      assert(Math.abs(after.top - before.top) < 2 && Math.abs(after.anchor - before.anchor) < 2, "new answer preserves the older reading position");
      assert(after.focused, "answer completion does not steal focus from the reader");
      assert.equal(await page.getByRole("button", { name: "New answer · Jump to latest", exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), "rgb(17, 24, 39)", "floating jump control stays opaque over earlier messages");
      await panel.screenshot({ path: path.join(output, `vsi-earlier-reading-${width}.png`) });
      await page.getByRole("button", { name: "New answer · Jump to latest", exact: true }).focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => { const node = document.getElementById("vsi-transcript"); return node.scrollHeight - node.scrollTop - node.clientHeight < 5; });
      await transcript.focus(); const bottomTop = await transcript.evaluate(node => node.scrollTop); await page.keyboard.press("PageUp");
      await page.waitForFunction(value => document.getElementById("vsi-transcript").scrollTop < value - 20, bottomTop);
      await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
      await composer.focus(); await composer.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `vsi-long-${width}-composer-check.png`) });
      const composerPosition = await composer.evaluate(node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, pageTop: scrollY, panel: node.closest('[aria-label="Conversation"]').getBoundingClientRect().toJSON() }; });
      assert(composerPosition.top >= 0 && composerPosition.bottom <= composerPosition.viewport, `composer remains reachable after 21 exchanges at ${width}: ${JSON.stringify(composerPosition)}; output ${output}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `long chat has no page overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `vsi-long-${width}.png`) });
      await panel.screenshot({ path: path.join(output, `vsi-long-panel-${width}.png`) });
      if (width === 390) {
        await page.setViewportSize({ width, height: 420 }); await composer.focus(); await composer.scrollIntoViewIfNeeded();
        assert(await composer.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), "composer remains visible in a software-keyboard-sized viewport");
        assert(await page.getByRole("button", { name: "Send", exact: true }).evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), "Send remains reachable with a reduced viewport");
        await page.screenshot({ path: path.join(output, "vsi-mobile-keyboard-height.png") });
      }
    }
    await page.clock.install();
    await page.goto(`${origin}/?chat=long`); await page.getByRole("heading", { name: "Workshop planning · 20 exchanges", exact: true }).waitFor();
    await composer.fill("Keep my reading position while this request times out"); await composer.press("Enter");
    await page.getByText("Vaeroex is preparing your answer…", { exact: true }).waitFor();
    await page.clock.fastForward(10_100);
    await page.getByText("Some questions take about three minutes. You can keep reading while Vaeroex finishes.", { exact: true }).waitFor();
    await page.clock.fastForward(195_100);
    await page.getByRole("button", { name: "Retry this question", exact: true }).waitFor();
    assert.match(await page.getByRole("alert").innerText(), /took too long/);
    assert.equal(await page.getByText(/Vaeroex is preparing your answer/).count(), 0, "timed-out request must clear the pending state");
    assert.equal(await page.getByRole("button", { name: "Retry this question", exact: true }).isEnabled(), true);
    assert(releaseDelayedAnswer); releaseDelayedAnswer(); releaseDelayedAnswer = null;
    await page.goto(`${origin}/?chat=warning`); await page.getByText(/This is a long conversation/).waitFor(); assert.equal(await composer.count(), 1);
    await page.goto(`${origin}/?chat=closed`); await page.getByText(/This chat has reached 250 exchanges/).waitFor(); assert.equal(await composer.count(), 0);
    await page.getByRole("button", { name: "Continue in a new chat" }).click(); await page.getByRole("link", { name: "the original transcript" }).waitFor(); assert(stored.has("closed"));
    await page.getByRole("link", { name: "the original transcript" }).click(); await page.getByText(/This chat has reached 250 exchanges/).waitFor();
    await page.evaluate(() => { document.documentElement.className = "pulsar dark"; document.documentElement.dataset.theme = "pulsar"; });
    lost = true; await page.getByRole("button", { name: "Usage", exact: true }).click(); await page.getByRole("button", { name: "Reload your active workspace" }).waitFor();
    assert.equal(await page.getByText("Start with your priorities.", { exact: true }).count(), 0); assert.equal(await page.getByRole("heading", { name: "Long-running project" }).count(), 0); assert.equal(await page.getByRole("alert").evaluate(element => getComputedStyle(element).color), "rgb(252, 165, 165)", "dark-theme errors must stay legible");
    assert.equal(serverError, null); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ["general question", "App Router searchParams update", "older history pagination", "keyboard", "stable retry", "explicit note confirmation", "citation dates", "legacy web excerpts hidden without removing private evidence or public links", "Markdown headings and fenced code stay safe and readable", "rename reopen delete", "225 warning", "250 handoff preserves transcript", "second-tab thread boundary preserves unsent draft", "workspace access loss clears transcript", "on-demand usage", "desktop mobile no overflow", "20-exchange bounded transcript and composer", "old reading position and focus survive delayed answers", "keyboard jump and transcript scrolling", "safe compact business tables", "software-keyboard-sized viewport", "slow-response notice and recoverable 205-second timeout", "actual global CSS light/Pulsar contrast"], widths: [1440, 390, 320], output, scope: "Hydrated UI with synthetic loopback API; authenticated API and provider qualification are separate." }));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
