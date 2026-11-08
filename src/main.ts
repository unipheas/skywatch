import { device } from '@shared/device';
import { loadValues } from '@shared/settings';
import { column, render, textWidth, type Node, type DisplayDrawParams } from '@busy-app/busy-lib';
import manifest from './appmeta/manifest.json';
import { DEFAULTS, autoPlace, readConfig, parseFeed, fresh, detail, rangeLabel, retryDelay, type Aircraft, type Place } from '@shared/core';

const APP = manifest.id;
const CYAN = '#52D9FFFF', AMBER = '#FFBE55FF', WHITE = '#FFFFFFFF', MUTED = '#7E9AA8FF';
let config = DEFAULTS, place: Place | null = null, aircraft: Aircraft[] = [];
let selected = '', page = 0, hold = false, info = false, stopped = false;
let status = 'LOCATING', error = '', failures = 0, nextPoll = 0, locationAt = 0;
let fetching = false, drawing = false, dirty = false, pendingPulse = false;
let radius = config.radius;
let alerted: { hex: string; at: number }[] = [];
const lastFrame: Record<string, string> = {};
let timer: ReturnType<typeof setInterval> | undefined;
const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

function lines(): [string, string, string] {
  if (info) {
    if (page % 3 === 1) return ['DATA: ADSB.FI', 'HTTPS://ADSB.FI', CYAN];
    if (page % 3 === 2) return ['SEARCH RADIUS', `${rangeLabel(radius, config.units)} / ${aircraft.length} SEEN`, CYAN];
    return [config.demo ? 'DEMO ONLY' : place?.approximate ? 'AUTO / APPROX' : 'FIXED LOCATION', place?.name || status, CYAN];
  }
  const current = aircraft.find(a => a.hex === selected) || aircraft[0];
  if (!current) return [error || status, place ? `${place.approximate ? '~' : ''}${rangeLabel(radius, config.units)} SCAN` : 'WIFI REQUIRED', error ? AMBER : CYAN];
  const near = current.distance <= config.overhead;
  const label = `${config.demo ? 'D ' : hold ? 'H ' : ''}${current.label}`;
  return [label, error ? 'STALE / RETRY' : config.demo && page === 5 ? 'DEMO ONLY' : detail(current, page, config, place?.approximate ?? true), error || near ? AMBER : CYAN];
}
function fit(text: string, face: 'small' | 'bold'): string {
  while (textWidth(text, face) > 72 && text.length) text = text.slice(0, -1);
  return text;
}
function frame(): Node {
  const [title, subtitle, color] = lines();
  const titleNode: Node = textWidth(title, 'bold') <= 72
    ? { type: 'text', id: 'title', text: fit(title, 'bold'), font: 'bold', color }
    : { type: 'text', id: 'title', text: fit(title, 'small'), font: 'small', color };
  return column({ align: 'center', justify: 'center', gap: 1 }, [
    titleNode,
    { type: 'text', id: 'detail', text: fit(subtitle, 'small'), font: 'small', color: hold ? WHITE : MUTED },
  ]);
}
function draw(): void {
  if (stopped) return;
  if (drawing) { dirty = true; return; }
  const elements = render(frame()).filter(e => lastFrame[e.id] !== JSON.stringify(e));
  if (!elements.length && !pendingPulse) return;
  const request: DisplayDrawParams = { application_name: APP, priority: 50, elements };
  if (pendingPulse && config.alerts && !config.demo) request.led_notification_color = AMBER;
  pendingPulse = false; drawing = true; dirty = false;
  device.DisplayDraw(request).then(() => { elements.forEach(e => { lastFrame[e.id] = JSON.stringify(e); }); }, report).then(() => {
    drawing = false; if (dirty && !stopped) draw();
  });
}
function reconcile(now: number): void {
  const hadTraffic = aircraft.length > 0;
  aircraft = fresh(aircraft, now);
  if (hadTraffic && !aircraft.length) status = 'WAITING DATA';
  if (!aircraft.some(a => a.hex === selected)) { selected = aircraft[0]?.hex || ''; hold = false; }
  alerted = alerted.filter(a => now - a.at < 600000);
  if (error || config.demo) return;
  let focused = false;
  for (const a of aircraft) {
    if (a.distance <= config.overhead && !alerted.some(x => x.hex === a.hex)) {
      alerted.push({ hex: a.hex, at: now }); if (alerted.length > 32) alerted.shift();
      pendingPulse = true;
      if (!hold && !focused) { selected = a.hex; page = 5; focused = true; }
    }
  }
}
async function settings(): Promise<void> {
  // Newer runtimes may provide Settings; 1.3.1 uses the documented HTTP endpoint.
  let values = await loadValues();
  if (!values) {
    const document = await device.AppsSettingsGet({ app_id: APP });
    if (document.version !== 1) throw new Error('UPDATE SETTINGS');
    values = document.values;
  }
  config = readConfig(values); radius = config.radius; place = config.location;
}
async function poll(): Promise<void> {
  if (stopped || fetching || config.demo || Date.now() < nextPoll) return;
  fetching = true; let retryAfter: string | null = null;
  try {
    const wifi = await device.WifiStatusGet();
    if (stopped) return;
    if (wifi.state !== 'connected') throw new Error('CONNECT WIFI');
    if (!place || (place.approximate && Date.now() - locationAt > 3600000)) {
      const response = await fetch('https://ipwho.is/?fields=success,latitude,longitude,city');
      if (stopped) return;
      if (!response.ok) { retryAfter = response.headers.get('Retry-After'); throw new Error('LOCATION ERROR'); }
      const body = await response.text();
      if (stopped) return;
      if (body.length > 4096) throw new Error('LOCATION ERROR');
      const resolved = autoPlace(JSON.parse(body));
      if (place && (place.lat !== resolved.lat || place.lon !== resolved.lon)) { aircraft = []; alerted = []; }
      place = resolved; locationAt = Date.now();
    }
    const response = await fetch(`https://opendata.adsb.fi/api/v3/lat/${place.lat.toFixed(4)}/lon/${place.lon.toFixed(4)}/dist/${radius}`);
    if (stopped) return;
    if (!response.ok) {
      retryAfter = response.headers.get('Retry-After');
      throw new Error(response.status === 429 ? 'RATE LIMITED' : response.status === 401 || response.status === 403 ? 'FEED ACCESS' : 'FEED OFFLINE');
    }
    const body = await response.text();
    if (stopped) return;
    aircraft = parseFeed(body, place, radius, Date.now());
    error = ''; status = 'NO AIRCRAFT'; failures = 0;
    if (!hold) selected = aircraft[0]?.hex || '';
    reconcile(Date.now()); nextPoll = Date.now() + config.refresh * 1000;
  } catch (err) {
    if (stopped) return;
    const message = err instanceof Error ? err.message : '';
    const known = ['CONNECT WIFI', 'LOCATION ERROR', 'DENSE TRAFFIC', 'RATE LIMITED', 'FEED ACCESS', 'FEED OFFLINE', 'BAD DATA', 'FEED ERROR', 'CHECK TIME/FEED'];
    error = known.includes(message) ? message : 'NETWORK ERROR';
    if (error === 'DENSE TRAFFIC' && radius > 1) radius = Math.max(1, Math.floor(radius / 2));
    failures++; nextPoll = Date.now() + retryDelay(failures, retryAfter, Date.now());
    reconcile(Date.now()); report(error);
  } finally { fetching = false; if (!stopped) draw(); }
}
function demo(): void {
  place = { lat: 0, lon: 0, approximate: false, name: 'DEMO ONLY' };
  const now = Date.now();
  aircraft = [{ hex: 'DEMO01', label: 'SKY123', registration: 'N123SW', type: 'B738', distance: 0.7, bearing: 45, altitude: 12500, geometric: false, track: 92, speed: 310, rate: 0, positionAt: now },
    { hex: 'DEMO02', label: 'JET456', registration: 'N456SW', type: 'A320', distance: 3.2, bearing: 270, altitude: 28000, geometric: false, track: 185, speed: 420, rate: -1200, positionAt: now }];
  selected = aircraft[0].hex; status = 'DEMO ONLY';
}
function main(): void {
  draw();
  const unbind = listen('input', event => {
    if (stopped) return;
    if (event.key === 'back' && event.action === 'short') {
      stopped = true; if (timer !== undefined) clearInterval(timer);
      setTimeout(unbind, 0); return;
    }
    if (event.key === 'encoder' && aircraft.length) {
      const index = Math.max(0, aircraft.findIndex(a => a.hex === selected));
      selected = aircraft[(index + event.delta + aircraft.length) % aircraft.length].hex;
      hold = true; info = false; page = 0;
    } else if (event.key === 'ok' && event.action === 'short') { info = false; page = (page + 1) % 6; }
    else if (event.key === 'ok' && event.action === 'long') { info = !info; page = 0; }
    else if (event.key === 'start' && event.action === 'short') { hold = !hold; if (!hold) selected = aircraft[0]?.hex || ''; }
    draw();
  });
  void (async () => {
    try { await settings(); }
    catch (err) { error = err instanceof Error && ['CHECK LOCATION', 'UPDATE SETTINGS'].includes(err.message) ? err.message : 'SETTINGS ERROR'; report(err); draw(); return; }
    if (stopped) return;
    if (config.demo) demo();
    timer = setInterval(() => {
      if (config.demo) aircraft.forEach(a => { a.positionAt = Date.now(); });
      reconcile(Date.now()); page = (page + 1) % 6;
      draw(); void poll();
    }, 3000);
    draw(); await poll();
  })().catch(report);
}
main();
