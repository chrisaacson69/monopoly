/**
 * Parameter Sweep for Trading AI
 *
 * Tests different trading parameter values to find optimal settings
 * and gather insights about property valuation.
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { StrategicAI } = require('./base-ai.js');
const { TradingAI } = require('./trading-ai.js');

// Load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.error('Markov engine required for parameter sweep');
    process.exit(1);
}

// Initialize shared components
const markovEngine = new MarkovEngine();
markovEngine.initialize();
const valuator = new PropertyValuator.Valuator(markovEngine);
valuator.initialize();

// =============================================================================
// CONFIGURABLE TRADING AI
// =============================================================================

class ConfigurableTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator, config = {}) {
        super(player, engine, markovEngine, valuator);

        // Override default parameters with config
        this.maxCashOffer = config.maxCashOffer ?? 0.5;
        this.cashPremiumMultiplier = config.cashPremiumMultiplier ?? 10;
        this.acceptanceThreshold = config.acceptanceThreshold ?? -50;
        this.paybackLimit = config.paybackLimit ?? 40;

        this.config = config;
        this.name = `TradingAI(${JSON.stringify(config)})`;
    }

    /**
     * Override cash offer calculation to use configurable multiplier
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        let baseValue = 0;
        for (const prop of properties) {
            baseValue += BOARD[prop].price;
        }

        // Configurable premium multiplier
        const premium = Math.floor(eptGain * this.cashPremiumMultiplier);
        const offer = baseValue + premium;
        const maxOffer = Math.floor(this.player.money * this.maxCashOffer);

        // Configurable payback limit
        const firstProp = properties.values().next().value;
        const houseCost = BOARD[firstProp].housePrice * 3 * properties.size;
        const totalInvestment = offer + houseCost;

        if (eptGain > 0 && totalInvestment / eptGain > this.paybackLimit) {
            return 0;
        }

        return Math.min(offer, maxOffer);
    }

    /**
     * Override trade evaluation with configurable threshold
     */
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
            if (this.wouldGiveUpMonopolyChance(prop, state)) {
                ourLoss += 100;
            }
        }

        ourGain += fromCash;
        const netGain = ourGain - ourLoss;

        // Configurable acceptance threshold
        return netGain >= this.acceptanceThreshold;
    }
}

// =============================================================================
// PARAMETER SWEEP RUNNER
// =============================================================================

class ParameterSweep {
    constructor(options = {}) {
        this.gamesPerConfig = options.gamesPerConfig || 100;
        this.maxTurns = options.maxTurns || 500;
        this.verbose = options.verbose || false;
    }

    /**
     * Run games with specific configurations
     */
    runComparison(config1, config2, numGames) {
        const results = {
            config1Wins: 0,
            config2Wins: 0,
            timeouts: 0,
            totalTurns: 0,
            tradesExecuted: 0,
            monopoliesFormed: [],
            avgHousesBuilt: 0
        };

        for (let i = 0; i < numGames; i++) {
            const engine = new GameEngine({
                maxTurns: this.maxTurns,
                verbose: false
            });

            // Alternate positions to remove seat bias
            const factories = i % 2 === 0
                ? [
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config1),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config2),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config1),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config2)
                ]
                : [
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config2),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config1),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config2),
                    (p, e) => new ConfigurableTradingAI(p, e, markovEngine, valuator, config1)
                ];

            engine.newGame(4, factories);
            const result = engine.runGame();

            results.totalTurns += result.turns;
            results.avgHousesBuilt += result.stats.housesBought.reduce((a, b) => a + b, 0);

            if (result.winner === null) {
                results.timeouts++;
            } else {
                // Determine which config won based on alternating positions
                const isConfig1 = i % 2 === 0
                    ? (result.winner === 0 || result.winner === 2)
                    : (result.winner === 1 || result.winner === 3);

                if (isConfig1) {
                    results.config1Wins++;
                } else {
                    results.config2Wins++;
                }
            }
        }

        results.avgTurns = results.totalTurns / numGames;
        results.avgHousesBuilt /= numGames;

        return results;
    }

    /**
     * Sweep a single parameter
     */
    sweepParameter(paramName, values, baseConfig = {}) {
        console.log(`\nSweeping ${paramName}: [${values.join(', ')}]`);
        console.log('-'.repeat(60));

        const results = [];

        // Test each value against the baseline (first value)
        const baselineConfig = { ...baseConfig, [paramName]: values[0] };

        for (let i = 1; i < values.length; i++) {
            const testConfig = { ...baseConfig, [paramName]: values[i] };

            const comparison = this.runComparison(
                baselineConfig,
                testConfig,
                this.gamesPerConfig
            );

            const totalGames = comparison.config1Wins + comparison.config2Wins;
            const config1Rate = totalGames > 0 ? comparison.config1Wins / totalGames : 0.5;
            const config2Rate = totalGames > 0 ? comparison.config2Wins / totalGames : 0.5;

            results.push({
                baseline: values[0],
                test: values[i],
                baselineWins: comparison.config1Wins,
                testWins: comparison.config2Wins,
                baselineRate: config1Rate,
                testRate: config2Rate,
                timeouts: comparison.timeouts,
                avgTurns: comparison.avgTurns,
                avgHouses: comparison.avgHousesBuilt
            });

            const winner = config1Rate > config2Rate ? values[0] : values[i];
            const margin = Math.abs(config1Rate - config2Rate) * 100;

            console.log(
                `  ${values[0]} vs ${values[i]}: ` +
                `${comparison.config1Wins}-${comparison.config2Wins} ` +
                `(${(config1Rate * 100).toFixed(1)}%-${(config2Rate * 100).toFixed(1)}%) ` +
                `[${comparison.timeouts} timeouts, ${comparison.avgTurns.toFixed(0)} avg turns]`
            );
        }

        return results;
    }

    /**
     * Run head-to-head between best values
     */
    headToHead(config1, config2, numGames, label1 = 'Config1', label2 = 'Config2') {
        console.log(`\n${label1} vs ${label2} (${numGames} games)`);
        console.log('-'.repeat(60));

        const comparison = this.runComparison(config1, config2, numGames);
        const totalGames = comparison.config1Wins + comparison.config2Wins;

        console.log(`  ${label1}: ${comparison.config1Wins} wins (${(comparison.config1Wins/totalGames*100).toFixed(1)}%)`);
        console.log(`  ${label2}: ${comparison.config2Wins} wins (${(comparison.config2Wins/totalGames*100).toFixed(1)}%)`);
        console.log(`  Timeouts: ${comparison.timeouts}`);
        console.log(`  Avg turns: ${comparison.avgTurns.toFixed(0)}`);

        return comparison;
    }
}

