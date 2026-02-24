/**
 * Confirmation tournament: Asset-mix-aware reserves (no flat multiplier) vs Control
 * Also compares against the 1.0x flat multiplier version.
 * 2000 games each for statistical power.
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

// Old 1.0x flat multiplier version for comparison
function computeFlatReserve(ai, state) {
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
                if (ps.houses > 0) rent = sq.rent[ps.houses];
                else if (sq.group && COLOR_GROUPS[sq.group] &&
                    COLOR_GROUPS[sq.group].squares.every(s =>
                        state.propertyStates[s].owner === opp.id))
                    rent = sq.rent[0] * 2;
                else rent = sq.rent[0];
            } else if ([5, 15, 25, 35].includes(propIdx)) {
                rent = RAILROAD_RENT[rrCount];
            }
            if (rent > 0) { exposures.push({ p: prob, rent }); if (rent > maxRent) maxRent = rent; }
        }
    }
    if (maxRent <= 50) return 50;

    let bestMarginalEPT = 0, bestCostPerLevel = 300;
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
    if (bestMarginalEPT === 0) { bestMarginalEPT = 10; bestCostPerLevel = 300; }

    let bestR = 0, minCost = Infinity;
    for (let R = 0; R <= maxRent; R += 25) {
        let liqCost = 0;
        for (const { p, rent } of exposures) {
            liqCost += p * Math.max(0, rent - R) * 1.0;  // flat 1.0x
        }
        const oppCost = (R / bestCostPerLevel) * bestMarginalEPT;
        const total = liqCost + oppCost;
        if (total < minCost) { minCost = total; bestR = R; }
    }
    return Math.max(50, bestR);
}

function createControlFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Control';
        ai.getMinReserve = function(state) {
            switch (state.phase) {
                case 'early': return 200;
                case 'mid': return 150;
                case 'late': return 100;
                default: return 150;
            }
        };
        return ai;
    };
}

function createAssetMixFactory() {
    // Uses the current code in enhanced-relative-ai.js (asset-mix aware)
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'AssetMix';
        // getMinReserve is already the asset-mix version from the code
        return ai;
    };
}

function createFlat1xFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Flat1x';
        ai.getMinReserve = function(state) {
            return computeFlatReserve(ai, state);
        };
        return ai;
    };
}

const GAMES = 2000;

function runTest(label, newFactory) {
    const controlFactory = createControlFactory();
    let newWins = 0, controlWins = 0, timeouts = 0;
    const startTime = Date.now();

    for (let i = 0; i < GAMES; i++) {
        const engine = new GameEngine({ maxTurns: 500 });
        const factories = [newFactory, controlFactory, controlFactory, controlFactory];
        engine.newGame(4, factories);
        const result = engine.runGame();

        if (result.winner === 0) newWins++;
        else if (result.winner !== null) controlWins++;
        else timeouts++;

        if ((i + 1) % 500 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const wr = (newWins / (i+1) * 100).toFixed(1);
            const z = (newWins/(i+1) - 0.25) / Math.sqrt(0.25 * 0.75 / (i+1));
            console.log('  [' + label + '] Game ' + (i+1) + '/' + GAMES +
                        '  wins=' + newWins + ' (' + wr + '%)  Z=' + z.toFixed(2));
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const newRate = (newWins / GAMES * 100).toFixed(1);
    const ctrlRate = (controlWins / (GAMES * 3) * 100).toFixed(1);
    const z = (newWins/GAMES - 0.25) / Math.sqrt(0.25 * 0.75 / GAMES);

    console.log();
    console.log('-'.repeat(60));
    console.log(label + ':');
    console.log('  New: ' + newWins + '/' + GAMES + ' (' + newRate + '%)');
    console.log('  Ctrl avg: ' + ctrlRate + '%');
    console.log('  Timeouts: ' + timeouts);
    console.log('  Z=' + z.toFixed(2) +
        (Math.abs(z) > 2.58 ? ' ***HIGHLY SIGNIFICANT (p<0.01)***' :
         Math.abs(z) > 1.96 ? ' ***SIGNIFICANT (p<0.05)***' :
         Math.abs(z) > 1.64 ? ' *marginal*' : ''));
    console.log('  ' + elapsed.toFixed(0) + 's');
    console.log();

    return { label, newRate, z };
}

console.log('='.repeat(80));
console.log('RESERVE COMPARISON: Asset-Mix vs Flat 1.0x vs Static Control');
console.log(GAMES + ' games each, 1 new vs 3 control');
console.log('='.repeat(80));
console.log();

const results = [];
results.push(runTest('Asset-Mix (derived)', createAssetMixFactory()));
results.push(runTest('Flat 1.0x (fudge)', createFlat1xFactory()));

console.log('='.repeat(60));
console.log('SUMMARY:');
for (const r of results) {
    console.log('  ' + r.label.padEnd(25) + r.newRate + '%  Z=' + r.z.toFixed(2));
}
console.log('  Control (static)'.padEnd(25) + '25.0% (expected)');
console.log('='.repeat(60));
