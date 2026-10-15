import test from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../src/probe.ts';
import { ingestIndependent } from '../src/independent.ts';
const target={url:'https://example.test/health',status:204};
test('healthy first response needs no retries',async()=>{
 const result=await probe(target,{fetch:async()=>new Response(null,{status:204})});
 assert.equal(result.outcome,'healthy');assert.equal(result.attempts.length,1);
});
test('recovered network error remains visible as transient evidence',async()=>{
 let requests=0; const delays=[];
 const result=await probe(target,{fetch:async()=>{if(!requests++)throw Error('network');return new Response(null,{status:204})},sleep:async ms=>{delays.push(ms)}});
 assert.equal(result.ok,1);assert.equal(result.outcome,'transient');assert.equal(result.attempts[0].error,'network');assert.deepEqual(delays,[2000]);
 assert.notEqual(result.attempts[0].request_id,result.attempts[1].request_id);
});
test('persistent timeout requires three attempts and records timeout cause',async()=>{
 const result=await probe(target,{timeoutMs:1,sleep:async()=>{},fetch:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))});
 assert.equal(result.ok,0);assert.equal(result.outcome,'failed');assert.equal(result.attempts.length,3);assert(result.attempts.every(x=>x.error==='timeout'));
});
test('redirects and HTTP errors never become healthy',async()=>{
 const result=await probe(target,{sleep:async()=>{},fetch:async()=>new Response(null,{status:302})});
 assert.equal(result.outcome,'failed');assert.equal(result.attempts[0].status_code,302);
});
test('independent reports require authentication before database access',async()=>{
 const response=await ingestIndependent(new Request('https://example.test/independent',{method:'POST',body:'{}'}),{INDEPENDENT_CHECK_KEY:'private-test-key',DB:{prepare(){throw Error('Must not touch database')}}});
 assert.equal(response.status,401);
});

test('signed independent summary is bounded, sanitized and expires',async()=>{
 const secret='only-a-test-key';const encoder=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const saved=[];const env={INDEPENDENT_CHECK_KEY:secret,DB:{prepare(sql){return{bind(...args){this.args=args;return this},async run(){saved.push({sql,args:this.args})}}}}};
 const report={checkedAt:new Date().toISOString(),targets:['app','sign','docs'].map(target_id=>({target_id,ok:1,latency_ms:20,attempts:1})),browser:{status:'passed'},private:'must-not-persist'};
 const send=async(data,wrong=false)=>{const body=JSON.stringify(data);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,encoder.encode(body))).toString('hex');return ingestIndependent(new Request('https://example.test/independent',{method:'POST',body,headers:{'X-Monitor-Signature':wrong?'0'.repeat(64):signature}}),env)};
 assert.equal((await send(report)).status,202);assert.equal(saved.length,1);assert(!saved[0].args[1].includes('must-not-persist'));
 assert(saved[0].sql.includes('excluded.checked_at > monitor_independent.checked_at'));
 assert.equal((await send(report,true)).status,401);
 assert.equal((await send({...report,checkedAt:new Date(Date.now()-360000).toISOString()})).status,400);
 assert.equal(saved.length,1);
});
