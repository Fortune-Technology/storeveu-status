// Reads uptime.json (produced by scripts/check.mjs) and renders the page.
// Auto-refreshes every 60s. No dependencies.

const DATA_URL = './uptime.json';

const fmtPct = (p) => (p === null ? '—' : `${p.toFixed(p >= 99.95 ? 2 : 1)}%`);

function lastDays(n) {
  const out = [];
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function uptimePct(daily, days) {
  const wanted = new Set(lastDays(days));
  let checks = 0;
  let up = 0;
  for (const [date, v] of Object.entries(daily || {})) {
    if (wanted.has(date)) {
      checks += v.checks || 0;
      up += v.up || 0;
    }
  }
  return checks ? (up / checks) * 100 : null;
}

function dayState(daily, date) {
  const v = daily && daily[date];
  if (!v || !v.checks) return 'nd';
  const r = v.up / v.checks;
  if (r >= 0.999) return 'ok';
  if (r >= 0.95) return 'warn';
  return 'down';
}

function relTime(isoStr) {
  if (!isoStr) return 'never';
  const s = Math.max(0, (Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderService(s) {
  const card = el('article', 'svc');

  const top = el('div', 'svc-top');
  const up = !!(s.current && s.current.up);
  const pillCls = s.current ? (up ? 'pill--ok' : 'pill--down') : 'pill--nd';
  const pillTxt = s.current ? (up ? 'Operational' : 'Down') : 'No data';
  top.append(el('div', 'svc-name', s.name), el('span', `pill ${pillCls}`, pillTxt));

  const bars = el('div', 'bars');
  for (const d of lastDays(90)) {
    const b = el('span', `bar bar--${dayState(s.daily, d)}`);
    const v = s.daily && s.daily[d];
    b.title = v && v.checks ? `${d}: ${((v.up / v.checks) * 100).toFixed(1)}% (${v.checks} checks)` : `${d}: no data`;
    bars.append(b);
  }

  const meta = el('div', 'svc-meta');
  const ms = s.current && s.current.responseMs != null ? `${s.current.responseMs} ms` : '—';
  meta.innerHTML =
    `<span>7-day<b>${fmtPct(uptimePct(s.daily, 7))}</b></span>` +
    `<span>90-day<b>${fmtPct(uptimePct(s.daily, 90))}</b></span>` +
    `<span>${up ? 'Response' : 'Last'}<b>${ms}</b></span>`;

  card.append(top, bars, meta);
  return card;
}

function renderOverall(data) {
  const node = document.getElementById('overall');
  const names = data.order || Object.keys(data.services || {});
  const states = names.map((n) => data.services[n] && data.services[n].current).filter(Boolean);

  node.className = 'overall';
  if (!states.length) {
    node.classList.add('overall--loading');
    node.textContent = 'Awaiting first check…';
    return;
  }
  const down = states.filter((c) => !c.up).length;
  if (down === 0) {
    node.classList.add('overall--ok');
    node.textContent = 'All systems operational';
  } else if (down === states.length) {
    node.classList.add('overall--down');
    node.textContent = 'Major outage';
  } else {
    node.classList.add('overall--warn');
    node.textContent = `Partial outage — ${down} service${down > 1 ? 's' : ''} affected`;
  }
}

async function load() {
  try {
    const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();

    renderOverall(data);

    const wrap = document.getElementById('services');
    wrap.innerHTML = '';
    const names = data.order || Object.keys(data.services || {});
    if (!names.length || !Object.keys(data.services || {}).length) {
      wrap.append(el('p', 'empty', 'Collecting data — the first check runs within a few minutes.'));
    } else {
      for (const n of names) {
        if (data.services[n]) wrap.append(renderService(data.services[n]));
      }
    }

    document.getElementById('updated').textContent = `Last checked ${relTime(data.updatedAt)}`;
  } catch {
    document.getElementById('updated').textContent = 'Could not load status data.';
  }
}

load();
setInterval(load, 60_000);
