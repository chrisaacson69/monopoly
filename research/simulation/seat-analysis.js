/**
 * Seat Position Analysis
 *
 * Tests if there's a seat position bias in the simulation
 */

'use strict';

const { GameEngine, BOARD } = require('./game-engine.js');
const { SimpleAI, StrategicAI, RandomAI } = require('./base-ai.js');

// Try to load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {}

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

console.log('='.repeat(60));
console.log('SEAT POSITION ANALYSIS');
console.log('='.repeat(60));

// Test 1: All same AI type - should show pure seat advantage
console.log('\n>>> Test 1: 4 Identical SimpleAI');
{
    const wins = [0, 0, 0, 0];
    const numGames = 400;

    for (let i = 0; i < numGames; i++) {
        const engine = new GameEngine({ maxTurns: 1000, verbose: false });
        const factories = [0, 1, 2, 3].map(() => (player, eng) => createAI('simple', player, eng));
        engine.newGame(4, factories);
        const result = engine.runGame();

        if (result.winner !== null) {
            wins[result.winner]++;
        }

        if ((i + 1) % 100 === 0) {
            console.log(`  Completed ${i + 1}/${numGames}...`);
        }
    }

    console.log('\nSeat Position Wins (SimpleAI):');
    const totalWins = wins.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) {
        console.log(`  Seat ${i + 1}: ${wins[i]} wins (${(wins[i]/numGames*100).toFixed(1)}%, expected 25%)`);
    }
}

// Test 2: Mixed AI with shuffled seating
console.log('\n>>> Test 2: Strategic vs Simple with shuffled seating');
{
    const aiWins = { strategic: 0, simple: 0 };
    const seatWins = [0, 0, 0, 0];
    const numGames = 400;

    for (let i = 0; i < numGames; i++) {
        // Create randomized seating
        const aiTypes = ['strategic', 'strategic', 'simple', 'simple'];

        // Shuffle (Fisher-Yates)
        for (let j = aiTypes.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [aiTypes[j], aiTypes[k]] = [aiTypes[k], aiTypes[j]];
        }

        const engine = new GameEngine({ maxTurns: 1000, verbose: false });
        const factories = aiTypes.map(type => (player, eng) => createAI(type, player, eng));
        engine.newGame(4, factories);
        const result = engine.runGame();

        if (result.winner !== null) {
            aiWins[aiTypes[result.winner]]++;
            seatWins[result.winner]++;
        }

        if ((i + 1) % 100 === 0) {
            console.log(`  Completed ${i + 1}/${numGames}...`);
        }
    }

    const totalWins = aiWins.strategic + aiWins.simple;
    console.log('\nWins by AI type (randomized seating):');
    console.log(`  Strategic: ${aiWins.strategic} (${(aiWins.strategic/totalWins*100).toFixed(1)}%)`);
    console.log(`  Simple: ${aiWins.simple} (${(aiWins.simple/totalWins*100).toFixed(1)}%)`);

    console.log('\nWins by seat position (all AI types):');
    for (let i = 0; i < 4; i++) {
        console.log(`  Seat ${i + 1}: ${seatWins[i]} wins (${(seatWins[i]/numGames*100).toFixed(1)}%)`);
    }
}

// Test 3: Investigate bankruptcy order
console.log('\n>>> Test 3: Bankruptcy Order Analysis');
{
    const bankruptcyOrder = [0, 0, 0, 0];  // How often each seat goes bankrupt 1st, 2nd, 3rd
    const numGames = 200;

    for (let i = 0; i < numGames; i++) {
        const engine = new GameEngine({ maxTurns: 1000, verbose: false });
        const factories = [0, 1, 2, 3].map(() => (player, eng) => createAI('simple', player, eng));
        engine.newGame(4, factories);

        // Track bankruptcy order
        const bankruptcies = [];
        const originalExecuteTurn = engine.executeTurn.bind(engine);

        engine.executeTurn = function() {
            const beforeBankrupt = this.state.players.filter(p => p.bankrupt).length;
            originalExecuteTurn();
            const afterBankrupt = this.state.players.filter(p => p.bankrupt).length;

            if (afterBankrupt > beforeBankrupt) {
                // Someone just went bankrupt
                for (const p of this.state.players) {
                    if (p.bankrupt && !bankruptcies.includes(p.id)) {
                        bankruptcies.push(p.id);
                    }
                }
            }
        };

        const result = engine.runGame();

        // Count first bankruptcy by seat
        if (bankruptcies.length > 0) {
            bankruptcyOrder[bankruptcies[0]]++;
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  Completed ${i + 1}/${numGames}...`);
        }
    }

    console.log('\nFirst Bankruptcy by Seat:');
    const total = bankruptcyOrder.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) {
        console.log(`  Seat ${i + 1}: ${bankruptcyOrder[i]} times (${(bankruptcyOrder[i]/total*100).toFixed(1)}%)`);
    }
}

console.log('\n' + '='.repeat(60));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(60));
