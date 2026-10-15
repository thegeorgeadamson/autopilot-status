import { createHmac } from 'node:crypto';
import { chromium } from 'playwright';
import { probe } from '../worker/src/probe.ts';
const origin='https://app.aplt.ai';
const targets=await Promise.all([
 {target_id:'app',url:origin+'/api/health',status:204},
 {target_id:'sign',url:'https://sign.aplt.ai/api/health',status:204},
 {target_id:'docs',url:'https://docs.aplt.ai/docs/',status:200},
].map(async t=>{const p=await probe(t);return {target_id:t.target_id,ok:p.ok,latency_ms:p.latency_ms,attempts:p.attempts.length}}));
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const char of secret.toUpperCase().replace(/=+$/,''))bits+=alphabet.indexOf(char).toString(2).padStart(5,'0');
 const key=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const hash=createHmac('sha1',key).update(counter).digest(),offset=hash[19]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
let browserStatus='not_configured';
if(process.env.MONITOR_EMAIL&&process.env.MONITOR_PASSWORD&&process.env.MONITOR_WORKSPACE_ID&&process.env.MONITOR_TOTP){
 let browser, context, stage='launch';
 try{
  browser=await chromium.launch();context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(30000);
  stage='login';await page.goto(origin+'/login',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Email',{exact:true}).fill(process.env.MONITOR_EMAIL);
  await page.getByLabel('Password',{exact:true}).fill(process.env.MONITOR_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  stage='mfa';await page.getByLabel('Authenticator code',{exact:true}).fill(totp(process.env.MONITOR_TOTP));
  await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await page.waitForURL(url=>url.origin===origin&&!url.pathname.startsWith('/login'),{timeout:45000});
  stage='workspace';const workspace=await context.request.get(origin+'/api/auth/workspaces/cognito');
  if(workspace.status()!==200)throw Error('workspace read failed');
  const data=await workspace.json();
  if(data.dealerships?.length!==1||data.dealerships[0].dealership_id!==process.env.MONITOR_WORKSPACE_ID||!data.dealerships[0].onboarding_complete)throw Error('unexpected workspace');
  // A normal authenticated workspace lookup above executes resolve_cognito_workspaces in RDS.
  stage='dashboard';const response=await page.goto(origin+'/dashboard',{waitUntil:'domcontentloaded'});
  console.log(JSON.stringify({stage:'dashboard-navigation',status:response?.status(),path:new URL(page.url()).pathname}));
  if(!response?.ok()||new URL(page.url()).pathname!=='/dashboard')throw Error('dashboard not available');
  stage='dashboard-content';await page.getByRole('main').waitFor();
  const text=await page.getByRole('main').innerText();
  if(/something went wrong|application error|couldn.t load|access denied|service unavailable/i.test(text))throw Error('dashboard rendered error');
  if(!text.trim())throw Error('empty dashboard');
  browserStatus='passed';
 }catch{browserStatus='failed';console.error(`Synthetic check failed at ${stage}; no credentials or page contents logged.`);}
 finally{
  if(context){try{const csrf=(await context.cookies(origin)).find(c=>c.name==='__Host-aplt_csrf')?.value;if(csrf){const logout=await context.request.post(origin+'/api/auth/logout/cognito',{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','X-CSRF-Token':decodeURIComponent(csrf),'Content-Type':'application/json'},data:{}});if(logout.status()!==204){browserStatus='failed';console.error('Synthetic session logout failed');}}}catch{browserStatus='failed';}}
  if(browser)await browser.close();
 }
}
let monitorFresh=false;
try { const feed=await fetch('https://uptime-api.aplt.ai/status',{cache:'no-store',signal:AbortSignal.timeout(15000)}); const snapshot=await feed.json();monitorFresh=feed.ok&&Number.isFinite(Date.parse(snapshot.checkedAt))&&Date.now()-Date.parse(snapshot.checkedAt)<180000; } catch {}
console.log(JSON.stringify({monitorFeed:monitorFresh?'fresh':'stale or unavailable'}));
const body=JSON.stringify({checkedAt:new Date().toISOString(),targets,browser:{status:browserStatus}});
if(!process.env.INDEPENDENT_CHECK_KEY)throw Error('Independent report key missing');
const signature=createHmac('sha256',process.env.INDEPENDENT_CHECK_KEY).update(body).digest('hex');
const response=await fetch('https://uptime-api.aplt.ai/independent',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Signature':signature},body,signal:AbortSignal.timeout(15000)});
if(response.status!==202)throw Error(`Independent report rejected (${response.status})`);
console.log(JSON.stringify({reported:true,targets,browser:{status:browserStatus}}));
if(!monitorFresh||targets.some(t=>!t.ok)||browserStatus!=='passed')process.exitCode=1;
