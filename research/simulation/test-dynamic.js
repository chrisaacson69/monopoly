/**
 * Test Dynamic Trading AI
 *
 * Compares dynamic (state-aware) trading parameters vs static parameters
 */

'use strict';

const { SimulationRunner } = require('./simulation-runner.js');

const runner = new SimulationRunner({
    games: 200,
    maxTurns: 500,
    verbose: false,
    progressInterval: 50
});

console.log('\n' + '='.repeat(60));
console.log('DYNAMIC vs STATIC TRADING AI');
console.log('='.repeat(60));

// Test 1: Dynamic vs Static Trading
console.log('\n>>> Test 1: Dynamic vs Trading (static) - 4 player, 2 each');
const results1 = runner.runSimulation(['dynamic', 'trading', 'dynamic', 'trading'], 200);
const dynamicWins1 = results1.wins[0] + results1.wins[2];
const tradingWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: Dynamic=${dynamicWins1}, Trading=${tradingWins1}`);
console.log(`Win rate: Dynamic ${(dynamicWins1/(dynamicWins1+tradingWins1)*100).toFixed(1)}%`);

// Test 2: Dynamic vs NoTrade
console.log('\n>>> Test 2: Dynamic vs NoTrade - 4 player, 2 each');
const results2 = runner.runSimulation(['dynamic', 'notrade', 'dynamic', 'notrade'], 200);
const dynamicWins2 = results2.wins[0] + results2.wins[2];
const notradeWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: Dynamic=${dynamicWins2}, NoTrade=${notradeWins2}`);
console.log(`Win rate: Dynamic ${(dynamicWins2/(dynamicWins2+notradeWins2)*100).toFixed(1)}%`);

// Test 3: All Dynamic (to see game dynamics)
console.log('\n>>> Test 3: All Dynamic (4 players) - game dynamics');
const results3 = runner.runSimulation(['dynamic', 'dynamic', 'dynamic', 'dynamic'], 200);
console.log(`\nAvg turns: ${results3.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results3.timeouts} (${(results3.timeouts/200*100).toFixed(0)}%)`);

// Test 4: Dynamic vs Strategic (no trading)
console.log('\n>>> Test 4: Dynamic vs Strategic (EPT but no trade) - 4 player, 2 each');
const results4 = runner.runSimulation(['dynamic', 'strategic', 'dynamic', 'strategic'], 200);
const dynamicWins4 = results4.wins[0] + results4.wins[2];
const strategicWins4 = results4.wins[1] + results4.wins[3];
console.log(`\nAGGREGATE: Dynamic=${dynamicWins4}, Strategic=${strategicWins4}`);
console.log(`Win rate: Dynamic ${(dynamicWins4/(dynamicWins4+strategicWins4)*100).toFixed(1)}%`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const totalDynamic1 = dynamicWins1 + tradingWins1;
const totalDynamic2 = dynamicWins2 + notradeWins2;
const totalDynamic4 = dynamicWins4 + strategicWins4;

console.log(`
Dynamic Trading AI Performance:
  vs Static Trading:  ${(dynamicWins1/totalDynamic1*100).toFixed(0)}% - ${(tradingWins1/totalDynamic1*100).toFixed(0)}%
  vs NoTrade:         ${(dynamicWins2/totalDynamic2*100).toFixed(0)}% - ${(notradeWins2/totalDynamic2*100).toFixed(0)}%
  vs Strategic:       ${(dynamicWins4/totalDynamic4*100).toFixed(0)}% - ${(strategicWins4/totalDynamic4*100).toFixed(0)}%

Game Dynamics (all Dynamic):
  Avg turns to completion: ${results3.avgTurns.toFixed(0)}
  Timeout rate: ${(results3.timeouts/200*100).toFixed(0)}%

Comparison to Static Trading:
  Static Trading timeout rate: ${(results1.timeouts/200*100).toFixed(0)}%
  Dynamic timeout rate: ${(results3.timeouts/200*100).toFixed(0)}%
`);
