/* Small, dependency-free SVG charts. All displayed values come from the model. */
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { ink: '#172d39', teal: '#24766b', purple: '#7a68a5', orange: '#c87749', grid: '#e8e8e2', muted: '#65736f' };
let chartId = 0;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const fmt = (value, digits = 1) => finite(value)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Math.abs(value) < 1e-9 ? 0 : value)
  : 'unavailable';
const pct = value => `${fmt(value * 100)}%`;
const units = p => ({ capacity: p?.units?.capacity || p?.capacityUnit || 'units', money: p?.units?.money || p?.moneyUnit || 'currency' });

function node(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  });
  if (text !== undefined) element.textContent = text;
  return element;
}

function append(parent, tag, attributes, text) {
  const element = node(tag, attributes, text);
  parent.append(element);
  return element;
}

// SVG units follow the rendered width, so labels stay readable as cards resize.
// Wrapping uses the actual inherited font after the SVG is attached to the DOM.
function wrappedText(parent, attributes, text, maxWidth, lineHeight = 16) {
  const element = append(parent, 'text', attributes);
  const probe = append(element, 'tspan', {}, '');
  const measure = value => {
    probe.textContent = value;
    return probe.getComputedTextLength?.() || value.length * Number(attributes['font-size'] || 13) * 0.55;
  };
  const lines = [];
  let line = '';
  String(text).split(/\s+/).filter(Boolean).forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) { line = candidate; return; }
    if (line) { lines.push(line); line = ''; }
    // Long tokens (including custom unit names) must not escape their card.
    while (measure(word) > maxWidth && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(`${word.slice(0, cut)}-`) > maxWidth) cut--;
      lines.push(`${word.slice(0, cut)}-`);
      word = word.slice(cut);
    }
    line = word;
  });
  if (line || !lines.length) lines.push(line);
  element.replaceChildren();
  lines.forEach((value, index) => append(element, 'tspan', { x: attributes.x, dy: index ? lineHeight : 0 }, value));
  return { element, lines: lines.length };
}

