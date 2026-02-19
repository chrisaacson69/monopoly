/**
 * Detailed Trade Investigation
 *
 * Look at actual trades to understand why they're so "unfair"
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
    PropertyValuator = require('../property-valuator.js');
} catch (e) {
    console.error('Markov engine required');
    process.exit(1);
}

const markovEngine = new MarkovEngine();
markovEngine.initialize();
const valuator = new PropertyValuator.Valuator(markovEngine);
valuator.initialize();

const probs = markovEngine.getAllProbabilities('stay');

// Run one verbose game
console.log('='.repeat(70));
console.log('DETAILED TRADE INVESTIGATION');
console.log('='.repeat(70));

// Custom engine that logs trades in detail
class VerboseEngine extends GameEngine {
    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        console.log(`\n${'='.repeat(50)}`);
        console.log(`TRADE at turn ${this.state.turn}:`);
        console.log(`  ${from.name} gives:`);

        let fromEPT = 0;
        for (const prop of fromProperties) {
            const sq = BOARD[prop];
            const ept = probs[prop] * (sq.rent?.[3] || 0) * 3;  // 3 opponents
            fromEPT += ept;
            console.log(`    - ${sq.name} (EPT@3H: ${ept.toFixed(2)})`);
        }
        if (fromCash > 0) {
            console.log(`    - $${fromCash} cash`);
        }
        console.log(`  Total EPT given: ${fromEPT.toFixed(2)}`);

        console.log(`\n  ${to.name} gives:`);
        let toEPT = 0;
        for (const prop of toProperties) {
            const sq = BOARD[prop];
            const ept = probs[prop] * (sq.rent?.[3] || 0) * 3;
            toEPT += ept;
            console.log(`    - ${sq.name} (EPT@3H: ${ept.toFixed(2)})`);
        }
        if (fromCash < 0) {
            console.log(`    - $${-fromCash} cash`);
        }
        console.log(`  Total EPT given: ${toEPT.toFixed(2)}`);

        // Check monopolies
        const fromGetsMonopoly = this.checkMonopolyCompletion(from, toProperties);
        const toGetsMonopoly = this.checkMonopolyCompletion(to, fromProperties);

        console.log(`\n  Result:`);
        console.log(`    ${from.name} gets monopoly: ${fromGetsMonopoly || 'NO'}`);
        console.log(`    ${to.name} gets monopoly: ${toGetsMonopoly || 'NO'}`);
        console.log(`    EPT difference: ${(toEPT - fromEPT).toFixed(2)} (+ cash factor: ${fromCash * 0.01})`);

        // What's the "true" value considering monopoly completion?
        if (fromGetsMonopoly) {
            const groupEPT = this.calculateGroupEPT(fromGetsMonopoly);
            console.log(`    ${from.name}'s ${fromGetsMonopoly} monopoly EPT@3H: ${groupEPT.toFixed(2)}`);
        }
        if (toGetsMonopoly) {
            const groupEPT = this.calculateGroupEPT(toGetsMonopoly);
            console.log(`    ${to.name}'s ${toGetsMonopoly} monopoly EPT@3H: ${groupEPT.toFixed(2)}`);
        }

        return super.executeTrade(trade);
    }

    checkMonopolyCompletion(player, properties) {
        for (const prop of properties) {
            const sq = BOARD[prop];
            if (!sq.group) continue;

            const groupSquares = COLOR_GROUPS[sq.group].squares;
            const wouldOwn = groupSquares.filter(s =>
                player.properties.has(s) || properties.has(s)
            ).length;

            if (wouldOwn === groupSquares.length) {
                return sq.group;
            }
        }
        return null;
    }

    calculateGroupEPT(group) {
        const groupSquares = COLOR_GROUPS[group].squares;
        let totalEPT = 0;
        for (const sq of groupSquares) {
            totalEPT += probs[sq] * (BOARD[sq].rent?.[3] || 0) * 3;
        }
        return totalEPT;
    }
}

// Run a game
const engine = new VerboseEngine({
    maxTurns: 100,
    verbose: true
});

const factories = [
    (p, e) => new TradingAI(p, e, markovEngine, valuator),
    (p, e) => new TradingAI(p, e, markovEngine, valuator),
    (p, e) => new TradingAI(p, e, markovEngine, valuator),
    (p, e) => new TradingAI(p, e, markovEngine, valuator)
];

engine.newGame(4, factories);
const result = engine.runGame();

console.log('\n' + '='.repeat(70));
console.log(`Game ended at turn ${result.turns}`);
console.log(`Winner: ${result.winner !== null ? `Player ${result.winner + 1}` : 'None'}`);
console.log('='.repeat(70));
