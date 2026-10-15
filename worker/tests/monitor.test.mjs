import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { runChecks, publish, resultStatements } from '../src/index.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0002_bounded_monitor.sql','utf8'));
  sqlite.exec(readFileSync('migrations/0003_monitor_evidence.sql','utf8'));
  const queries=[];
  const db={ prepare(sql) {
    assert(!/\bchecks\b/.test(sql), 'Retained legacy history must never be queried');
    const statement={ sql, values:[], bind(...values) { this.values=values; return this; },
      async all() { queries.push(sql); return {results:sqlite.prepare(sql).all(...this.values), meta:{}}; },
      async first() { return (await this.all()).results[0] ?? null; },
      async run() { queries.push(sql); const r=sqlite.prepare(sql).run(...this.values); return {results:[],meta:{changes:Number(r.changes)}}; }
    }; return statement;
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=[]; for (const s of statements) results.push(/^\s*SELECT/.test(s.sql) ? await s.all() : await s.run()); sqlite.exec('COMMIT'); return results; }
    catch(error) { sqlite.exec('ROLLBACK'); throw error; }
  }};
  return {sqlite,db,queries};
}

test('indexed writes are retry-safe; old results cannot overwrite current status', async()=>{
  const {sqlite,db}=database();
  const row={target_id:'app',minute:100,ok:1,latency_ms:25,status_code:204,failure_streak:0};
  await db.batch(resultStatements(db,row)); await db.batch(resultStatements(db,row));
  assert.equal(sqlite.prepare('SELECT total FROM monitor_hourly').get().total,1);
  assert.equal(sqlite.prepare('SELECT total FROM monitor_daily').get().total,1);
  await db.batch(resultStatements(db,{...row,minute:99,ok:0}));
  assert.equal(sqlite.prepare('SELECT minute FROM monitor_current').get().minute,100);
  const plans=sqlite.prepare('EXPLAIN QUERY PLAN SELECT * FROM monitor_recent WHERE minute >= ? ORDER BY minute').all(0);
  assert(plans.some(p=>p.detail.includes('SEARCH') && p.detail.includes('PRIMARY KEY')));
});

test('failure threshold, recovery, monitoring gap, redirect and duplicate invocation', async()=>{
  const {sqlite,db}=database(); const realFetch=globalThis.fetch, realNow=Date.now;
  const alerts=[]; let minute=30000; let failing=true;
  Date.now=()=>minute*60000;
  globalThis.fetch=async(url)=>{
    if(url==='https://example.test/webhook') { alerts.push(url); return new Response(null,{status:204}); }
    return new Response(null,{status:url.includes('app.aplt') && failing ? 302 : url.includes('docs.aplt') ? 200 : 204});
  };
  try {
    const env={DB:db,DISCORD_WEBHOOK_URL:'https://example.test/webhook'};
    for(let i=0;i<3;i++,minute++) await runChecks(env,minute*60000);
    assert.equal(alerts.length,1);
    minute--; await runChecks(env,minute*60000); assert.equal(alerts.length,1);
    assert.equal(sqlite.prepare('SELECT total FROM monitor_daily WHERE target_id=?').get('app').total,3);
    minute++; failing=false; await runChecks(env,minute*60000); assert.equal(alerts.length,2);
    minute+=3; failing=true; await runChecks(env,minute*60000);
    assert.equal(sqlite.prepare('SELECT failure_streak FROM monitor_current WHERE target_id=?').get('app').failure_streak,1);
    assert.equal(alerts.length,2);
    const before=sqlite.prepare('SELECT COUNT(*) n FROM monitor_recent').get().n;
    await runChecks(env,(minute-10)*60000); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM monitor_recent').get().n,before);
  } finally { globalThis.fetch=realFetch; Date.now=realNow; }
});

