/* eslint-disable @typescript-eslint/no-require-imports -- Isolated production-build configuration, never application imported. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),file=process.env.VAEROEX_CAPACITY_RUNTIME_CONFIG;
assert(file&&fs.statSync(file).mode%512===384,'private_capacity_configuration_required');
const cfg=JSON.parse(fs.readFileSync(file)),override=cfg.nextConfigOverride;
assert(cfg.syntheticOnly===true&&cfg.paidCredentialsPresent===false&&cfg.runId,'synthetic_configuration_required');
assert(override?.skipMiddlewareUrlNormalize===true&&path.dirname(file)===cfg.out,'isolated_normalization_configuration_required');
const configuration=path.join(root,'next.config.mjs'),loader=require.resolve('next/dist/server/config');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(digest(configuration),override.originalConfigSha256,'application_configuration_changed');
assert.equal(digest(loader),override.originalLoaderSha256,'framework_configuration_loader_changed');
const load=Module._load,cache=new WeakMap();
Module._load=function(request,parent,isMain){
  const value=load.call(this,request,parent,isMain);
  if(Module._resolveFilename(request,parent,isMain)!==loader)return value;
  if(cache.has(value))return cache.get(value);
  const wrapped=async function(...args){
    assert(['phase-production-build','phase-production-server'].includes(args[0])&&fs.realpathSync(args[1])===fs.realpathSync(root),'isolated_configuration_scope_denied');
    assert.equal(digest(configuration),override.originalConfigSha256,'application_configuration_changed');
    const original=await value.default(...args);
    assert(original&&typeof original==='object'&&!Array.isArray(original),'framework_configuration_invalid');
    // Preserve original functions (headers, redirects, webpack), references,
    // authorization, action encryption and all build settings. Only the public
    // URL-normalization option differs to represent a DNS production authority
    // on the harness's literal-loopback-only network.
    return {...original,skipMiddlewareUrlNormalize:true};
  };
  const proxy=new Proxy(value,{get(target,key,receiver){return key==='default'?wrapped:Reflect.get(target,key,receiver);}});
  cache.set(value,proxy);return proxy;
};
