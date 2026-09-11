/* Ephemeral synthetic browser; no sign-in, storage, credentials or hosted I/O. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {view,render}=require("./square-workspace-evidence-regression-tests.js");
let stage="launch";
async function main(){
  stage="css";
  const config=require("./../tailwind.config.ts").default;
  const css=(await require("postcss")([require("tailwindcss")({...config,content:["./components/integrations/SquareEvidenceCard.tsx","./components/operations/SectionCard.tsx"]})])
    .process(fs.readFileSync("app/globals.css","utf8"),{from:undefined})).css;
  stage="launch";const browser=await require("playwright").chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
  try{
    stage="page";const page=await browser.newPage();let requests=0;
    await page.route("**/*",route=>{requests++;return route.abort();});
    for(const width of [390,1280]){
      stage=`viewport_${width}`;
      await page.setViewportSize({width,height:900});
      await page.setContent(`<html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body><main style="max-width:1000px;margin:24px auto;padding:16px">${render(view)}</main></body></html>`);
      stage=`heading_${width}`;assert.equal(await page.getByRole("heading",{name:"Square Sandbox evidence"}).count(),1);
      await page.getByText("Source-version provenance",{exact:true}).click();
      stage=`rows_${width}`;assert.equal(await page.getByRole("row").count(),14);
      assert.equal(await page.getByRole("button").count(),0);
      assert.ok((await page.locator("body").innerText()).includes("Historical completeness: unknown"));
      stage=`overflow_${width}`;assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.locator("script,input,form").count(),0);
    }
    assert.equal(requests,0);
    if(process.env.SQUARE_EVIDENCE_SCREENSHOT)await page.screenshot({path:process.env.SQUARE_EVIDENCE_SCREENSHOT,fullPage:true});
    // Actual app CSS and server component; synthetic data, not a hosted page.
    assert.ok(fs.readFileSync("app/app/settings/page.tsx","utf8").includes("readSquareWorkspaceEvidence(supabase, workspaceId, await headers())"));
    console.log("Square evidence browser: desktop/mobile disclosure, no overflow, no mutations, zero network requests passed.");
  }finally{await browser.close();}
}
main().catch(()=>{console.error(`Square evidence browser qualification failed: ${stage}`);process.exitCode=1;});
