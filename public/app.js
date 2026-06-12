// Reads uptime.json (produced by scripts/check.mjs) and renders the page:
// overall banner, active incidents, per-service 90-day uptime bars + uptime %
// + response-time sparkline, and a Past Incidents log. Auto-refreshes every 60s.
// Defensive against older data files that lack `samples`/`incidents`.

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

function fmtDateTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDur(min) {
  if (min == null) return '';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
}

function msStats(samples) {
  const ms = (samples || []).map((s) => s.ms).filter((v) => typeof v === 'number');
  if (!ms.length) return null;
  return {
    last: ms[ms.length - 1],
    avg: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    peak: Math.max(...ms),
  };
}

// Inline SVG sparkline of response time over the recent sample window.
function responseChart(samples) {
  const pts = (samples || []).filter((s) => s && typeof s.ms === 'number');
  if (pts.length < 2) return '<div class="chart-empty">Collecting response-time data…</div>';
  const W = 600;
  const H = 56;
  const PAD = 3;
  const maxMs = Math.max(...pts.map((p) => p.ms), 50) * 1.2; // 20% headroom
  const n = pts.length;
  const X = (i) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const Y = (v) => PAD + (1 - v / maxMs) * (H - 2 * PAD);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.ms).toFixed(1)}`).join(' ');
  const area = `M${X(0).toFixed(1)} ${H - PAD} ${pts
    .map((p, i) => `L${X(i).toFixed(1)} ${Y(p.ms).toFixed(1)}`)
    .join(' ')} L${X(n - 1).toFixed(1)} ${H - PAD} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Response time, last ${n} checks">
    <path class="chart-area" d="${area}" />
    <path class="chart-line" d="${line}" vector-effect="non-scaling-stroke" />
  </svg>`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderService(s) {
  const card = el('article', 'svc');
  const up = !!(s.current && s.current.up);
  const stateCls = s.current ? (up ? 'ok' : 'down') : 'nd';
  const u90 = uptimePct(s.daily, 90);

  // Header: dot + name + status pill
  const head = el('div', 'svc-head');
  const left = el('div', 'svc-head-left');
  left.append(el('span', `dot dot--${stateCls}`), el('span', 'svc-name', s.name));
  const pill = el('span', `pill pill--${stateCls}`, s.current ? (up ? 'Operational' : 'Down') : 'No data');
  head.append(left, pill);

  // 90-day uptime bars
  const bars = el('div', 'bars');
  for (const d of lastDays(90)) {
    const b = el('span', `bar bar--${dayState(s.daily, d)}`);
    const v = s.daily && s.daily[d];
    b.title = v && v.checks ? `${d}: ${((v.up / v.checks) * 100).toFixed(1)}% (${v.checks} checks)` : `${d}: no data`;
    bars.append(b);
  }

  // Axis labels under the bars (90 days ago · uptime % · Today)
  const axis = el('div', 'bars-axis');
  axis.append(
    el('span', null, '90 days ago'),
    el('span', 'bars-axis-pct', `${fmtPct(u90)} uptime`),
    el('span', null, 'Today'),
  );

  // Response-time sparkline + stats
  const chartWrap = el('div', 'chart-wrap');
  chartWrap.innerHTML = responseChart(s.samples);
  const stats = msStats(s.samples);
  const meta = el('div', 'svc-meta');
  if (stats) {
    meta.innerHTML =
      `<span>Response <b>${up && s.current ? `${s.current.responseMs} ms` : `${stats.last} ms`}</b></span>` +
      `<span>Avg <b>${stats.avg} ms</b></span>` +
      `<span>Peak <b>${stats.peak} ms</b></span>` +
      `<span>7-day <b>${fmtPct(uptimePct(s.daily, 7))}</b></span>`;
  } else {
    meta.innerHTML = `<span>7-day <b>${fmtPct(uptimePct(s.daily, 7))}</b></span>`;
  }

  card.append(head, bars, axis, chartWrap, meta);
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
    node.textContent = 'All Systems Operational';
  } else if (down === states.length) {
    node.classList.add('overall--down');
    node.textContent = 'Major Outage';
  } else {
    node.classList.add('overall--warn');
    node.textContent = `Partial Outage — ${down} service${down > 1 ? 's' : ''} affected`;
  }
}

function renderIncidents(data) {
  const incidents = data.incidents || [];
  const ongoing = incidents.filter((i) => !i.endedAt);
  const past = incidents.filter((i) => i.endedAt);

  const oc = document.getElementById('ongoing');
  oc.innerHTML = '';
  for (const i of ongoing) {
    const card = el('div', 'inc inc--ongoing');
    const title = el('div', 'inc-title');
    title.append(el('span', 'inc-tag inc-tag--investigating', 'Investigating'), el('span', 'inc-name', i.title || `${i.service} down`));
    card.append(title, el('div', 'inc-when', `Detected ${fmtDateTime(i.startedAt)} · ${relTime(i.startedAt)}`));
    oc.append(card);
  }

  const pc = document.getElementById('past-incidents');
  pc.innerHTML = '';
  if (!past.length) {
    pc.append(el('p', 'empty', 'No incidents in the past 90 days.'));
    return;
  }
  for (const i of past.slice(0, 25)) {
    const card = el('div', 'inc inc--past');
    const title = el('div', 'inc-title');
    title.append(el('span', 'inc-tag inc-tag--resolved', 'Resolved'), el('span', 'inc-name', i.title || `${i.service} down`));
    card.append(
      title,
      el('div', 'inc-when', `${fmtDateTime(i.startedAt)} · down ${fmtDur(i.durationMin)} · resolved ${relTime(i.endedAt)}`),
    );
    pc.append(card);
  }
}

async function load() {
  try {
    const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();

    renderOverall(data);
    renderIncidents(data);

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
