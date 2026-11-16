/* eslint-disable @typescript-eslint/no-require-imports -- Reproducible branded asset build, no network. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] }));
(async () => {
  const logo = fs.readFileSync('public/brand/vaeroex-logo-white-wordmark.png').toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#070c17"/><stop offset="1" stop-color="#182746"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><path d="M80 72H1120" stroke="#839dff" stroke-opacity=".5"/><rect x="78" y="132" width="510" height="340" rx="6" fill="#182746" stroke="#6079a0"/><image x="80" y="134" width="506" height="336" href="data:image/png;base64,${logo}"/><g font-family="Arial, sans-serif" fill="#fff"><text x="640" y="171" font-size="23" letter-spacing="5" fill="#a9beff">VAEROEX</text><text x="640" y="250" font-size="39" font-weight="600">Intelligence. Software.</text><text x="640" y="308" font-size="35">Built around business.</text><text x="640" y="372" font-size="21" fill="#c1cde0">AI tools · Custom systems</text><text x="640" y="408" font-size="21" fill="#c1cde0">Websites · Integrations</text><text x="80" y="551" font-size="22" fill="#c1cde0">vaeroex.com</text></g></svg>`;
  await sharp(Buffer.from(svg)).jpeg({quality:83,mozjpeg:true}).toFile('public/brand/vaeroex-social.jpg');
  const m=await sharp('public/brand/vaeroex-social.jpg').metadata();
  console.log(JSON.stringify({width:m.width,height:m.height,bytes:fs.statSync('public/brand/vaeroex-social.jpg').size}));
})();
