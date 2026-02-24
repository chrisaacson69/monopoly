/**
 * Detailed Game Analysis
 *
 * Runs games and collects detailed statistics to understand
 * game dynamics and why games timeout.
 */

'use strict';

const { GameEngine, BOARD } = require('./game-engine.js');
const { SimpleAI, StrategicAI, RandomAI } = require('./base-ai.js');

// Try to load Markov engine for strategic AI
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.log('Note: Markov engine not available');
}

// Initialize shared components
let markovEngine = null;
let valuator = null;

if (MarkovEngine) {
    markovEngine = new MarkovEngine();
    markovEngine.initialize();
    if (PropertyValuator) {
        valuator = new PropertyValuator.Valuator(markovEngine);
        valuator.initialize();
    }
}

function createAI(type, player, engine) {
    switch (type) {
        case 'simple': return new SimpleAI(player, engine);
        case 'strategic': return new StrategicAI(player, engine, markovEngine, valuator);
        case 'random': return new RandomAI(player, engine);
        default: return new SimpleAI(player, engine);
    }
}

function analyzeGame(aiTypes, verbose = false) {
    const engine = new GameEngine({
        maxTurns: 1000,
        verbose: verbose
    });

    const factories = aiTypes.map(type => (player, eng) => createAI(type, player, eng));
    engine.newGame(aiTypes.length, factories);
    const result = engine.runGame();

    // Detailed analysis
    const analysis = {
        winner: result.winner,
        turns: result.turns,
        timedOut: result.winner === null,

        // Monopoly formation
        monopoliesFormed: [],

        // House building
        totalHousesBuilt: result.stats.housesBought.reduce((a, b) => a + b, 0),
        housesByPlayer: result.stats.housesBought,

        // Property ownership
        propertiesPerPlayer: [],

        // Money flow
        rentPaidPerPlayer: result.stats.rentPaid,

        // Final state
        finalMoney: [],
        finalNetWorth: []
    };

    // Analyze final state
    const state = result.finalState;
    for (let i = 0; i < aiTypes.length; i++) {
        const player = state.players[i];
        analysis.propertiesPerPlayer.push(player.properties.size);
        analysis.finalMoney.push(player.money);

        // Calculate net worth
        let netWorth = player.money;
        for (const prop of player.properties) {
            const square = state.propertyStates[prop];
            const boardSquare = BOARD[prop];
            if (boardSquare.price) {
                if (square.mortgaged) {
                    netWorth += boardSquare.price / 2;  // Mortgaged value
                } else {
                    netWorth += boardSquare.price;
                    if (square.houses > 0) {
                        const houseValue = (boardSquare.housePrice || 0) * Math.min(square.houses, 4);
                        const hotelValue = square.houses === 5 ? (boardSquare.housePrice || 0) : 0;
                        netWorth += (houseValue + hotelValue) / 2;  // Half value for houses
                    }
                }
            }
        }
        analysis.finalNetWorth.push(Math.floor(netWorth));

        // Check monopolies
        const monopolies = player.getMonopolies ? player.getMonopolies(state) : [];
        if (monopolies.length > 0) {
            analysis.monopoliesFormed.push({
                player: i,
                monopolies: monopolies
            });
        }
    }

    return analysis;
}

// Run analysis
console.log('='.repeat(60));
console.log('DETAILED GAME ANALYSIS');
console.log('='.repeat(60));

const aiTypes = ['strategic', 'strategic', 'strategic', 'strategic'];
const numGames = 50;

let timedOutGames = 0;
let totalTurns = 0;
let gamesWithMonopolies = 0;
let totalMonopolies = 0;
let totalHouses = 0;
const winsByMonopolyCount = {};
const turnsDistribution = [];

console.log(`\nRunning ${numGames} games with ${aiTypes.join(' vs ')}...\n`);

for (let i = 0; i < numGames; i++) {
    const analysis = analyzeGame(aiTypes);

    totalTurns += analysis.turns;
    turnsDistribution.push(analysis.turns);

    if (analysis.timedOut) {
        timedOutGames++;
    }

    if (analysis.monopoliesFormed.length > 0) {
        gamesWithMonopolies++;
        totalMonopolies += analysis.monopoliesFormed.reduce((sum, m) => sum + m.monopolies.length, 0);
    }

    totalHouses += analysis.totalHousesBuilt;

    // Track wins by monopoly count
    if (analysis.winner !== null) {
        const winnerMonopolies = analysis.monopoliesFormed
            .filter(m => m.player === analysis.winner)
            .reduce((sum, m) => sum + m.monopolies.length, 0);
        winsByMonopolyCount[winnerMonopolies] = (winsByMonopolyCount[winnerMonopolies] || 0) + 1;
    }

    if ((i + 1) % 10 === 0) {
        console.log(`  Completed ${i + 1}/${numGames} games...`);
    }
}

// Sort turns for median calculation
turnsDistribution.sort((a, b) => a - b);

console.log('\n' + '='.repeat(60));
console.log('RESULTS');
console.log('='.repeat(60));

console.log(`\nGames completed: ${numGames}`);
console.log(`Timed out games: ${timedOutGames} (${(timedOutGames/numGames*100).toFixed(1)}%)`);
console.log(`Games with monopolies: ${gamesWithMonopolies} (${(gamesWithMonopolies/numGames*100).toFixed(1)}%)`);

console.log(`\nTurns per game:`);
console.log(`  Average: ${(totalTurns/numGames).toFixed(1)}`);
console.log(`  Median: ${turnsDistribution[Math.floor(numGames/2)]}`);
console.log(`  Min: ${turnsDistribution[0]}`);
console.log(`  Max: ${turnsDistribution[numGames-1]}`);

console.log(`\nMonopolies formed: ${totalMonopolies} total (${(totalMonopolies/numGames).toFixed(2)} per game)`);
console.log(`Houses built: ${totalHouses} total (${(totalHouses/numGames).toFixed(1)} per game)`);

console.log(`\nWins by monopoly count:`);
for (const [count, wins] of Object.entries(winsByMonopolyCount).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`  ${count} monopolies: ${wins} wins`);
}

// Run one verbose game to see what's happening
console.log('\n' + '='.repeat(60));
console.log('SAMPLE VERBOSE GAME');
console.log('='.repeat(60));

const verboseAnalysis = analyzeGame(['strategic', 'simple'], true);

console.log(`\nGame ended at turn ${verboseAnalysis.turns}`);
console.log(`Winner: Player ${verboseAnalysis.winner !== null ? verboseAnalysis.winner + 1 : 'None (timed out)'}`);
console.log(`\nFinal state:`);
for (let i = 0; i < 2; i++) {
    console.log(`  Player ${i + 1}: $${verboseAnalysis.finalMoney[i]}, ${verboseAnalysis.propertiesPerPlayer[i]} properties, net worth $${verboseAnalysis.finalNetWorth[i]}`);
}
if (verboseAnalysis.monopoliesFormed.length > 0) {
    console.log(`\nMonopolies:`);
    for (const m of verboseAnalysis.monopoliesFormed) {
        console.log(`  Player ${m.player + 1}: ${m.monopolies.join(', ')}`);
    }
}