function makeChart(el, title, description, accounting = false) {
  const id = `economic-chart-${++chartId}`;
  el.replaceChildren();
  el.style.position = 'relative';
  const width = Math.max(280, Math.round(el.getBoundingClientRect().width || el.clientWidth || 600));
  const height = accounting ? 266 : 250;
  const box = { left: 55, right: width - 18, top: 58, bottom: accounting ? 188 : 196 };
  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%', height, role: 'group',
    'aria-labelledby': `${id}-title ${id}-description`,
    style: 'display:block;overflow:visible;font-family:inherit;color:#172d39;max-width:100%;',
  });
  append(svg, 'title', { id: `${id}-title` }, title);
  append(svg, 'desc', { id: `${id}-description` }, `${description} Tab to enter the chart; use left and right arrow keys to inspect points, Home or End for the first or last point. Values are also available on hover.`);
  const defs = append(svg, 'defs');
  const clip = append(defs, 'clipPath', { id: `${id}-clip` });
  const clipRect = append(clip, 'rect', { x: box.left - 1, y: box.top - 1, width: box.right - box.left + 2, height: box.bottom - box.top + 2 });
  const tooltip = document.createElement('div');
  tooltip.className = 'economic-chart-tooltip';
  tooltip.id = `${id}-tooltip`;
  tooltip.setAttribute('role', 'tooltip');
  Object.assign(tooltip.style, {
    display: 'none', position: 'absolute', zIndex: '4', pointerEvents: 'none',
    color: '#fff', background: COLORS.ink, borderRadius: '8px', padding: '10px 12px',
    maxWidth: 'min(280px, calc(100% - 12px))', fontSize: '14px', fontWeight: '500', lineHeight: '1.5',
    whiteSpace: 'pre-line', boxShadow: '0 5px 20px #172d3920',
  });
  el.append(svg, tooltip);
  const targets = [];

  function show(element, x, y, content) {
    tooltip.textContent = content;
    tooltip.style.display = 'block';
    element.setAttribute('aria-describedby', tooltip.id);
    const scale = svg.getBoundingClientRect().width / width;
    const maxLeft = Math.max(6, el.clientWidth - tooltip.offsetWidth - 6);
    tooltip.style.left = `${Math.max(6, Math.min(x * scale - tooltip.offsetWidth / 2, maxLeft))}px`;
    const top = y * scale - tooltip.offsetHeight - 12;
    tooltip.style.top = `${top >= 0 ? top : y * scale + 14}px`;
  }

  function hide(element) {
    element.removeAttribute('aria-describedby');
    tooltip.style.display = 'none';
  }

  function interactive(element, x, y, content, color = COLORS.teal, circle = false) {
    const index = targets.length;
    targets.push(element);
    element.setAttribute('tabindex', index === 0 ? '0' : '-1');
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', content.replace(/\n/g, '. '));
    element.style.outline = 'none';
    element.style.cursor = 'crosshair';
    const activate = () => {
      if (circle) {
        element.setAttribute('stroke', color);
        element.setAttribute('fill', '#fff');
      } else {
        element.setAttribute('stroke', COLORS.ink);
        element.setAttribute('stroke-width', '2');
      }
      show(element, x, y, content);
    };
    const deactivate = () => {
      if (circle) {
        element.setAttribute('stroke', 'transparent');
        element.setAttribute('fill', 'transparent');
      } else {
        element.setAttribute('stroke', 'none');
      }
      hide(element);
    };
    element.addEventListener('pointerenter', activate);
    element.addEventListener('pointerleave', () => { if (document.activeElement !== element) deactivate(); });
    element.addEventListener('focus', activate);
    element.addEventListener('blur', deactivate);
    element.addEventListener('keydown', event => {
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(targets.length - 1, index + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = targets.length - 1;
      else if (event.key === 'Escape') { hide(element); return; }
      else return;
      event.preventDefault();
      targets.forEach((target, i) => target.setAttribute('tabindex', i === next ? '0' : '-1'));
      targets[next].focus();
    });
  }

  function point(x, y, content, color = COLORS.teal) {
    const dot = append(svg, 'circle', { cx: x, cy: y, r: 6, fill: 'transparent', stroke: 'transparent', 'stroke-width': 2 });
    interactive(dot, x, y, content, color, true);
    return dot;
  }
  return { svg, width, height, box, accounting, clipRect, clipId: `${id}-clip`, point, interactive };
}

function niceDomain(values, includeZero = true) {
  const valid = values.filter(finite);
  let low = valid.length ? Math.min(...valid) : 0;
  let high = valid.length ? Math.max(...valid) : 1;
  if (includeZero) { low = Math.min(0, low); high = Math.max(0, high); }
  if (Math.abs(high - low) < 1e-10) {
    if (low === 0) high = 1;
    else { const pad = Math.abs(low) * 0.2; low -= pad; high += pad; }
  }
  const rough = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.abs(v) < step / 100 ? 0 : v);
  return { min, max, ticks };
}

function makeScale(domain, start, end) {
  return value => start + (value - domain.min) / (domain.max - domain.min || 1) * (end - start);
}

function compact(value) {
  if (Math.abs(value) >= 1e6) return `${fmt(value / 1e6, 1)}m`;
  if (Math.abs(value) >= 1e3) return `${fmt(value / 1e3, 1)}k`;
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) return value.toExponential(0);
  return fmt(value, Math.abs(value) < 1 ? 3 : 1);
}

