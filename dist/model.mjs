/**
 * Illustrative implementation of equation (7) in the project draft.
 *
 * Y ~ Uniform[mean(1-spread), mean(1+spread)], V(x)=v*x,
 * C(x)=o*x, K(c)=k*c+h*c*c/2. All monetary flows share one period.
 * These functional forms and parameter values illustrate the draft; they are
 * assumptions of this laboratory, not estimates or extra claims in the paper.
 * Conditional on capacity, alpha is optimized analytically. Capacity is solved
 * approximately using a global grid and local bounded refinement.
 */

export const DEFAULTS = Object.freeze({
  gamma: 0.5, rho: 0.10, r: 0.06, cap: 160, q: 1,
  mean: 80, spread: 0.65, v: 1.6, o: 0.2, k: 8, h: 0.02,
  outside: 20,
});

const CAPACITY_STEPS = 600;
const REFINEMENT_STEPS = 40;
const EPS = 1e-9;

function parameters(input = {}) {
  const p = { ...DEFAULTS, ...input };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isFinite(p[key]) || p[key] < 0) {
      throw new RangeError(`${key} must be a finite, nonnegative number.`);
    }
  }
  if (p.gamma > 1 || p.spread > 1) {
    throw new RangeError('gamma and spread must be between zero and one.');
  }
  return p;
}

function checkOffer(c, alpha = 0) {
  if (!Number.isFinite(c) || c < 0) throw new RangeError('Capacity must be finite and nonnegative.');
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('alpha must be between zero and one.');
}

function tolerance(...values) {
  return EPS * Math.max(1, ...values.map(Math.abs));
}

function served(c, p) {
  const a = p.mean * (1 - p.spread);
  const b = p.mean * (1 + p.spread);
  if (b === a) return Math.min(c, p.mean);
  if (c <= a) return c;
  if (c >= b) return p.mean;
  return c - (c - a) ** 2 / (2 * (b - a));
}

function billed(c, alpha, p, s = served(c, p)) {
  const floor = alpha * c;
  const a = p.mean * (1 - p.spread);
  const b = p.mean * (1 + p.spread);
  if (b === a) return Math.max(s, floor);
  if (floor <= a) return s;
  if (floor >= b) return s + floor - p.mean;
  return s + (floor - a) ** 2 / (2 * (b - a));
}

/** Expected actual service E[min(Y,c)], in capacity/energy units. */
export function expectedServed(c, input = {}) {
  checkOffer(c);
  return served(c, parameters(input));
}

/** Expected billed quantity E[max(min(Y,c),alpha*c)], before multiplying by q. */
export function expectedBilled(c, alpha, input = {}) {
  checkOffer(c, alpha);
  return billed(c, alpha, parameters(input));
}

function evaluateOffer(c, alpha, p) {
  const expectedServed = served(c, p);
  const expectedBilled = billed(c, alpha, p, expectedServed);
  const payment = p.q * expectedBilled;
  const operatingCost = p.o * expectedServed;
  const rateBase = p.k * c + 0.5 * p.h * c * c;
  const capitalCost = p.r * rateBase;
  const allowedReturn = p.rho * rateBase;
  const margin = payment - operatingCost;
  const dcValue = p.v * expectedServed;
  const dcPayoff = dcValue - payment;
  const regulatorySlack = allowedReturn - margin;
  const participationSlack = dcPayoff - p.outside;
  const regulatoryFeasible = regulatorySlack >= -tolerance(allowedReturn, margin);
  const participationFeasible = participationSlack >= -tolerance(dcPayoff, p.outside);
  const capacityFeasible = c <= p.cap + tolerance(c, p.cap);
  const feasible = regulatoryFeasible && participationFeasible && capacityFeasible;
  // Infeasible offers have no realized transfer or profit. In particular, a
  // negative recovery gap is NOT repaired by clamping the transfer to zero.
  const transfer = feasible ? p.gamma * Math.max(0, regulatorySlack) : null;
  // Use the algebraically identical reduced objective to preserve exact endpoint
  // identities (notably gamma=1 and rho=r) despite floating-point subtraction.
  const profit = feasible ? (1 - p.gamma) * margin + (p.gamma * p.rho - p.r) * rateBase : null;
  return {
    c, alpha, expectedServed, expectedBilled, payment, operatingCost,
    rateBase, capitalCost, allowedReturn, margin, transfer, profit,
    dcValue, dcPayoff, regulatorySlack, participationSlack,
    regulatoryFeasible, participationFeasible, capacityFeasible, feasible,
    utilization: c > 0 ? expectedServed / c : 0,
    expectedUnserved: Math.max(0, p.mean - expectedServed),
    retainedReturn: feasible ? margin + transfer : null,
  };
}

