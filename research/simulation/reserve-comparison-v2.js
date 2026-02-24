/**
 * Reserve Strategy Comparison v2 — Focused on Low Multipliers
 *
 * The v1 results showed 1.0x uncapped as the most promising (Z=1.39).
 * This test narrows in on the aggressive end: 0.5x, 0.75x, 1.0x
 * with 2000 games each for higher statistical power.
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
    console.log('Ready.');
}

function computeDynamicReserve(ai, state, liqMultiplier) {
    const myMonopolies = ai.getMyMonopolies(state);
    if (myMonopolies.length === 0) {
        return state.phase === 'early' ? 200 : state.phase === 'mid' ? 150 : 100;
    }

    const opponents = state.players.filter(p => !p.bankrupt && p.id !== ai.player.id);
    if (opponents.length === 0) return 50;

    const getProb = (idx) => (ai.probs && ai.probs[idx]) || 0.025;

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

    let bestR = 0;
    let minCost = Infinity;

    for (let R = 0; R <= maxRent; R += 25) {
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

    return Math.max(50, bestR);
}

function createFactory(label, liqMultiplier) {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = label;

        if (liqMultiplier !== null) {
            ai.getMinReserve = function(state) {
                return computeDynamicReserve(ai, state, liqMultiplier);
            };
        }
        // null = control (use original getMinReserve)

        return ai;
    };
}

const GAMES = 2000;
const MAX_TURNS = 500;

const variants = [
    { label: 'Uncapped 0.5x', liqMult: 0.5 },
    { label: 'Uncapped 0.75x', liqMult: 0.75 },
    { label: 'Uncapped 1.0x', liqMult: 1.0 },
];

console.log('='.repeat(80));
console.log('RESERVE COMPARISON v2: Low multipliers, ' + GAMES + ' games each');
console.log('='.repeat(80));
console.log();

for (const variant of variants) {
    const newFactory = createFactory(variant.label, variant.liqMult);
    const controlFactory = createFactory('Control', null);

    let newWins = 0, controlWins = 0, timeouts = 0;
    const startTime = Date.now();

    for (let i = 0; i < GAMES; i++) {
        const engine = new GameEngine({ maxTurns: MAX_TURNS });
        const factories = [newFactory, controlFactory, controlFactory, controlFactory];
        engine.newGame(4, factories);
        const result = engine.runGame();

        if (result.winner === 0) newWins++;
        else if (result.winner !== null) controlWins++;
        else timeouts++;

        if ((i + 1) % 500 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log('  [' + variant.label + '] Game ' + (i+1) + '/' + GAMES +
                        ' (' + (i/elapsed).toFixed(0) + ' g/s)' +
                        ' wins=' + newWins + ' (' + (newWins/(i+1)*100).toFixed(1) + '%)');
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const newRate = (newWins / GAMES * 100).toFixed(1);
    const ctrlRate = (controlWins / (GAMES * 3) * 100).toFixed(1);
    const expected = 0.25;
    const z = (newWins/GAMES - expected) / Math.sqrt(expected * (1 - expected) / GAMES);

    console.log();
    console.log('-'.repeat(60));
    console.log(variant.label + ':');
    console.log('  New: ' + newWins + '/' + GAMES + ' (' + newRate + '%)');
    console.log('  Ctrl avg: ' + ctrlRate + '%');
    console.log('  Timeouts: ' + timeouts);
    console.log('  Z=' + z.toFixed(2) + (Math.abs(z) > 1.96 ? ' ***SIGNIFICANT***' : Math.abs(z) > 1.64 ? ' *marginal*' : ''));
    console.log('  ' + elapsed.toFixed(0) + 's');
    console.log();
}
