/**
 * Reserve Strategy Comparison
 *
 * Tests 4 reserve strategies head-to-head (1 new vs 3 baseline):
 * 1. Capped Dynamic (theory capped at base reserve)
 * 2. Uncapped 2.0x multiplier (full theory)
 * 3. Uncapped 1.0x multiplier (reduced liquidation penalty)
 * 4. Control (static baseline)
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS, RAILROAD_RENT } = require('./game-engine.js');

// Load the AI chain
const { StrategicTradeAI } = require('./strategic-trade-ai.js');

// Try to load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.log('Note: Markov engine not available');
}

// Initialize shared resources
let markovEngine = null, valuator = null;
if (MarkovEngine) {
    console.log('Initializing Markov engine...');
    markovEngine = new MarkovEngine();
    markovEngine.initialize();
    if (PropertyValuator) {
        valuator = new PropertyValuator.Valuator(markovEngine);
        valuator.initialize();
    }
    console.log('Markov engine ready.');
}

// =============================================================================
// DYNAMIC RESERVE CALCULATION (standalone, so we can parameterize multiplier)
// =============================================================================

function computeDynamicReserve(ai, state, liqMultiplier, capAtBase) {
    const myMonopolies = ai.getMyMonopolies(state);
    if (myMonopolies.length === 0) return ai.constructor.prototype.getMinReserve ?
        200 : 200; // base fallback

    const opponents = state.players.filter(p => !p.bankrupt && p.id !== ai.player.id);
    if (opponents.length === 0) return 50;

    const getProb = (idx) => (ai.probs && ai.probs[idx]) || 0.025;

    // 1. Build rent exposure
    const exposures = [];
    let maxRent = 0;

    for (const opp of opponents) {
        let rrCount = 0;
        for (const propIdx of opp.properties) {
            if ([5, 15, 25, 35].includes(propIdx) && !state.propertyStates[propIdx].mortgaged) {
                rrCount++;
            }
        }

        for (const propIdx of opp.properties) {
            const ps = state.propertyStates[propIdx];
            if (ps.mortgaged) continue;

            const sq = BOARD[propIdx];
            const prob = getProb(propIdx);
            let rent = 0;

            if (sq.rent) {
                if (ps.houses > 0) {
                    rent = sq.rent[ps.houses];
                } else if (sq.group && COLOR_GROUPS[sq.group] &&
                    COLOR_GROUPS[sq.group].squares.every(s =>
                        state.propertyStates[s].owner === opp.id)) {
                    rent = sq.rent[0] * 2;
                } else {
                    rent = sq.rent[0];
                }
            } else if ([5, 15, 25, 35].includes(propIdx)) {
                rent = RAILROAD_RENT[rrCount];
            }

            if (rent > 0) {
                exposures.push({ p: prob, rent });
                if (rent > maxRent) maxRent = rent;
            }
        }
    }

    if (maxRent <= 50) return 50;

    // 2. Find best buildable monopoly for opportunity cost
    let bestMarginalEPT = 0;
    let bestCostPerLevel = 300;

    for (const group of myMonopolies) {
        if (!COLOR_GROUPS[group]) continue;
        const squares = COLOR_GROUPS[group].squares;
        const sq0 = BOARD[squares[0]];
        if (!sq0.rent || !sq0.housePrice) continue;
        if (!squares.some(s => (state.propertyStates[s].houses || 0) < 5)) continue;

        let marginalEPT = 0;
        for (const s of squares) {
            const r = BOARD[s].rent;
            const avgMarginal = (r[3] - r[2] + r[2] - r[1] + r[1] - r[0] * 2) / 3;
            marginalEPT += getProb(s) * Math.max(avgMarginal, r[1] - r[0]) * opponents.length;
        }

        if (marginalEPT > bestMarginalEPT) {
            bestMarginalEPT = marginalEPT;
            bestCostPerLevel = sq0.housePrice * squares.length;
        }
    }

    if (bestMarginalEPT === 0) {
        bestMarginalEPT = 10;
        bestCostPerLevel = 300;
    }

    // 3. Search for optimal reserve
    let bestR = 0;
    let minCost = Infinity;
    const step = 50;

    for (let R = 0; R <= maxRent; R += step) {
        let liqCost = 0;
        for (const { p, rent } of exposures) {
            liqCost += p * Math.max(0, rent - R) * liqMultiplier;
        }
        const oppCost = (R / bestCostPerLevel) * bestMarginalEPT;
        const total = liqCost + oppCost;
        if (total < minCost) {
            minCost = total;
            bestR = R;
        }
    }

    if (capAtBase) {
        // Phase-based base reserve
        const baseReserve = state.phase === 'early' ? 200 :
                           state.phase === 'mid' ? 150 : 100;
        return Math.max(50, Math.min(bestR, baseReserve));
    }

    return Math.max(50, bestR);
}

// =============================================================================
// CREATE AI VARIANTS
// =============================================================================

// Strategy: monkey-patch getMinReserve after creation
function createFactory(label, liqMultiplier, capAtBase) {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = label;

        if (label !== 'Control') {
            const origGetMinReserve = ai.getMinReserve.bind(ai);
            ai.getMinReserve = function(state) {
                return computeDynamicReserve(ai, state, liqMultiplier, capAtBase);
            };
        }

        return ai;
    };
}

// =============================================================================
// RUN TOURNAMENT
// =============================================================================

const GAMES = 1000;
const MAX_TURNS = 500;

const variants = [
    { label: 'Capped 2.0x', liqMult: 2.0, cap: true },
    { label: 'Uncapped 2.0x', liqMult: 2.0, cap: false },
    { label: 'Uncapped 1.5x', liqMult: 1.5, cap: false },
    { label: 'Uncapped 1.0x', liqMult: 1.0, cap: false },
];

console.log('='.repeat(80));
console.log('RESERVE STRATEGY COMPARISON: 1 new vs 3 control, ' + GAMES + ' games each');
console.log('='.repeat(80));
console.log();

for (const variant of variants) {
    const newFactory = createFactory(variant.label, variant.liqMult, variant.cap);
    const controlFactory = createFactory('Control', 2.0, true); // doesn't matter, uses original

    let newWins = 0, controlWins = 0, timeouts = 0;
    const startTime = Date.now();

    for (let i = 0; i < GAMES; i++) {
        const engine = new GameEngine({ maxTurns: MAX_TURNS });

        // Position 0 = new variant, positions 1-3 = control
        const factories = [newFactory, controlFactory, controlFactory, controlFactory];
        engine.newGame(4, factories);
        const result = engine.runGame();

        if (result.winner === 0) newWins++;
        else if (result.winner !== null) controlWins++;
        else timeouts++;

        if ((i + 1) % 200 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log('  [' + variant.label + '] Game ' + (i+1) + '/' + GAMES +
                        ' (' + (i/elapsed).toFixed(0) + ' games/sec)');
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const newRate = (newWins / GAMES * 100).toFixed(1);
    const ctrlRate = (controlWins / (GAMES * 3) * 100).toFixed(1);
    const expected = 25.0;
    const z = (newWins/GAMES - expected/100) / Math.sqrt(expected/100 * (1 - expected/100) / GAMES);

    console.log();
    console.log('-'.repeat(60));
    console.log(variant.label + ':');
    console.log('  New wins: ' + newWins + '/' + GAMES + ' (' + newRate + '%)');
    console.log('  Control avg: ' + ctrlRate + '%');
    console.log('  Timeouts: ' + timeouts);
    console.log('  Z-score: ' + z.toFixed(2) + (Math.abs(z) > 1.96 ? ' ***SIGNIFICANT***' : ''));
    console.log('  Time: ' + elapsed.toFixed(1) + 's');
    console.log();
}
