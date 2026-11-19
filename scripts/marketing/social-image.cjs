/* eslint-disable @typescript-eslint/no-require-imports -- Reproducible branded asset build, no network. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] }));
(async () => {
  const output = 'public/brand/vaeroex-social.jpg';
  // Existing shares may still request the historical JPEG URL.
  await sharp('public/brand/drug-discovery-social.png').jpeg({quality: 82, mozjpeg: true}).toFile(output);
  const {width, height} = await sharp(output).metadata();
  console.log(JSON.stringify({width, height, bytes: fs.statSync(output).size}));
})();
