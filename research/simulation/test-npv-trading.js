/**
 * Test NPV-Based Trading AI
 *
 * Compares NPV trading (financially rigorous) vs standard trading
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
console.log('NPV TRADING AI vs STANDARD TRADING AI');
console.log('='.repeat(60));

// Test 1: NPV vs Standard Trading (head to head)
console.log('\n>>> Test 1: NPV vs Standard Trading - 4 player, 2 each');
const results1 = runner.runSimulation(['npv', 'trading', 'npv', 'trading'], 200);
const npvWins1 = results1.wins[0] + results1.wins[2];
const tradingWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: NPV=${npvWins1}, Trading=${tradingWins1}`);
console.log(`Win rate: NPV ${(npvWins1/(npvWins1+tradingWins1)*100).toFixed(1)}%`);

// Test 2: NPV vs Dynamic Trading
console.log('\n>>> Test 2: NPV vs Dynamic Trading - 4 player, 2 each');
const results2 = runner.runSimulation(['npv', 'dynamic', 'npv', 'dynamic'], 200);
const npvWins2 = results2.wins[0] + results2.wins[2];
const dynamicWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: NPV=${npvWins2}, Dynamic=${dynamicWins2}`);
console.log(`Win rate: NPV ${(npvWins2/(npvWins2+dynamicWins2)*100).toFixed(1)}%`);

// Test 3: NPV vs NoTrade (baseline)
console.log('\n>>> Test 3: NPV vs NoTrade - 4 player, 2 each');
const results3 = runner.runSimulation(['npv', 'notrade', 'npv', 'notrade'], 200);
const npvWins3 = results3.wins[0] + results3.wins[2];
const notradeWins3 = results3.wins[1] + results3.wins[3];
console.log(`\nAGGREGATE: NPV=${npvWins3}, NoTrade=${notradeWins3}`);
console.log(`Win rate: NPV ${(npvWins3/(npvWins3+notradeWins3)*100).toFixed(1)}%`);

// Test 4: All NPV (game dynamics)
console.log('\n>>> Test 4: All NPV (4 players) - game dynamics');
const results4 = runner.runSimulation(['npv', 'npv', 'npv', 'npv'], 200);
console.log(`\nAvg turns: ${results4.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results4.timeouts} (${(results4.timeouts/200*100).toFixed(0)}%)`);

// Test 5: All Standard Trading (comparison)
console.log('\n>>> Test 5: All Standard Trading (4 players) - comparison');
const results5 = runner.runSimulation(['trading', 'trading', 'trading', 'trading'], 200);
console.log(`\nAvg turns: ${results5.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results5.timeouts} (${(results5.timeouts/200*100).toFixed(0)}%)`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const total1 = npvWins1 + tradingWins1;
const total2 = npvWins2 + dynamicWins2;
const total3 = npvWins3 + notradeWins3;

console.log(`
NPV Trading AI Performance:
  vs Standard Trading: ${(npvWins1/total1*100).toFixed(0)}% - ${(tradingWins1/total1*100).toFixed(0)}%
  vs Dynamic Trading:  ${(npvWins2/total2*100).toFixed(0)}% - ${(dynamicWins2/total2*100).toFixed(0)}%
  vs NoTrade:          ${(npvWins3/total3*100).toFixed(0)}% - ${(notradeWins3/total3*100).toFixed(0)}%

Game Dynamics Comparison:
                        NPV Trading    Standard Trading
  Avg turns:               ${results4.avgTurns.toFixed(0)}              ${results5.avgTurns.toFixed(0)}
  Timeout rate:            ${(results4.timeouts/200*100).toFixed(0)}%              ${(results5.timeouts/200*100).toFixed(0)}%

Key Metrics:
  NPV uses discount rate = EPT / Total Cash (money velocity)
  Fair trade: buyer pays ~65% of net NPV, seller demands ~35%
  Payback period limit: 30 turns max
`);