function axes(chart, xDomain, yDomain, xLabel, yLabel, xFormat = compact) {
  const { svg, box: BOX, height } = chart;
  const caption = wrappedText(svg, { x: BOX.left, y: 14, fill: COLORS.muted, 'font-size': 13, 'font-weight': 500 }, yLabel, BOX.right - BOX.left);
  chart.markerY = 14 + (caption.lines - 1) * 16 + 20;
  BOX.top = chart.markerY + 28;
  chart.clipRect.setAttribute('y', BOX.top - 1);
  chart.clipRect.setAttribute('height', BOX.bottom - BOX.top + 2);
  const x = makeScale(xDomain, BOX.left, BOX.right);
  const y = makeScale(yDomain, BOX.bottom, BOX.top);
  yDomain.ticks.forEach(tick => {
    append(svg, 'line', { x1: BOX.left, x2: BOX.right, y1: y(tick), y2: y(tick), stroke: COLORS.grid, 'stroke-width': 1 });
    append(svg, 'text', { x: BOX.left - 8, y: y(tick) + 4, 'text-anchor': 'end', fill: COLORS.muted, 'font-size': 13 }, compact(tick));
  });
  xDomain.ticks.forEach(tick => {
    append(svg, 'line', { x1: x(tick), x2: x(tick), y1: BOX.bottom, y2: BOX.bottom + 4, stroke: '#ccd2cd' });
    append(svg, 'text', { x: x(tick), y: BOX.bottom + 19, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 13 }, xFormat(tick));
  });
  append(svg, 'line', { x1: BOX.left, x2: BOX.right, y1: BOX.bottom, y2: BOX.bottom, stroke: '#ccd2cd' });
  const axisCaption = wrappedText(svg, { x: (BOX.left + BOX.right) / 2, y: chart.accounting ? height - 22 : height - 20, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 13, 'font-weight': 500 }, xLabel, BOX.right - BOX.left);
  if (axisCaption.lines > 2) {
    const extra = (axisCaption.lines - 2) * 16;
    svg.setAttribute('viewBox', `0 0 ${chart.width} ${height + extra}`);
    svg.setAttribute('height', height + extra);
  }
  return { x, y };
}

