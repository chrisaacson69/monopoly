# Monopoly AI

A mathematically rigorous Monopoly AI built on Markov chain probability analysis, financial valuation theory, and evolutionary optimization.

## What It Does

This project computes exact landing probabilities for all 40 board squares using a 43-state Markov chain (validated within 0.05% of Monte Carlo simulation over 2M turns), then uses those probabilities to derive Earnings Per Turn (EPT) valuations for every property at every development level. On top of that foundation sits a trading AI that was iteratively developed through tournament play and genetic algorithm optimization, culminating in a bot that wins 36% of 4-player games (vs. 25% baseline).

## Project Structure

```
Monopoly/
├── ai/                  # Shared core engine
│   ├── markov-engine.js       # 43-state Markov chain (doubles, jail, cards)
│   ├── property-valuator.js   # EPT, ROI, and investment rankings
│   └── monte-carlo-sim.js     # Monte Carlo validation
├── player/              # Game-facing AI
│   ├── monopoly-ai.js         # EPT-based decision engine
│   └── strategic-ai.js        # Trade quality filtering, debt mgmt, blocking
├── research/            # Analysis and simulation
│   ├── simulation/            # Tournament runner, genetic algorithm, analytics
│   ├── ept-analysis.js        # EPT report generator
│   ├── trade-valuator.js      # Trade evaluation models
│   └── ...                    # Valuation studies, comparison tools
├── integration/         # Richup.io Python bot
│   ├── strategic_bot.py       # WebSocket bot for online play
│   ├── strategic_ai.py        # Python port of the JS decision engine
│   └── game_state_extractor.py
└── source-material/     # Reference implementations (JS, C#, C)
```

## Key Concepts

**Markov Chains** -- A 43-state transition matrix models every dice outcome, doubles chain, Chance/Community Chest card, and jail mechanic. The steady-state distribution gives exact landing probabilities (e.g., Illinois Ave at 3.16%, Jail at 6.2%).

**Earnings Per Turn (EPT)** -- `EPT = P(landing) * rent * opponents`. This is the core valuation metric. The *relative* EPT framework recognizes that property income is a zero-sum wealth transfer between players: your relative EPT is your property EPT minus the table average. A developed Orange monopoly at +$110/turn relative EPT compounds into a knockout advantage within 15-20 turns.

**Trading AI Evolution** -- Eight generations of AI, from a no-trade baseline (8% win rate) through NPV-based trading, relative EPT evaluation, auction-derived bidding premiums, and finally empirical trade quality filtering (36% win rate). A genetic algorithm optimized parameters like leader penalty, underdog bonus, and discount rate across 150 generations.

## Usage

All simulation code runs with Node.js from the `research/simulation/` directory:

```bash
# Run a 4-way AI tournament (1000 games)
cd research/simulation
node -e "
const { SimulationRunner } = require('./simulation-runner.js');
const runner = new SimulationRunner({ games: 1000 });
runner.runSimulation(['strategic', 'optimal', 'relative', 'growth'], 1000);
"

# Run genetic algorithm optimization
node genetic-algorithm.js --quick       # ~2 min test run
node genetic-algorithm.js               # ~1-2 hours
node genetic-algorithm.js --overnight   # ~4-6 hours comprehensive

# EPT analysis report
cd ..
node ept-analysis.js
```

## Integration

The `integration/` folder contains a Python bot that connects to [Richup.io](https://richup.io) (an online Monopoly platform) via WebSocket. It ports the strategic AI logic to Python and maps the Richup.io board state to the internal game model. See `integration/README.md` for setup details.

## Highlights

| Metric | Value |
|--------|-------|
| Best AI win rate (4-player) | 35.7% (vs 25% random) |
| Markov vs Monte Carlo accuracy | 0.05% avg difference |
| Best ROI group (3 houses) | Orange -- 3.48%/turn, 28.7 turn payback |
| Highest EPT group (3 houses) | Green -- $219/turn |
| GA optimization | 150 generations, 8 parameters |
