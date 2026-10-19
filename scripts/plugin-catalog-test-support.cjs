/* eslint-disable @typescript-eslint/no-require-imports -- Render real server cards with synthetic tenant-scoped data. */
const { harness, loadSource, renderToStaticMarkup } = require('./integrations-ui-test-support');
async function catalogFixture(options = {}) {
  let entries = [], h;
  const mocks = {
    './_PluginCatalog': { PluginCatalog(props) { entries = props.entries; return null; } },
    '@/lib/integrations/reporting/security': { available: provider => (options.reportingEnabled ?? []).includes(provider) }
  };
  for (const provider of ['loyverse', 'zoho-books', 'wix-orders']) {
    mocks[`@/lib/integrations/${provider}/server`] = {
      enabled: () => (options.legacyEnabled ?? []).includes(provider), admin: () => h.access.supabase
    };
  }
  h = harness(options, mocks);
  await h.render('app/app/integrations/page.tsx');
  return { entries: entries.map(({ content, ...entry }) => ({ ...entry, html: renderToStaticMarkup(content) })), h };
}
const model = loadSource('app/app/integrations/_catalog.ts');
module.exports = { catalogFixture, model };
