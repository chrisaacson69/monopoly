/**
 * Trajectory Diagnostic
 *
 * Visualize bilateral trajectories for cheap vs expensive monopolies
 * to understand the area-sum bias toward front-loaded development.
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { getCachedEngines } = require('./cached-engines.js');
const { EnhancedRelativeOptimal } = require('./enhanced-relative-ai.js');

const { markov, valuator } = getCachedEngines();

// Create a minimal AI instance just to access simulateBilateralGrowth
const mockPlayer = { id: 0, money: 800, properties: new Set() };
const mockEngine = { state: { players: [mockPlayer] } };
const ai = new EnhancedRelativeOptimal(mockPlayer, mockEngine, markov, valuator);

// Scenario: Player with monopoly X vs player with NO monopoly
// Starting cash: $800 each (typical mid-game)
// This shows the "threat value" of each monopoly completing

const groups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

console.log('='.repeat(80));
console.log('TRAJECTORY DIAGNOSTIC: Monopoly Value Over Time');
console.log('Scenario: Player A has monopoly (0 houses) vs Player B has nothing');
console.log('Starting cash: $800 each, 3 opponents');
console.log('='.repeat(80));

for (const group of groups) {
    const squares = COLOR_GROUPS[group].squares;
    const houseCost = BOARD[squares[0]].housePrice;
    const totalDevCost = houseCost * squares.length * 5;  // cost to fully develop

    // Build property states: player 0 owns the monopoly
    const propertyStates = {};
    for (const sq of squares) {
        propertyStates[sq] = { owner: 0, houses: 0, mortgaged: false };
    }

    const result = ai.simulateBilateralGrowth(
        { groups: [group], cash: 800, id: 0 },
        { groups: [], cash: 800, id: 1 },
        propertyStates, 2  // 2 other opponents (4-player game)
    );

    const myTraj = result.myTrajectory;
    const theirTraj = result.theirTrajectory;

    // Compute area difference
    const myArea = myTraj.reduce((s, v) => s + v, 0);
    const theirArea = theirTraj.reduce((s, v) => s + v, 0);
    const areaDiff = myArea - theirArea;

    // Find crossover point (when does the gap stop growing?)
    let maxGap = 0, maxGapTurn = 0;
    let gapGrowing = true;
    const gaps = [];
    for (let t = 0; t < myTraj.length; t++) {
        const gap = myTraj[t] - theirTraj[t];
        gaps.push(gap);
        if (gap > maxGap) {
            maxGap = gap;
            maxGapTurn = t;
        }
    }

    // Terminal gap (end of horizon)
    const terminalGap = myTraj[62] - theirTraj[62];

    // When does player A reach 3 houses? (check trajectory growth rate)
    let buildCompleteTurn = 62;
    for (let t = 1; t < myTraj.length; t++) {
        const growth = myTraj[t] - myTraj[t - 1];
        const prevGrowth = t > 1 ? myTraj[t - 1] - myTraj[t - 2] : 0;
        if (t > 5 && growth < prevGrowth * 0.95 && growth > 0) {
            buildCompleteTurn = t;
            break;
        }
    }

    console.log(`\n--- ${group.toUpperCase()} (house cost: $${houseCost}, full dev: $${totalDevCost}) ---`);
    console.log(`  Area diff:     ${areaDiff.toFixed(0).padStart(10)} (me - them)`);
    console.log(`  Terminal gap:  ${terminalGap.toFixed(0).padStart(10)} (turn 62)`);
    console.log(`  Max gap:       ${maxGap.toFixed(0).padStart(10)} at turn ${maxGapTurn}`);
    console.log(`  Ratio terminal/area: ${(terminalGap * 63 / areaDiff * 100).toFixed(1)}%`);
    console.log(`  Trajectory sample (every 10 turns):`);
    console.log(`    Turn   Me        Them      Gap`);
    for (let t = 0; t <= 62; t += 10) {
        console.log(`    ${String(t).padStart(4)}   $${myTraj[t].toFixed(0).padStart(7)}   $${theirTraj[t].toFixed(0).padStart(7)}   $${(myTraj[t] - theirTraj[t]).toFixed(0).padStart(7)}`);
    }
    // Also show turn 62
    console.log(`    ${String(62).padStart(4)}   $${myTraj[62].toFixed(0).padStart(7)}   $${theirTraj[62].toFixed(0).padStart(7)}   $${(myTraj[62] - theirTraj[62]).toFixed(0).padStart(7)}`);
}

// Now: symmetric scenario — both players have monopolies
console.log('\n' + '='.repeat(80));
console.log('SYMMETRIC: Brown holder vs Green holder');
console.log('$800 each, 3 opponents');
console.log('='.repeat(80));

const brownSquares = COLOR_GROUPS['brown'].squares;
const greenSquares = COLOR_GROUPS['green'].squares;

const symPS = {};
for (const sq of brownSquares) symPS[sq] = { owner: 0, houses: 0, mortgaged: false };
for (const sq of greenSquares) symPS[sq] = { owner: 1, houses: 0, mortgaged: false };

const symResult = ai.simulateBilateralGrowth(
    { groups: ['brown'], cash: 800, id: 0 },
    { groups: ['green'], cash: 800, id: 1 },
    symPS, 2
);

console.log('  Turn   Brown     Green     Gap (Brown-Green)');
for (let t = 0; t <= 62; t += 5) {
    console.log(`  ${String(t).padStart(4)}   $${symResult.myTrajectory[t].toFixed(0).padStart(7)}   $${symResult.theirTrajectory[t].toFixed(0).padStart(7)}   $${(symResult.myTrajectory[t] - symResult.theirTrajectory[t]).toFixed(0).padStart(7)}`);
}
console.log(`  ${String(62).padStart(4)}   $${symResult.myTrajectory[62].toFixed(0).padStart(7)}   $${symResult.theirTrajectory[62].toFixed(0).padStart(7)}   $${(symResult.myTrajectory[62] - symResult.theirTrajectory[62]).toFixed(0).padStart(7)}`);

const brownArea = symResult.myTrajectory.reduce((s, v) => s + v, 0);
const greenArea = symResult.theirTrajectory.reduce((s, v) => s + v, 0);
console.log(`\n  Brown total area: ${brownArea.toFixed(0)}`);
console.log(`  Green total area: ${greenArea.toFixed(0)}`);
console.log(`  Brown wins the area? ${brownArea > greenArea ? 'YES (problem!)' : 'No (correct)'}`);

// Orange vs Green
console.log('\n' + '='.repeat(80));
console.log('SYMMETRIC: Orange holder vs Green holder');
console.log('$800 each, 3 opponents');
console.log('='.repeat(80));

const orangeSquares = COLOR_GROUPS['orange'].squares;
const ogPS = {};
for (const sq of orangeSquares) ogPS[sq] = { owner: 0, houses: 0, mortgaged: false };
for (const sq of greenSquares) ogPS[sq] = { owner: 1, houses: 0, mortgaged: false };

const ogResult = ai.simulateBilateralGrowth(
    { groups: ['orange'], cash: 800, id: 0 },
    { groups: ['green'], cash: 800, id: 1 },
    ogPS, 2
);

console.log('  Turn   Orange    Green     Gap (Orange-Green)');
for (let t = 0; t <= 62; t += 5) {
    console.log(`  ${String(t).padStart(4)}   $${ogResult.myTrajectory[t].toFixed(0).padStart(7)}   $${ogResult.theirTrajectory[t].toFixed(0).padStart(7)}   $${(ogResult.myTrajectory[t] - ogResult.theirTrajectory[t]).toFixed(0).padStart(7)}`);
}
console.log(`  ${String(62).padStart(4)}   $${ogResult.myTrajectory[62].toFixed(0).padStart(7)}   $${ogResult.theirTrajectory[62].toFixed(0).padStart(7)}   $${(ogResult.myTrajectory[62] - ogResult.theirTrajectory[62]).toFixed(0).padStart(7)}`);

const orangeArea = ogResult.myTrajectory.reduce((s, v) => s + v, 0);
const gArea2 = ogResult.theirTrajectory.reduce((s, v) => s + v, 0);
console.log(`\n  Orange total area: ${orangeArea.toFixed(0)}`);
console.log(`  Green total area: ${gArea2.toFixed(0)}`);
