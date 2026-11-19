// Generate the static public figures with the same projection as the demo.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const dir = fileURLToPath(new URL("../app/drug-discovery-intelligence/demo/", import.meta.url));
const source = path.join(dir,"SiteGraphic.tsx");
const compiled = ts.transpileModule(fs.readFileSync(source,"utf8"), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleForView = new Module(source);
moduleForView.paths = Module._nodeModulePaths(dir);
moduleForView._compile(compiled,source);
const sites = JSON.parse(fs.readFileSync(path.join(dir,"sites.json"),"utf8"));
for (const [id,site] of Object.entries(sites)) {
  const file = path.join(dir,"../../../public/brand/compound-demo",id.toLowerCase()+"-site.svg");
  const svg = renderToStaticMarkup(React.createElement(moduleForView.exports.default,{site,label:"Experimental binding site of "+(id==="3HS4"?"acetazolamide":"dorzolamide")+" in human carbonic anhydrase II, chain A, PDB "+id+"."}))+"\n";
  if (process.argv.includes("--check")) assert.equal(fs.readFileSync(file,"utf8"),svg);
  else fs.writeFileSync(file,svg);
}
