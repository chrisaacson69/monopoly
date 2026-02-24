# Monopoly Project

**Vault:** `C:\Users\Chris.Isaacson\Vault\projects\monopoly\README.md`

A Monopoly game implementation with both C# backend models and JavaScript frontend/AI components, featuring a mathematically rigorous AI based on Markov chain probability analysis and financial valuation theory.

## Project Structure

```
Monopoly/
├── Model/                    # C# game models
│   ├── Board.cs             # Board state, players, tiles (UK edition)
│   ├── Players/Player.cs    # Player class with money, position, properties
│   ├── Tiles/               # Tile types (Street, Tax, ChanceCard, SpecialTile)
│   ├── Enums/               # NeighbourhoodType enum for property colors
│   └── Interfaces/          # IPlayer, ITile interfaces
├── simulation/              # JavaScript AI and simulation system
│   ├── game-engine.js       # Core game engine for simulations
│   ├── base-ai.js           # Base AI classes (Simple, Strategic, Random)
│   ├── trading-ai.js        # Trading AI with blocking value
│   ├── growth-trading-ai.js # Growth curve NPV-based trading
│   ├── relative-growth-ai.js # Relative EPT framework
│   ├── enhanced-relative-ai.js # Auction-improved bidding & debt management
│   ├── strategic-trade-ai.js # **BEST** - trade quality filtering based on empirical win rates
│   ├── leader-aware-ai.js   # GA-optimized leader-aware trading
│   ├── simulation-runner.js # Multi-game simulation framework
│   ├── genetic-algorithm.js # Parameter optimization via GA
│   ├── relative-position-estimator.js # Relative EPT calculations
│   ├── formation-tracker.js # Monopoly formation analysis & trade chains
│   └── investment-map.js    # EPT per $1000 investment efficiency
├── AI System/               # Core AI components
│   ├── markov-engine.js     # Markov chain transition matrix & steady-state probabilities
│   ├── property-valuator.js # EPT calculations, ROI analysis, investment rankings
│   └── monte-carlo-sim.js   # Monte Carlo simulation for validation
├── Analysis Tools/
│   ├── ept-analysis.js      # Comprehensive EPT report generator
│   ├── compare-markov-montecarlo.js  # Validation comparison tool
│   └── relative-ept-analysis.js # Relative EPT framework analysis
├── Game Engine/
│   ├── monopoly.js          # Main game engine - dice, auctions, turns, UI
│   └── classicedition.js    # Board edition configuration
├── *.json                   # Game data (Tiles, Chance, CommunityChest)
└── Monopoly.csproj          # .NET Core 2.1 project
```

## AI System Architecture

### Markov Chain Engine (`markov-engine.js`)
Computes exact landing probabilities using a 43-state Markov chain:
- **States 0-39**: Normal board positions
- **State 40-42**: Jail states (turn 1, 2, 3 in jail)
- **State 50**: Virtual "sent to jail" marker

Key features:
- Full doubles mechanic (roll again up to 3x, triple doubles = jail)
- Chance cards: 10/16 move player (Boardwalk, Go, Illinois, St. Charles, Reading RR, Jail, 2×nearest RR, nearest utility, back 3)
- Community Chest: 2/16 move (Go, Jail)
- Distinguishes "Just Visiting" (state 10) from "In Jail" (state 40+)
- Two jail strategies: "Long Stay" (try doubles) vs "Short Stay" (pay $50)

