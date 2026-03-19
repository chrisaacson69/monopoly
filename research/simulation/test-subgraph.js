/**
 * Test the SubgraphAnalyzer against known game states
 */

'use strict';

const { GameEngine, GameState, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');
const { analyzeSubgraph, valuePropertyForPlayer, printSubgraph } = require('./subgraph-analyzer.js');
const { searchTrades, printTradeSearch } = require('./trade-search-engine.js');

// Create a test game state with known property distribution
function createTestState() {
    const engine = new GameEngine({ verbose: false });
    engine.newGame(4);  // Initialize 4-player game

    // Manually assign properties to create an interesting mid-game state
    // Player 0: Complete orange + 1 red (strong position)
    // Player 1: Complete light blue + 1 green (fast developer)
    // Player 2: 2 of 3 red + 1 yellow (needs trade)
    // Player 3: 2 green + dark blue pair (needs trade)

    const assignments = {
        // Orange complete → Player 0
        16: { owner: 0, houses: 0 },  // St. James
        18: { owner: 0, houses: 0 },  // Tennessee
        19: { owner: 0, houses: 0 },  // New York
        // Player 0 also has 1 red
        21: { owner: 0, houses: 0 },  // Kentucky

        // Light Blue complete → Player 1
        6: { owner: 1, houses: 2 },   // Oriental (2 houses)
        8: { owner: 1, houses: 2 },   // Vermont (2 houses)
        9: { owner: 1, houses: 2 },   // Connecticut (2 houses)
        // Player 1 also has 1 green
        31: { owner: 1, houses: 0 },  // Pacific

        // Player 2: 2 of 3 red + 1 yellow
        23: { owner: 2, houses: 0 },  // Indiana
        24: { owner: 2, houses: 0 },  // Illinois
        26: { owner: 2, houses: 0 },  // Atlantic (yellow)

        // Player 3: 2 green + dark blue pair
        32: { owner: 3, houses: 0 },  // North Carolina
        34: { owner: 3, houses: 0 },  // Pennsylvania
        37: { owner: 3, houses: 0 },  // Park Place
        39: { owner: 3, houses: 0 },  // Boardwalk
    };

    for (const [sq, assignment] of Object.entries(assignments)) {
        const sqIdx = parseInt(sq);
        engine.state.propertyStates[sqIdx] = {
            owner: assignment.owner,
            houses: assignment.houses,
            mortgaged: false
        };
        engine.state.players[assignment.owner].properties.add(sqIdx);
    }

    // Set cash positions
    engine.state.players[0].money = 800;
    engine.state.players[1].money = 400;
    engine.state.players[2].money = 1200;
    engine.state.players[3].money = 600;

    return engine;
}

// Run the test
const engine = createTestState();
const state = engine.state;

console.log('╔══════════════════════════════════════════════════╗');
console.log('║     SUBGRAPH ANALYZER TEST                      ║');
console.log('╚══════════════════════════════════════════════════╝');

// Analyze each player
for (let i = 0; i < 4; i++) {
    const subgraph = analyzeSubgraph(i, state);
    printSubgraph(subgraph);
}

// Test property valuation: How much is Kentucky (21) worth to Player 2?
// Player 2 has Indiana (23) + Illinois (24) — Kentucky would complete red!
console.log('\n=== PROPERTY VALUATION TEST ===');
const kentuckyForP2 = valuePropertyForPlayer(21, 2, state);
console.log(`Kentucky Avenue value to Player 2:`);
console.log(`  Completes set: ${kentuckyForP2.completesSet}`);
console.log(`  New set group: ${kentuckyForP2.newSetGroup}`);
console.log(`  Frontier delta (EPT gain): $${kentuckyForP2.hypotheticalValue.toFixed(2)}`);
console.log(`  Position change: ${kentuckyForP2.positionChange}`);

// How much is Kentucky worth to Player 0? (already has orange, it's just a partial)
const kentuckyForP0 = valuePropertyForPlayer(21, 0, state);
console.log(`\nKentucky Avenue value to Player 0 (already owns it):`);
console.log(`  Completes set: ${kentuckyForP0.completesSet}`);
console.log(`  Frontier delta: $${kentuckyForP0.hypotheticalValue.toFixed(2)}`);

// How much is Pacific (31) worth to Player 3?
// Player 3 has NC (32) + Penn (34) — Pacific would complete green!
const pacificForP3 = valuePropertyForPlayer(31, 3, state);
console.log(`\nPacific Avenue value to Player 3:`);
console.log(`  Completes set: ${pacificForP3.completesSet}`);
console.log(`  New set group: ${pacificForP3.newSetGroup}`);
console.log(`  Frontier delta: $${pacificForP3.hypotheticalValue.toFixed(2)}`);
console.log(`  Position change: ${pacificForP3.positionChange}`);

// === TRADE SEARCH TEST ===
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║     TRADE SEARCH TEST                            ║');
console.log('╚══════════════════════════════════════════════════╝');

// Player 2 is LOSING_WITH_PARTIALS — should be searching for trades
const p2Trade = searchTrades(2, state, null, { verbose: true });
printTradeSearch(p2Trade, 2);

// Player 0 is CAPPED — should search (low ROI on orange 0h→1h)
const p0Trade = searchTrades(0, state, null, { verbose: true });
printTradeSearch(p0Trade, 0);

// Player 1 is GROWING — should NOT search (building is better)
const p1Trade = searchTrades(1, state, null, { verbose: true });
printTradeSearch(p1Trade, 1);

// Player 3 is CAPPED — should search
const p3Trade = searchTrades(3, state, null, { verbose: true });
printTradeSearch(p3Trade, 3);

console.log('\n=== TEST COMPLETE ===');
