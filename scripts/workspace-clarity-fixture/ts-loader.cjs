/* eslint-disable @typescript-eslint/no-require-imports -- Webpack loads this local-only custom loader through its CommonJS loader interface. */
const ts = require("typescript");
module.exports = function loader(source) {
  return ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
};
