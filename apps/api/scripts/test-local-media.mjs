// Real PostgreSQL + real Nest HTTP + real disk. Never reads the root .env.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { demoArt } from './demo-art.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg'); const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcrypt');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = resolve(root, '.cache/local-e2e', randomUUID());
await mkdir(directory, { recursive: true });
const binaries = await import(pathToFileURL(resolve(root, '.cache/e2e-tools/node_modules/@embedded-postgres/windows-x64/dist/index.js')));
const freePort = async () => { const server = createServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const port = server.address().port; await new Promise(ok => server.close(ok)); return port; };
const pgPort = await freePort(); const apiPort = await freePort();
const databaseURL = `postgresql://gloomi_e2e@127.0.0.1:${pgPort}/gloomi_e2e`;
// This hard guard runs before applying SQL or writing users.
const target = new URL(databaseURL); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/gloomi_e2e');
function command(exe, args) { const result = spawnSync(exe, args, { windowsHide: true, stdio: 'ignore', timeout: 60000 }); if (result.status !== 0) throw new Error(`Local test tool failed: ${exe.split(/[\\/]/).pop()} (see isolated postgres.log)`); }
command(binaries.initdb, ['-D', resolve(directory, 'db'), '-U', 'gloomi_e2e', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
command(binaries.pg_ctl, ['-D', resolve(directory, 'db'), '-l', resolve(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort}`, '-w', 'start']);
let apiProcess; let browser; let db;
const env = { ...process.env, DATABASE_URL: databaseURL, DIRECT_URL: databaseURL, NODE_ENV: 'development', EMAIL_DELIVERY_MODE: 'direct', REDIS_URL: '',
  JWT_ACCESS_SECRET: 'isolated-local-media-test-access-key-32-bytes', JWT_REFRESH_SECRET: 'isolated-local-media-test-refresh-key-32-bytes', EMAIL_CODE_PEPPER: 'isolated-local-media-test-pepper-32-bytes',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: '', AWS_DB_SECRET_ARN: '', AWS_EC2_METADATA_DISABLED: 'true', MEDIA_STORAGE_PROVIDER: 'local',
  LOCAL_MEDIA_DIR: resolve(directory, 'media'), API_PUBLIC_ORIGIN: `http://localhost:${apiPort}`, PORT: String(apiPort), WEB_ORIGIN: 'http://127.0.0.1:5173', COOKIE_SAME_SITE: 'lax', COOKIE_DOMAIN: '' };
const origin = `http://127.0.0.1:${apiPort}`;
async function startApi() {
  apiProcess = spawn(process.execPath, [resolve(root, 'apps/api/dist/main.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; apiProcess.stdout.on('data', b => logs.push(String(b))); apiProcess.stderr.on('data', b => logs.push(String(b)));
  for(let n=0;n<100;n++) { try { if((await fetch(`${origin}/api/health`)).ok) return; } catch {} if(apiProcess.exitCode !== null) break; await delay(100); }
  throw new Error(`Isolated API did not start: ${logs.join('').slice(-2500)}`);
}
async function stopApi() { if(!apiProcess || apiProcess.exitCode !== null) return; const child=apiProcess; const ended=new Promise(ok=>child.once('exit',ok)); child.kill(); await ended; }
async function call(path, token, method='GET', body, expected=200) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(`${origin}/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP status (response payload intentionally omitted)`); return data;
}
const png = demoArt(0);
let socket;
async function makeVideo() {
  const executable = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const debugPort = await freePort();
  browser = spawn(executable, ['--headless','--disable-gpu','--no-first-run',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${resolve(directory,'browser')}`,'about:blank'], {windowsHide:true,stdio:'ignore'});
  let pages;
  for(let n=0;n<60;n++){try{pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();if(pages.length)break;}catch{}await delay(100);}
  assert.ok(pages?.length,'Browser must start to generate an original video');
  socket = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl); await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail});
  const generated = await new Promise((ok,fail)=>{
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id===1){if(message.result?.exceptionDetails)fail(new Error('Video generation failed'));else ok(message.result.result.value)}};
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');let frame=0;const paint=()=>{ctx.fillStyle='#7348ed';ctx.fillRect(0,0,320,240);ctx.fillStyle='#eee6ff';ctx.beginPath();ctx.arc(60+(frame++%150),120,35,0,Math.PI*2);ctx.fill();};paint();const timer=setInterval(paint,60);const stream=canvas.captureStream(15);const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const parts=[];recorder.ondataavailable=e=>parts.push(e.data);recorder.onstop=async()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let text='';for(const b of bytes)text+=String.fromCharCode(b);resolve(btoa(text));};recorder.start();setTimeout(()=>recorder.stop(),1200);})`}}));
  });
  socket.close(); browser.kill(); socket=null; browser=null; const bytes=Buffer.from(generated,'base64'); await writeFile(resolve(directory,'clip.webm'),bytes); return bytes;
}
try {
  const adminUrl=new URL(databaseURL);adminUrl.pathname='/postgres';
  const admin=new Client({connectionString:adminUrl.toString()});await admin.connect();await admin.query('CREATE DATABASE gloomi_e2e');await admin.end();
  const sql=new Client({connectionString:databaseURL});await sql.connect();
  for(const folder of (await readdir(resolve(root,'prisma/migrations'))).filter(name=>/^\d/.test(name)).sort()) await sql.query(await readFile(resolve(root,'prisma/migrations',folder,'migration.sql'),'utf8'));
  await sql.end();
  db=new PrismaClient({datasourceUrl:databaseURL});
  const password='LocalDemoOnly123!'; const passwordHash=await bcrypt.hash(password,10);
  const a=await db.user.create({data:{email:'media-a@example.test',username:'demo_alina',passwordHash,emailVerified:new Date(),profile:{create:{displayName:'Демо · Алина',bio:'Изолированная проверка медиа'}}}});
  const b=await db.user.create({data:{email:'media-b@example.test',username:'demo_mark',passwordHash,emailVerified:new Date(),profile:{create:{displayName:'Демо · Марк'}}}});
  const video=await makeVideo();await writeFile(resolve(directory,'photo.png'),png);
  await startApi();
  const aliasLogin=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:JSON.stringify({email:a.email,password})});assert.equal(aliasLogin.status,201,'Configured loopback alias is accepted locally');
  const foreignLogin=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({email:a.email,password})});assert.equal(foreignLogin.status,403,'Foreign origins stay denied');
  const loginA=await call('/auth/login',null,'POST',{email:a.email,password},201);const tokenA=loginA.accessToken;
  const tokenB=(await call('/auth/login',null,'POST',{email:b.email,password},201)).accessToken;
  async function upload(bytes,type,purpose='POST'){
    const descriptor=await call('/media/uploads',tokenA,'POST',{contentType:type,sizeBytes:bytes.length,intent:purpose},201);assert.equal(descriptor.provider,'local');
    const result=await fetch(`${origin}/api${descriptor.uploadUrl}`,{method:'PUT',headers:{Authorization:`Bearer ${tokenA}`,'Content-Type':type},body:bytes});assert.equal(result.status,200,await result.text());
    await call(`/media/uploads/${descriptor.mediaId}/finalize`,tokenA,'POST',undefined,201);return descriptor.mediaId;
  }
  const photoId=await upload(png,'image/png');const clipId=await upload(video,'video/webm');
  const photo=await call('/posts',tokenA,'POST',{mediaId:photoId,caption:'Демо · настоящая фотография #gloomi',location:'Локальная проверка'},201);
  assert.equal((await call('/posts',tokenA,'POST',{mediaId:photoId,caption:'Повторная попытка'},201)).id,photo.id,'Publish retries must be idempotent');
  const clip=await call('/posts',tokenA,'POST',{mediaId:clipId,caption:'Демо · настоящее видео'},201);
  assert.equal((await call('/feed',tokenA)).items.length,2);
  assert.ok((await call('/search/users?q=demo_alina',tokenB)).some(user=>user.id===a.id));
  assert.ok((await call(`/search/users?q=${encodeURIComponent('Алина')}`,tokenB)).some(user=>user.id===a.id));
  assert.ok((await call(`/explore?q=${encodeURIComponent('#gloomi')}`,tokenB)).some(post=>post.id===photo.id));
  const image=await fetch(photo.mediaUrl);assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const ranged=await fetch(clip.mediaUrl,{headers:{Range:'bytes=0-15'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,16);
  const unsigned=new URL(photo.mediaUrl);unsigned.search='';assert.equal((await fetch(unsigned)).status,404);
  await call('/media/uploads',null,'POST',{contentType:'image/png',sizeBytes:png.length,intent:'POST'},401);
  await call('/posts',tokenB,'POST',{mediaId:photoId},403);
  const pending=await call('/media/uploads',tokenA,'POST',{contentType:'image/png',sizeBytes:png.length,intent:'POST'},201);
  assert.equal((await fetch(`${origin}/api${pending.uploadUrl}`,{method:'PUT',headers:{Authorization:`Bearer ${tokenB}`,'Content-Type':'image/png'},body:png})).status,404);
  const spoof=Buffer.alloc(png.length,60);assert.equal((await fetch(`${origin}/api${pending.uploadUrl}`,{method:'PUT',headers:{Authorization:`Bearer ${tokenA}`,'Content-Type':'image/png'},body:spoof})).status,400);
  await call(`/media/${pending.mediaId}`,tokenA,'DELETE');
  await call('/profiles/me',tokenA,'PATCH',{visibility:'PRIVATE'});
  assert.equal((await call(`/profiles/${a.username}`,tokenB)).posts.length,0);
  assert.ok(!(await call('/explore',tokenB)).some(p=>p.id===photo.id));
  await call(`/posts/${photo.id}/comments`,tokenB,'GET',undefined,403);
  assert.equal((await call(`/profiles/${a.id}/follow`,tokenB,'POST',undefined,201)).requested,true);
  assert.equal((await call('/follow-requests',tokenA))[0].id,b.id);
  await call(`/follow-requests/${b.id}/reject`,tokenA,'POST',undefined,201);
  assert.equal((await call('/follow-requests',tokenA)).length,0);
  await call(`/profiles/${a.id}/follow`,tokenB,'POST',undefined,201);
  await call(`/follow-requests/${b.id}/accept`,tokenA,'POST',undefined,201);
  assert.equal((await call(`/profiles/${a.username}`,tokenB)).posts.length,2);
  assert.ok((await call('/notifications',tokenB)).some(item=>item.type==='FOLLOW_APPROVED'));
  await call(`/profiles/${a.id}/unfollow`,tokenB,'POST',undefined,201);
  await call('/profiles/me',tokenA,'PATCH',{visibility:'PUBLIC'});
  await call(`/profiles/${a.id}/follow`,tokenB,'POST',undefined,201);
  await call(`/posts/${photo.id}/like`,tokenB,'POST',undefined,201);
  await call(`/posts/${photo.id}/comments`,tokenB,'POST',{body:'Демо · комментарий второго аккаунта'},201);
  const storyId=await upload(png,'image/png','STORY');await call('/stories',tokenA,'POST',{mediaId:storyId,caption:'Демо · история'},201);
  const conversation=await call(`/conversations/${a.id}`,tokenB,'POST',undefined,201);await call(`/conversations/${conversation.id}/messages`,tokenB,'POST',{body:'Демо · настоящее сообщение через API'},201);
  assert.ok((await call('/notifications',tokenA)).length>=3);assert.equal((await call(`/conversations/${conversation.id}/messages`,tokenA)).length,1);
  await call(`/conversations/${conversation.id}/read`,tokenA,'POST',undefined,201);
  assert.ok((await db.conversationMember.findUnique({where:{conversationId_userId:{conversationId:conversation.id,userId:a.id}}})).lastReadAt);
  const webRequire=createRequire(resolve(root,'apps/web/package.json'));const {io}=webRequire('socket.io-client');
  const realtime=io(`${origin}/messages`,{auth:{token:tokenA},reconnection:false});
  try{
    await new Promise((ok,fail)=>{realtime.once('connect',ok);realtime.once('connect_error',fail)});realtime.emit('conversation:join',conversation.id);await delay(200);
    const incoming=new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(new Error('Realtime event not received')),5000);realtime.once('message:new',message=>{clearTimeout(timer);ok(message)})});
    await call(`/conversations/${conversation.id}/messages`,tokenB,'POST',{body:'Демо · реальный Socket.IO event'},201);
    assert.equal((await incoming).body,'Демо · реальный Socket.IO event');
  }finally{realtime.disconnect()}
  await call('/profiles/me',tokenA,'PATCH',{username:'demo_alina_updated',website:'https://example.test'});assert.equal((await call('/auth/me',tokenA)).username,'demo_alina_updated');
  await call('/profiles/me',tokenA,'PATCH',{username:a.username,website:''});assert.equal((await call(`/profiles/${a.username}`,tokenA)).profile.website,null);
  const removable=await upload(png,'image/png');const removablePost=await call('/posts',tokenA,'POST',{mediaId:removable,caption:'Демо · проверка удаления'},201);
  await call(`/posts/${removablePost.id}`,tokenB,'DELETE',undefined,403);await call(`/posts/${removablePost.id}`,tokenA,'DELETE');assert.equal((await fetch(removablePost.mediaUrl)).status,404);
  await stopApi(); await startApi();
  const restored=await call('/feed',tokenA);assert.equal(restored.items.length,2);
  assert.deepEqual(Buffer.from(await(await fetch(restored.items.find(p=>p.id===photo.id).mediaUrl)).arrayBuffer()),png);
  assert.equal((await db.mediaAsset.findUnique({where:{id:photoId}})).status,'ATTACHED');assert.equal(await db.post.count(),2);
  console.log('PASS real integration: PNG/WebM upload/publish/idempotent retry; signed reads/range; validation/owner/privacy; follow request accept/reject; likes/comments/stories; REST + Socket.IO messages; read markers; profile edits; owner deletion/file cleanup; PostgreSQL + media persistence after API restart. Primary Neon/SMTP not used.');
  if(process.env.GLOOMI_BROWSER_QA==='1'||process.argv.includes('--browser')) {
    const {seedDemo}=await import('./seed-demo.mjs');const demo=await seedDemo({db,storageRoot:env.LOCAL_MEDIA_DIR,password});
    const countsBefore=await db.post.count();await seedDemo({db,storageRoot:env.LOCAL_MEDIA_DIR,password});assert.equal(await db.post.count(),countsBefore,'Demo seeding must be idempotent');
    if(demo[0])await db.follow.create({data:{followerId:a.id,followingId:demo[0].id,accepted:true}});
    const {runBrowserQA}=await import('./browser-real.mjs');
    await runBrowserQA({root,directory,apiOrigin:origin,apiPort,env,email:a.email,password,photoPath:resolve(directory,'photo.png'),videoPath:resolve(directory,'clip.webm')});
  }
  console.log(`Artifacts: ${directory}`);
} finally {
  socket?.close();browser?.kill();await stopApi();await db?.$disconnect();
  command(binaries.pg_ctl,['-D',resolve(directory,'db'),'-m','fast','-w','stop']);
}