### Property Valuator (`property-valuator.js`)
Calculates Earnings Per Ply (EPT) for all properties:
- **Base EPT = P(landing) × rent** (per-ply: one opponent's move). Charts are player-count-independent.
- **Round EPT = base EPT × opponents** (converts ply→round where needed, e.g. bilateral models)
- **Total round income = diceEPT + (plyEPT × opponents)** — dice fires once (your ply), rent fires N times (each opponent's ply)
- Supports all development levels: Own, Monopoly (2x rent), 1-4 Houses, Hotel
- Marginal ROI calculations for house investments
- Group rankings by ROI

### Validated Results
Markov chain vs Monte Carlo (2M turns) agreement:
- 38/40 squares within 0.1% difference
- Average difference: 0.05%
- Validates correct implementation of game rules

## Trading AI Evolution

### Key Economic Insight: Two Sources of Money

1. **Dice EPT (~$38/turn)**: Money from bank (Go, Chance/CC cards)
   - "Tide that lifts all boats" - everyone gains roughly equally
   - Sets the global growth rate of the economy

2. **Property EPT**: Wealth TRANSFER between players (zero-sum!)
   - When you collect rent, opponent loses that exact amount
   - Relative EPT = Your Property EPT - Average Property EPT
   - Positive = gaining ground, Negative = losing ground

### The Relative EPT Framework

```
relativeEPT[i] = propertyEPT[i] - (totalPropertyEPT / numPlayers)
netGrowth[i] = diceEPT + relativeEPT[i]
position[i] = netWorth + netGrowth * turnsRemaining
```

This explains why monopolies are "knockout blows":
- Orange monopoly @ 3 houses: ~$150 EPT
- With 4 players: relativeEPT = $150 - $40 = +$110/turn
- Others: relativeEPT ≈ -$37/turn each
- The differential compounds rapidly!

### AI Performance Rankings (1000 game tournaments)

| AI Type | Win Rate | Notes |
|---------|----------|-------|
| **StrategicTradeAI** | **35.7%** | **Current best** - trade quality filtering + all EnhancedRelative features |
| EnhancedRelativeOptimal | 31.9% | Previous best - auction-tuned bidding + conservative debt |
| EnhancedRelative5 | 31.0% | Same as Optimal (5% premium, 15% debt) |
| EnhancedRelative10 | 31.4% | 10% premium, slightly more aggressive |
| RelativeGrowthAI | 16.1%* | Relative EPT framework |
| GrowthTradingAI | 14.4%* | Growth curve simulation, absolute EPT |
| LeaderAwareAI | 22.4%* | GA-optimized, "gang up on leader" |
| NoTradeAI | 8.4% | Baseline - refuses all trades |

*Win rates when competing against StrategicTradeAI + EnhancedRelativeOptimal

**Head-to-head: StrategicTradeAI vs EnhancedRelativeOptimal: 54.7% vs 45.3%** (Z-score 2.95, p<0.05, statistically significant)

### AI Development History

1. **NoTradeAI**: Refuses trades → rarely gets monopolies → loses
2. **TradingAI**: Simple trades based on property value → easily exploited
3. **NPVTradingAI**: Time-value calculations → too conservative
4. **GrowthTradingAI**: Simulates development timeline → big improvement
5. **LeaderAwareAI**: Adds "gang up on leader" → GA-optimized parameters
6. **RelativeGrowthAI**: Relative EPT framework → big improvement
7. **EnhancedRelativeAI**: Applies auction insights (premium bidding, debt management) → previous best
8. **StrategicTradeAI**: Trade quality filtering based on empirical win rates → **current best**

### Genetic Algorithm Results

GA optimized 8 parameters over 150 generations (6 hours):
- Best win rate: 40% (vs 25% random in 4-player)
- Key findings:
  - `sellerShareThreshold`: 0.30 (slightly more willing to trade than default 0.35)
  - `leaderPenaltyMultiplier`: 1.80 (strongly penalize helping the leader)
  - `underdogBonus`: 0.65 (be lenient with players behind you)
  - `discountRate`: 0.015 (value future earnings more than default)

## Key Findings

### ROI Rankings (at 3 Houses)
| Rank | Group | ROI/Turn | Payback |
|------|-------|----------|---------|
| 1 | **ORANGE** | 3.48% | 28.7 turns |
| 2 | RED | 3.05% | 32.8 turns |
| 3 | DARK BLUE | 2.99% | 33.4 turns |
| 4 | YELLOW | 2.96% | 33.8 turns |
| 5 | GREEN | 2.69% | 37.2 turns |
| 6 | PINK | 2.64% | 37.9 turns |
| 7 | LIGHT BLUE | 2.50% | 39.9 turns |
| 8 | BROWN | 1.33% | 75.1 turns |

### Property EPT at 3 Houses (3 opponents)
| Group | EPT/turn | vs Dice EPT |
|-------|----------|-------------|
| Green | $219 | 5.7x |
| Yellow | $191 | 5.0x |
| Red | $186 | 4.8x |
| Dark Blue | $175 | 4.6x |
| Orange | $153 | 4.0x |
| Pink | $106 | 2.8x |
| Light Blue | $58 | 1.5x |
| Brown | $17 | 0.4x |

### Most Landed Squares
1. Jail/Just Visiting: ~6.2%
2. Illinois Avenue: 3.16%
3. Go: 3.12%
4. New York Avenue: 3.05%
5. B&O Railroad: 3.03%

## Running Simulations

```bash
cd simulation

# Run AI tournament with best AI (1000 games)
node -e "
const { SimulationRunner } = require('./simulation-runner.js');
const runner = new SimulationRunner({ games: 1000 });
runner.runSimulation(['strategic', 'optimal', 'relative', 'growth'], 1000);
"

# Head-to-head: Strategic vs Optimal (1000 games)
node -e "
const { SimulationRunner } = require('./simulation-runner.js');
const runner = new SimulationRunner({ games: 1000 });
runner.runSimulation(['strategic', 'optimal'], 1000);
"

# Compare strategic variants
node -e "
const { SimulationRunner } = require('./simulation-runner.js');
const runner = new SimulationRunner({ games: 500 });
runner.runSimulation(['strategic', 'strategic-strict', 'strategic-lenient', 'optimal'], 500);
"

# Compare enhanced variants
node -e "
const { SimulationRunner } = require('./simulation-runner.js');
const runner = new SimulationRunner({ games: 500 });
runner.runSimulation(['enhanced5', 'enhanced10', 'enhanced15', 'relative'], 500);
"

# Run auction-only simulation (reveals true property values)
node -e "
const { AuctionSimulationRunner } = require('./auction-game-engine.js');
const runner = new AuctionSimulationRunner({ games: 500 });
runner.runSimulation(['bidder10', 'relative', 'growth', 'trading'], 500);
"

# Run self-play analytics (detailed stats)
node -e "
const { SelfPlayAnalytics } = require('./self-play-analytics.js');
const runner = new SelfPlayAnalytics({ games: 500 });
runner.runAnalysis();
"

# Run genetic algorithm
node genetic-algorithm.js --quick      # ~2 min test
node genetic-algorithm.js              # ~1-2 hours
node genetic-algorithm.js --overnight  # ~4-6 hours comprehensive

# Resume interrupted GA
node genetic-algorithm.js --resume
```

## Analytics & Metrics Tracked

### Self-Play Analytics
- **Game length distribution**: min, p25, median, p75, max, std deviation
- **Winner's net worth**: Average winning position
- **Total economy**: Sum of all net worth at game end
- **Declined purchases**: Properties player could afford but chose not to buy
- **Auction outcomes**: What declined properties sold for (validates AI decisions)
- **Monopoly performance**: Win rate by color group, railroads, utilities
- **Housing statistics**: Houses bought/sold, forced sales, housing shortages

### Auction Analytics
- **Property prices**: Avg, min, max per property
- **% of face value**: How much above/below list price
- **Contested rate**: % of auctions with multiple bidders
- **By game phase**: Early (turns 1-20), mid (21-50), late (51+)

### Debt Tracking
- **Mortgages/Unmortgages per game**
- **Peak debt**: Maximum mortgaged value reached
- **Debt recovery rate**: % of times player recovered from debt
- **Debt vs winning**: Correlation between leverage and outcomes

## Game Rules Implemented

- 40-square board (standard US Monopoly layout)
- **Doubles mechanic**:
  - Roll doubles → roll again (up to 3 times)
  - Triple doubles → go directly to jail
  - When escaping jail via doubles → move but NO extra roll
  - When paying to leave jail → full doubles mechanics apply
- Chance/Community Chest card effects with chaining
- Go-to-Jail square (30) and jail card handling
- Two jail strategies affecting landing probabilities
- Full trading system with property + cash exchanges

## Auction-Only Variant & Property Valuation Research

### Auction Game Engine (`auction-game-engine.js`)
A variant where ALL properties go to auction (no direct purchases). This reveals true market valuations when AIs must bid competitively.

### Key Auction Findings

**Property values at auction (500 games, 4 trading AIs):**
| Group | Avg Price | % of Face | Notes |
|-------|-----------|-----------|-------|
| Brown | $73 | **121%** | Overbid due to blocking! |
| Dark Blue | $385 | 103% | Premium for knockout power |
| Light Blue | $109 | 102% | |
| Orange | $187 | 100% | Fair value |
| Green | $296 | 97% | Slight discount |
| Railroad | $193 | 97% | |
| Utility | $145 | 97% | |

**The Brown Premium Paradox**: All AIs overbid 20%+ on browns despite lowest win rate (23%). This is the N>2 blocking problem - everyone tries to block, driving up prices.

### Aggressive Bidder AI (`aggressive-bidder-ai.js`)
Tests the hypothesis that paying above face value for EPT growth is worthwhile.

**Results (auction mode):**
| AI | Win Rate | Notes |
|----|----------|-------|
| Bidder +5% | **46%** | Best - conservative premium |
| Bidder +10% | 41-46% | Strong but can overextend |
| Bidder +20% | 16-17% | Over-leverages, loses |
| Relative (baseline) | 1-15% | Crushed when facing bidders |

**Key Insight**: Properties are undervalued at face price. Paying 5-10% premium dominates, but 20% overextends.

### Debt Analysis
Tracks mortgage usage and recovery:
- **Winners avg peak debt**: ~$510
- **Losers avg peak debt**: ~$718 (+41%)
- **Insight**: Over-leveraging hurts. Moderate debt (bidder5/10) works; excessive debt (bidder20) fails.
- Bidder20 ends games in debt 85% of the time with only 7% debt recovery rate

### Premium Trading AI (`premium-trading-ai.js`)
Applies auction insights to normal game trades. Less effective than in auctions because:
1. Most properties bought at landing (no competition)
2. Trades already constrained to monopoly-completion
3. Premium doesn't force trades, just makes you accept worse deals

### Enhanced Relative AI (`enhanced-relative-ai.js`)
**Current best performer.** Combines RelativeGrowthAI with auction-derived improvements:

**Optimal Parameters (from 1000+ game tournament):**
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `baseBidPremium` | **5%** | Properties undervalued at face; higher premiums overextend |
| `maxDebtRatio` | **15%** | Moderate debt helps; winners avg $510 debt vs losers $718 |
| `maxAbsoluteDebt` | **$400** | Conservative cap prevents over-leveraging |
| `absoluteMinCash` | **$75** | Maintain liquidity for rent/taxes |
| `smartBlocking` | **true** | Only pay blocking premium when sole blocker |

**Key Features:**
1. **Premium bidding**: Willing to pay 5% above face value at auctions
2. **Parameterized debt tolerance**: Mortgages to fund bids within limits
3. **Proactive unmortgaging**: Clears debt when cash allows (prioritizes monopoly properties)
4. **Strategic multipliers**: 1.5x for monopoly completion, 1.3x for blocking
5. **Smart blocking**: Avoids overpaying when others are already blocking (+6.4pp improvement)

**Tournament Results:**
- vs Original RelativeGrowthAI: **61.7% vs 37.0%** (head-to-head)
- vs Mixed field (growth, leader, relative): **37.2%** (4-way)
- Smart blocking vs naive blocking: **52.7% vs 46.3%** (+6.4pp head-to-head)

**Key Insights**:
- Properties are undervalued at face price, but over-leveraging hurts
- 24% of blocking decisions are redundant (group already blocked by someone else)
- Smart blocking saves resources by not overpaying for redundant blocks

### Strategic Trade AI (`strategic-trade-ai.js`)
**Current best performer.** Extends EnhancedRelativeAI with empirically-validated trade quality filtering.

**Key Insight**: Not all monopolies are equal. Empirical win rate analysis shows significant variation:

| Group | Win Rate | Quality Multiplier |
|-------|----------|-------------------|
| **Green** | **51.5%** | **1.30** (BEST) |
| Yellow | 48.2% | 1.20 |
| Dark Blue | 45.5% | 1.15 |
| Red | 42.1% | 1.05 |
| Orange | 39.6% | 1.00 (baseline) |
| Light Blue | 39.6% | 0.95 |
| Pink | 38.4% | 0.95 |
| **Brown** | **30.2%** | **0.85** (WORST - the "trap") |

**Trade Quality Filter Logic:**
```javascript
// Accept if our quality is at least 85% of theirs
if (ourQuality >= theirQuality * 0.85) return true;

// Reject if they get much better monopoly (>40% better)
if (theirQuality > ourQuality * 1.4) return false;

// Default: accept (parent already approved the trade)
return true;
```

**Tournament Results (1000 games):**
- Head-to-head vs EnhancedRelativeOptimal: **54.7% vs 45.3%**
- Z-score: 2.95 (statistically significant, p<0.05)
- 95% CI: 51.6% - 57.9%
- 4-way tournament: **35.7%** (vs 31.9% for Optimal)

**Why It Works:**
1. Inherits all EnhancedRelativeAI features (premium bidding, debt management, smart blocking)
2. Adds quality filter that rejects trades giving opponents high-quality monopolies
3. Avoids the "Brown Trap" - cheap to complete but worst win rate
4. Prioritizes trades that result in Green/Yellow monopolies

**Presets Available:**
- `StrategicBalanced` - Default (accept ≥85%, reject >140%)
- `StrategicStrict` - Conservative (accept ≥95%, reject >120%)
- `StrategicLenient` - Aggressive (accept ≥70%, reject >160%)

## New Simulation Files

```
simulation/
├── auction-game-engine.js      # Auction-only variant with debt tracking
├── aggressive-bidder-ai.js     # +5%, +10%, +20% premium bidders
├── enhanced-relative-ai.js     # Auction-improved RelativeGrowthAI
├── strategic-trade-ai.js       # **BEST** - Trade quality filtering based on empirical win rates
├── premium-trading-ai.js       # Premium trading for normal games
├── self-play-analytics.js      # Extended analytics (game length, economy, etc.)
├── trade-analytics.js          # Trade pattern tracking for N>2 analysis
├── blocking-analysis.js        # Blocking decision analysis & redundancy detection
├── formation-tracker.js        # Monopoly formation analysis & trade chains
└── investment-map.js           # EPT per $1000 investment analysis
```

## Monopoly Formation Analysis

### Formation Tracker (`simulation/formation-tracker.js`)
Analyzes HOW monopolies form - natural acquisition vs trades, and the dynamics of trade chains.

### Key Formation Findings (500 games)

**Natural vs Trade Formation Rates:**
| Group Size | Natural Formation | Trade Formation |
|------------|-------------------|-----------------|
| 2-property (Brown, Dark Blue) | 26-32% | 68-74% |
| 3-property (all others) | 6-7% | 93-94% |

**Critical Insight**: 2-property groups form naturally 4x more often than 3-property groups. This explains part of the Brown Premium Paradox - browns are more likely to already be contested when you land on them.

### Win Rate by Monopoly Color (500 games)
| Group | Win Rate | Trade Frequency | Notes |
|-------|----------|-----------------|-------|
| **Green** | **51.5%** | Low | Best win rate despite low trade volume |
| **Yellow** | **48.2%** | Medium | Second best |
| Dark Blue | 45.5% | Low | Good natural formation rate |
| Red | 42.1% | Medium | Solid performer |
| Orange | 39.6% | High | Most traded, decent wins |
| Pink | 38.4% | High | Trade bait, moderate wins |
| Light Blue | 39.6% | **Highest** | Most traded but not best wins |
| **Brown** | **30.2%** | High | **WORST** despite most contested |

**Key Discovery**: Most traded ≠ Highest win rate
- Light Blue: Most traded (199/property) but only 39.6% win rate
- Green: Lower trade frequency but 51.5% win rate (BEST)

### Trade Chain Analysis

**Trade Chain Statistics:**
- **93% of games** have trade chains (trades enabling other trades)
- **63% of trade formations** were enabled by a prior trade
- **Average chain length**: 3.14 trades
- **Average time between chain trades**: ~15 turns

**Critical Insight**: The 15-turn gap between chain trades indicates chains are **coincidental, not strategic**. Current AIs don't intentionally set up future trades.

### Winner vs Loser Trading Behavior
| Metric | Winners | Losers | Delta |
|--------|---------|--------|-------|
| Trades initiated | 2.3 | 1.7 | +0.62 |
| Monopolies from trades | 2.29 | 1.01 | **+2.3x** |
| Positioning trades | 0% | 0% | - |

**Key Insights:**
- Winners initiate **0.62 more trades** than losers
- Winners get **2.3x more monopolies** from trading
- **0% positioning trades** - current AI only does monopoly-completing trades
- No evidence of intentional "trade bait" strategy

### Trade Bait Properties
Properties most frequently involved in trades:
1. **Light Blue** - 199 trades/property (highest)
2. **Orange** - 187 trades/property
3. **Pink** - 172 trades/property

These don't correlate with highest win rates, suggesting current AI trades for EPT/cash balance without considering strategic importance.

### Investment Efficiency Analysis (`simulation/investment-map.js`)

**EPT per $1000 Invested (at 3 Houses):**
| Rank | Group | EPT/$1000 | Total Cost | Notes |
|------|-------|-----------|------------|-------|
| 1 | **Orange** | $42.11 | $1840 | Best efficiency |
| 2 | Red | $38.20 | $2430 | |
| 3 | Yellow | $35.82 | $2680 | |
| 4 | Pink | $32.14 | $1640 | Good value |
| 5 | Dark Blue | $29.91 | $2350 | |
| 6 | Green | $27.12 | $3230 | Highest cost |
| 7 | Light Blue | $24.17 | $1200 | |
| 8 | **Brown** | **$13.32** | $420 | **Worst efficiency** |

**Dice EPT Breakdown:**
- Go salary contribution: ~$42.51/turn
- Chance/CC card gains: ~$2.88/turn
- **Total Dice EPT: ~$45/turn** (money entering game from bank)

## Open Problems

### The N>2 Coalition Problem
With more than 2 players, trade evaluation becomes complex:
- A trade between P1-P2 affects P3, P4 (externalities)
- P3 might want to counter-offer to block P1-P2 deal
- "Kingmaker" scenarios where one trade determines the winner

**Potential solutions explored:**
- Leader-awareness (implemented) - don't help the leader
- Counter-offering system (future work) - let others intervene in trades
- Full coalition analysis - computationally expensive

### Strategic Trade Algorithm (Partially Implemented)

**StrategicTradeAI** implements the key insight from formation analysis - not all monopolies are equal:

✅ **Implemented:**
- **Avoid the Brown Trap** - Quality multiplier 0.85 (15% discount) makes AI less willing to accept trades that give opponent browns
- **Target high win-rate groups** - Green (1.30x), Yellow (1.20x) quality multipliers favor these trades
- **Trade quality filtering** - Rejects trades giving opponents much better monopolies

❌ **Future Work:**
1. **Value "trade potential"** - Properties that unlock future trades are worth more
   - Green/Yellow properties unlock winning monopolies
   - Light Blue/Pink are "trade bait" - frequently traded but don't correlate with wins

2. **Intentional chain building** - Current 15-turn gaps suggest accidental chains
   - AI should acquire properties that make opponents WANT to trade
   - Track which properties are blocking multiple groups

3. **First mover advantage** - Trade initiators get monopoly 100% of the time
   - Be more aggressive initiating trades when you can complete a monopoly
   - Receiving player only gets monopoly 66% of the time

**Note**: Testing showed that complex features (game phase awareness, trade potential scoring, lookahead, positioning trades) did NOT improve performance. The simple trade quality filter alone provided the statistically significant improvement.

## Data Files

- **Tiles.json**: Property definitions with prices, rents, colors
- **Chance.json**: Chance card definitions (10/16 movement cards)
- **CommunityChest.json**: Community Chest card definitions (2/16 movement cards)
