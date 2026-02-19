/**
 * Compare Markov Chain vs Monte Carlo Results
 *
 * This validates our Markov chain implementation against a Monte Carlo
 * simulation using the same rules.
 */

const MonopolyMarkov = require('./markov-engine.js');
const MonteCarloSim = require('./monte-carlo-sim.js');

console.log('================================================================================');
console.log('MARKOV CHAIN vs MONTE CARLO COMPARISON');
console.log('================================================================================\n');

// Initialize Markov engine
console.log('Initializing Markov engine...');
const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

// Run Monte Carlo simulations
const NUM_TURNS = 2000000;  // 2 million turns for good accuracy

console.log(`\nRunning Monte Carlo simulation (${(NUM_TURNS/1000000).toFixed(1)}M turns, "stay in jail" strategy)...`);
const mcStay = MonteCarloSim.runSimulation(NUM_TURNS, 'stay');
console.log(`  Total landings: ${mcStay.totalLandings.toLocaleString()}`);
console.log(`  Landings per turn: ${mcStay.landingsPerTurn.toFixed(4)}`);

console.log(`\nRunning Monte Carlo simulation (${(NUM_TURNS/1000000).toFixed(1)}M turns, "leave jail" strategy)...`);
const mcLeave = MonteCarloSim.runSimulation(NUM_TURNS, 'leave');
console.log(`  Total landings: ${mcLeave.totalLandings.toLocaleString()}`);
console.log(`  Landings per turn: ${mcLeave.landingsPerTurn.toFixed(4)}`);

// Get Markov results
const markovStay = markov.getAllProbabilities('stay');
const markovLeave = markov.getAllProbabilities('leave');

// Published values for reference
const PUBLISHED = [
    3.09, 2.15, 1.83, 2.18, 2.35, 2.90, 2.28, 0.86, 2.43, 2.43,  // 0-9
    5.89, 2.71, 2.64, 2.36, 2.52, 2.87, 2.78, 2.68, 2.97, 3.11,  // 10-19
    2.89, 2.75, 1.07, 2.74, 3.18, 3.05, 2.68, 2.63, 2.79, 2.60,  // 20-29
    0.00, 2.69, 2.63, 2.48, 2.56, 2.36, 0.93, 2.24, 2.14, 2.65   // 30-39
];

// Compare results
console.log('\n================================================================================');
console.log('COMPARISON: STAY IN JAIL STRATEGY');
console.log('================================================================================\n');

console.log('Square                        Markov    Monte Carlo  Published   MC-Markov');
console.log('------------------------------------------------------------------------------');

let totalDiff = 0;
let maxDiff = 0;
let maxDiffSquare = '';

for (let i = 0; i < 40; i++) {
    const name = MonteCarloSim.SQUARE_NAMES[i].padEnd(28);
    const markovPct = (markovStay[i] * 100).toFixed(3) + '%';
    const mcPct = (mcStay.probabilities[i] * 100).toFixed(3) + '%';
    const pubPct = PUBLISHED[i].toFixed(2) + '%';
    const diff = (mcStay.probabilities[i] - markovStay[i]) * 100;
    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(3) + '%';

    // Status indicator
    const absDiff = Math.abs(diff);
    totalDiff += absDiff;
    if (absDiff > maxDiff) {
        maxDiff = absDiff;
        maxDiffSquare = MonteCarloSim.SQUARE_NAMES[i];
    }

    const status = absDiff < 0.1 ? '✓' : absDiff < 0.2 ? '~' : '✗';

    console.log(`${name} ${markovPct.padStart(8)}  ${mcPct.padStart(8)}    ${pubPct.padStart(6)}    ${diffStr.padStart(8)} ${status}`);
}

console.log('------------------------------------------------------------------------------');
console.log(`\nSummary (Markov vs Monte Carlo):`);
console.log(`  Total absolute difference: ${totalDiff.toFixed(3)}%`);
console.log(`  Average difference: ${(totalDiff / 40).toFixed(4)}%`);
console.log(`  Maximum difference: ${maxDiff.toFixed(3)}% (${maxDiffSquare})`);

// Leave strategy comparison
console.log('\n================================================================================');
console.log('COMPARISON: LEAVE JAIL STRATEGY');
console.log('================================================================================\n');

console.log('Square                        Markov    Monte Carlo  Diff');
console.log('------------------------------------------------------------------------------');

totalDiff = 0;
maxDiff = 0;
maxDiffSquare = '';

for (let i = 0; i < 40; i++) {
    const name = MonteCarloSim.SQUARE_NAMES[i].padEnd(28);
    const markovPct = (markovLeave[i] * 100).toFixed(3) + '%';
    const mcPct = (mcLeave.probabilities[i] * 100).toFixed(3) + '%';
    const diff = (mcLeave.probabilities[i] - markovLeave[i]) * 100;
    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(3) + '%';

    const absDiff = Math.abs(diff);
    totalDiff += absDiff;
    if (absDiff > maxDiff) {
        maxDiff = absDiff;
        maxDiffSquare = MonteCarloSim.SQUARE_NAMES[i];
    }

    const status = absDiff < 0.1 ? '✓' : absDiff < 0.2 ? '~' : '✗';

    console.log(`${name} ${markovPct.padStart(8)}  ${mcPct.padStart(8)}   ${diffStr.padStart(8)} ${status}`);
}

console.log('------------------------------------------------------------------------------');
console.log(`\nSummary (Markov vs Monte Carlo):`);
console.log(`  Total absolute difference: ${totalDiff.toFixed(3)}%`);
console.log(`  Average difference: ${(totalDiff / 40).toFixed(4)}%`);
console.log(`  Maximum difference: ${maxDiff.toFixed(3)}% (${maxDiffSquare})`);

// Strategy comparison
console.log('\n================================================================================');
console.log('JAIL STRATEGY IMPACT (Monte Carlo)');
console.log('================================================================================\n');

console.log('Squares most affected by jail strategy choice:');
console.log('Square                        Stay       Leave      Difference');
console.log('----------------------------------------------------------------');

const diffs = [];
for (let i = 0; i < 40; i++) {
    diffs.push({
        square: i,
        name: MonteCarloSim.SQUARE_NAMES[i],
        stay: mcStay.probabilities[i],
        leave: mcLeave.probabilities[i],
        diff: mcStay.probabilities[i] - mcLeave.probabilities[i]
    });
}

diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

for (let i = 0; i < 10; i++) {
    const d = diffs[i];
    const name = d.name.padEnd(28);
    const stayPct = (d.stay * 100).toFixed(3) + '%';
    const leavePct = (d.leave * 100).toFixed(3) + '%';
    const diffStr = (d.diff >= 0 ? '+' : '') + (d.diff * 100).toFixed(3) + '%';
    console.log(`${name} ${stayPct.padStart(8)}  ${leavePct.padStart(8)}   ${diffStr.padStart(8)}`);
}

console.log('\n================================================================================');
console.log('ANALYSIS COMPLETE');
console.log('================================================================================');
