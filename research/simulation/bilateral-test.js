/**
 * Bilateral Trajectory Test
 *
 * Tests whether the bilateral growth simulation (trajectory-based trade
 * evaluation + trajectory-based pricing) beats the previous best variants.
 *
 * Key hypothesis: the old cash fix conflicted with dynamic reserves because
 * the NPV-snapshot model made the AI stingy when cash-poor. The bilateral
 * model captures the competitive feedback loop, which should make the cash
 * fix and reserves synergistic instead of antagonistic.
 *
 * Variants tested:
 *   Current     = bilateral trajectory + dynamic reserves (the new code)
 *   ReserveOnly = dynamic reserves + original TradingAI cash formula
 *                 (previous best, Z=4.34)
 *   Original    = static reserves + original TradingAI cash formula
 *                 (the baseline)
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
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

// =============================================================================
// FACTORIES
// =============================================================================

// Current: bilateral trajectory + dynamic reserves (the new code, as-is)
function createCurrentFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'BilateralTraj';
        return ai;
    };
}

// ReserveOnly: dynamic reserves but REVERT bilateral trajectory back to
// original TradingAI cash formula and old evaluateTrade
function createReserveOnlyFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'ReserveOnly';

        // Revert bilateral cash → original TradingAI formula
        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            const gainRatio = myGain / (myGain + theirGain);
            const myPropValue = propsGained.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            let cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);
            const maxCash = Math.floor(ai.player.money * ai.maxCashOffer);
            return Math.max(-maxCash, Math.min(maxCash, cashDiff));
        };

        // Revert evaluateTrade → old position-based
        ai.evaluateTrade = function(offer, state) {
            const { from, to } = offer;
            if (to.id !== ai.player.id) return false;

            const opponents = state.players.filter(p => !p.bankrupt).length - 1;
            if (opponents === 0) return false;

            // Use position-based evaluation (the old way)
            const currentPositions = ai.calculateAllPositions(state);
            const myCurrentPos = currentPositions.find(p => p.id === ai.player.id);
            const theirCurrentPos = currentPositions.find(p => p.id === from.id);

            const afterState = ai.simulateTradeState(state, offer);
            const afterPositions = ai.calculateAllPositions(afterState);
            const myAfterPos = afterPositions.find(p => p.id === ai.player.id);
            const theirAfterPos = afterPositions.find(p => p.id === from.id);

            const myPositionChange = myAfterPos.position - myCurrentPos.position;
            const theirPositionChange = theirAfterPos.position - theirCurrentPos.position;

            if (myPositionChange >= -100) {
                if (theirPositionChange <= myPositionChange * 3) {
                    return true;
                }
            }

            const myRelEPTChange = myAfterPos.relativeEPT - myCurrentPos.relativeEPT;
            if (myRelEPTChange > 10 && myPositionChange > -500) {
                return true;
            }

            return false;
        };

        // Then apply StrategicTradeAI quality filter on top
        const revertedEval = ai.evaluateTrade.bind(ai);
        const origQualityFilter = StrategicTradeAI.prototype.evaluateTrade;
        ai.evaluateTrade = function(offer, state) {
            // Call reverted base eval
            if (!revertedEval(offer, state)) return false;

            // Apply quality filter (from StrategicTradeAI)
            if (!ai.tradeParams.enableQualityFilter) return true;

            const { from, fromProperties, toProperties } = offer;
            const propsGained = fromProperties instanceof Set ? [...fromProperties] : (fromProperties || []);
            const propsGiven = toProperties instanceof Set ? [...toProperties] : (toProperties || []);
            if (propsGained.length === 0 || propsGiven.length === 0) return true;

            const myProps = ai.player.properties instanceof Set ? [...ai.player.properties] : (ai.player.properties || []);
            const myPropsAfter = [...myProps, ...propsGained].filter(p => !propsGiven.includes(p));
            const theirProps = from.properties instanceof Set ? [...from.properties] : (from.properties || []);
            const theirPropsAfter = [...theirProps, ...propsGiven].filter(p => !propsGained.includes(p));

            const ourQuality = ai.calculateMonopolyQuality(myPropsAfter, myProps);
            const theirQuality = ai.calculateMonopolyQuality(theirPropsAfter, theirProps);

            if (ourQuality === 0 && theirQuality === 0) return true;
            if (ourQuality >= theirQuality * ai.tradeParams.qualityAcceptThreshold) return true;
            if (theirQuality > ourQuality * ai.tradeParams.qualityRejectThreshold) return false;
            return true;
        };

        return ai;
    };
}

// Original: revert BOTH bilateral trajectory AND dynamic reserves
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
        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            const gainRatio = myGain / (myGain + theirGain);
            const myPropValue = propsGained.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            let cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);
            const maxCash = Math.floor(ai.player.money * ai.maxCashOffer);
            return Math.max(-maxCash, Math.min(maxCash, cashDiff));
        };

        // Revert evaluateTrade → old position-based (same as ReserveOnly above)
        ai.evaluateTrade = function(offer, state) {
            const { from, to } = offer;
            if (to.id !== ai.player.id) return false;

            const opponents = state.players.filter(p => !p.bankrupt).length - 1;
            if (opponents === 0) return false;

            const currentPositions = ai.calculateAllPositions(state);
            const myCurrentPos = currentPositions.find(p => p.id === ai.player.id);
            const theirCurrentPos = currentPositions.find(p => p.id === from.id);

            const afterState = ai.simulateTradeState(state, offer);
            const afterPositions = ai.calculateAllPositions(afterState);
            const myAfterPos = afterPositions.find(p => p.id === ai.player.id);
            const theirAfterPos = afterPositions.find(p => p.id === from.id);

            const myPositionChange = myAfterPos.position - myCurrentPos.position;
            const theirPositionChange = theirAfterPos.position - theirCurrentPos.position;

            if (myPositionChange >= -100) {
                if (theirPositionChange <= myPositionChange * 3) {
                    return true;
                }
            }

            const myRelEPTChange = myAfterPos.relativeEPT - myCurrentPos.relativeEPT;
            if (myRelEPTChange > 10 && myPositionChange > -500) {
                return true;
            }

            return false;
        };

        // Apply quality filter
        const revertedEval = ai.evaluateTrade.bind(ai);
        ai.evaluateTrade = function(offer, state) {
            if (!revertedEval(offer, state)) return false;
            if (!ai.tradeParams.enableQualityFilter) return true;

            const { from, fromProperties, toProperties } = offer;
            const propsGained = fromProperties instanceof Set ? [...fromProperties] : (fromProperties || []);
            const propsGiven = toProperties instanceof Set ? [...toProperties] : (toProperties || []);
            if (propsGained.length === 0 || propsGiven.length === 0) return true;

            const myProps = ai.player.properties instanceof Set ? [...ai.player.properties] : (ai.player.properties || []);
            const myPropsAfter = [...myProps, ...propsGained].filter(p => !propsGiven.includes(p));
            const theirProps = from.properties instanceof Set ? [...from.properties] : (from.properties || []);
            const theirPropsAfter = [...theirProps, ...propsGiven].filter(p => !propsGained.includes(p));

            const ourQuality = ai.calculateMonopolyQuality(myPropsAfter, myProps);
            const theirQuality = ai.calculateMonopolyQuality(theirPropsAfter, theirProps);

            if (ourQuality === 0 && theirQuality === 0) return true;
            if (ourQuality >= theirQuality * ai.tradeParams.qualityAcceptThreshold) return true;
            if (theirQuality > ourQuality * ai.tradeParams.qualityRejectThreshold) return false;
            return true;
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

    const newCount = 1;
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
                        '  wins=' + newWins + ' (' + wr + '%)' +
                        '  ' + elapsed.toFixed(0) + 's');
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
console.log('BILATERAL TRAJECTORY TEST');
console.log(GAMES + ' games each, 1 new vs 3 baseline');
console.log('='.repeat(80));
console.log();
console.log('Variants:');
console.log('  BilateralTraj = bilateral trajectory sim + dynamic reserves (NEW)');
console.log('  ReserveOnly   = dynamic reserves + old position-based eval (Z=4.34 prev)');
console.log('  Original      = static reserves + old eval (baseline)');
console.log();

const results = [];
const originalFactory = createOriginalFactory();

results.push(runTest('BilateralTraj vs Original', createCurrentFactory(), originalFactory, GAMES, 4));
results.push(runTest('ReserveOnly vs Original', createReserveOnlyFactory(), originalFactory, GAMES, 4));

console.log('='.repeat(80));
console.log('SUMMARY:');
console.log('='.repeat(80));
for (const r of results) {
    console.log('  ' + r.label.padEnd(35) + r.winRate + '%  Z=' + r.z);
}
console.log('  ' + 'Expected (no improvement)'.padEnd(35) + '25.0%  Z=0.00');
console.log('='.repeat(80));
