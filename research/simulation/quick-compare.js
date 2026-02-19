/**
 * Quick AI Comparison
 *
 * Runs a quick comparison between AI types
 */

'use strict';

const { SimulationRunner } = require('./simulation-runner.js');

const runner = new SimulationRunner({
    games: 200,
    maxTurns: 1000,
    verbose: false,
    progressInterval: 50
});

console.log('\n' + '='.repeat(60));
console.log('QUICK AI COMPARISON (200 games each)');
console.log('='.repeat(60));

// Test 1: Strategic vs Simple head-to-head
console.log('\n>>> Test 1: Strategic vs Simple (4 player, 2 each)');
const results1 = runner.runSimulation(['strategic', 'simple', 'strategic', 'simple'], 200);
const strategicWins1 = results1.wins[0] + results1.wins[2];
const simpleWins1 = results1.wins[1] + results1.wins[3];
console.log(`\nAGGREGATE: Strategic=${strategicWins1} (${(strategicWins1/200*100).toFixed(1)}%), Simple=${simpleWins1} (${(simpleWins1/200*100).toFixed(1)}%)`);

// Test 2: Strategic vs Random
console.log('\n>>> Test 2: Strategic vs Random (4 player, 2 each)');
const results2 = runner.runSimulation(['strategic', 'random', 'strategic', 'random'], 200);
const strategicWins2 = results2.wins[0] + results2.wins[2];
const randomWins2 = results2.wins[1] + results2.wins[3];
console.log(`\nAGGREGATE: Strategic=${strategicWins2} (${(strategicWins2/200*100).toFixed(1)}%), Random=${randomWins2} (${(randomWins2/200*100).toFixed(1)}%)`);

// Test 3: Simple vs Random
console.log('\n>>> Test 3: Simple vs Random (4 player, 2 each)');
const results3 = runner.runSimulation(['simple', 'random', 'simple', 'random'], 200);
const simpleWins3 = results3.wins[0] + results3.wins[2];
const randomWins3 = results3.wins[1] + results3.wins[3];
console.log(`\nAGGREGATE: Simple=${simpleWins3} (${(simpleWins3/200*100).toFixed(1)}%), Random=${randomWins3} (${(randomWins3/200*100).toFixed(1)}%)`);

console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`
Win Rates (approx):
  Strategic vs Simple: ${(strategicWins1/(strategicWins1+simpleWins1)*100).toFixed(0)}% - ${(simpleWins1/(strategicWins1+simpleWins1)*100).toFixed(0)}%
  Strategic vs Random: ${(strategicWins2/(strategicWins2+randomWins2)*100).toFixed(0)}% - ${(randomWins2/(strategicWins2+randomWins2)*100).toFixed(0)}%
  Simple vs Random:    ${(simpleWins3/(simpleWins3+randomWins3)*100).toFixed(0)}% - ${(randomWins3/(simpleWins3+randomWins3)*100).toFixed(0)}%

Average turns to completion:
  Strategic vs Simple: ${results1.avgTurns.toFixed(0)}
  Strategic vs Random: ${results2.avgTurns.toFixed(0)}
  Simple vs Random:    ${results3.avgTurns.toFixed(0)}

Timeout rates:
  Strategic vs Simple: ${(results1.timeouts/200*100).toFixed(0)}%
  Strategic vs Random: ${(results2.timeouts/200*100).toFixed(0)}%
  Simple vs Random:    ${(results3.timeouts/200*100).toFixed(0)}%
`);