function path(chart, points, x, y, color, valid = () => true, dashed = false) {
  let data = '';
  let connected = false;
  points.forEach(point => {
    if (!valid(point) || !finite(point.x) || !finite(point.y)) { connected = false; return; }
    data += `${connected ? 'L' : 'M'}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)} `;
    connected = true;
  });
  if (data) append(chart.svg, 'path', { d: data, fill: 'none', stroke: color, 'stroke-width': 2.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': dashed ? '7 5' : null, 'clip-path': `url(#${chart.clipId})` });
}

function marker(chart, x, label) {
  if (!finite(x)) return;
  const { box: BOX } = chart;
  append(chart.svg, 'line', { x1: x, x2: x, y1: BOX.top, y2: BOX.bottom, stroke: COLORS.ink, 'stroke-width': 1.2, 'stroke-dasharray': '4 5', opacity: 0.6 });
  // The label has its own line above the plot, away from the y-axis caption.
  // Keep the caption inside the plot width even when the chosen point is central.
  wrappedText(chart.svg, { x: BOX.left, y: chart.markerY, fill: COLORS.ink, 'font-size': 13, 'font-weight': 600 }, label, BOX.right - BOX.left);
}

function selectedDot(chart, x, y, color) {
  append(chart.svg, 'circle', { cx: x, cy: y, r: 5, fill: '#fff', stroke: color, 'stroke-width': 2.6, 'pointer-events': 'none' });
}

function empty(chart, message) {
  wrappedText(chart.svg, { x: chart.width / 2, y: 114, fill: COLORS.muted, 'font-size': 14, 'text-anchor': 'middle' }, message, chart.width - 36, 20);
}

/** Utility profit along the capacity frontier; infeasible offers are gaps. */
export function renderCapacityChart(el, curve = [], selected = {}, p = {}) {
  const u = units(p);
  const chart = makeChart(el, 'Utility profit across capacity choices', 'The teal curve shows feasible offers. The dashed vertical marker identifies the chosen capacity. Zero is the utility no-deal payoff.');
  const { box: BOX } = chart;
  const good = curve.filter(d => d.feasible !== false && finite(d.c) && finite(d.profit));
  const xDomain = niceDomain([...curve.map(d => d.c), selected.c]);
  const yDomain = niceDomain([...good.map(d => d.profit), ...(selected.feasible !== false && finite(selected.profit) ? [selected.profit] : [])]);
  const { x, y } = axes(chart, xDomain, yDomain, `Capacity c (${u.capacity})`, `Utility profit (${u.money} / period)`);
  append(chart.svg, 'line', { x1: BOX.left, x2: BOX.right, y1: y(0), y2: y(0), stroke: '#99a5a0', 'stroke-width': 1.2, 'stroke-dasharray': '3 4' });
  append(chart.svg, 'text', { x: BOX.right - 2, y: y(0) - 6, 'text-anchor': 'end', fill: COLORS.muted, 'font-size': 13 }, 'No deal = 0');
  path(chart, curve.map(d => ({ ...d, x: d.c, y: d.profit })), x, y, COLORS.teal, d => d.feasible !== false);
  if (finite(selected.c)) marker(chart, x(selected.c), `Chosen c = ${fmt(selected.c)}${selected.feasible === false ? ' · infeasible' : ''}`);
  good.forEach(d => chart.point(x(d.c), y(d.profit), `Capacity c: ${fmt(d.c)} ${u.capacity}\nUtility profit: ${fmt(d.profit, 2)} ${u.money} / period\nTake-or-pay α: ${pct(d.alpha)}${finite(d.expectedServed) ? `\nExpected use: ${fmt(d.expectedServed)} ${u.capacity}` : ''}`, COLORS.teal));
  if (selected.feasible !== false && finite(selected.c) && finite(selected.profit)) {
    selectedDot(chart, x(selected.c), y(selected.profit), COLORS.teal);
    chart.point(x(selected.c), y(selected.profit), `Chosen offer\nCapacity c: ${fmt(selected.c)} ${u.capacity}\nUtility profit: ${fmt(selected.profit, 2)} ${u.money} / period\nTake-or-pay α: ${pct(selected.alpha)}`, COLORS.teal);
  }
  if (!good.length) empty(chart, 'No feasible positive-capacity offers in this range.');
  return chart.svg;
}

/** Optimal utility capacity as regulatory recovery permission changes. */
export function renderRecoveryChart(el, sweep = [], selected = {}, p = {}) {
  const u = units(p);
  const chart = makeChart(el, 'Optimal capacity as recovery permission changes', 'Each point re-solves the utility offer at a different recovery share gamma. The purple line may jump when the preferred offer changes. The vertical marker is the current recovery rule.');
  const xDomain = { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const yDomain = niceDomain([...sweep.map(d => d.c), selected.feasible !== false ? selected.c : 0]);
  const { x, y } = axes(chart, xDomain, yDomain, 'Recovery permission γ', `Optimal capacity (${u.capacity})`, pct);
  path(chart, sweep.map(d => ({ ...d, x: d.gamma, y: d.c })), x, y, COLORS.purple);
  const gamma = finite(p.gamma) ? p.gamma : selected.gamma;
  if (finite(gamma)) marker(chart, x(gamma), `Current γ = ${pct(gamma)}`);
  sweep.filter(d => finite(d.gamma) && finite(d.c)).forEach(d => chart.point(x(d.gamma), y(d.c), `Recovery permission γ: ${pct(d.gamma)}\nOptimal capacity: ${fmt(d.c)} ${u.capacity}\nUtility profit: ${fmt(d.profit, 2)} ${u.money} / period\nRatepayer transfer: ${fmt(d.transfer, 2)} ${u.money} / period${d.status ? `\nOutcome: ${d.status.replace(/[-_]/g, ' ')}` : ''}`, COLORS.purple));
  // The current custom offer need not be an optimum, so do not draw it on this frontier.
  const nearest = sweep.filter(d => finite(d.gamma) && finite(d.c)).reduce((best, d) => !best || Math.abs(d.gamma - gamma) < Math.abs(best.gamma - gamma) ? d : best, null);
  if (nearest && finite(gamma) && Math.abs(nearest.gamma - gamma) < 1e-8) selectedDot(chart, x(nearest.gamma), y(nearest.c), COLORS.purple);
  if (!sweep.some(d => finite(d.c))) empty(chart, 'No optimization results available.');
  return chart.svg;
}

/** Demand-realization view: physical use and the contracted billing floor. */
export function renderDemandChart(el, curve = [], selected = {}, p = {}) {
  const u = units(p);
  const chart = makeChart(el, 'Physical demand served and billed quantity', 'The solid teal line is served demand, capped by capacity. The dashed orange line is billed quantity. When use falls below alpha times capacity, the data center still pays the contractual floor. Shading identifies the assumed demand support; curve portions outside it illustrate the contract, but do not enter expected payoffs.');
  const { box: BOX } = chart;
  if (selected.feasible === false) {
    empty(chart, 'This offer is infeasible; realized outcomes are unavailable.');
    return chart.svg;
  }
  const xDomain = niceDomain(curve.map(d => d.demand));
  const yDomain = niceDomain([...curve.map(d => d.served), ...curve.map(d => d.billed), selected.c]);
  const support = curve.filter(d => d.inSupport);
  const { x, y } = axes(chart, xDomain, yDomain, `Demand Y (${u.capacity})`, `Served / billed (${u.capacity})${support.length ? ' · shade = demand support' : ''}`);
  if (support.length) {
    const supportLow = Math.min(...support.map(d => d.demand));
    const supportHigh = Math.max(...support.map(d => d.demand));
    append(chart.svg, 'rect', { x: x(supportLow), y: BOX.top, width: Math.max(2, x(supportHigh) - x(supportLow)), height: BOX.bottom - BOX.top, fill: '#dce6df', opacity: 0.36, 'pointer-events': 'none' });
  }
  const floor = selected.alpha * selected.c;
  if (finite(floor) && floor > 0) {
    append(chart.svg, 'rect', { x: BOX.left, y: y(floor), width: Math.max(0, x(Math.min(floor, xDomain.max)) - BOX.left), height: Math.max(0, y(0) - y(floor)), fill: COLORS.orange, opacity: 0.065 });
    append(chart.svg, 'text', { x: BOX.left + 7, y: Math.min(BOX.bottom - 7, y(floor) + 18), fill: COLORS.orange, 'font-size': 13, 'font-weight': 600 }, `Floor αc = ${fmt(floor)}`);
  }
  path(chart, curve.map(d => ({ x: d.demand, y: d.served })), x, y, COLORS.teal);
  path(chart, curve.map(d => ({ x: d.demand, y: d.billed })), x, y, COLORS.orange, () => true, true);
  if (finite(selected.c) && selected.c <= xDomain.max) marker(chart, x(selected.c), `Capacity c = ${fmt(selected.c)}`);
  curve.filter(d => finite(d.demand) && finite(d.served) && finite(d.billed)).forEach(d => chart.point(x(d.demand), y(d.billed), `Demand: ${fmt(d.demand)} ${u.capacity}${d.inSupport === false ? '\nOutside assumed demand support' : ''}\nServed: ${fmt(d.served)} ${u.capacity}\nBilled: ${fmt(d.billed)} ${u.capacity}\nDC payment: ${fmt(d.payment, 2)} ${u.money}${selected.status === 'no-build' ? `\nNo build: DC takes outside option ${fmt(selected.dcPayoff, 2)}` : finite(d.dcPayoff) ? `\nDC payoff: ${fmt(d.dcPayoff, 2)} ${u.money}` : ''}`, COLORS.orange));
  if (!curve.length) empty(chart, 'No realized-demand values available.');
  return chart.svg;
}

/** Expected monetary flows reconcile to actual utility economic profit. */
export function renderAccountingChart(el, selected = {}, p = {}) {
  const u = units(p);
  const chart = makeChart(el, 'Utility profit accounting', 'Incoming data center payment and ratepayer recovery, less operating and true capital costs, equal utility profit. Each bar is an expected amount per period. Allowed return is a constraint, not an extra revenue stream.', true);
  const { box: BOX } = chart;
  if (selected.feasible === false) {
    empty(chart, 'This offer is infeasible; profit accounting is unavailable.');
    return chart.svg;
  }
  const capitalCost = finite(selected.capitalCost) ? selected.capitalCost
    : finite(p.r) && finite(selected.rateBase) ? p.r * selected.rateBase
    : selected.payment + selected.transfer - selected.operatingCost - selected.profit;
  const values = [selected.payment, selected.transfer, selected.operatingCost, capitalCost, selected.profit];
  if (!values.every(finite)) {
    empty(chart, 'Profit components are unavailable for this outcome.');
    return chart.svg;
  }
  const data = [
    { label: chart.width < 440 ? 'DC bill' : 'DC payment', detail: 'Expected data center payment', value: selected.payment, color: COLORS.teal },
    { label: chart.width < 440 ? 'Bills T' : 'Ratepayers T', detail: 'Expected recovery from other ratepayers', value: selected.transfer, color: COLORS.purple },
    { label: chart.width < 440 ? 'Op. cost' : 'Operating cost', detail: 'Expected operating cost', value: -selected.operatingCost, color: COLORS.orange },
    { label: chart.width < 440 ? 'rK cost' : 'Capital rK', detail: 'True capital cost, r × rate base', value: -capitalCost, color: COLORS.orange },
    { label: 'Profit ΠU', detail: 'Actual utility economic profit', value: selected.profit, color: COLORS.ink, total: true },
  ];
  let balance = 0;
  data.forEach(d => {
    d.start = d.total ? 0 : balance;
    d.end = d.total ? d.value : balance + d.value;
    if (!d.total) balance = d.end;
  });
  const yDomain = niceDomain(data.flatMap(d => [d.start, d.end]));
  const { y } = axes(chart, { min: 0, max: 5, ticks: [] }, yDomain, 'Expected monetary flows per period', `Amount (${u.money} / period)`);
  const slot = (BOX.right - BOX.left) / data.length;
  const barWidth = Math.min(68, slot * 0.66);
  data.forEach((d, i) => {
    const cx = BOX.left + slot * (i + 0.5);
    const top = Math.min(y(d.start), y(d.end));
    const height = Math.max(2, Math.abs(y(d.start) - y(d.end)));
    const bar = append(chart.svg, 'rect', { x: cx - barWidth / 2, y: top, width: barWidth, height, rx: 3, fill: d.color, opacity: d.total ? 1 : 0.88 });
    const valueLabel = `${!d.total && d.value > 0 ? '+' : ''}${fmt(d.value, 1)}`;
    append(chart.svg, 'text', { x: cx, y: Math.max(BOX.top + 13, top - 7), 'text-anchor': 'middle', fill: COLORS.ink, 'font-size': 13, 'font-weight': 600 }, `${!d.total && d.value > 0 ? '+' : ''}${compact(d.value)}`);
    wrappedText(chart.svg, { x: cx, y: BOX.bottom + 19, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 13 }, d.label, slot - 4, 15);
    if (i < data.length - 2) append(chart.svg, 'line', { x1: cx + barWidth / 2, x2: cx + slot - barWidth / 2, y1: y(d.end), y2: y(d.end), stroke: '#abb5ad', 'stroke-dasharray': '3 3' });
    chart.interactive(bar, cx, top, `${d.detail}\n${valueLabel} ${u.money} / period${d.total ? '' : `\nRunning balance: ${fmt(d.end, 2)} ${u.money}`}`, d.color);
  });
  return chart.svg;
}