/** Evaluate a proposed offer. Null transfer/profit means the offer is infeasible. */
export function evaluate(c, alpha, input = {}) {
  checkOffer(c, alpha);
  return evaluateOffer(c, alpha, parameters(input));
}

function alphaForBilling(target, c, s, p) {
  if (c === 0 || target <= s + tolerance(s, target)) return 0;
  const extra = target - s;
  const a = p.mean * (1 - p.spread);
  const b = p.mean * (1 + p.spread);
  let floor;
  if (b === a) floor = target;
  else if (extra <= (b - a) / 2) floor = a + Math.sqrt(2 * (b - a) * extra);
  else floor = p.mean + extra;
  return Math.max(0, Math.min(1, floor / c));
}

/** Best accepted and regulatory-feasible alpha at one capacity, if one exists. */
function bestAtCapacity(c, p) {
  const base = evaluateOffer(c, 0, p);
  if (!base.feasible) return { ...base, status: 'infeasible' };
  // With full recovery, utility profit is independent of alpha. Choose the
  // smallest alpha among tied offers, as also when payment is identically zero.
  if (p.gamma === 1 || p.q === 0 || c === 0) return { ...base, status: 'feasible' };
  const maxPayment = Math.min(
    p.q * c,
    base.allowedReturn + base.operatingCost,
    base.dcValue - p.outside,
  );
  const targetBilling = Math.max(base.expectedServed, maxPayment / p.q);
  const alpha = alphaForBilling(targetBilling, c, base.expectedServed, p);
  return { ...evaluateOffer(c, alpha, p), status: 'feasible' };
}

function noBuild(p, reason, diagnostics) {
  return {
    c: 0, alpha: 0, expectedServed: 0, expectedBilled: 0, payment: 0,
    operatingCost: 0, rateBase: 0, capitalCost: 0, allowedReturn: 0,
    margin: 0, transfer: 0, profit: 0, dcValue: 0, dcPayoff: p.outside,
    regulatorySlack: 0, participationSlack: 0, regulatoryFeasible: true,
    participationFeasible: true, capacityFeasible: true, feasible: true,
    utilization: 0, expectedUnserved: p.mean, retainedReturn: 0,
    status: 'no-build', built: false, reason, diagnostics,
    bindingConstraints: [],
  };
}

function bindingConstraints(result, p) {
  const near = (x, scale) => Math.abs(x) <= 1e-5 * Math.max(1, Math.abs(scale));
  const constraints = [];
  if (near(result.regulatorySlack, result.allowedReturn)) constraints.push('allowed-return');
  if (near(result.participationSlack, p.outside)) constraints.push('participation');
  if (near(p.cap - result.c, p.cap)) constraints.push('capacity-cap');
  if (near(1 - result.alpha, 1)) constraints.push('billing-floor-upper');
  return constraints;
}

