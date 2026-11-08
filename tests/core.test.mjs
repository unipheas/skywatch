import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, autoPlace, coordinate, clean, distanceNm, bearing, compass, normalize, parseFeed, fresh, detail, rangeLabel, retryDelay, DEFAULTS, MAX_BODY } from '../shared/core.ts';
const home={lat:0,lon:0,name:'TEST',approximate:false};
const now=1800000000000;
const record=(overrides={})=>({hex:'abc123',flight:' SKY123 ',lat:0.01,lon:0,alt_baro:12500,gs:310,track:90,seen_pos:1,...overrides});
const feed=(ac,extra={})=>JSON.stringify({ac,now,msg:'No error',...extra});
test('settings default to auto, bound resource limits, reject invalid fixed location',()=>{
  assert.deepEqual(readConfig({}),DEFAULTS);
  assert.equal(readConfig({radius_nm:100,refresh_seconds:1}).radius,10);
  assert.equal(readConfig({radius_nm:1,overhead_nm:3}).overhead,1);
  assert.equal(readConfig({refresh_seconds:1}).refresh,15);
  assert.throws(()=>readConfig({location:{mode:'fixed',lat:91,lon:0}}));
  assert.equal(readConfig({location:{mode:'fixed',lat:0,lon:0}}).location.lat,0);
  assert.equal(coordinate(NaN,0),false);
});
test('auto geolocation requires success and finite coordinates; zero is valid',()=>{
  assert.equal(autoPlace({success:true,latitude:0,longitude:0,city:'City'}).approximate,true);
  for(const data of [{success:false},{success:true,latitude:'1',longitude:2},{success:true,latitude:90,longitude:181}]) assert.throws(()=>autoPlace(data));
});
test('spherical distance, cardinal directions, antimeridian and poles',()=>{
  assert.ok(Math.abs(distanceNm(home,1,0)-60.04)<0.01);
  assert.equal(distanceNm(home,0,0),0);
  assert.equal(bearing(home,0,1),90);
  assert.equal(bearing(home,-1,0),180);
  assert.ok(distanceNm({...home,lon:179.99},0,-179.99)<2);
  assert.ok(Number.isFinite(distanceNm({...home,lat:90},89,180)));
  assert.deepEqual([0,45,90,180,270,359,null].map(compass),['N','NE','E','S','W','N','--']);
});
test('filters ground vehicles, absent positions, old positions and out-of-range traffic',()=>{
  for(const overrides of [{alt_baro:'ground'},{category:'C1'},{category:'C2'},{lat:null},{lon:181},{seen_pos:46},{seen_pos:-1},{seen_pos:null},{lat:2},{hex:''}]) assert.equal(normalize(record(overrides),home,5,now),null);
  assert.equal(normalize(record({alt_baro:null,alt_geom:null}),home,5,now).altitude,null);
  assert.equal(normalize(record({alt_baro:null,alt_geom:12000}),home,5,now).geometric,true);
});
test('unknown values remain unknown, zero heading/speed/altitude survive, identifiers sanitized',()=>{
  const a=normalize(record({alt_baro:0,gs:0,track:0,flight:'',r:'N123'}),home,5,now);
  assert.equal(a.altitude,0); assert.equal(a.speed,0); assert.equal(a.track,0);assert.equal(a.label,'N123');
  assert.equal(clean('A\n<BC>🛩'),'ABC');
});
test('bounded parser handles both envelopes, escaped strings, nested fields, and top 12',()=>{
  const rows=Array.from({length:50},(_,i)=>record({hex:i.toString(16).padStart(6,'0'),lat:(50-i)/1000,extra:{str:'a } ] \\" x',list:[1,2]}}));
  const out=parseFeed(feed(rows),home,5,now);
  assert.equal(out.length,12); assert.equal(out[0].hex,'000031'); assert.ok(out[0].distance<out[11].distance);
  assert.equal(parseFeed(JSON.stringify({now:now/1000,aircraft:[record()]}),home,5,now).length,1);
  assert.equal(parseFeed(feed([record(),record()]),home,5,now).length,1);
});
test('bad schemas, invalid JSON, duplicate arrays, errors, old feeds and oversized responses are errors, not empty sky',()=>{
  for(const body of ['{}','[]','{"ac":null}','{"ac":[]}','{"ac":[null]}',feed([], {msg:'error'}),feed([], {now:now-90000}),feed([], {now:now+90000}),feed([])+'oops','{"now":1800000000000,"ac":[],}', '{"now":1800000000000,"ac":[{},]}','{"now":1800000000000,"ac":[],"aircraft":[]}']) assert.throws(()=>parseFeed(body,home,5,now),body);
  assert.throws(()=>parseFeed(' '.repeat(MAX_BODY+1),home,5,now),/DENSE TRAFFIC/);
  assert.deepEqual(parseFeed(feed([]),home,5,now),[]);
});
test('feed timestamp and position age both contribute to staleness',()=>{
  assert.equal(parseFeed(feed([record({seen_pos:30})],{now:now-20000}),home,5,now).length,0);
  const list=parseFeed(feed([record()]),home,5,now);
  assert.equal(fresh(list,now+45000).length,0);
  assert.equal(fresh(list,now+1000).length,1);
});
test('display distinguishes heading from bearing, auto radius from overhead, and units',()=>{
  const a=normalize(record(),home,5,now);
  assert.match(detail(a,0,DEFAULTS,true),/^~.* N$/);
  assert.equal(detail(a,2,DEFAULTS,false),'HDG 090 E');
  assert.equal(detail(a,5,DEFAULTS,true),'~NEAR IP LOC');
  assert.equal(detail(a,5,DEFAULTS,false),'OVERHEAD');
  assert.equal(detail(a,1,{...DEFAULTS,units:'metric'},false),'ALT 3810M');
  assert.equal(rangeLabel(1,'imperial'),'1.2MI');
});
test('retry delay is bounded, honors Retry-After seconds and dates',()=>{
  assert.equal(retryDelay(1,null,now),30000);
  assert.equal(retryDelay(100,null,now),300000);
  assert.equal(retryDelay(1,'600',now),600000);
  assert.equal(retryDelay(1,new Date(now+900000).toUTCString(),now),900000);
  assert.equal(retryDelay(1,'invalid',now),30000);
});
