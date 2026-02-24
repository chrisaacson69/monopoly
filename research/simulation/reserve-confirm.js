/**
 * Confirmation tournament: Dynamic reserve (1.0x uncapped) vs Control
 * 3000 games for high confidence.
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
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

function createFactory(label) {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = label;
        return ai;
    };
}

// The "new" factory uses the updated getMinReserve (1.0x uncapped) in the code
// The "control" factory uses a copy with the OLD static reserves
function createControlFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Control';
        // Override with static phase-based reserves (the old behavior)
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

const GAMES = 3000;

console.log('='.repeat(80));
console.log('CONFIRMATION: Dynamic Reserve (1.0x uncapped) vs Static Control');
console.log(GAMES + ' games, 1 new vs 3 control');
console.log('='.repeat(80));
console.log();

const newFactory = createFactory('Dynamic');
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
        const rate = ((i+1) / elapsed).toFixed(0);
        const wr = (newWins / (i+1) * 100).toFixed(1);
        const z = (newWins/(i+1) - 0.25) / Math.sqrt(0.25 * 0.75 / (i+1));
        console.log('  Game ' + (i+1) + '/' + GAMES +
                    ' (' + rate + ' g/s)' +
                    '  wins=' + newWins + ' (' + wr + '%)' +
                    '  Z=' + z.toFixed(2));
    }
}

const elapsed = (Date.now() - startTime) / 1000;
const newRate = (newWins / GAMES * 100).toFixed(1);
const ctrlRate = (controlWins / (GAMES * 3) * 100).toFixed(1);
const z = (newWins/GAMES - 0.25) / Math.sqrt(0.25 * 0.75 / GAMES);

console.log();
console.log('='.repeat(60));
console.log('FINAL RESULTS:');
console.log('  Dynamic (1.0x uncapped): ' + newWins + '/' + GAMES + ' (' + newRate + '%)');
console.log('  Control (static) avg:    ' + ctrlRate + '%');
console.log('  Timeouts: ' + timeouts);
console.log('  Z-score: ' + z.toFixed(2) +
    (Math.abs(z) > 2.58 ? ' ***HIGHLY SIGNIFICANT (p<0.01)***' :
     Math.abs(z) > 1.96 ? ' ***SIGNIFICANT (p<0.05)***' :
     Math.abs(z) > 1.64 ? ' *marginal (p<0.10)*' : ' (not significant)'));
console.log('  Time: ' + elapsed.toFixed(0) + 's');
console.log('='.repeat(60));