// =============================================================================
// RUN SWEEP
// =============================================================================

console.log('='.repeat(60));
console.log('TRADING PARAMETER SWEEP');
console.log('='.repeat(60));

const sweep = new ParameterSweep({
    gamesPerConfig: 100,
    maxTurns: 500
});

// Sweep 1: Cash Premium Multiplier
// How much extra (per EPT point) should we offer above property value?
console.log('\n>>> SWEEP 1: Cash Premium Multiplier');
console.log('Higher = more willing to pay premium for monopoly completion');
const premiumResults = sweep.sweepParameter(
    'cashPremiumMultiplier',
    [5, 10, 15, 20, 25],
    { maxCashOffer: 0.5, acceptanceThreshold: -50, paybackLimit: 40 }
);

// Sweep 2: Max Cash Offer (fraction of money)
// How much of our cash are we willing to spend on a trade?
console.log('\n>>> SWEEP 2: Max Cash Offer Percentage');
console.log('Higher = willing to spend more of our cash on trades');
const cashOfferResults = sweep.sweepParameter(
    'maxCashOffer',
    [0.3, 0.5, 0.7, 0.9],
    { cashPremiumMultiplier: 10, acceptanceThreshold: -50, paybackLimit: 40 }
);

// Sweep 3: Acceptance Threshold
// How much are we willing to "lose" on a trade for mutual benefit?
console.log('\n>>> SWEEP 3: Trade Acceptance Threshold');
console.log('Lower (more negative) = more willing to accept unfavorable trades');
const thresholdResults = sweep.sweepParameter(
    'acceptanceThreshold',
    [0, -50, -100, -150, -200],
    { cashPremiumMultiplier: 10, maxCashOffer: 0.5, paybackLimit: 40 }
);

// Sweep 4: Payback Limit
// How many turns of payback are acceptable?
console.log('\n>>> SWEEP 4: Payback Turn Limit');
console.log('Higher = willing to wait longer for ROI');
const paybackResults = sweep.sweepParameter(
    'paybackLimit',
    [20, 30, 40, 50, 60],
    { cashPremiumMultiplier: 10, maxCashOffer: 0.5, acceptanceThreshold: -50 }
);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SWEEP SUMMARY');
console.log('='.repeat(60));

function findBest(results, paramName) {
    // Find which value performed best against baseline
    let bestValue = results[0].baseline;
    let bestRate = 0.5;

    for (const r of results) {
        if (r.testRate > bestRate) {
            bestRate = r.testRate;
            bestValue = r.test;
        }
    }

    // If baseline was best
    if (bestRate <= 0.5) {
        bestValue = results[0].baseline;
        bestRate = results[0].baselineRate;
    }

    return { value: bestValue, rate: bestRate };
}

const bestPremium = findBest(premiumResults, 'cashPremiumMultiplier');
const bestCashOffer = findBest(cashOfferResults, 'maxCashOffer');
const bestThreshold = findBest(thresholdResults, 'acceptanceThreshold');
const bestPayback = findBest(paybackResults, 'paybackLimit');

console.log(`
Best Parameters Found:
  Cash Premium Multiplier: ${bestPremium.value} (${(bestPremium.rate * 100).toFixed(1)}% win rate)
  Max Cash Offer: ${bestCashOffer.value} (${(bestCashOffer.rate * 100).toFixed(1)}% win rate)
  Acceptance Threshold: ${bestThreshold.value} (${(bestThreshold.rate * 100).toFixed(1)}% win rate)
  Payback Limit: ${bestPayback.value} (${(bestPayback.rate * 100).toFixed(1)}% win rate)
`);

// Final head-to-head: Optimized vs Default
console.log('\n>>> FINAL: Optimized vs Default Configuration');
const optimizedConfig = {
    cashPremiumMultiplier: bestPremium.value,
    maxCashOffer: bestCashOffer.value,
    acceptanceThreshold: bestThreshold.value,
    paybackLimit: bestPayback.value
};

const defaultConfig = {
    cashPremiumMultiplier: 10,
    maxCashOffer: 0.5,
    acceptanceThreshold: -50,
    paybackLimit: 40
};

console.log(`Optimized: ${JSON.stringify(optimizedConfig)}`);
console.log(`Default: ${JSON.stringify(defaultConfig)}`);

sweep.headToHead(optimizedConfig, defaultConfig, 200, 'Optimized', 'Default');

console.log('\n' + '='.repeat(60));
console.log('SWEEP COMPLETE');
console.log('='.repeat(60));
