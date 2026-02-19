/**
 * Test Growth-Based Trading AI
 *
 * The growth AI uses actual EPT growth curves that account for
 * cash-after-trade and development time.
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
console.log('GROWTH-BASED TRADING AI TOURNAMENT');
console.log('='.repeat(60));

// Test 1: Growth vs Standard Trading
console.log('\n>>> Test 1: Growth vs Standard Trading - 4 player, 2 each');
const results1 = runner.runSimulation(['growth', 'trading', 'growth', 'trading'], 200);
const growthWins1 = results1.wins[0] + results1.wins[2];
const tradingWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: Growth=${growthWins1}, Trading=${tradingWins1}`);
console.log(`Win rate: Growth ${(growthWins1/(growthWins1+tradingWins1)*100).toFixed(1)}%`);

// Test 2: Growth vs NPV
console.log('\n>>> Test 2: Growth vs NPV - 4 player, 2 each');
const results2 = runner.runSimulation(['growth', 'npv', 'growth', 'npv'], 200);
const growthWins2 = results2.wins[0] + results2.wins[2];
const npvWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: Growth=${growthWins2}, NPV=${npvWins2}`);
console.log(`Win rate: Growth ${(growthWins2/(growthWins2+npvWins2)*100).toFixed(1)}%`);

// Test 3: Growth vs NoTrade (baseline)
console.log('\n>>> Test 3: Growth vs NoTrade - 4 player, 2 each');
const results3 = runner.runSimulation(['growth', 'notrade', 'growth', 'notrade'], 200);
const growthWins3 = results3.wins[0] + results3.wins[2];
const notradeWins3 = results3.wins[1] + results3.wins[3];
console.log(`\nAGGREGATE: Growth=${growthWins3}, NoTrade=${notradeWins3}`);
console.log(`Win rate: Growth ${(growthWins3/(growthWins3+notradeWins3)*100).toFixed(1)}%`);

// Test 4: All Growth (game dynamics)
console.log('\n>>> Test 4: All Growth (4 players) - game dynamics');
const results4 = runner.runSimulation(['growth', 'growth', 'growth', 'growth'], 200);
console.log(`\nAvg turns: ${results4.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results4.timeouts} (${(results4.timeouts/200*100).toFixed(0)}%)`);

// Test 5: All AI Types (round-robin)
console.log('\n>>> Test 5: All AI Types (one of each)');
const results5 = runner.runSimulation(['growth', 'trading', 'npv', 'notrade'], 200);
console.log(`\nWin rates:`);
console.log(`  Growth:    ${results5.wins[0]} (${(results5.wins[0]/200*100).toFixed(0)}%)`);
console.log(`  Trading:   ${results5.wins[1]} (${(results5.wins[1]/200*100).toFixed(0)}%)`);
console.log(`  NPV:       ${results5.wins[2]} (${(results5.wins[2]/200*100).toFixed(0)}%)`);
console.log(`  NoTrade:   ${results5.wins[3]} (${(results5.wins[3]/200*100).toFixed(0)}%)`);

// Test 6: Growth vs Competitive
console.log('\n>>> Test 6: Growth vs Competitive - 4 player, 2 each');
const results6 = runner.runSimulation(['growth', 'competitive', 'growth', 'competitive'], 200);
const growthWins6 = results6.wins[0] + results6.wins[2];
const compWins6 = results6.wins[1] + results6.wins[3];
console.log(`\nAGGREGATE: Growth=${growthWins6}, Competitive=${compWins6}`);
console.log(`Win rate: Growth ${(growthWins6/(growthWins6+compWins6)*100).toFixed(1)}%`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const total1 = growthWins1 + tradingWins1;
const total2 = growthWins2 + npvWins2;
const total3 = growthWins3 + notradeWins3;
const total6 = growthWins6 + compWins6;

console.log(`
Growth Trading AI Performance:
  vs Standard Trading: ${(growthWins1/total1*100).toFixed(0)}% - ${(tradingWins1/total1*100).toFixed(0)}%
  vs NPV Trading:      ${(growthWins2/total2*100).toFixed(0)}% - ${(npvWins2/total2*100).toFixed(0)}%
  vs Competitive:      ${(growthWins6/total6*100).toFixed(0)}% - ${(compWins6/total6*100).toFixed(0)}%
  vs NoTrade:          ${(growthWins3/total3*100).toFixed(0)}% - ${(notradeWins3/total3*100).toFixed(0)}%

Game Dynamics (all Growth):
  Avg turns: ${results4.avgTurns.toFixed(0)}
  Timeout rate: ${(results4.timeouts/200*100).toFixed(0)}%

Round-Robin Results:
  Growth: ${(results5.wins[0]/200*100).toFixed(0)}%
  Trading: ${(results5.wins[1]/200*100).toFixed(0)}%
  NPV: ${(results5.wins[2]/200*100).toFixed(0)}%
  NoTrade: ${(results5.wins[3]/200*100).toFixed(0)}%

Key Features of Growth AI:
  - Models actual EPT growth curve (not instant 3-house assumption)
  - Accounts for cash-after-trade development speed
  - Binary search for optimal offer price
  - Evaluates trades based on NPV change, not "fairness"
`);
