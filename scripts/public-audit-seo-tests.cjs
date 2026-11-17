/* eslint-disable @typescript-eslint/no-require-imports -- Offline metadata and indexing contracts. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function read(p){return fs.readFileSync(p,'utf8')}
function load(p){const result={exports:{}};vm.runInNewContext(ts.transpileModule(read(p),{fileName:p,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:result.exports,module:result,require:s=>s==='@/lib/seo/public-seo'?load('lib/seo/public-seo.ts'):s.includes('LegalDocumentPage')?{LegalDocumentPage:()=>null}:s==='next/headers'?{}:require(s)});return result.exports}
const slugs=['terms','privacy','refund-policy','subscription-billing-terms','workspace-capacity-terms','acceptable-use','sensitive-data-policy','data-retention','ai-disclaimer','human-review'];
const titles=new Set(),descriptions=new Set();
for(const slug of slugs){const m=load(`app/${slug}/page.tsx`).metadata;assert.ok(m.title&&m.description);assert.equal(m.alternates.canonical,`https://www.vaeroex.com/${slug}`);assert.equal(m.openGraph.url,m.alternates.canonical);assert.equal(m.openGraph.title,m.title);assert.equal(m.twitter.title,m.title);assert.equal(m.other['twitter:url'],m.alternates.canonical);assert.equal(m.openGraph.images[0].width,1200);assert.equal(m.openGraph.images[0].height,630);assert.match(m.openGraph.images[0].url,/vaeroex-social.jpg$/);titles.add(m.title);descriptions.add(m.description);}
assert.equal(titles.size,10);assert.equal(descriptions.size,10);
const robots=load('app/robots.ts').default();for(const p of ['/login','/signup','/app','/checkout','/systems'])assert.ok(!robots.rules.disallow.includes(p));
const sitemap=load('app/sitemap.ts').default();for(const s of slugs)assert.ok(sitemap.some(x=>x.url===`https://www.vaeroex.com/${s}`));for(const p of ['/systems','/access','/login','/signup','/checkout/legal','/app'])assert.ok(!sitemap.some(x=>x.url===`https://www.vaeroex.com${p}`));
for(const p of ['app/(auth)/layout.tsx','app/checkout/layout.tsx','app/app/layout.tsx','app/access/page.tsx','app/billing-required/page.tsx'])assert.match(read(p),/robots: utilityRobots/);
assert.match(read('next.config.mjs'),/X-Robots-Tag/);assert.doesNotMatch(read('app/pricing/page.tsx'),/All purchases and subscription payments/);assert.match(read('app/pricing/page.tsx'),/Commissioned-project payment, cancellation, and refund terms/);
assert.equal((read('components/marketing/ProjectSections.tsx').match(/PROJECT_AGREEMENT_NOTICE\}/g)||[]).length,1);
const image=fs.readFileSync('public/brand/vaeroex-social.jpg');assert.equal(image.readUInt16BE(0),0xffd8);assert.ok(image.length<100000);
console.log('Policy-specific metadata, distinct social/canonical URLs, noindex/crawl coordination, sitemap exclusions, scoped FAQ and compressed image contracts passed.');
