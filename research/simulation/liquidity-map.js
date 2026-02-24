/**
 * Liquidity Map Analysis
 *
 * For a given player state, what does it ACTUALLY cost to cover each dollar
 * of shortfall? The answer is a curve, not a constant:
 *
 *   - First dollars: covered by mortgaging cheap properties (low cost)
 *   - Middle dollars: mortgage monopoly properties (medium cost)
 *   - Last dollars: sell houses at 50% loss (high cost, 2.0x)
 *   - Beyond assets: bankruptcy (infinite cost)
 *
 * This script:
 *   1. Captures player asset snapshots from real games
 *   2. For each snapshot, builds the marginal liquidation cost curve
 *   3. Aggregates to show the typical curve shape by game phase
 *   4. Shows what the effective multiplier is at each shortfall level
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS, RAILROAD_RENT } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');

let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {}

let markovEngine = null, valuator = null;
if (MarkovEngine) {
    console.log('Initializing Markov engine...');
    markovEngine = new MarkovEngine();
    markovEngine.initialize();
    if (PropertyValuator) {
        valuator = new PropertyValuator.Valuator(markovEngine);
        valuator.initialize();
    }
}
console.log('Ready.\n');

const probs = markovEngine ? markovEngine.getAllProbabilities() : null;
const getProb = (idx) => (probs && probs[idx]) || 0.025;

// =============================================================================
// CAPTURE SNAPSHOTS
// =============================================================================

const GAMES = 500;
const snapshots = [];

for (let g = 0; g < GAMES; g++) {
    const engine = new GameEngine({ maxTurns: 500 });
    const factory = (player, eng) => new StrategicTradeAI(player, eng, markovEngine, valuator);
    engine.newGame(4, [factory, factory, factory, factory]);

    const origExecuteTurn = engine.executeTurn.bind(engine);
    engine.executeTurn = function() {
        const state = engine.state;
        if (state.turn % 10 === 0) {
            for (const player of state.players) {
                if (player.bankrupt) continue;

                // Does this player have a monopoly?
                const myMonopolies = new Set();
                for (const group of Object.keys(COLOR_GROUPS)) {
                    const squares = COLOR_GROUPS[group].squares;
                    if (squares.every(s => state.propertyStates[s].owner === player.id)) {
                        myMonopolies.add(group);
                    }
                }
                if (myMonopolies.size === 0) continue; // Only care about monopoly holders

                // Build liquidation ladder: sorted list of assets by cost to liquidate
                // Each entry: { amount, costPerDollar, source }
                const ladder = [];

                // Tier 1: Mortgage non-monopoly, non-railroad properties (cheapest)
                for (const propIdx of player.properties) {
                    const ps = state.propertyStates[propIdx];
                    if (ps.mortgaged || ps.houses > 0) continue;
                    const sq = BOARD[propIdx];
                    const group = sq.group;

                    // Skip monopoly properties (more expensive to mortgage)
                    if (group && myMonopolies.has(group)) continue;

                    const mortgageValue = Math.floor(sq.price / 2);

                    // Cost of mortgaging: 10% unmortgage fee + lost rent income
                    // Lost rent: prob × rent × turns_until_unmortgage (~15 turns avg)
                    const baseRent = sq.rent ? sq.rent[0] : 0;
                    const rentLoss = getProb(propIdx) * baseRent * 15;
                    // Total cost per dollar raised = (fee + rentLoss) / mortgageValue
                    const totalCost = mortgageValue * 0.1 + rentLoss;
                    const costPerDollar = mortgageValue > 0 ? totalCost / mortgageValue : 0;

                    ladder.push({
                        amount: mortgageValue,
                        costPerDollar,
                        source: 'mortgage-nonmono'
                    });
                }

                // Tier 1b: Mortgage railroads
                for (const propIdx of player.properties) {
                    if (![5, 15, 25, 35].includes(propIdx)) continue;
                    const ps = state.propertyStates[propIdx];
                    if (ps.mortgaged) continue;

                    const mortgageValue = Math.floor(BOARD[propIdx].price / 2); // $100

                    // Railroad rent depends on how many you own
                    let rrCount = 0;
                    for (const pi of player.properties) {
                        if ([5, 15, 25, 35].includes(pi) && !state.propertyStates[pi].mortgaged) rrCount++;
                    }
                    // Marginal loss: losing one RR drops all RR rents
                    const currentRent = RAILROAD_RENT[rrCount] || 0;
                    const reducedRent = RAILROAD_RENT[rrCount - 1] || 0;
                    const rentDrop = currentRent - reducedRent;

                    // Each remaining RR loses rentDrop, times their landing prob, times ~15 turns
                    const rrSquares = [5, 15, 25, 35].filter(s =>
                        player.properties.has(s) && !state.propertyStates[s].mortgaged && s !== propIdx);
                    let rentLoss = 0;
                    for (const rr of rrSquares) {
                        rentLoss += getProb(rr) * rentDrop * 15;
                    }
                    // Plus this RR's own rent loss
                    rentLoss += getProb(propIdx) * currentRent * 15;

                    const totalCost = mortgageValue * 0.1 + rentLoss;
                    const costPerDollar = totalCost / mortgageValue;

                    ladder.push({
                        amount: mortgageValue,
                        costPerDollar,
                        source: 'mortgage-railroad'
                    });
                }

                // Tier 2: Mortgage monopoly properties (no houses)
                for (const propIdx of player.properties) {
                    const ps = state.propertyStates[propIdx];
                    if (ps.mortgaged || ps.houses > 0) continue;
                    const sq = BOARD[propIdx];
                    if (!sq.group || !myMonopolies.has(sq.group)) continue;

                    const mortgageValue = Math.floor(sq.price / 2);

                    // Cost: 10% fee + lost DOUBLE rent + blocks building on whole group
                    const monopolyRent = sq.rent[0] * 2;
                    const rentLoss = getProb(propIdx) * monopolyRent * 15;
                    // Also: can't build on this group while any property is mortgaged
                    // Approximate as losing the marginal value of building
                    const totalCost = mortgageValue * 0.1 + rentLoss;
                    const costPerDollar = totalCost / mortgageValue;

                    ladder.push({
                        amount: mortgageValue,
                        costPerDollar,
                        source: 'mortgage-monopoly'
                    });
                }

                // Tier 3: Sell houses (most expensive, 50% loss = 2.0x per dollar)
                // Houses must be sold evenly within groups
                let totalHouseSellValue = 0;
                for (const propIdx of player.properties) {
                    const ps = state.propertyStates[propIdx];
                    if (ps.houses <= 0) continue;
                    const sq = BOARD[propIdx];
                    totalHouseSellValue += ps.houses * Math.floor((sq.housePrice || 0) / 2);
                }

                if (totalHouseSellValue > 0) {
                    ladder.push({
                        amount: totalHouseSellValue,
                        costPerDollar: 2.0,  // Spend $2 in house value to raise $1
                        source: 'sell-houses'
                    });
                }

                // Sort by cost (cheapest first)
                ladder.sort((a, b) => a.costPerDollar - b.costPerDollar);

                // Build cumulative curve
                const totalLiquidity = ladder.reduce((s, e) => s + e.amount, 0);

                snapshots.push({
                    turn: state.turn,
                    phase: state.phase,
                    cash: player.money,
                    monopolyCount: myMonopolies.size,
                    ladder,
                    totalLiquidity,
                });
            }
        }
        return origExecuteTurn();
    };

    engine.runGame();

    if ((g + 1) % 100 === 0) {
        console.log(`  Game ${g + 1}/${GAMES} (${snapshots.length} snapshots)`);
    }
}

// =============================================================================
// BUILD THE LIQUIDITY MAP
// =============================================================================

console.log();
console.log('='.repeat(80));
console.log('LIQUIDITY MAP: Effective cost per dollar of shortfall');
console.log('='.repeat(80));
console.log();

// For each phase, compute the average marginal cost curve
for (const phase of ['mid', 'late']) {
    const phaseSnaps = snapshots.filter(s => s.phase === phase);
    if (phaseSnaps.length === 0) continue;

    console.log(`--- ${phase.toUpperCase()} GAME (${phaseSnaps.length} snapshots) ---`);
    console.log();

    // For various shortfall amounts, compute the effective multiplier
    // across all snapshots (percentiles)
    const shortfalls = [50, 100, 150, 200, 300, 400, 500, 600, 750, 1000, 1250, 1500];

    console.log('  Shortfall   p10     p25     MEDIAN  p75     p90     mean');
    console.log('  ' + '-'.repeat(70));

    for (const S of shortfalls) {
        const multipliers = [];

        for (const snap of phaseSnaps) {
            let remaining = S;
            let totalCost = 0;

            for (const tier of snap.ladder) {
                if (remaining <= 0) break;
                const used = Math.min(remaining, tier.amount);
                totalCost += used * tier.costPerDollar;
                remaining -= used;
            }

            // If still short after all assets: bankruptcy proxy
            if (remaining > 0) {
                totalCost += remaining * 10.0;
            }

            multipliers.push(totalCost / S);
        }

        multipliers.sort((a, b) => a - b);
        const pct = (p) => multipliers[Math.floor(multipliers.length * p)];
        const mean = multipliers.reduce((a, b) => a + b, 0) / multipliers.length;

        console.log(
            '  $' + String(S).padEnd(10) +
            pct(0.10).toFixed(2).padEnd(8) +
            pct(0.25).toFixed(2).padEnd(8) +
            pct(0.50).toFixed(2).padEnd(8) +
            pct(0.75).toFixed(2).padEnd(8) +
            pct(0.90).toFixed(2).padEnd(8) +
            mean.toFixed(2)
        );
    }
    console.log();
}

// =============================================================================
// LADDER COMPOSITION: What's in each tier?
// =============================================================================

console.log('='.repeat(80));
console.log('AVERAGE LADDER COMPOSITION (by phase)');
console.log('='.repeat(80));
console.log();

for (const phase of ['mid', 'late']) {
    const phaseSnaps = snapshots.filter(s => s.phase === phase);
    if (phaseSnaps.length === 0) continue;

    const avg = (fn) => phaseSnaps.reduce((s, snap) => s + fn(snap), 0) / phaseSnaps.length;

    const tierAmount = (source) => avg(snap => {
        return snap.ladder.filter(t => t.source === source)
            .reduce((s, t) => s + t.amount, 0);
    });

    const tierCost = (source) => {
        let totalCost = 0, totalAmount = 0;
        for (const snap of phaseSnaps) {
            for (const t of snap.ladder) {
                if (t.source === source) {
                    totalCost += t.costPerDollar * t.amount;
                    totalAmount += t.amount;
                }
            }
        }
        return totalAmount > 0 ? totalCost / totalAmount : 0;
    };

    console.log(`--- ${phase.toUpperCase()} ---`);
    console.log('  Source               Avg Amount    Avg Cost/Dollar');
    console.log('  ' + '-'.repeat(55));

    for (const source of ['mortgage-nonmono', 'mortgage-railroad', 'mortgage-monopoly', 'sell-houses']) {
        const amt = tierAmount(source);
        const cost = tierCost(source);
        if (amt > 0) {
            console.log(
                '  ' + source.padEnd(23) +
                ('$' + amt.toFixed(0)).padEnd(14) +
                cost.toFixed(3) + 'x'
            );
        }
    }

    console.log('  ' + 'TOTAL'.padEnd(23) + '$' + avg(s => s.totalLiquidity).toFixed(0));
    console.log('  Cash on hand:        $' + avg(s => s.cash).toFixed(0));
    console.log();
}

// =============================================================================
// THE KEY QUESTION: Where does 1.0x sit on the curve?
// =============================================================================

console.log('='.repeat(80));
console.log('WHERE DOES 1.0x SIT? Finding the shortfall where eff. mult crosses 1.0');
console.log('='.repeat(80));
console.log();

for (const phase of ['mid', 'late']) {
    const phaseSnaps = snapshots.filter(s => s.phase === phase);
    if (phaseSnaps.length === 0) continue;

    // For each snapshot, find the shortfall where multiplier crosses 1.0
    const crossPoints = [];

    for (const snap of phaseSnaps) {
        for (let S = 25; S <= 2000; S += 25) {
            let remaining = S;
            let totalCost = 0;

            for (const tier of snap.ladder) {
                if (remaining <= 0) break;
                const used = Math.min(remaining, tier.amount);
                totalCost += used * tier.costPerDollar;
                remaining -= used;
            }
            if (remaining > 0) totalCost += remaining * 10.0;

            if (totalCost / S >= 1.0) {
                crossPoints.push(S);
                break;
            }
        }
    }

    if (crossPoints.length === 0) continue;
    crossPoints.sort((a, b) => a - b);

    const pct = (p) => crossPoints[Math.floor(crossPoints.length * p)];
    const mean = crossPoints.reduce((a, b) => a + b, 0) / crossPoints.length;

    console.log(`${phase.toUpperCase()}: Shortfall where effective multiplier reaches 1.0x`);
    console.log(`  p10=$${pct(0.10)}  p25=$${pct(0.25)}  median=$${pct(0.50)}  p75=$${pct(0.75)}  p90=$${pct(0.90)}  mean=$${mean.toFixed(0)}`);
    console.log(`  (Below this: multiplier < 1.0x. Above this: multiplier > 1.0x)`);
    console.log();
}
