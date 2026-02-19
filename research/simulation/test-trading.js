/**
 * Test Trading AI Performance
 *
 * Compares trading vs non-trading AI performance
 */

'use strict';

const { SimulationRunner } = require('./simulation-runner.js');

const runner = new SimulationRunner({
    games: 100,
    maxTurns: 500,
    verbose: false,
    progressInterval: 25
});

console.log('\n' + '='.repeat(60));
console.log('TRADING AI COMPARISON');
console.log('='.repeat(60));

// Test 1: Trading vs NoTrade (same strategic base)
console.log('\n>>> Test 1: Trading vs NoTrade (4 player, 2 each)');
const results1 = runner.runSimulation(['trading', 'notrade', 'trading', 'notrade'], 100);
const tradingWins1 = results1.wins[0] + results1.wins[2];
const notradeWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: Trading=${tradingWins1}, NoTrade=${notradeWins1}`);
console.log(`Win rate: Trading ${(tradingWins1/(tradingWins1+notradeWins1)*100).toFixed(1)}%`);

// Test 2: Trading vs Strategic (both have EPT logic, only one trades)
console.log('\n>>> Test 2: Trading vs Strategic (4 player, 2 each)');
const results2 = runner.runSimulation(['trading', 'strategic', 'trading', 'strategic'], 100);
const tradingWins2 = results2.wins[0] + results2.wins[2];
const strategicWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: Trading=${tradingWins2}, Strategic=${strategicWins2}`);
console.log(`Win rate: Trading ${(tradingWins2/(tradingWins2+strategicWins2)*100).toFixed(1)}%`);

// Test 3: Aggressive Trading vs Trading
console.log('\n>>> Test 3: AggressiveTrading vs Trading (4 player, 2 each)');
const results3 = runner.runSimulation(['aggressive', 'trading', 'aggressive', 'trading'], 100);
const aggressiveWins3 = results3.wins[0] + results3.wins[2];
const tradingWins3 = results3.wins[1] + results3.wins[3];
console.log(`\nAGGREGATE: Aggressive=${aggressiveWins3}, Trading=${tradingWins3}`);
console.log(`Win rate: Aggressive ${(aggressiveWins3/(aggressiveWins3+tradingWins3)*100).toFixed(1)}%`);

// Test 4: Full comparison - Trading vs Simple (no EPT, no trades)
console.log('\n>>> Test 4: Trading vs Simple (4 player, 2 each)');
const results4 = runner.runSimulation(['trading', 'simple', 'trading', 'simple'], 100);
const tradingWins4 = results4.wins[0] + results4.wins[2];
const simpleWins4 = results4.wins[1] + results4.wins[3];
console.log(`\nAGGREGATE: Trading=${tradingWins4}, Simple=${simpleWins4}`);
console.log(`Win rate: Trading ${(tradingWins4/(tradingWins4+simpleWins4)*100).toFixed(1)}%`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`
Trading AI Performance:
  vs NoTrade (same base):  ${(tradingWins1/(tradingWins1+notradeWins1)*100).toFixed(0)}% - ${(notradeWins1/(tradingWins1+notradeWins1)*100).toFixed(0)}%
  vs Strategic:            ${(tradingWins2/(tradingWins2+strategicWins2)*100).toFixed(0)}% - ${(strategicWins2/(tradingWins2+strategicWins2)*100).toFixed(0)}%
  vs Simple:               ${(tradingWins4/(tradingWins4+simpleWins4)*100).toFixed(0)}% - ${(simpleWins4/(tradingWins4+simpleWins4)*100).toFixed(0)}%

Aggressive vs Trading:     ${(aggressiveWins3/(aggressiveWins3+tradingWins3)*100).toFixed(0)}% - ${(tradingWins3/(aggressiveWins3+tradingWins3)*100).toFixed(0)}%

Timeout Rates:
  Trading vs NoTrade:    ${(results1.timeouts/100*100).toFixed(0)}%
  Trading vs Strategic:  ${(results2.timeouts/100*100).toFixed(0)}%
  Trading vs Simple:     ${(results4.timeouts/100*100).toFixed(0)}%
`);
