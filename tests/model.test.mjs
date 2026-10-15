import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, expectedServed, expectedBilled, evaluate, solve,
  capacityCurve, recoverySweep, demandCurve,
} from '../dist/model.mjs';

const close = (actual, expected, atol = 1e-7) => assert.ok(
  Math.abs(actual - expected) <= atol,
  `${actual} differs from ${expected} by more than ${atol}`,
);

test('uniform expectations match independent midpoint integration', () => {
  const n = 20000;
  for (const spread of [0, 0.4, 1]) {
    const p = { ...DEFAULTS, mean: 75, spread };
    for (const c of [0, 20, 75, 180]) {
      for (const alpha of [0, 0.3, 1]) {
        let actual = 0;
        let billed = 0;
        for (let i = 0; i < n; i++) {
          const y = p.mean * (1 - spread) + 2 * p.mean * spread * (i + 0.5) / n;
          const x = Math.min(y, c);
          actual += x / n;
          billed += Math.max(x, alpha * c) / n;
        }
        close(expectedServed(c, p), actual, 2e-6);
        close(expectedBilled(c, alpha, p), billed, 2e-6);
      }
    }
  }
});

test('reduced profit equals primitive revenue minus actual capital and operating costs', () => {
  const p = { ...DEFAULTS };
  const result = evaluate(120, 0.5, p);
  assert.equal(result.feasible, true);
  close(result.transfer, p.gamma * (p.rho * result.rateBase - result.margin));
  close(result.profit, (1 - p.gamma) * result.margin + (p.gamma * p.rho - p.r) * result.rateBase);
  close(result.profit, result.payment + result.transfer - result.operatingCost - p.r * result.rateBase);
  close(result.profit + result.dcPayoff - result.transfer,
    (p.v - p.o) * result.expectedServed - p.r * result.rateBase);
  assert.ok(result.retainedReturn <= result.allowedReturn + 1e-7);
});

test('regulatory violations remain infeasible even when recovery is zero', () => {
  const result = evaluate(40, 1, { ...DEFAULTS, gamma: 0, rho: 0.001 });
  assert.equal(result.regulatoryFeasible, false);
  assert.equal(result.feasible, false);
  assert.equal(result.transfer, null);
  assert.equal(result.profit, null);
});

test('conditional alpha respects both constraints and does not leave profitable room', () => {
  const p = { ...DEFAULTS, gamma: 0.4 };
  for (const offer of capacityCurve(p)) {
    if (!offer.feasible || offer.c === 0) continue;
    const maximumPayment = Math.min(p.q * offer.c,
      p.rho * offer.rateBase + offer.operatingCost,
      p.v * offer.expectedServed - p.outside);
    close(offer.payment, maximumPayment, 1e-6);
    assert.ok(offer.dcPayoff >= p.outside - 1e-6);
    assert.ok(offer.margin <= p.rho * offer.rateBase + 1e-6);
  }
});

test('full recovery chooses eligible capacity and smallest tied alpha', () => {
  const result = solve({ ...DEFAULTS, gamma: 1 });
  assert.equal(result.status, 'built');
  close(result.c, DEFAULTS.cap);
  close(result.alpha, 0);
  close(result.profit, (DEFAULTS.rho - DEFAULTS.r) * result.rateBase);
});

test('zero regulated spread under full recovery selects no build on a profit tie', () => {
  const result = solve({ ...DEFAULTS, gamma: 1, rho: DEFAULTS.r });
  assert.equal(result.status, 'no-build');
  close(result.profit, 0);
  close(result.dcPayoff, DEFAULTS.outside);
});

test('zero regulated spread selects no build at every recovery permission', () => {
  // For rho=r, feasibility implies profit=(1-gamma)*(margin-r*K)<=0.
  // Feasibility rounding at the boundary must not create profitable building.
  for (const result of recoverySweep({ ...DEFAULTS, rho: DEFAULTS.r })) {
    assert.equal(result.status, 'no-build', `gamma=${result.gamma}`);
    close(result.c, 0);
    close(result.profit, 0);
    close(result.transfer, 0);
    close(result.dcPayoff, DEFAULTS.outside);
  }
});

