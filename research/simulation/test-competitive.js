/**
 * Test Competitive Trading AI
 *
 * Tests the position-based trading approach
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
console.log('COMPETITIVE TRADING AI TOURNAMENT');
console.log('='.repeat(60));

// Test 1: Competitive vs Standard Trading
console.log('\n>>> Test 1: Competitive vs Standard Trading - 4 player, 2 each');
const results1 = runner.runSimulation(['competitive', 'trading', 'competitive', 'trading'], 200);
const compWins1 = results1.wins[0] + results1.wins[2];
const tradingWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: Competitive=${compWins1}, Trading=${tradingWins1}`);
console.log(`Win rate: Competitive ${(compWins1/(compWins1+tradingWins1)*100).toFixed(1)}%`);

// Test 2: Competitive vs NPV
console.log('\n>>> Test 2: Competitive vs NPV - 4 player, 2 each');
const results2 = runner.runSimulation(['competitive', 'npv', 'competitive', 'npv'], 200);
const compWins2 = results2.wins[0] + results2.wins[2];
const npvWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: Competitive=${compWins2}, NPV=${npvWins2}`);
console.log(`Win rate: Competitive ${(compWins2/(compWins2+npvWins2)*100).toFixed(1)}%`);

// Test 3: Competitive vs NoTrade
console.log('\n>>> Test 3: Competitive vs NoTrade - 4 player, 2 each');
const results3 = runner.runSimulation(['competitive', 'notrade', 'competitive', 'notrade'], 200);
const compWins3 = results3.wins[0] + results3.wins[2];
const notradeWins3 = results3.wins[1] + results3.wins[3];
console.log(`\nAGGREGATE: Competitive=${compWins3}, NoTrade=${notradeWins3}`);
console.log(`Win rate: Competitive ${(compWins3/(compWins3+notradeWins3)*100).toFixed(1)}%`);

// Test 4: All Competitive (game dynamics)
console.log('\n>>> Test 4: All Competitive (4 players) - game dynamics');
const results4 = runner.runSimulation(['competitive', 'competitive', 'competitive', 'competitive'], 200);
console.log(`\nAvg turns: ${results4.avgTurns.toFixed(0)}`);
console.log(`Timeouts: ${results4.timeouts} (${(results4.timeouts/200*100).toFixed(0)}%)`);

// Test 5: Round-robin all AI types
console.log('\n>>> Test 5: All AI Types (one of each)');
const results5 = runner.runSimulation(['competitive', 'trading', 'npv', 'notrade'], 200);
console.log(`\nWin rates:`);
console.log(`  Competitive: ${results5.wins[0]} (${(results5.wins[0]/200*100).toFixed(0)}%)`);
console.log(`  Trading:     ${results5.wins[1]} (${(results5.wins[1]/200*100).toFixed(0)}%)`);
console.log(`  NPV:         ${results5.wins[2]} (${(results5.wins[2]/200*100).toFixed(0)}%)`);
console.log(`  NoTrade:     ${results5.wins[3]} (${(results5.wins[3]/200*100).toFixed(0)}%)`);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const total1 = compWins1 + tradingWins1;
const total2 = compWins2 + npvWins2;
const total3 = compWins3 + notradeWins3;

console.log(`
Competitive Trading AI Performance:
  vs Standard Trading: ${(compWins1/total1*100).toFixed(0)}% - ${(tradingWins1/total1*100).toFixed(0)}%
  vs NPV Trading:      ${(compWins2/total2*100).toFixed(0)}% - ${(npvWins2/total2*100).toFixed(0)}%
  vs NoTrade:          ${(compWins3/total3*100).toFixed(0)}% - ${(notradeWins3/total3*100).toFixed(0)}%

Game Dynamics (all Competitive):
  Avg turns: ${results4.avgTurns.toFixed(0)}
  Timeout rate: ${(results4.timeouts/200*100).toFixed(0)}%

Key Principle:
  Position = Cash + EPT × TurnsRemaining
  Accept trades that maintain or improve RANK, not just position
  Special aggression when in last place
`);
