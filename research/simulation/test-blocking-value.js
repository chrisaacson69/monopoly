/**
 * Test Blocking Value Impact
 *
 * Compare AI with blocking value vs AI without it
 */

'use strict';

const { SimulationRunner } = require('./simulation-runner.js');
const { TradingAI } = require('./trading-ai.js');
const { StrategicAI } = require('./base-ai.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
    PropertyValuator = require('../property-valuator.js');
} catch (e) {}

/**
 * Old TradingAI without blocking value (for comparison)
 */
class OldTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'OldTradingAI';
    }

    // Override evaluateTrade to use old logic (no blocking value)
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        let ourGain = 0;
        let ourLoss = 0;

        for (const prop of fromProperties) {
            ourGain += this.calculatePropertyValue(prop, state);
            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                ourGain += this.calculateMonopolyGain(BOARD[prop].group, state);
            }
        }

        for (const prop of toProperties) {
            ourLoss += this.calculatePropertyValue(prop, state);
            // OLD LOGIC: Just a fixed $100 penalty
            if (this.wouldGiveUpMonopolyChance(prop, state)) {
                ourLoss += 100;
            }
        }

        ourGain += fromCash;
        const netGain = ourGain - ourLoss;
        return netGain >= -50;
    }
}

// Register the old AI
const runner = new SimulationRunner({
    games: 200,
    maxTurns: 500,
    verbose: false,
    progressInterval: 50,
    extraAIs: {
        'oldtrading': OldTradingAI
    }
});

console.log('\n' + '='.repeat(60));
console.log('BLOCKING VALUE IMPACT TEST');
console.log('='.repeat(60));

// Test 1: New TradingAI (with blocking) vs Old TradingAI (without blocking)
console.log('\n>>> Test 1: New Trading AI vs Old Trading AI - 4 player, 2 each');
const results1 = runner.runSimulation(['trading', 'oldtrading', 'trading', 'oldtrading'], 200);
const newWins = results1.wins[0] + results1.wins[2];
const oldWins = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: New=${newWins}, Old=${oldWins}`);
console.log(`Win rate: New ${(newWins/(newWins+oldWins)*100).toFixed(1)}% vs Old ${(oldWins/(newWins+oldWins)*100).toFixed(1)}%`);

// Test 2: All New Trading AI
console.log('\n>>> Test 2: All New Trading AI - game dynamics');
const results2 = runner.runSimulation(['trading', 'trading', 'trading', 'trading'], 200);
console.log(`Avg turns: ${results2.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results2.timeouts} (${(results2.timeouts/200*100).toFixed(0)}%)`);

// Test 3: All Old Trading AI
console.log('\n>>> Test 3: All Old Trading AI - game dynamics');
const results3 = runner.runSimulation(['oldtrading', 'oldtrading', 'oldtrading', 'oldtrading'], 200);
console.log(`Avg turns: ${results3.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results3.timeouts} (${(results3.timeouts/200*100).toFixed(0)}%)`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`
Blocking Value Impact:
  New AI (with blocking) vs Old AI: ${(newWins/(newWins+oldWins)*100).toFixed(0)}% - ${(oldWins/(newWins+oldWins)*100).toFixed(0)}%

Game Dynamics Comparison:
                    New AI    Old AI
  Avg turns:          ${results2.avgTurns.toFixed(0)}        ${results3.avgTurns.toFixed(0)}
  Timeout rate:       ${(results2.timeouts/200*100).toFixed(0)}%       ${(results3.timeouts/200*100).toFixed(0)}%

Interpretation:
  If New AI wins more: blocking value helps defend against unfair trades
  If Old AI wins more: overly cautious trading loses opportunities
  If similar: blocking value provides balance without losing trades
`);
