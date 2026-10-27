// Isolated SQL + application-path qualification. The existing screened function
// captures stay outside Git; this does not contact Supabase or any provider.
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { read, uuid, w, other, owner, owner2, session, secondSession, entity, conn,
  login, admin, map, typedSetup, sheetsFixture } from './shared-evidence-sql-fixture.mjs';
const require = createRequire(import.meta.url);

test('all twelve stored-provider projections retain their fields through real SQL admission, packing, rendering, settlement and reopening', async () => {
  const { db } = await typedSetup();
  try {
    await admin(db);
    await sheetsFixture(db);
    for (const file of ['07-reopen-shared-artifact.sql', '08-sheets-projection.sql', '11-generation-discovery.sql']) {
      await db.exec(read(`docs/security-drafts/${file}`));
    }
    const run = require('./shared-evidence-all-provider-path.cjs');
    console.log(JSON.stringify(await run({ db, uuid, w, other, owner, owner2, session, secondSession, entity, conn, login, admin, map })));
  } finally { await db.close(); }
});
