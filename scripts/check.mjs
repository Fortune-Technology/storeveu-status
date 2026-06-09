// Polls each service in services.json and updates:
//   • data/uptime.json   — committed history (source of truth, daily buckets)
//   • public/uptime.json — the copy the published page reads
//
// Zero dependencies: uses Node 20's built-in fetch. Runs in GitHub Actions.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA_FILE = 'data/uptime.json';
const RETAIN_DAYS = 90;
const TIMEOUT_MS = 10_000;

const services = JSON.parse(readFileSync('services.json', 'utf8'));

const now = new Date();
const iso = now.toISOString();
const today = iso.slice(0, 10);
const cutoff = new Date(now.getTime() - RETAIN_DAYS * 86_400_000)
  .toISOString()
  .slice(0, 10);

let data = { updatedAt: null, order: [], services: {} };
if (existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    /* corrupt/empty — reseed below */
  }
}
data.services ||= {};

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
    // 2xx/3xx (after following redirects) = up; 4xx/5xx/network error = down.
    const up = res.status >= 200 && res.status < 400;
    return { up, status: res.status, responseMs: Date.now() - started };
  } catch {
    return { up: false, status: 0, responseMs: Date.now() - started };
  }
}

for (const svc of services) {
  const r = await probe(svc.url);
  const prev = data.services[svc.name] || {};
  const daily = prev.daily || {};

  const bucket = daily[today] || { checks: 0, up: 0 };
  bucket.checks += 1;
  if (r.up) bucket.up += 1;
  daily[today] = bucket;

  // Drop buckets older than the retention window.
  for (const day of Object.keys(daily)) {
    if (day < cutoff) delete daily[day];
  }

  data.services[svc.name] = {
    name: svc.name,
    url: svc.url,
    current: { up: r.up, status: r.status, responseMs: r.responseMs, checkedAt: iso },
    daily,
  };

  console.log(`${r.up ? 'UP  ' : 'DOWN'}  ${svc.name}  (${r.status}, ${r.responseMs}ms)`);
}

const out = {
  updatedAt: iso,
  order: services.map((s) => s.name),
  services: data.services,
};

writeFileSync(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
mkdirSync('public', { recursive: true });
writeFileSync('public/uptime.json', JSON.stringify(out));

console.log(`\nWrote ${DATA_FILE} and public/uptime.json at ${iso}`);
