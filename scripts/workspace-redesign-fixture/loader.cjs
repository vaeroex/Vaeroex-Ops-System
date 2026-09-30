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
    source = `import Link from "next/link"; import { CalendarRange } from "lucide-react";
      import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
      import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
      import { ErrorNotice } from "@/components/operations/ErrorNotice";
      import { QboAccountingIntelligenceView } from "@/lib/integrations/qbo-customer/accounting-intelligence-view";
      import { intelligenceFixture, qboProductionCustomerConnectionsEnabled } from ${JSON.stringify(options.readRuntime)};
      export default async function IntelligencePage({searchParams}) {
        const params = await searchParams;
        const qboAccounting = Object.freeze({state: "hidden"});
        const {displayErrors,lifecycleCards,explanationTokens,canManageLifecycle,blockedState,briefingStates,isIntelligenceBriefingEnabled} = intelligenceFixture();
        return ${finalReturn.expression.getText(ast)};
      }`;
  }
  const serverAction = ast.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use server");
  if (serverAction) {
    if (!options.allowedActions.includes(this.resourcePath)) throw new Error(`Unreviewed server-action import: ${this.resourcePath}`);
    const exports = ast.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(statement => statement.name.text);
    if (!exports.length) throw new Error(`No supported action exports: ${this.resourcePath}`);
    source = `import { fixtureAction } from ${JSON.stringify(options.actionRuntime)};\n` + exports.map(name => `export const ${name} = fixtureAction(${JSON.stringify(name)});`).join("\n");
  }
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
};
