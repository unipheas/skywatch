export type Place = { lat: number; lon: number; name: string; approximate: boolean };
export type Config = { location: Place | null; radius: number; overhead: number; refresh: number; units: 'aviation' | 'metric' | 'imperial'; alerts: boolean; demo: boolean };
export type Aircraft = { hex: string; label: string; registration: string; type: string; distance: number; bearing: number; altitude: number | null; geometric: boolean; track: number | null; speed: number | null; rate: number | null; positionAt: number };
export const MAX_AGE_MS = 45000, MAX_AIRCRAFT = 12, MAX_BODY = 16384;
export const DEFAULTS: Config = { location: null, radius: 5, overhead: 1, refresh: 15, units: 'aviation', alerts: true, demo: false };
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function coordinate(lat: unknown, lon: unknown): boolean { return numeric(lat) && numeric(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
export function clean(v: unknown, max = 8): string { return typeof v === 'string' ? v.replace(/[^a-zA-Z0-9 .-]/g, '').trim().toUpperCase().slice(0, max) : ''; }
function bounded(v: unknown, fallback: number, min: number, max: number): number { return numeric(v) ? Math.max(min, Math.min(max, v)) : fallback; }
export function readConfig(v: Record<string, unknown>): Config {
  const geo = v.location as Record<string, unknown> | undefined;
  let location: Place | null = null;
  if (geo?.mode === 'fixed') {
    if (!coordinate(geo.lat, geo.lon)) throw new Error('CHECK LOCATION');
    location = { lat: geo.lat as number, lon: geo.lon as number, name: clean(geo.name, 24) || 'FIXED', approximate: false };
  }
  const radius = bounded(v.radius_nm, 5, 1, 10);
  return { location, radius, overhead: Math.min(radius, bounded(v.overhead_nm, 1, 1, 3)), refresh: bounded(v.refresh_seconds, 15, 15, 60), units: v.units === 'metric' || v.units === 'imperial' ? v.units : 'aviation', alerts: v.alerts !== false, demo: v.demo === true };
}
export function autoPlace(data: Record<string, unknown>): Place {
  if (data.success !== true || !coordinate(data.latitude, data.longitude)) throw new Error('LOCATION ERROR');
  return { lat: data.latitude as number, lon: data.longitude as number, name: clean(data.city, 24) || 'IP LOCATION', approximate: true };
}
const rad = Math.PI / 180;
export function distanceNm(a: Place, lat: number, lon: number): number {
  const p = (lat - a.lat) * rad / 2, q = (lon - a.lon) * rad / 2;
  const h = Math.sin(p) ** 2 + Math.cos(a.lat * rad) * Math.cos(lat * rad) * Math.sin(q) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function bearing(a: Place, lat: number, lon: number): number {
  const d = (lon - a.lon) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(lat * rad), Math.cos(a.lat * rad) * Math.sin(lat * rad) - Math.sin(a.lat * rad) * Math.cos(lat * rad) * Math.cos(d)) / rad + 360) % 360;
}
export function compass(degrees: number | null): string { return degrees === null ? '--' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]; }
export function normalize(a: Record<string, unknown>, place: Place, radius: number, at: number): Aircraft | null {
  if (!coordinate(a.lat, a.lon) || a.alt_baro === 'ground' || a.category === 'C1' || a.category === 'C2') return null;
  if (!numeric(a.seen_pos) || a.seen_pos < 0 || a.seen_pos * 1000 > MAX_AGE_MS) return null;
  const d = distanceNm(place, a.lat as number, a.lon as number), hex = clean(a.hex, 7);
  if (d > radius || !hex) return null;
  const baro = numeric(a.alt_baro) && a.alt_baro >= -1500 && a.alt_baro <= 100000;
  const geom = numeric(a.alt_geom) && a.alt_geom >= -1500 && a.alt_geom <= 100000;
  return { hex, label: clean(a.flight) || clean(a.r) || hex, registration: clean(a.r), type: clean(a.t, 4), distance: d, bearing: bearing(place, a.lat as number, a.lon as number), altitude: baro ? a.alt_baro as number : geom ? a.alt_geom as number : null, geometric: !baro && geom, track: numeric(a.track) && a.track >= 0 && a.track <= 360 ? a.track % 360 : null, speed: numeric(a.gs) && a.gs >= 0 && a.gs < 2500 ? a.gs : null, rate: numeric(a.baro_rate) ? a.baro_rate : numeric(a.geom_rate) ? a.geom_rate : null, positionAt: at - a.seen_pos * 1000 };
}
/** Parse one record at a time: a JSON reviver allocates the entire array first. */
export function parseFeed(body: string, place: Place, radius: number, receivedAt: number): Aircraft[] {
  if (body.length > MAX_BODY) throw new Error('DENSE TRAFFIC');
  let i = 0;
  const ws = () => { while (i < body.length && /\s/.test(body.charAt(i))) i++; };
  function valueEnd(): void {
    const start = i; let depth = 0, quoted = false, escaped = false;
    for (; i < body.length; i++) {
      const c = body[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { if (depth === 0) break; depth--; }
      else if (depth === 0 && c === ',') break;
    }
    if (quoted || depth !== 0 || i === start) throw new Error('BAD DATA');
  }
  const result: Aircraft[] = []; let found = false, timestamp: number | null = null;
  ws(); if (body[i++] !== '{') throw new Error('BAD DATA'); ws();
  while (body[i] !== '}') {
    if (body[i] !== '"') throw new Error('BAD DATA');
    const keyStart = i++;
    while (i < body.length && body[i] !== '"') { if (body[i] === '\\') i++; i++; }
    const key = JSON.parse(body.slice(keyStart, ++i)) as string;
    ws(); if (body[i++] !== ':') throw new Error('BAD DATA'); ws();
    if (key === 'ac' || key === 'aircraft') {
      if (found || body[i++] !== '[') throw new Error('BAD DATA');
      found = true; ws();
      while (body[i] !== ']') {
        const start = i; valueEnd(); const raw = JSON.parse(body.slice(start, i));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('BAD DATA');
        const a = normalize(raw, place, radius, receivedAt);
        if (a && !result.some(x => x.hex === a.hex)) {
          result.push(a); result.sort((x, y) => x.distance - y.distance || x.hex.localeCompare(y.hex));
          if (result.length > MAX_AIRCRAFT) result.pop();
        }
        ws(); if (body[i] !== ',') break; i++; ws();
        if (body[i] === ']') throw new Error('BAD DATA');
      }
      if (body[i++] !== ']') throw new Error('BAD DATA');
    } else {
      const start = i; valueEnd(); const v = JSON.parse(body.slice(start, i));
      if (key === 'now' && numeric(v)) timestamp = v > 1e12 ? v : v * 1000;
      if (key === 'msg' && v !== 'No error' && v !== 'No Error' && v !== '' && v !== null) throw new Error('FEED ERROR');
    }
    ws(); if (body[i] !== ',') break; i++; ws();
    if (body[i] === '}') throw new Error('BAD DATA');
  }
  if (body[i++] !== '}') throw new Error('BAD DATA'); ws();
  if (i !== body.length || !found) throw new Error('BAD DATA');
  if (timestamp === null || Math.abs(receivedAt - timestamp) > 60000) throw new Error('CHECK TIME/FEED');
  const age = Math.max(0, receivedAt - timestamp);
  return result.map(a => ({ ...a, positionAt: a.positionAt - age })).filter(a => receivedAt - a.positionAt <= MAX_AGE_MS);
}
export function fresh(list: Aircraft[], now: number): Aircraft[] { return list.filter(a => now >= a.positionAt && now - a.positionAt <= MAX_AGE_MS); }
export function rangeLabel(nm: number, units: Config['units']): string { return units === 'metric' ? `${(nm * 1.852).toFixed(1)}KM` : units === 'imperial' ? `${(nm * 1.15078).toFixed(1)}MI` : `${nm.toFixed(1)}NM`; }
export function detail(a: Aircraft, page: number, c: Config, approximate: boolean): string {
  if (page === 0) return `${approximate ? '~' : ''}${rangeLabel(a.distance, c.units)} ${compass(a.bearing)}`;
  if (page === 1) return a.altitude === null ? 'ALT UNKNOWN' : `${a.geometric ? 'GEO' : 'ALT'} ${Math.round(c.units === 'metric' ? a.altitude * 0.3048 : a.altitude)}${c.units === 'metric' ? 'M' : 'FT'}`;
  if (page === 2) return `HDG ${a.track === null ? '---' : (Math.round(a.track) % 360).toString().padStart(3, '0')} ${compass(a.track)}`;
  if (page === 3) return a.speed === null ? 'SPD UNKNOWN' : `${Math.round(a.speed * (c.units === 'metric' ? 1.852 : c.units === 'imperial' ? 1.15078 : 1))}${c.units === 'metric' ? 'KM/H' : c.units === 'imperial' ? 'MPH' : 'KT'} ${a.rate === null ? '' : a.rate > 200 ? 'CLIMB' : a.rate < -200 ? 'DESC' : 'LEVEL'}`.trim();
  if (page === 4) return [a.registration, a.type].filter(Boolean).join(' ') || 'TYPE UNKNOWN';
  return a.distance <= c.overhead ? (approximate ? '~NEAR IP LOC' : 'OVERHEAD') : 'NEARBY';
}
export function retryDelay(failures: number, retryAfter: string | null, now: number): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  const requested = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - now : 0;
  return Math.max(Math.min(300000, 15000 * 2 ** Math.min(failures, 5)), Number.isFinite(requested) ? Math.min(86400000, Math.max(0, requested)) : 0);
}
