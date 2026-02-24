/**
 * Nash Pricing Comparison: Convergence-point vs Area-equality
 *
 * Tests whether the convergence-point Nash (find t where trajectories
 * are closest, equalize gap at that t) outperforms area-equality Nash
 * (equalize sum of trajectory positions).
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');

let MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
let PropertyValuator = require('../../ai/property-valuator.js');
let markovEngine = new MarkovEngine();
markovEngine.initialize();
let valuator = new PropertyValuator.Valuator(markovEngine);
valuator.initialize();
console.log('Ready.');

// Current = convergence-point Nash (in the code now)
function createConvergenceFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'ConvergenceNash';
        return ai;
    };
}

// Area-equality variant: override calculateMutualTradeCash to use area
function createAreaFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'AreaNash';

        const origMethod = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(ai)))).calculateMutualTradeCash;

        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            if (!myGroup || !theirGroup || !COLOR_GROUPS[myGroup] || !COLOR_GROUPS[theirGroup]) {
                return origMethod.call(ai, myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state);
            }

            const activePlayers = state.players.filter(p => !p.bankrupt);
            const numOtherOpponents = activePlayers.length - 2;
            if (numOtherOpponents < 0) return 0;

            const myCash = ai.player.money;
            const opponentId = state.propertyStates[propsGained[0]]?.owner;
            const opponent = state.players.find(p => p.id === opponentId);
            const theirCash = opponent ? opponent.money : 0;
            const maxCash = Math.floor(myCash * ai.maxCashOffer);

            const getPostTradeGroups = (playerId, gainedGroup, lostGroup) => {
                const groups = [];
                for (const [gName, gData] of Object.entries(COLOR_GROUPS)) {
                    if (gName === lostGroup) continue;
                    if (gName === gainedGroup) { groups.push(gName); continue; }
                    if (gData.squares.every(sq => state.propertyStates[sq]?.owner === playerId)) {
                        groups.push(gName);
                    }
                }
                return groups;
            };

            const myGroups = getPostTradeGroups(ai.player.id, myGroup, theirGroup);
            const theirGroups = getPostTradeGroups(opponentId, theirGroup, myGroup);

            const postTradePS = { ...state.propertyStates };
            for (const sq of propsGained) postTradePS[sq] = { ...postTradePS[sq], owner: ai.player.id };
            for (const sq of propsGiven) postTradePS[sq] = { ...postTradePS[sq], owner: opponentId };

            const myPropValue = propsGained.reduce((s, sq) => s + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((s, sq) => s + BOARD[sq].price, 0);

            let bestCash = Math.max(-maxCash, Math.min(maxCash, myPropValue - theirPropValue));
            let minAreaDiff = Infinity;
            const step = 50;
            const searchMin = Math.max(-maxCash, -500);
            const searchMax = Math.min(maxCash, myCash);

            for (let cash = searchMin; cash <= searchMax; cash += step) {
                const myCashAfter = myCash - cash;
                const theirCashAfter = theirCash + cash;
                if (myCashAfter < 0 || theirCashAfter < 0) continue;

                const { myTrajectory, theirTrajectory } = ai.simulateBilateralGrowth(
                    { groups: myGroups, cash: myCashAfter, id: ai.player.id },
                    { groups: theirGroups, cash: theirCashAfter, id: opponentId },
                    postTradePS, numOtherOpponents
                );

                // AREA equality
                const myArea = myTrajectory.reduce((s, v) => s + v, 0);
                const theirArea = theirTrajectory.reduce((s, v) => s + v, 0);
                const areaDiff = Math.abs(myArea - theirArea);
                if (areaDiff < minAreaDiff) {
                    minAreaDiff = areaDiff;
                    bestCash = cash;
                }
            }
            return Math.max(-maxCash, Math.min(maxCash, bestCash));
        };
        return ai;
    };
}

// Original baseline (revert everything)
function createOriginalFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Original';

        ai.getMinReserve = function(state) {
            switch (state.phase) {
                case 'early': return 200;
                case 'mid': return 150;
                case 'late': return 100;
                default: return 150;
            }
        };

        ai.calculateMutualTradeCash = function(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
            const gainRatio = myGain / (myGain + theirGain);
            const myPropValue = propsGained.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const theirPropValue = propsGiven.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            let cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);
            const maxCash = Math.floor(ai.player.money * ai.maxCashOffer);
            return Math.max(-maxCash, Math.min(maxCash, cashDiff));
        };

        ai.evaluateTrade = function(offer, state) {
            const { from, to } = offer;
            if (to.id !== ai.player.id) return false;
            const opponents = state.players.filter(p => !p.bankrupt).length - 1;
            if (opponents === 0) return false;
            const cp = ai.calculateAllPositions(state);
            const myC = cp.find(p => p.id === ai.player.id);
            const afterState = ai.simulateTradeState(state, offer);
            const ap = ai.calculateAllPositions(afterState);
            const myA = ap.find(p => p.id === ai.player.id);
            const thA = ap.find(p => p.id === from.id);
            const thC = cp.find(p => p.id === from.id);
            const myD = myA.position - myC.position;
            const thD = thA.position - thC.position;
            if (myD >= -100 && thD <= myD * 3) return true;
            const myR = myA.relativeEPT - myC.relativeEPT;
            if (myR > 10 && myD > -500) return true;
            return false;
        };

        // Re-apply quality filter
        const baseEval = ai.evaluateTrade.bind(ai);
        ai.evaluateTrade = function(offer, state) {
            if (!baseEval(offer, state)) return false;
            if (!ai.tradeParams.enableQualityFilter) return true;
            const { from, fromProperties, toProperties } = offer;
            const pg = fromProperties instanceof Set ? [...fromProperties] : (fromProperties || []);
            const pg2 = toProperties instanceof Set ? [...toProperties] : (toProperties || []);
            if (pg.length === 0 || pg2.length === 0) return true;
            const mp = ai.player.properties instanceof Set ? [...ai.player.properties] : [];
            const mpa = [...mp, ...pg].filter(p => !pg2.includes(p));
            const tp = from.properties instanceof Set ? [...from.properties] : [];
            const tpa = [...tp, ...pg2].filter(p => !pg.includes(p));
            const oq = ai.calculateMonopolyQuality(mpa, mp);
            const tq = ai.calculateMonopolyQuality(tpa, tp);
            if (oq === 0 && tq === 0) return true;
            if (oq >= tq * ai.tradeParams.qualityAcceptThreshold) return true;
            if (tq > oq * ai.tradeParams.qualityRejectThreshold) return false;
            return true;
        };

        return ai;
    };
}

// Tournament runner
function runTest(label, newFactory, baseFactory, games) {
    let newWins = 0, timeouts = 0;
    const startTime = Date.now();
    for (let i = 0; i < games; i++) {
        const engine = new GameEngine({ maxTurns: 500 });
        engine.newGame(4, [newFactory, baseFactory, baseFactory, baseFactory]);
        const result = engine.runGame();
        if (result.winner === 0) newWins++;
        else if (result.winner === null) timeouts++;
        if ((i + 1) % 500 === 0) {
            const wr = (newWins / (i + 1) * 100).toFixed(1);
            console.log('  [' + label + '] ' + (i + 1) + '/' + games +
                        '  wins=' + newWins + ' (' + wr + '%)');
        }
    }
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = newWins / games;
    const z = (rate - 0.25) / Math.sqrt(0.25 * 0.75 / games);
    console.log();
    console.log(label + ':');
    console.log('  ' + newWins + '/' + games + ' (' + (rate * 100).toFixed(1) + '%)');
    console.log('  Z=' + z.toFixed(2) +
        (Math.abs(z) > 2.58 ? ' ***HIGHLY SIGNIFICANT***' :
         Math.abs(z) > 1.96 ? ' ***SIGNIFICANT***' :
         Math.abs(z) > 1.64 ? ' *marginal*' : ''));
    console.log('  ' + elapsed.toFixed(0) + 's');
    console.log();
    return { label, rate: (rate * 100).toFixed(1), z: z.toFixed(2) };
}

// Run
const GAMES = 2000;
console.log('='.repeat(70));
console.log('NASH PRICING COMPARISON: ' + GAMES + ' games each');
console.log('='.repeat(70));

const orig = createOriginalFactory();
const results = [];
results.push(runTest('ConvergenceNash vs Original', createConvergenceFactory(), orig, GAMES));
results.push(runTest('AreaNash vs Original', createAreaFactory(), orig, GAMES));

console.log('='.repeat(70));
console.log('SUMMARY:');
for (const r of results) {
    console.log('  ' + r.label.padEnd(35) + r.rate + '%  Z=' + r.z);
}
console.log('  ' + 'Expected (no improvement)'.padEnd(35) + '25.0%  Z=0.00');
console.log('='.repeat(70));
