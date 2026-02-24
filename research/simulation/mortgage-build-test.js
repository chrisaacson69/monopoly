/**
 * Mortgage Build A/B Test
 *
 * Tests whether mortgage-funded house building improves win rate.
 * 1 mortgage-builder (mortgageForBuilds: true) vs 3 baseline StrategicTradeAI.
 *
 * Usage: node mortgage-build-test.js [games]
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');
const { getCachedEngines } = require('./cached-engines.js');

const { markovEngine, valuator } = getCachedEngines();

// =============================================================================
// FACTORIES
// =============================================================================

function createMortgageBuildFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator,
            { mortgageForBuilds: true });
        ai.name = 'MortgageBuild';
        return ai;
    };
}

function createBaselineFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'Baseline';
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
            const wr = (newWins / (i + 1) * 100).toFixed(1);
            console.log('  [' + label + '] Game ' + (i + 1) + '/' + games +
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
// RUN
// =============================================================================

const GAMES = parseInt(process.argv[2]) || 2000;

console.log('='.repeat(80));
console.log('MORTGAGE-FUNDED BUILD A/B TEST');
console.log(GAMES + ' games, 1 MortgageBuild vs 3 Baseline (StrategicTradeAI)');
console.log('='.repeat(80));
console.log();

const result = runTest(
    'MortgageBuild vs Baseline',
    createMortgageBuildFactory(),
    createBaselineFactory(),
    GAMES, 4
);

console.log('='.repeat(80));
console.log('SUMMARY:');
console.log('='.repeat(80));
console.log('  ' + result.label.padEnd(45) + result.winRate + '%  Z=' + result.z);
console.log('  ' + 'Expected (no improvement)'.padEnd(45) + '25.0%  Z=0.00');
console.log('='.repeat(80));
