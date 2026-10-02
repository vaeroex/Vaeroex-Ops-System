/* eslint-disable @typescript-eslint/no-require-imports -- Local-only webpack loader. */
const ts = require("typescript");
module.exports = function(source) {
  const options = this.getOptions();
  const ast = ts.createSourceFile(this.resourcePath, source, ts.ScriptTarget.Latest, true);
  if (this.resourcePath === options.intelligencePage) {
    // Preserve this root's exact final JSX, including its page header. The large
    // server-only evidence/token pipeline is replaced by explicit immutable props.
    const page = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "IntelligencePage");
    const finalReturn = page?.body?.statements.filter(ts.isReturnStatement).at(-1);
    if (!finalReturn?.expression) throw new Error("Intelligence page render boundary changed; review the fixture adapter");
    // Keep the real client dashboard, with no established synthetic connections.
    // Workspace access and operational loaders never enter this preview bundle.
    const render = finalReturn.expression.getText(ast);
    if (render.split('<CurrentIntegrations key={workspaceId} initial={dashboard} />').length !== 2) {
      throw new Error("Intelligence dashboard binding changed; review the fixture adapter");
    }
    source = `import Link from "next/link"; import { CalendarRange } from "lucide-react";
      import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
      import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
      import { ErrorNotice } from "@/components/operations/ErrorNotice";
      import { CurrentIntegrations } from "@/components/integrations/CurrentIntegrations";
      import { intelligenceFixture } from ${JSON.stringify(options.readRuntime)};
      export default async function IntelligencePage({searchParams}) {
        const params = await searchParams;
        const {workspaceId,dashboard,displayErrors,lifecycleCards,explanationTokens,canManageLifecycle,blockedState,briefingStates,isIntelligenceBriefingEnabled} = intelligenceFixture();
        return ${render};
      }`;
  }
  const serverAction = ast.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use server");
  if (serverAction) {
    if (!options.allowedActions.includes(this.resourcePath)) throw new Error(`Unreviewed server-action import: ${this.resourcePath}`);
    const allowedExports = options.allowedActionExports?.[this.resourcePath];
    if (allowedExports) {
      const valueExports = ast.statements.filter(statement => ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)
        || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
          && !ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement));
      if (valueExports.length !== allowedExports.length || valueExports.some(statement => !ts.isFunctionDeclaration(statement)
        || !statement.name || !allowedExports.includes(statement.name.text)
        || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword))) {
        throw new Error(`Unreviewed server-action exports: ${this.resourcePath}`);
      }
    }
    const exports = ast.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(statement => statement.name.text);
    if (!exports.length) throw new Error(`No supported action exports: ${this.resourcePath}`);
    source = `import { fixtureAction } from ${JSON.stringify(options.actionRuntime)};\n` + exports.map(name => `export const ${name} = fixtureAction(${JSON.stringify(name)});`).join("\n");
  }
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
};