test('no deal is available when the DC outside option makes every contract unacceptable', () => {
  const p = { ...DEFAULTS, outside: 10000 };
  assert.equal(evaluate(0, 0, p).participationFeasible, false);
  const result = solve(p);
  assert.equal(result.status, 'no-build');
  assert.equal(result.feasible, true);
  close(result.c, 0);
  close(result.profit, 0);
  close(result.transfer, 0);
  close(result.dcPayoff, p.outside);
});

test('capacity optimizer dominates an independent two-dimensional feasible mesh', () => {
  for (const overrides of [
    {}, { gamma: 0 }, { gamma: 0.3, q: 1.7 },
    { gamma: 0.8, outside: 90 }, { spread: 0, cap: 130 },
  ]) {
    const p = { ...DEFAULTS, ...overrides };
    const optimum = solve(p);
    let meshBest = 0;
    for (let i = 0; i <= 200; i++) {
      for (let j = 0; j <= 100; j++) {
        const offer = evaluate(p.cap * i / 200, j / 100, p);
        if (offer.feasible) meshBest = Math.max(meshBest, offer.profit);
      }
    }
    assert.ok(optimum.profit >= meshBest - 1e-5, `${optimum.profit} < mesh optimum ${meshBest}`);
    assert.equal(optimum.diagnostics.approximate, true);
    assert.ok(optimum.diagnostics.capacitySteps >= 500);
    if (optimum.built) {
      assert.equal(evaluate(optimum.c, optimum.alpha, p).feasible, true);
    }
  }
});

test('a narrow feasible interval is not lost between grid points', () => {
  const p = { ...DEFAULTS, v: 2.4, spread: 0, mean: 200, cap: 160, outside: 223.9999 };
  const result = solve(p);
  assert.equal(result.status, 'built');
  assert.ok(result.c > 159.99 && result.c <= 160);
  assert.ok(result.dcPayoff >= p.outside - 1e-6);
});

test('recovery sweep re-solves feasible choices and exposes both endpoints', () => {
  const sweep = recoverySweep();
  assert.equal(sweep.length, 41);
  assert.equal(sweep[0].gamma, 0);
  assert.equal(sweep.at(-1).gamma, 1);
  for (const result of sweep) {
    assert.ok(result.profit >= -1e-7);
    if (result.built) {
      assert.ok(result.dcPayoff >= DEFAULTS.outside - 1e-6);
      assert.ok(result.margin <= DEFAULTS.rho * result.rateBase + 1e-6);
    }
  }
});

test('zero-capacity, zero-demand, deterministic-demand and zero-price cases remain finite', () => {
  for (const overrides of [{ cap: 0 }, { mean: 0, outside: 0 }, { spread: 0 }, { q: 0 }]) {
    const result = solve({ ...DEFAULTS, ...overrides });
    for (const key of ['c', 'alpha', 'profit', 'transfer', 'dcPayoff', 'utilization']) {
      assert.equal(Number.isFinite(result[key]), true, key);
    }
  }
  const curve = demandCurve(90, 0.5, { ...DEFAULTS, spread: 0 });
  const deterministicState = curve.find(point => point.demand === DEFAULTS.mean);
  close(deterministicState.payment, 80);
  assert.equal(deterministicState.inSupport, true);
  assert.equal(curve.filter(point => point.inSupport).length, 1);
  close(curve[0].demand, 0);
  close(curve.at(-1).demand, 1.08 * 90);
  assert.ok(curve.some(point => point.demand === 45));
  assert.ok(curve.some(point => point.demand === 90));
});

test('invalid assumptions fail explicitly instead of silently changing the game', () => {
  assert.throws(() => solve({ gamma: 1.1 }), RangeError);
  assert.throws(() => solve({ spread: -1 }), RangeError);
  assert.throws(() => expectedServed(-1), RangeError);
  assert.throws(() => expectedBilled(10, 2), RangeError);
});
