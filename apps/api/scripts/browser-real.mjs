// Invoked only by test-local-media.mjs, against its isolated API/database.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

export async function runBrowserQA({root,directory,apiOrigin,env,email,password,photoPath,videoPath}){
 const require=createRequire(resolve(root,'apps/web/package.json'));const vite=resolve(dirname(require.resolve('vite/package.json')),'bin/vite.js');
 const server=spawn(process.execPath,[vite,'--host','127.0.0.1','--port','5173','--strictPort'],{cwd:resolve(root,'apps/web'),env:{...env,VITE_API_URL:`${apiOrigin}/api`,VITE_SOCKET_URL:`${apiOrigin}/messages`},windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.resume();server.stderr.resume();
 const listener=createServer();await new Promise(ok=>listener.listen(0,'127.0.0.1',ok));const port=listener.address().port;await new Promise(ok=>listener.close(ok));
 let browser;let socket;const screenshots=resolve(directory,'screenshots');await mkdir(screenshots,{recursive:true});
 try{
  let ready=false;for(let n=0;n<80;n++){try{ready=(await fetch('http://127.0.0.1:5173')).ok;if(ready)break}catch{}await delay(100)}assert.ok(ready,'Isolated Vite must start');assert.equal(server.exitCode,null,'Port 5173 must be free before browser QA');
  const executable=process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=spawn(executable,['--headless','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(directory,'browser-qa')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let targets;for(let n=0;n<60;n++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();if(targets.length)break}catch{}await delay(100)}assert.ok(targets?.length,'Browser must start');
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail});
  let id=0;const pending=new Map();const exceptions=[];const failed=[];const requests=new Map();
  function call(method,params={}){const next=++id;return new Promise((ok,fail)=>{pending.set(next,{ok,fail});socket.send(JSON.stringify({id:next,method,params}))})}
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.fail(new Error(message.error.message)):p?.ok(message.result);return}if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);if(message.method==='Network.requestWillBeSent')requests.set(message.params.requestId,message.params.request.url);if(message.method==='Network.responseReceived'&&message.params.response.status>=400)failed.push(`${message.params.response.status} ${new URL(message.params.response.url).pathname}`);if(message.method==='Network.loadingFailed'&&message.params.errorText!=='net::ERR_ABORTED')failed.push(`${message.params.errorText} ${(requests.get(message.params.requestId)||'').split('?')[0]}`)};
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value}
  async function wait(expression,label){for(let n=0;n<120;n++){if(await evaluate(expression))return;await delay(100)}await screenshot('failure-last');console.log(`Browser failures: ${failed.join(', ')}`);throw new Error(`Browser assertion failed: ${label}`)}
  const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function fill(selector,value){await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const prototype=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`)}
  async function file(selector,path){const document=await call('DOM.getDocument');const target=await call('DOM.querySelector',{nodeId:document.root.nodeId,selector});await call('DOM.setFileInputFiles',{nodeId:target.nodeId,files:[path]})}
  async function screenshot(name){await evaluate('document.fonts.ready');const {data}=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(screenshots,`${name}.png`),Buffer.from(data,'base64'))}
  async function width(value){await call('Emulation.setDeviceMetricsOverride',{width:value,height:1000,deviceScaleFactor:1,mobile:value<681});await delay(100);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`No horizontal overflow at ${value}px`)}
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await width(1440);await call('Page.navigate',{url:'http://127.0.0.1:5173'});await wait(`!!document.querySelector('.forgot-password')`,'login');
  await fill('input[type=email]',email);await fill('input[type=password]',password);await click('.stack .primary');await wait(`!!document.querySelector('.feed-greeting')`,'real login');
  await wait(`document.querySelectorAll('.post').length>=3`,'real seeded feed');await wait(`Array.from(document.querySelectorAll('img.post-media')).filter(image=>image.getBoundingClientRect().top<innerHeight&&image.getBoundingClientRect().bottom>0).every(image=>image.naturalWidth>0)`,'visible real images display');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.brand-wordmark')).fontFamily.includes('Grand Hotel')`),true,'Font wordmark');
  await screenshot('home-desktop');
  await click('.post button[aria-label="Нравится"]');await wait(`document.querySelector('.post button[aria-label="Нравится"]').getAttribute('aria-pressed')==='true'`,'browser like');
  await fill('.post .comment-form input','Демо · комментарий из браузера');await click('.post .comment-form button');await wait(`document.querySelector('.comments-list')?.innerText.includes('комментарий из браузера')`,'browser comment');
  await click('.post button[aria-label="Сохранить"]');await wait(`document.querySelector('.post button[aria-label="Сохранить"]').getAttribute('aria-pressed')==='true'`,'browser save');
  await click('.sidebar a[href="/saved"]');await wait(`!!document.querySelector('.saved-page .post')`,'saved collection');await click('.saved-page .post button[aria-label="Сохранить"]');await wait(`document.body.innerText.includes('Сохраните что-нибудь особенное')`,'unsave collection');
  await click('.sidebar a[href="/"]');await wait(`!!document.querySelector('.feed-greeting')`,'back to feed');
  await click('.post button[aria-label="Отправить другу"]');await wait(`!!document.querySelector('.share-person')`,'share to real conversation');await click('.share-person');await wait(`document.body.innerText.includes('Публикация отправлена')`,'post sent to friend');
  for(const size of [320,390,430,768,1024,1440])await width(size);
  await width(390);await screenshot('home-mobile');await width(1440);
  await click('.sidebar a[href="/explore"]');await wait(`document.querySelectorAll('.media-grid>a').length>=6`,'Explore real posts');await screenshot('explore-desktop');
  await fill('.searchbar input','#gloomi');await wait(`document.querySelectorAll('.media-grid>a').length>=1 && document.querySelectorAll('.media-grid>a').length<10`,'real hashtag search');
  await fill('.searchbar input','demo_mark');await wait(`!!document.querySelector('.person-result[href="/profile/demo_mark"]')`,'real user search');
  await fill('.searchbar input','');await wait(`document.querySelectorAll('.media-grid>a').length>=6`,'clear search');
  await click('.sidebar a[href="/profile"]');await wait(`!!document.querySelector('.profile-hero')`,'profile');await screenshot('profile-desktop');
  await click('.profile-action-row button');await wait(`!!document.querySelector('.profile-edit-dialog')`,'profile editor');
  await file('.profile-edit-photo input',photoPath);await wait(`document.querySelector('.profile-edit-photo img')?.naturalWidth>0 && !document.querySelector('.profile-edit-fields .primary').disabled`,'avatar upload');
  await fill('.profile-edit-dialog input[name=displayName]','Алина · браузерная проверка');await fill('.profile-edit-dialog textarea','Демонстрационный профиль. Изменения сохраняются в PostgreSQL.');
  await click('.profile-edit-fields .primary');await wait(`!document.querySelector('.profile-edit-dialog')`,'profile persisted');await wait(`document.querySelector('.profile-biography').innerText.includes('браузерная проверка')`,'profile update visible');
  await call('Page.reload');await wait(`document.querySelector('.profile-biography')?.innerText.includes('браузерная проверка')`,'profile survives refresh with real cookies');
  await screenshot('profile-desktop');
  await evaluate(`window.__revoked=[];const originalRevoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__revoked.push(url);originalRevoke(url)};`);
  await click('.sidebar .nav-create');await wait(`!!document.querySelector('.create-select')`,'create selection');await screenshot('create-selection');
  await file('.file-picker input',photoPath);await wait(`document.querySelector('.create-preview img')?.naturalWidth>0`,'photo preview');const preview=await evaluate(`document.querySelector('.create-preview img').src`);
  await evaluate(`const select=document.querySelector('.preview-tools select');select.value='square';select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await screenshot('create-preview');await click('.create-header>.text-button');await wait(`!!document.querySelector('.create-details')`,'create details');
  await fill('.create-details textarea','Демо · публикация из настоящего браузера #gloomi');await fill('.location-field input','Изолированная проверка');await click('.save-draft');await wait(`document.querySelector('[role=status]')?.innerText.includes('черновика')`,'draft saved');await screenshot('create-details');
  await click('.publish-button');await wait(`!!document.querySelector('.create-success')`,'photo published to real API');await click('.create-success .primary');await wait(`document.querySelector('img.post-media')?.naturalWidth>0`,'published photo renders');
  assert.ok(await evaluate(`window.__revoked.includes(${JSON.stringify(preview)})`),'Preview URL revoked on close');
  const photoRoute=await evaluate('location.pathname');await call('Page.reload');await wait(`document.querySelector('img.post-media')?.naturalWidth>0`,'published photo survives reload');assert.equal(await evaluate('location.pathname'),photoRoute);
  await click('.sidebar .nav-create');await file('.file-picker input',videoPath);await wait(`document.querySelector('.create-preview video')?.readyState>=1`,'real WebM preview');await click('.create-header>.text-button');await fill('.create-details textarea','Демо · видео из настоящего браузера');await click('.publish-button');await wait(`!!document.querySelector('.create-success')`,'video published');await click('.create-success .primary');await wait(`document.querySelector('video.post-media')?.readyState>=1`,'published video renders');
  await call('Page.reload');await wait(`document.querySelector('video.post-media')?.readyState>=1`,'published video survives reload');
  await click('.sidebar a[href="/"]');await wait(`!!document.querySelector('.story-add')`,'back to feed');await click('.story-add');await file('.file-picker input',photoPath);await wait(`document.querySelector('.create-preview img')?.naturalWidth>0`,'story preview');await click('.create-header>.text-button');await fill('.create-details textarea','Демо · история из браузера');await click('.publish-button');await wait(`!!document.querySelector('.create-success')`,'story published');await click('.create-success .primary');
  await wait(`document.querySelectorAll('.stories .story:not(.story-add)').length>=2`,'story persists in strip');await click('.stories .story:not(.story-add)');await wait(`document.querySelector('.story-stage>img')?.naturalWidth>0`,'story viewer');await width(390);await screenshot('story-mobile');await click('.story-close');
  await width(1440);await click('.sidebar a[href="/messages"]');await wait(`!!document.querySelector('.chat-list-item')`,'messenger real conversation');await click('.chat-list-item');await wait(`!!document.querySelector('.message-compose')`,'active chat');await fill('.message-compose input','Демо · сообщение из настоящего браузера');await click('.message-compose button');await wait(`document.querySelector('.chat-messages').innerText.includes('сообщение из настоящего браузера')`,'message persisted');await screenshot('messages-desktop');
  await click('.sidebar a[href="/notifications"]');await wait(`!!document.querySelector('.activity-group')`,'actual activity');await screenshot('notifications-desktop');await click('[aria-label="Отметить всё прочитанным"]');await wait(`!document.querySelector('.activity-row.unread')`,'read state persisted');
  await click('.sidebar a[href="/reels"]');await wait(`document.querySelector('.reels-stream video')?.readyState>=1`,'real Reels video');await screenshot('reels-desktop');
  await width(390);await click('.mobile-nav button:nth-child(5)');await wait(`!!document.querySelector('.profile-hero')`,'mobile profile');await screenshot('profile-mobile');await click('.mobile-nav button:nth-child(2)');await wait(`!!document.querySelector('.searchbar input')`,'mobile Explore');await screenshot('explore-mobile');await click('.mobile-nav button:nth-child(3)');await wait(`!!document.querySelector('.create-select')`,'mobile create');await screenshot('create-mobile');await click('.create-header button');
  await width(1440);await call('Page.navigate',{url:'http://127.0.0.1:5173/phone-preview'});await wait(`!!document.querySelector('.phone-frame iframe')`,'phone preview frame');await wait(`!!document.querySelector('.phone-frame iframe').contentDocument?.querySelector('.mobile-header')`,'interactive mobile app inside frame');await screenshot('phone-preview');
  assert.equal(exceptions.length,0,`No runtime exceptions: ${exceptions.join(',')}`);
  assert.equal(failed.length,0,`No HTTP/blob failures: ${failed.join(',')}`);
  console.log('PASS real browser: cookie login/refresh, Grand Hotel, six widths; likes/comments/save/unsave/share; avatar/profile save/reload; cropped PNG + WebM publish/reload; preview cleanup; story upload/view; messages; activity/read; Reels; zero HTTP/blob/runtime errors. No API mocks.');
  console.log(`Screenshots: ${screenshots}`);
  await call('Browser.close').catch(()=>{});
  const regression=spawnSync(process.execPath,[resolve(root,'apps/web/scripts/smoke-ui.mjs')],{cwd:root,windowsHide:true,stdio:'inherit'});
  assert.equal(regression.status,0,'Separate auth UI regression with API fixtures');
 }finally{socket?.close();browser?.kill();server.kill()}
}