function solveGame(p) {
  const diagnostics = {
    approximate: true,
    capacitySteps: CAPACITY_STEPS,
    capacityResolution: p.cap / CAPACITY_STEPS,
    localRefinementSteps: REFINEMENT_STEPS,
    alphaMethod: 'analytic conditional optimum; smallest alpha on ties',
    capacityMethod: 'global grid, feasible-boundary bisection, local bounded refinement',
    assumptions: 'Uniform demand; linear value and operating cost; quadratic rate base.',
  };
  if (p.cap === 0) return noBuild(p, 'No capacity is eligible for investment.', diagnostics);

  // For these particular functional forms and nonnegative outside options, the
  // positive-capacity feasible set is an upper interval (or empty). E[x]/c is
  // nonincreasing, K/c nondecreasing, and participation is monotone whenever
  // positive service can be accepted. Include its boundary to retain very
  // narrow feasible regions that an ordinary grid would otherwise miss.
  const capOffer = bestAtCapacity(p.cap, p);
  if (!capOffer.feasible) {
    return noBuild(p, 'No positive-capacity offer satisfies both participation and the allowed-return constraint.', diagnostics);
  }
  let low = 0;
  let high = p.cap;
  for (let iteration = 0; iteration < 60; iteration++) {
    const middle = (low + high) / 2;
    if (bestAtCapacity(middle, p).feasible) high = middle;
    else low = middle;
  }
  const feasibleStart = high;
  diagnostics.feasibleCapacityMin = feasibleStart;
  let best = noBuild(p, 'Every feasible investment yields nonpositive utility profit.', diagnostics);
  const consider = result => {
    if (!result.feasible || result.c === 0 || result.profit === null) return;
    // Profit can be near zero after subtracting much larger monetary flows.
    // Use their scale, as feasibility does, so its rounding allowance cannot
    // turn a break-even contract into an apparent gain over no build.
    const tieTolerance = tolerance(
      result.profit, best.profit,
      result.margin, result.allowedReturn, result.capitalCost,
      best.margin, best.allowedReturn, best.capitalCost,
    );
    if (result.profit > best.profit + tieTolerance ||
      (result.profit > tieTolerance && Math.abs(result.profit - best.profit) <= tieTolerance &&
       (result.c < best.c - tolerance(result.c, best.c) ||
        (Math.abs(result.c - best.c) <= tolerance(result.c, best.c) && result.alpha < best.alpha)))) {
      best = result;
    }
  };
  const grid = [];
  for (let i = 0; i <= CAPACITY_STEPS; i++) {
    const offer = bestAtCapacity(p.cap * i / CAPACITY_STEPS, p);
    grid.push(offer);
    consider(offer);
  }
  const critical = [feasibleStart, p.mean * (1 - p.spread), p.mean * (1 + p.spread), p.cap];
  for (const c of critical) if (c >= feasibleStart && c <= p.cap) consider(bestAtCapacity(c, p));

  const score = c => {
    const offer = bestAtCapacity(c, p);
    consider(offer);
    return offer.feasible && offer.profit !== null ? offer.profit : -Infinity;
  };
  const refine = (left, right) => {
    left = Math.max(left, feasibleStart);
    if (right <= left) return;
    const ratio = (Math.sqrt(5) - 1) / 2;
    let x1 = right - ratio * (right - left);
    let x2 = left + ratio * (right - left);
    let f1 = score(x1);
    let f2 = score(x2);
    for (let i = 0; i < REFINEMENT_STEPS; i++) {
      if (f1 >= f2) {
        right = x2; x2 = x1; f2 = f1;
        x1 = right - ratio * (right - left); f1 = score(x1);
      } else {
        left = x1; x1 = x2; f1 = f2;
        x2 = left + ratio * (right - left); f2 = score(x2);
      }
    }
    score((left + right) / 2);
  };
  for (let i = 1; i < CAPACITY_STEPS; i++) {
    const point = grid[i];
    if (!point.feasible) continue;
    const before = grid[i - 1].profit ?? -Infinity;
    const after = grid[i + 1].profit ?? -Infinity;
    if (point.profit >= before && point.profit >= after &&
      (point.profit > before || point.profit > after)) {
      refine(grid[i - 1].c, grid[i + 1].c);
    }
  }
  refine(feasibleStart, Math.min(p.cap, feasibleStart + p.cap / CAPACITY_STEPS));
  if (best.status === 'no-build') return best;
  return {
    ...best, status: 'built', built: true,
    reason: 'Best feasible offer found; the data center accepts and utility profit exceeds its no-build option.',
    diagnostics, bindingConstraints: bindingConstraints(best, p),
  };
}

/** Solve the utility offer game, allowing the utility to choose no deal for zero profit. */
export function solve(input = {}) {
  return solveGame(parameters(input));
}

/** Capacity-profit frontier, optimizing alpha separately at each capacity. */
export function capacityCurve(input = {}) {
  const p = parameters(input);
  return Array.from({ length: 161 }, (_, i) => bestAtCapacity(p.cap * i / 160, p));
}

/** Re-solve the entire game at 41 recovery permissions; do not impose monotonicity. */
export function recoverySweep(input = {}) {
  const p = parameters(input);
  return Array.from({ length: 41 }, (_, i) => {
    const gamma = i / 40;
    return { gamma, ...solveGame({ ...p, gamma }) };
  });
}

/**
 * State-contingent service and bills over an illustrative realized-demand range.
 * Include the exact bill/service kinks and mark the probabilistic demand support.
 * The extra plotted states do not change expectations used by the game.
 */
export function demandCurve(c, alpha, input = {}) {
  checkOffer(c, alpha);
  const p = parameters(input);
  const a = p.mean * (1 - p.spread);
  const b = p.mean * (1 + p.spread);
  const plotMax = 1.08 * Math.max(c, b);
  const samples = plotMax === 0 ? [0] : Array.from({ length: 101 }, (_, i) => plotMax * i / 100);
  const points = [...new Set([...samples, a, b, alpha * c, c])].sort((x, y) => x - y);
  return points.map(demand => {
    const actual = Math.min(demand, c);
    const bill = Math.max(actual, alpha * c);
    return {
      demand, served: actual, billed: bill, payment: p.q * bill,
      dcPayoff: p.v * actual - p.q * bill,
      inSupport: demand >= a && demand <= b,
    };
  });
}