test('large legacy history and long retention do not expand published query scans',async()=>{
  const {sqlite,db}=database();
  sqlite.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
    INSERT INTO checks (target_id,ok,status,latency_ms,checked_at) SELECT 'old',1,'up',1,'2026-01-01' FROM n;`);
  const minute=300000;
  for(const [table,key,spacing,count] of [['monitor_recent','minute',1,7*1440+60],['monitor_hourly','bucket',60,720],['monitor_daily','bucket',1440,180]]) {
    const insert=sqlite.prepare(table==='monitor_recent' ? `INSERT INTO ${table} VALUES (?,?,1,20)` : table==='monitor_hourly' ? `INSERT INTO ${table} VALUES (?,?,60,60,1200)` : `INSERT INTO ${table} VALUES (?,?,1440,1440)`);
    sqlite.exec('BEGIN'); for(let n=0;n<count;n++) for(const id of ['app','sign','docs']) insert.run(minute-n*spacing,id); sqlite.exec('COMMIT');
  }
  await publish({DB:db},minute);
  const snapshot=JSON.parse(sqlite.prepare('SELECT payload FROM monitor_published').get().payload);
  assert.equal(snapshot.recent.length,180); assert.equal(snapshot.hourly.length,2160); assert.equal(snapshot.daily.length,270);
  assert(Buffer.byteLength(JSON.stringify(snapshot))<500000);
  for(const q of ['SELECT * FROM monitor_hourly WHERE bucket >= ? ORDER BY bucket','SELECT * FROM monitor_daily WHERE bucket >= ? ORDER BY bucket']) {
    assert(sqlite.prepare('EXPLAIN QUERY PLAN '+q).all(0).every(p=>!p.detail.includes('SCAN')));
  }
  const dailyHistoryReads=(180+2160+270)*288;
  assert(dailyHistoryReads+100000+20000<5000000);
  console.log(JSON.stringify({dailyHistoryReads,conservativeDailyReads:dailyHistoryReads+120000,payloadBytes:Buffer.byteLength(JSON.stringify(snapshot))}));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM checks').get().n,100000);
});

test('public cache keys ignore query strings; invalid paths and methods do not read D1',async()=>{
  const {db}=database(); let reads=0; let cacheEntry;
  const env={DB:{prepare(){reads++;return{first:async()=>({payload:'{"checkedAt":"2026-10-12T00:00:00Z"}'})}}}};
  const originalCaches=globalThis.caches;
  globalThis.caches={default:{match:async()=>cacheEntry?.clone(),put:async(_key,response)=>{cacheEntry=response}}};
  const waits=[]; const ctx={waitUntil(p){waits.push(p)}};
  try {
    assert.equal((await worker.fetch(new Request('https://uptime-api.aplt.ai/status?noise=1'),env,ctx)).status,200);
    await Promise.all(waits);
    assert.equal((await worker.fetch(new Request('https://uptime-api.aplt.ai/status?noise=2'),env,ctx)).status,200);
    assert.equal(reads,1);
    assert.equal((await worker.fetch(new Request('https://uptime-api.aplt.ai/calendar?days=999'),env,ctx)).status,404);
    assert.equal((await worker.fetch(new Request('https://uptime-api.aplt.ai/status',{method:'POST'}),env,ctx)).status,405);
    assert.equal(reads,1);
  } finally {globalThis.caches=originalCaches;}
});

test('cleanup keeps bounded raw and rollup windows; legacy rows remain untouched',async()=>{
  const {sqlite,db}=database();const realFetch=globalThis.fetch,realNow=Date.now;
  const minute=300000;
  sqlite.exec(`INSERT INTO monitor_recent VALUES (${minute-7*1440-1},'app',1,1),(${minute-7*1440},'app',1,1);
    INSERT INTO monitor_hourly VALUES (${minute-30*1440-60},'app',1,1,1),(${minute-30*1440},'app',1,1,1);
    INSERT INTO monitor_daily VALUES (${Math.floor(minute/1440)*1440-181*1440},'app',1,1),(${Math.floor(minute/1440)*1440-180*1440},'app',1,1);`);
  Date.now=()=>minute*60000;globalThis.fetch=async(url)=>new Response(null,{status:url.includes('docs.aplt')?200:204});
  try {await runChecks({DB:db},minute*60000);assert.equal(sqlite.prepare('SELECT MIN(minute) m FROM monitor_recent').get().m,minute-7*1440);assert.equal(sqlite.prepare('SELECT MIN(bucket) b FROM monitor_hourly').get().b,minute-30*1440);assert.equal(sqlite.prepare('SELECT MIN(bucket) b FROM monitor_daily').get().b,Math.floor(minute/1440)*1440-180*1440);} finally {Date.now=realNow;globalThis.fetch=realFetch}
});

test('database failures give an uncached unknown response',async()=>{
 const original=globalThis.caches;globalThis.caches={default:{match:async()=>undefined}};
 try {const response=await worker.fetch(new Request('https://uptime-api.aplt.ai/status'),{DB:{prepare(){return{first:async()=>{throw Error('private dependency detail')}}}}},{waitUntil(){}});assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');assert(!(await response.text()).includes('private dependency'));}finally{globalThis.caches=original}
});

test('the one-time quota reset gate makes no database requests',async()=>{
 const env={MONITOR_START_AT:'2099-01-01T00:00:00Z',DB:{prepare(){throw Error('Must not query before the reset')}}};
 await runChecks(env,Date.now());
 const response=await worker.fetch(new Request('https://uptime-api.aplt.ai/status'),env,{waitUntil(){}});
 assert.equal(response.status,503);assert.equal((await response.json()).startsAt,env.MONITOR_START_AT);
});
