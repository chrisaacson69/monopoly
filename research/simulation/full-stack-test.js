/**
 * Full Stack Test: Current StrategicTradeAI vs Original
 *
 * Tests whether the cumulative changes (cash runway fix + dynamic reserves)
 * beat the original StrategicTradeAI. Each change was tested in isolation:
 *   - Cash runway fix: 28.4% (Z=2.40)
 *   - Dynamic reserves: 26.8% (Z=2.28)
 *
 * But do they stack? This test runs:
 *   1. Current (both changes) vs Original (neither) — head-to-head
 *   2. Current vs Original in 1-vs-3 format
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

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

// =============================================================================
// FACTORIES
// =============================================================================

// Current: has both cash runway fix (in RelativeGrowthAI.calculateMutualTradeCash)
// and dynamic reserves (in EnhancedRelativeAI.getMinReserve)
function createCurrentFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Current';
        return ai;
    };
}

// Original: revert BOTH changes
// 1. Override getMinReserve back to static phase-based
// 2. Override calculateMutualTradeCash back to the parent TradingAI version
function createOriginalFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Original';

        // Revert dynamic reserves → static phase-based
        ai.getMinReserve = function(state) {
            switch (state.phase) {
                case 'early': return 200;
                case 'mid': return 150;
                case 'late': return 100;
                default: return 150;
            }
        };

        // Revert bilateral cash → original TradingAI formula
        // Original: cashDiff = (myPropValue - theirPropValue) * gainRatio
        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            const gainRatio = myGain / (myGain + theirGain);
            const myPropValue = propsGained.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            let cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);
            const maxCash = Math.floor(ai.player.money * ai.maxCashOffer);
            return Math.max(-maxCash, Math.min(maxCash, cashDiff));
        };

        return ai;
    };
}

// Cash fix only (no dynamic reserves)
function createCashFixOnlyFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'CashFixOnly';

        // Revert reserves to static, keep bilateral cash
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

// Reserve fix only (no cash runway fix)
function createReserveFixOnlyFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'ReserveOnly';

        // Keep dynamic reserves, revert bilateral cash
        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            const gainRatio = myGain / (myGain + theirGain);
            const myPropValue = propsGained.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            let cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);
            const maxCash = Math.floor(ai.player.money * ai.maxCashOffer);
            return Math.max(-maxCash, Math.min(maxCash, cashDiff));
        };

        return ai;
    };
}

// =============================================================================
// TOURNAMENT RUNNER
// =============================================================================

function runTest(label, newFactory, baseFactory, games, nPlayers) {
    let newWins = 0, baseWins = 0, timeouts = 0;
    const startTime = Date.now();

    const newCount = nPlayers === 2 ? 1 : 1;
    const baseCount = nPlayers - newCount;

    for (let i = 0; i < games; i++) {
        const engine = new GameEngine({ maxTurns: 500 });
        const factories = [newFactory];
        for (let j = 0; j < baseCount; j++) factories.push(baseFactory);
        engine.newGame(nPlayers, factories);
        const result = engine.runGame();

        if (result.winner === 0) newWins++;
        else if (result.winner !== null) baseWins++;
        else timeouts++;

        if ((i + 1) % 500 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const wr = (newWins / (i+1) * 100).toFixed(1);
            console.log('  [' + label + '] Game ' + (i+1) + '/' + games +
                        '  wins=' + newWins + ' (' + wr + '%)');
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const expected = 1 / nPlayers;
    const newRate = newWins / games;
    const z = (newRate - expected) / Math.sqrt(expected * (1 - expected) / games);

    console.log();
    console.log('-'.repeat(60));
    console.log(label + ':');
    console.log('  New: ' + newWins + '/' + games + ' (' + (newRate * 100).toFixed(1) + '%)');
    console.log('  Base: ' + baseWins + '/' + games + ' (avg ' +
        (baseWins / (games * baseCount) * 100).toFixed(1) + '% each)');
    console.log('  Timeouts: ' + timeouts);
    console.log('  Z=' + z.toFixed(2) +
        (Math.abs(z) > 2.58 ? ' ***HIGHLY SIGNIFICANT (p<0.01)***' :
         Math.abs(z) > 1.96 ? ' ***SIGNIFICANT (p<0.05)***' :
         Math.abs(z) > 1.64 ? ' *marginal*' : ''));
    console.log('  ' + elapsed.toFixed(0) + 's');
    console.log();

    return { label, winRate: (newRate * 100).toFixed(1), z: z.toFixed(2) };
}

// =============================================================================
// RUN TESTS
// =============================================================================

const GAMES = 2000;

console.log('='.repeat(80));
console.log('FULL STACK TEST: Do the changes stack?');
console.log(GAMES + ' games each, 1 new vs 3 baseline');
console.log('='.repeat(80));
console.log();
console.log('Variants:');
console.log('  Current     = cash runway fix + dynamic reserves (both changes)');
console.log('  CashFixOnly = cash runway fix only (static reserves)');
console.log('  ReserveOnly = dynamic reserves only (old cash formula)');
console.log('  Original    = neither change (the old StrategicTradeAI)');
console.log();

const results = [];

// Each variant vs the Original baseline
const originalFactory = createOriginalFactory();

results.push(runTest('Current vs Original', createCurrentFactory(), originalFactory, GAMES, 4));
results.push(runTest('CashFixOnly vs Original', createCashFixOnlyFactory(), originalFactory, GAMES, 4));
results.push(runTest('ReserveOnly vs Original', createReserveFixOnlyFactory(), originalFactory, GAMES, 4));

console.log('='.repeat(80));
console.log('SUMMARY:');
console.log('='.repeat(80));
for (const r of results) {
    console.log('  ' + r.label.padEnd(30) + r.winRate + '%  Z=' + r.z);
}
console.log('  Expected (no improvement)'.padEnd(30) + '25.0%  Z=0.00');
console.log('='.repeat(80));
