/**
 * Quick tournament: SubgraphTradeAI vs StrategicTradeAI
 *
 * Runs N games with 2 SubgraphTradeAI vs 2 StrategicTradeAI
 * to measure whether subgraph-driven trade proposals improve win rate.
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { StrategicBalanced } = require('./strategic-trade-ai.js');
const { SubgraphTradeAI } = require('./subgraph-trade-ai.js');

// Load shared engines from cache
const { getCachedEngines } = require('./cached-engines.js');
const { markovEngine, valuator } = getCachedEngines();

const NUM_GAMES = parseInt(process.argv[2]) || 100;

console.log(`\n╔══════════════════════════════════════════════════╗`);
console.log(`║  SubgraphTradeAI vs StrategicTradeAI Tournament  ║`);
console.log(`╚══════════════════════════════════════════════════╝`);
console.log(`Games: ${NUM_GAMES}`);
console.log(`Setup: 2x SubgraphTradeAI vs 2x StrategicTradeAI\n`);

const wins = { subgraph: 0, strategic: 0, timeout: 0 };
const tradeStats = { proposed: 0, accepted: 0, rejected: 0 };
let totalTurns = 0;

for (let game = 0; game < NUM_GAMES; game++) {
    const engine = new GameEngine({ maxTurns: 500, verbose: false });

    // Create AI factories — alternate positions to avoid seat bias
    const factories = game % 2 === 0
        ? [
            (p, e) => new SubgraphTradeAI(p, e, markovEngine, valuator),
            (p, e) => new StrategicBalanced(p, e, markovEngine, valuator),
            (p, e) => new SubgraphTradeAI(p, e, markovEngine, valuator),
            (p, e) => new StrategicBalanced(p, e, markovEngine, valuator)
          ]
        : [
            (p, e) => new StrategicBalanced(p, e, markovEngine, valuator),
            (p, e) => new SubgraphTradeAI(p, e, markovEngine, valuator),
            (p, e) => new StrategicBalanced(p, e, markovEngine, valuator),
            (p, e) => new SubgraphTradeAI(p, e, markovEngine, valuator)
          ];

    engine.newGame(4, factories);
    const result = engine.runGame();

    if (result && result.winner !== undefined && result.winner !== null) {
        const winner = engine.state.players[result.winner];
        if (winner && winner.ai) {
            if (winner.ai.name === 'SubgraphTradeAI') {
                wins.subgraph++;
            } else {
                wins.strategic++;
            }
        }
    } else {
        wins.timeout++;
    }

    // Collect trade stats from SubgraphTradeAI players
    for (const player of engine.state.players) {
        if (player.ai && player.ai.getTradeStats) {
            const stats = player.ai.getTradeStats();
            tradeStats.proposed += stats.proposed;
            tradeStats.accepted += stats.accepted;
            tradeStats.rejected += stats.rejected;
        }
    }

    totalTurns += result ? (result.turns || 0) : 0;

    // Progress
    if ((game + 1) % 10 === 0 || game === NUM_GAMES - 1) {
        const pct = ((game + 1) / NUM_GAMES * 100).toFixed(0);
        process.stdout.write(`\rProgress: ${pct}% (${game + 1}/${NUM_GAMES})`);
    }
}

console.log('\n');
console.log('='.repeat(50));
console.log('RESULTS:');
console.log('='.repeat(50));
console.log(`SubgraphTradeAI:  ${wins.subgraph} wins (${(wins.subgraph / NUM_GAMES * 100).toFixed(1)}%)`);
console.log(`StrategicTradeAI: ${wins.strategic} wins (${(wins.strategic / NUM_GAMES * 100).toFixed(1)}%)`);
console.log(`Timeouts:         ${wins.timeout}`);
console.log(`Avg turns/game:   ${(totalTurns / NUM_GAMES).toFixed(0)}`);
console.log('');
console.log('Trade Search Stats (SubgraphTradeAI only):');
console.log(`  Proposed: ${tradeStats.proposed}`);
console.log(`  Accepted: ${tradeStats.accepted}`);
console.log(`  Rejected: ${tradeStats.rejected}`);
console.log(`  Accept rate: ${tradeStats.proposed > 0 ? (tradeStats.accepted / tradeStats.proposed * 100).toFixed(1) : 'N/A'}%`);
console.log(`  Per game: ${(tradeStats.proposed / NUM_GAMES).toFixed(1)} proposals/game`);

// Statistical significance
const n = wins.subgraph + wins.strategic;
if (n > 0) {
    const p = wins.subgraph / n;
    const se = Math.sqrt(p * (1 - p) / n);
    const z = (p - 0.5) / se;
    console.log(`\nStatistical test (H0: equal win rate):`);
    console.log(`  Subgraph win rate: ${(p * 100).toFixed(1)}%`);
    console.log(`  Z-score: ${z.toFixed(2)}`);
    console.log(`  ${Math.abs(z) > 1.96 ? 'SIGNIFICANT (p < 0.05)' : 'Not significant'}`);
}
