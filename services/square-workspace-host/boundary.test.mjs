import assert from 'node:assert/strict';
import { permitted, HOST, ORIGIN } from './boundary.mjs';
const request = (url='/evidence', method='GET', pairs=['Host',HOST]) => ({url,method,rawHeaders:pairs,headers:Object.fromEntries(Array.from({length:pairs.length/2},(_,i)=>[pairs[i*2].toLowerCase(),pairs[i*2+1]])),socket:{servername:HOST}});
assert(permitted(request()));
assert(permitted(request('/signin')));
for (const route of ['/session','/signout']) assert(permitted(request(route,'POST',['Host',HOST,'Origin',ORIGIN,'Content-Type','application/x-www-form-urlencoded','Content-Length','5'])));
for (const host of ['localhost','127.0.0.1','8.229.223.109','vaeroex.com','www.vaeroex.com','preview.vercel.app','evil.example',HOST+':443',HOST+'.',HOST.toUpperCase()]) assert(!permitted(request('/evidence','GET',['Host',host])));
for (const sni of ['',undefined,'localhost','127.0.0.1','preview.vercel.app']) { const r=request();r.socket.servername=sni;assert(!permitted(r)); }
for (const path of ['/','/app/settings','/admin','/api','/_next/static/test.js','/_next/image','/.env','/evidence?x=1','//evidence','/./evidence','/x/../evidence','/%65vidence','/evidence/','/evidence%00','https://'+HOST+'/evidence','/api/integrations/square/callback','/signin/../evidence','/SIGNIN','/evidence\\foo']) assert(!permitted(request(path)));
for (const method of ['HEAD','OPTIONS','PUT','PATCH','DELETE','TRACE','CONNECT','POST']) assert(!permitted(request('/evidence',method)));
for (const h of ['Forwarded','X-Forwarded-Host','X-Forwarded-Proto','X-Forwarded-For','Next-Action','RSC','Next-Router-State-Tree','Next-Router-Prefetch','X-Middleware-Subrequest','Upgrade','Transfer-Encoding','Host']) assert(!permitted(request('/evidence','GET',['Host',HOST,h,'x'])));
assert(!permitted(request('/session','POST')));
const formHeaders = ['Host',HOST,'Origin','null','Sec-Fetch-Site','same-origin','Sec-Fetch-Mode','navigate','Sec-Fetch-Dest','document','Content-Type','application/x-www-form-urlencoded','Content-Length','5'];
for (const route of ['/session','/workspace','/signout']) {
  assert(permitted(request(route,'POST',formHeaders)), 'no-referrer same-origin browser form');
  for (const [header, values] of Object.entries({'Origin':['',ORIGIN+'.evil','https://evil.example'],'Sec-Fetch-Site':['same-site','cross-site','none',''],'Sec-Fetch-Mode':['cors','no-cors','same-origin',''],'Sec-Fetch-Dest':['iframe','empty','']})) {
    for(const value of values){const pairs=[...formHeaders];pairs[pairs.indexOf(header)+1]=value;assert(!permitted(request(route,'POST',pairs)),`${header}=${value} rejected`);}
    const pairs=[...formHeaders];pairs.splice(pairs.indexOf(header),2);assert(!permitted(request(route,'POST',pairs)),`${header} absent rejected`);
  }
}
assert(!permitted(request('/session','POST',[...formHeaders,'X-Forwarded-Host',HOST,'X-Forwarded-Proto','https']),true),'private upstream cannot accept opaque origin');
for (const site of ['same-site','cross-site','none']) assert(!permitted(request('/session','POST',['Host',HOST,'Origin',ORIGIN,'Sec-Fetch-Site',site,'Content-Type','application/x-www-form-urlencoded','Content-Length','5'])));
for (const route of ['/signout','/session','/workspace']) assert.equal(permitted(request(route,'POST',['Host',HOST,'Origin',ORIGIN,'Content-Type','application/x-www-form-urlencoded','Content-Length','0'])),route==='/signout');
assert(!permitted(request('/evidence','GET',['Host',HOST,'Content-Length','1'])));
assert(!permitted(request(),true));
assert(permitted(request('/evidence','GET',['Host',HOST,'X-Forwarded-Host',HOST,'X-Forwarded-Proto','https']),true));
console.log('square_workspace_host_raw_boundary_passed');
