// Polls each service in services.json and updates:
//   • data/uptime.json   — committed history (source of truth)
//   • public/uptime.json — the copy the published page reads
//
// Tracks, per service: a 90-day daily up/down aggregate (the uptime bars),
// a rolling window of response-time samples (the sparkline), and detects
// up<->down transitions into a top-level incident log (Past Incidents).
//
// Zero dependencies: uses Node 20's built-in fetch. Runs in GitHub Actions.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA_FILE = 'data/uptime.json';
const RETAIN_DAYS = 90;
const TIMEOUT_MS = 10_000;
const SAMPLE_CAP = 288;     // rolling response-time window (~2 days at a 10-min cadence)
const INCIDENT_CAP = 100;

const services = JSON.parse(readFileSync('services.json', 'utf8'));

const now = new Date();
const iso = now.toISOString();
const today = iso.slice(0, 10);
const cutoff = new Date(now.getTime() - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);

let data = { updatedAt: null, order: [], services: {}, incidents: [] };
if (existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    /* corrupt/empty — reseed */
  }
}
data.services ||= {};
data.incidents ||= [];

async function probe(url) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'storeveu-status-monitor (+https://status.storeveu.com)' },
    });
    clearTimeout(timer);
    const up = res.status >= 200 && res.status < 400; // 2xx/3xx = up
    return { up, status: res.status, responseMs: Date.now() - started };
  } catch {
    return { up: false, status: 0, responseMs: Date.now() - started };
  }
}

function incidentTitle(name, status) {
  if (status === 0) return `${name} unreachable`;
  return `${name} returning errors (HTTP ${status})`;
}

for (const svc of services) {
  const r = await probe(svc.url);
  const prev = data.services[svc.name] || {};

  // Daily up/down aggregate (drives the 90-day bars).
  const daily = prev.daily || {};
  const bucket = daily[today] || { checks: 0, up: 0 };
  bucket.checks += 1;
  if (r.up) bucket.up += 1;
  daily[today] = bucket;
  for (const day of Object.keys(daily)) if (day < cutoff) delete daily[day];

  // Rolling response-time samples (drives the sparkline).
  const samples = (prev.samples || []).concat([{ t: iso, up: r.up, ms: r.responseMs }]).slice(-SAMPLE_CAP);

  // Incident log: open on first-seen-down, close on recovery.
  const open = data.incidents.find((i) => i.service === svc.name && !i.endedAt);
  if (!r.up && !open) {
    data.incidents.unshift({
      service: svc.name,
      title: incidentTitle(svc.name, r.status),
      status: r.status,
      startedAt: iso,
      endedAt: null,
    });
  } else if (r.up && open) {
    open.endedAt = iso;
    open.durationMin = Math.max(1, Math.round((new Date(iso) - new Date(open.startedAt)) / 60_000));
  }

  data.services[svc.name] = {
    name: svc.name,
    url: svc.url,
    current: { up: r.up, status: r.status, responseMs: r.responseMs, checkedAt: iso },
    daily,
    samples,
  };

  console.log(`${r.up ? 'UP  ' : 'DOWN'}  ${svc.name}  (${r.status}, ${r.responseMs}ms)`);
}

// Prune the incident log: keep ongoing + anything resolved within retention.
const incCutoffMs = now.getTime() - RETAIN_DAYS * 86_400_000;
data.incidents = data.incidents
  .filter((i) => !i.endedAt || new Date(i.endedAt).getTime() >= incCutoffMs)
  .slice(0, INCIDENT_CAP);

const out = {
  updatedAt: iso,
  order: services.map((s) => s.name),
  services: data.services,
  incidents: data.incidents,
};

writeFileSync(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
mkdirSync('public', { recursive: true });
writeFileSync('public/uptime.json', JSON.stringify(out));

console.log(`\nWrote ${DATA_FILE} and public/uptime.json at ${iso}`);
