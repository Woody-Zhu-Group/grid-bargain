# Grid Bargain

An interactive research portal for our ongoing paper titled `Strategic Capacity Requests as a Cap on Regulated Utility Investment`.

## Run

No installation or build is required. Start the local preview server:

```sh
python3 serve.py
```

Open http://127.0.0.1:4173. This preview server disables caching so browser reloads pick up edits. The `dist` directory also works with any static host. JavaScript modules require HTTP; opening `index.html` directly is not supported. Run mathematical checks with Node 18+:

```sh
node --test tests/model.test.mjs
```

## Model

The regulator sets recovery permission γ and allowed return ρ. Conditional on policy and exogenous eligible capacity c̄, the utility chooses minimum-bill share α and capacity c. The data center accepts if its expected payoff meets its outside option. Other ratepayers are affected stakeholders with no strategic choice in the baseline.

- Served demand: x=min(Y,c)
- Bill: P=q max(x,αc)
- Net contribution: M=E[P−C(x)]
- Recovery: T=γ(ρK−M), for feasible contracts only
- Utility objective: (1−γ)M+(γρ−r)K
- Constraints: E[V(x)−P]≥outside, M≤ρK, 0≤α≤1, 0≤c≤c̄

Illustrative closure (not specified or estimated in the draft): uniform demand, linear V and C, quadratic investment K(c)=kc+½hc². All parameters are adjustable. Monetary/capacity units are normalized; r,ρ and monetary flows share one model period. Depreciation is not separately modeled. Recovery is expected, not state contingent.

The no-build alternative gives the utility zero, zero transfer, and the data center its outside option. This is explicitly separate from an accepted c=0 contract. Infeasible offers return null for implemented profit and transfer. Conditional α is optimized analytically; capacity uses a 600-point global grid, feasible-boundary bisection and local refinement. Capacity optimum is approximate. At γ=1, the smallest α breaks ties; smaller capacity breaks positive-profit ties, and no-build wins zero-profit ties. Policy comparative statics are calculated, never imposed.

## Files

- `dist/model.mjs`: pure numerical model and curve generation
- `dist/app.mjs`: state, interactive party controls, scenario presets, result interpretation, JSON export
- `dist/charts.mjs`: dependency-free SVG plots with mouse/keyboard inspection
- `dist/index.html`, `dist/styles.css`: responsive portal
- `tests/model.test.mjs`: analytic expectations, constraints, accounting, boundary cases and optimization checks

“Try an offer” is a proposed contract, not a solved equilibrium. The sensitivity/frontier charts continue to re-optimize the utility offer. The regulator has no objective in this draft, so the app does not solve an optimal-regulation problem.
