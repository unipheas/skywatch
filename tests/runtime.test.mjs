import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const script=execFileSync('tar',['-xOf','dist/app.unipheas.skywatch.tgz','app.unipheas.skywatch/scripts/main.js'],{encoding:'utf8'});
const START=1800000000000;
const row={hex:'abc123',flight:'SKY123',lat:0.01,lon:0,seen_pos:0,alt_baro:12000,track:90,gs:300};
const response=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:{get:k=>headers[k]??null},json:async()=>data,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
async function boot({values={},wifi='connected',remote,settingsDeferred,drawDeferred}={}) {
  let time=START,handler=null,id=0; const timers=new Map(),calls=[],frames=[],errors=[];
  const context=vm.createContext({
    Date:class extends Date{static now(){return time;}},
    console:{log(){},warn(){},error:x=>errors.push(String(x))},
    setInterval:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearInterval:key=>timers.delete(key),
    setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms,once:true});return key;},clearTimeout:key=>timers.delete(key),
    listen:(kind,fn)=>{assert.equal(kind,'input');assert.equal(handler,null);handler=fn;return()=>{handler=null;};},
    fetch:async(url,options)=>{
      calls.push(String(url));
      if(String(url).includes('/api/display/draw')){frames.push(JSON.parse(options.body)); if(drawDeferred) await drawDeferred;return response({success:true});}
      if(String(url).includes('/api/apps/settings')){if(settingsDeferred)await settingsDeferred;return response({version:1,values});}
      if(String(url).includes('/api/wifi/status'))return response({state:wifi});
      if(remote)return remote(String(url),time);
      if(String(url).startsWith('https://ipwho.is/'))return response({success:true,latitude:0,longitude:0,city:'TEST CITY'});
      return response({now:time,ac:[row],msg:'No error'});
    },
  });
  new vm.Script(script).runInContext(context);await settle();
  return {calls,frames,errors,timers,get handler(){return handler;},
    async key(key,action='short',delta=1){handler?.({key,action,delta});await settle();},
    async tick(ms=3000){time+=ms;for(const [key,t] of [...timers]){if(t.once)timers.delete(key);t.fn();}await settle();},
    screen(){const state={};for(const f of frames)for(const e of f.elements)state[e.id]=e;return state;},
  };
}
test('archive executes as a plain script with only documented device globals',async()=>{
  assert.doesNotMatch(script,/^import\b|^export\b/m);
  const app=await boot();assert.equal(app.errors.length,0);
  assert.equal(app.screen().title.text,'SKY123');
  assert.ok(app.calls.some(x=>x.startsWith('https://ipwho.is/')));
  assert.ok(app.frames.some(x=>x.led_notification_color));
  await app.key('back');await app.tick(0);assert.equal(app.timers.size,0);assert.equal(app.handler,null);
});
test('fixed location bypasses IP service, demo bypasses all remote services and alerts',async()=>{
  const fixed=await boot({values:{location:{mode:'fixed',lat:0,lon:0,name:'ZERO'}}});
  assert.ok(!fixed.calls.some(x=>x.includes('ipwho.is')));
  const demo=await boot({values:{demo:true}});assert.equal(demo.calls.filter(x=>x.startsWith('https:')).length,0);
  assert.ok(demo.screen().title.text.startsWith('D '));assert.ok(!demo.frames.some(x=>x.led_notification_color));
});
test('offline state never calls external services; settings failures do not leak polling',async()=>{
  const offline=await boot({wifi:'disconnected'});assert.equal(offline.screen().title.text,'CONNECT WIFI');
  await offline.tick(15000);assert.equal(offline.calls.filter(x=>x.startsWith('https:')).length,0);
  const invalid=await boot({values:{location:{mode:'fixed',lat:99,lon:0}}});
  assert.equal(invalid.screen().title.text,'CHECK LOCATION');assert.equal(invalid.timers.size,0);
});
test('one LED alert per aircraft cooldown, buttons do not hammer the API',async()=>{
  const app=await boot();const start=app.calls.filter(x=>x.startsWith('https:')).length;
  for(let i=0;i<20;i++)await app.key('ok');
  assert.equal(app.calls.filter(x=>x.startsWith('https:')).length,start);
  await app.tick(15000);assert.equal(app.frames.filter(x=>x.led_notification_color).length,1);
  await app.key('encoder','clockwise',1);assert.ok(app.screen().title.text.startsWith('H '));
  await app.key('start');assert.equal(app.screen().title.text,'SKY123');
});
test('429 observes Retry-After, stale positions expire, and recovery resumes',async()=>{
  let count=0;
  const app=await boot({values:{location:{mode:'fixed',lat:0,lon:0}},remote:(_,time)=>{
    count++;return count===2?response({},429,{'Retry-After':'120'}):response({now:time,ac:[row]});
  }});
  await app.tick(15000);assert.equal(count,2);assert.equal(app.screen().detail.text,'STALE / RETRY');
  await app.tick(45000);assert.equal(app.screen().title.text,'RATE LIMITED');assert.equal(count,2);
  await app.tick(74000);assert.equal(count,2);
  await app.tick(1000);assert.equal(count,3);assert.equal(app.screen().title.text,'SKY123');
});
test('back during settings or flight request does not start more work',async()=>{
  let resolve;const waiting=new Promise(r=>resolve=r);
  const app=await boot({settingsDeferred:waiting});await app.key('back');await app.tick(0);
  resolve();await settle();assert.equal(app.timers.size,0);assert.equal(app.calls.filter(x=>x.startsWith('https:')).length,0);
  let done;const remoteWait=new Promise(r=>done=r);
  const second=await boot({values:{location:{mode:'fixed',lat:0,lon:0}},remote:()=>remoteWait});
  await second.key('back');await second.tick(0);const draws=second.frames.length;
  done(response({now:START,ac:[row]}));await settle();assert.equal(second.frames.length,draws);assert.equal(second.timers.size,0);
});
test('draw requests coalesce while in flight and cannot redraw after quit',async()=>{
  let release;const waiting=new Promise(r=>release=r);
  const app=await boot({drawDeferred:waiting});
  for(let i=0;i<10;i++)await app.key('ok');assert.equal(app.frames.length,1);
  await app.key('back');await app.tick(0);release();await settle();assert.equal(app.frames.length,1);
});
test('crowded response reduces radius instead of repeatedly parsing oversized input',async()=>{
  const urls=[];
  const app=await boot({values:{location:{mode:'fixed',lat:0,lon:0}},remote:(url,time)=>{urls.push(url);return urls.length===1?response(' '.repeat(17000)):response({now:time,ac:[]});}});
  assert.equal(app.screen().title.text,'DENSE TRAFFIC');
  await app.tick(30000);assert.match(urls[1],/dist\/2$/);assert.equal(app.screen().title.text,'NO AIRCRAFT');
});
test('an unresolved network request never makes expired traffic look like clear sky',async()=>{
  let count=0,resolve;
  const waiting=new Promise(r=>resolve=r);
  const app=await boot({values:{location:{mode:'fixed',lat:0,lon:0}},remote:(_,time)=>++count===1?response({now:time,ac:[row]}):waiting});
  await app.tick(15000);await app.tick(45000);
  assert.equal(app.screen().title.text,'WAITING DATA');assert.equal(count,2);
  await app.key('back');await app.tick(0);resolve(response({now:START,ac:[]}));await settle();
});
