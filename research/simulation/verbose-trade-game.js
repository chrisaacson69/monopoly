/**
 * Run a single verbose game to see trading in action
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
    PropertyValuator = require('../property-valuator.js');
} catch (e) {}

let markovEngine = null;
let valuator = null;

if (MarkovEngine) {
    markovEngine = new MarkovEngine();
    markovEngine.initialize();
    if (PropertyValuator) {
        valuator = new PropertyValuator.Valuator(markovEngine);
        valuator.initialize();
    }
}

console.log('\n' + '='.repeat(60));
console.log('VERBOSE TRADING GAME');
console.log('='.repeat(60));

const engine = new GameEngine({
    maxTurns: 200,
    verbose: true
});

// Create two trading AIs
const factories = [
    (player, eng) => new TradingAI(player, eng, markovEngine, valuator),
    (player, eng) => new TradingAI(player, eng, markovEngine, valuator)
];

engine.newGame(2, factories);
const result = engine.runGame();

console.log('\n' + '='.repeat(60));
console.log('GAME RESULTS');
console.log('='.repeat(60));
console.log(`\nWinner: Player ${result.winner !== null ? result.winner + 1 : 'None (timeout)'}`);
console.log(`Turns: ${result.turns}`);

console.log('\nFinal State:');
for (let i = 0; i < 2; i++) {
    const player = result.finalState.players[i];
    const monopolies = player.getMonopolies(result.finalState);
    console.log(`  Player ${i + 1}: $${player.money}, ${player.properties.size} properties`);
    if (monopolies.length > 0) {
        console.log(`    Monopolies: ${monopolies.join(', ')}`);
    }
}
