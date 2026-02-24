/**
 * Liquidation Cost Analysis
 *
 * Derives the effective liquidation multiplier from actual game state.
 * The textbook 2.0x assumes all shortfall = house sales at 50% loss.
 * Reality: players have cash, mortgageable properties, AND houses.
 *
 * Liquidation priority:
 *   1. Cash on hand (cost = 0, already in R)
 *   2. Mortgage non-monopoly properties (cost ≈ 10% unmortgage penalty)
 *   3. Mortgage monopoly properties (cost = lost double rent)
 *   4. Sell houses at 50% (cost = 2.0x per dollar recovered)
 *   5. Bankruptcy (cost = game over)
 *
 * The effective multiplier is a weighted average based on how much
 * of the shortfall comes from each source.
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
    markovEngine = new MarkovEngine();
    markovEngine.initialize();
    if (PropertyValuator) {
        valuator = new PropertyValuator.Valuator(markovEngine);
        valuator.initialize();
    }
}

// =============================================================================
// SNAPSHOT: Capture player asset composition during games
// =============================================================================

const GAMES = 500;
const snapshots = [];

function captureSnapshots(engine) {
    const state = engine.state;
    for (const player of state.players) {
        if (player.bankrupt) continue;

        const mortgageableNonMonopoly = [];
        const mortgageableMonopoly = [];
        let totalHouseValue = 0;
        let totalHouses = 0;

        // Identify monopolies
        const myMonopolies = new Set();
        for (const group of Object.keys(COLOR_GROUPS)) {
            const squares = COLOR_GROUPS[group].squares;
            if (squares.every(s => state.propertyStates[s].owner === player.id)) {
                myMonopolies.add(group);
            }
        }

        for (const propIdx of player.properties) {
            const ps = state.propertyStates[propIdx];
            const sq = BOARD[propIdx];

            if (ps.houses > 0) {
                totalHouses += ps.houses;
                totalHouseValue += ps.houses * (sq.housePrice || 0);
            }

            if (!ps.mortgaged && ps.houses === 0) {
                const mortgageValue = Math.floor(sq.price / 2);
                if (sq.group && myMonopolies.has(sq.group)) {
                    mortgageableMonopoly.push(mortgageValue);
                } else {
                    mortgageableNonMonopoly.push(mortgageValue);
                }
            }
        }

        snapshots.push({
            turn: state.turn,
            phase: state.phase,
            cash: player.money,
            houses: totalHouses,
            houseValue: totalHouseValue,
            houseSellValue: Math.floor(totalHouseValue / 2),
            mortgageableNonMonopoly: mortgageableNonMonopoly.reduce((a, b) => a + b, 0),
            mortgageableMonopoly: mortgageableMonopoly.reduce((a, b) => a + b, 0),
            hasMonopoly: myMonopolies.size > 0,
            monopolyCount: myMonopolies.size,
        });
    }
}

for (let g = 0; g < GAMES; g++) {
    const engine = new GameEngine({ maxTurns: 500 });
    const factory = (player, eng) => new StrategicTradeAI(player, eng, markovEngine, valuator);
    engine.newGame(4, [factory, factory, factory, factory]);

    // Hook into executeTurn to capture snapshots every 10 turns
    const origExecuteTurn = engine.executeTurn.bind(engine);
    engine.executeTurn = function() {
        if (engine.state.turn % 10 === 0) {
            captureSnapshots(engine);
        }
        return origExecuteTurn();
    };

    engine.runGame();

    if ((g + 1) % 100 === 0) {
        console.log(`  Game ${g + 1}/${GAMES} (${snapshots.length} snapshots)`);
    }
}

// =============================================================================
// ANALYSIS
// =============================================================================

console.log();
console.log('='.repeat(80));
console.log('LIQUIDATION COST ANALYSIS: Player Asset Composition');
console.log('='.repeat(80));
console.log(`${snapshots.length} snapshots from ${GAMES} games`);
console.log();

// Filter to players with monopolies (the interesting case for reserves)
const withMonopoly = snapshots.filter(s => s.hasMonopoly);
console.log(`Snapshots with monopoly: ${withMonopoly.length}`);
console.log();

// By phase
for (const phase of ['early', 'mid', 'late']) {
    const phaseSnaps = withMonopoly.filter(s => s.phase === phase);
    if (phaseSnaps.length === 0) continue;

    const avg = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / arr.length;

    console.log(`--- ${phase.toUpperCase()} GAME (${phaseSnaps.length} snapshots) ---`);
    console.log(`  Cash on hand:           $${avg(phaseSnaps, 'cash').toFixed(0)}`);
    console.log(`  Houses:                 ${avg(phaseSnaps, 'houses').toFixed(1)}`);
    console.log(`  House value (cost):     $${avg(phaseSnaps, 'houseValue').toFixed(0)}`);
    console.log(`  House sell value (50%): $${avg(phaseSnaps, 'houseSellValue').toFixed(0)}`);
    console.log(`  Mortgageable (non-mono):$${avg(phaseSnaps, 'mortgageableNonMonopoly').toFixed(0)}`);
    console.log(`  Mortgageable (mono):    $${avg(phaseSnaps, 'mortgageableMonopoly').toFixed(0)}`);
    console.log(`  Total liquidation:      $${(
        avg(phaseSnaps, 'cash') +
        avg(phaseSnaps, 'mortgageableNonMonopoly') +
        avg(phaseSnaps, 'mortgageableMonopoly') +
        avg(phaseSnaps, 'houseSellValue')
    ).toFixed(0)}`);
    console.log();
}

// =============================================================================
// EFFECTIVE MULTIPLIER CALCULATION
// =============================================================================

console.log('='.repeat(80));
console.log('EFFECTIVE LIQUIDATION MULTIPLIER');
console.log('='.repeat(80));
console.log();
console.log('For a shortfall S beyond cash reserve R:');
console.log('  1. Use mortgageable non-monopoly props (cost = 10% of mortgage value)');
console.log('  2. Use mortgageable monopoly props (cost = lost rent EPT)');
console.log('  3. Sell houses at 50% loss (cost = 2x per dollar)');
console.log();

// For various shortfall sizes, compute effective multiplier
const shortfalls = [100, 200, 300, 500, 750, 1000, 1500];

// Compute per-phase
for (const phase of ['early', 'mid', 'late']) {
    const phaseSnaps = withMonopoly.filter(s => s.phase === phase);
    if (phaseSnaps.length === 0) continue;

    const avg = (key) => phaseSnaps.reduce((s, x) => s + x[key], 0) / phaseSnaps.length;

    const avgMortNonMono = avg('mortgageableNonMonopoly');
    const avgMortMono = avg('mortgageableMonopoly');
    const avgHouseSell = avg('houseSellValue');

    console.log(`--- ${phase.toUpperCase()} GAME ---`);
    console.log(`  Available: mortgage(non-mono)=$${avgMortNonMono.toFixed(0)}, ` +
                `mortgage(mono)=$${avgMortMono.toFixed(0)}, ` +
                `houseSell=$${avgHouseSell.toFixed(0)}`);
    console.log();
    console.log('  Shortfall  From Mortgage(NM)  From Mortgage(M)  From Houses   Eff.Mult');
    console.log('  ' + '-'.repeat(75));

    for (const S of shortfalls) {
        let remaining = S;
        let totalCost = 0;

        // 1. Mortgage non-monopoly (cost = 10% of mortgage value used)
        const fromMortNM = Math.min(remaining, avgMortNonMono);
        totalCost += fromMortNM * 0.1;  // 10% unmortgage penalty
        remaining -= fromMortNM;

        // 2. Mortgage monopoly (cost = more significant, ~30% penalty due to lost double rent)
        // Rough: losing monopoly rent doubles. Average monopoly rent ~$30/turn, for ~10 turns
        // before unmortgage. That's ~$300 lost on a $200 mortgage. ~0.3x penalty.
        const fromMortM = Math.min(remaining, avgMortMono);
        totalCost += fromMortM * 0.3;  // Lost rent penalty
        remaining -= fromMortM;

        // 3. Sell houses at 50% loss (cost = 2.0x: spend $200 in houses to raise $100)
        const fromHouses = Math.min(remaining, avgHouseSell);
        totalCost += fromHouses * 2.0;
        remaining -= fromHouses;

        // 4. If still short: bankruptcy (effectively infinite cost)
        if (remaining > 0) {
            totalCost += remaining * 10;  // Proxy for "game over"
        }

        const effMult = S > 0 ? totalCost / S : 0;

        console.log(
            '  $' + String(S).padEnd(10) +
            '$' + fromMortNM.toFixed(0).padEnd(18) +
            '$' + fromMortM.toFixed(0).padEnd(18) +
            '$' + fromHouses.toFixed(0).padEnd(14) +
            effMult.toFixed(2) + 'x'
        );
    }
    console.log();
}

// =============================================================================
// DISTRIBUTION OF EFFECTIVE MULTIPLIER ACROSS SNAPSHOTS
// =============================================================================

console.log('='.repeat(80));
console.log('PER-SNAPSHOT EFFECTIVE MULTIPLIER DISTRIBUTION');
console.log('For typical rent hits ($200, $500, $800)');
console.log('='.repeat(80));
console.log();

for (const targetShortfall of [200, 500, 800]) {
    const multipliers = [];

    for (const snap of withMonopoly) {
        let remaining = targetShortfall;
        let totalCost = 0;

        const fromMortNM = Math.min(remaining, snap.mortgageableNonMonopoly);
        totalCost += fromMortNM * 0.1;
        remaining -= fromMortNM;

        const fromMortM = Math.min(remaining, snap.mortgageableMonopoly);
        totalCost += fromMortM * 0.3;
        remaining -= fromMortM;

        const fromHouses = Math.min(remaining, snap.houseSellValue);
        totalCost += fromHouses * 2.0;
        remaining -= fromHouses;

        if (remaining > 0) totalCost += remaining * 10;

        multipliers.push(totalCost / targetShortfall);
    }

    multipliers.sort((a, b) => a - b);
    const avg = multipliers.reduce((a, b) => a + b, 0) / multipliers.length;
    const p10 = multipliers[Math.floor(multipliers.length * 0.1)];
    const p25 = multipliers[Math.floor(multipliers.length * 0.25)];
    const p50 = multipliers[Math.floor(multipliers.length * 0.5)];
    const p75 = multipliers[Math.floor(multipliers.length * 0.75)];
    const p90 = multipliers[Math.floor(multipliers.length * 0.9)];

    console.log(`Shortfall $${targetShortfall}:`);
    console.log(`  Mean=${avg.toFixed(2)}x  p10=${p10.toFixed(2)}x  p25=${p25.toFixed(2)}x  ` +
                `median=${p50.toFixed(2)}x  p75=${p75.toFixed(2)}x  p90=${p90.toFixed(2)}x`);
}
