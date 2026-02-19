# Genetic Algorithm for Monopoly AI Parameter Optimization

## Quick Start

```bash
# Navigate to the simulation directory
cd simulation

# Quick test run (~2 minutes)
node genetic-algorithm.js --quick

# Standard run (~1-2 hours)
node genetic-algorithm.js

# Comprehensive overnight run (~3-5 hours)
node genetic-algorithm.js --overnight

# Resume a previous run
node genetic-algorithm.js --resume
node genetic-algorithm.js --overnight --resume
```

## Parameters Being Optimized

| Parameter | Description | Range | Default |
|-----------|-------------|-------|---------|
| `sellerShareThreshold` | Min share of opponent's monopoly value to demand | 0.15-0.50 | 0.35 |
| `mutualTradeRatio` | Min ratio of my NPV to their NPV for mutual trades | 0.50-1.00 | 0.80 |
| `leaderPenaltyMultiplier` | Extra compensation when trading with leader | 1.00-2.50 | 1.50 |
| `dominanceThreshold` | Ratio to 2nd place that makes someone "dominant" | 1.20-2.00 | 1.50 |
| `dominancePenaltyMultiplier` | Extra compensation when creating dominant leader | 1.50-3.00 | 2.00 |
| `underdogBonus` | Discount when trading with players behind you | 0.60-1.00 | 0.80 |
| `projectionHorizon` | Turns to project growth NPV | 30-80 | 50 |
| `discountRate` | Per-turn discount rate for NPV | 0.01-0.05 | 0.02 |

## Run Settings

### Quick (--quick)
- Population: 20
- Generations: 10
- Games per evaluation: 20
- Total games: ~4,000
- Estimated time: ~2 minutes

### Standard (default)
- Population: 40
- Generations: 100
- Games per evaluation: 50
- Total games: ~200,000
- Estimated time: 1-2 hours

### Overnight (--overnight)
- Population: 50
- Generations: 150
- Games per evaluation: 80
- Total games: ~600,000
- Estimated time: 3-5 hours

## Output Files

All results saved to `./ga-results/`:

- `ga-state.json` - Full state for resumption
- `ga-summary.txt` - Human-readable summary

## Fitness Evaluation

Each individual (parameter set) is evaluated by:
1. Playing against 5 different AI types:
   - Standard Trading AI
   - Growth Trading AI
   - NPV Trading AI
   - No Trade AI
   - Default Leader-Aware AI

2. Playing in all 4 positions against each opponent type

3. Fitness = total wins / total games played

## Tips for Overnight Run

1. **Save your work** - The GA auto-saves every 5 generations
2. **Check progress** - Look at `ga-results/ga-summary.txt`
3. **Interrupt safely** - Press Ctrl+C; use `--resume` to continue
4. **Monitor CPU** - The GA uses significant CPU for game simulation

## Example Output

```
GENERATION 42
======================================================================
  Evaluated 50/50 individuals...
  NEW BEST: 38.5% win rate
  Best:  38.5% (31/80 wins)
  Avg:   27.3%
  Time:  45.2s | Est. remaining: 82.3 min

  Top 3 individuals:
    1. 38.5% - seller=0.28, leader=1.85, dominance=2.4
    2. 36.3% - seller=0.31, leader=1.72, dominance=2.1
    3. 35.0% - seller=0.25, leader=2.10, dominance=2.3
```

## After Optimization

Once the GA completes, you can:

1. View the best parameters in `ga-summary.txt`
2. Update the defaults in `leader-aware-ai.js`
3. Run validation tournaments to confirm performance
