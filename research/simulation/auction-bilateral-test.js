/**
 * Auction Bilateral Test
 *
 * Tests whether the bilateral trajectory model improves auction bidding
 * by replacing static multipliers (1.05x base, 1.5x completion, 1.3x blocking)
 * with trajectory-derived indifference prices.
 *
 * The indifference price is the cash C where I'm equally well off owning
 * the property (at cost C) vs the most threatening opponent owning it.
 *
 * Tests in both:
 * 1. Normal game mode (1 new vs 3 baseline)
 * 2. Auction-only mode (all properties go to auction)
 *
 * Key hypothesis: The bilateral model captures what the property is worth
 * to BOTH players, naturally handling monopoly completion and blocking
 * without arbitrary multipliers.
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { AuctionGameEngine } = require('./auction-game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');

const { getCachedEngines } = require('./cached-engines.js');
const { markovEngine, valuator } = getCachedEngines();

// =============================================================================
// FACTORIES
// =============================================================================

// Current: bilateral trajectory bid (the new code in EnhancedRelativeAI)
function createBilateralBidFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'BilateralBid';
        return ai;
    };
}

// Control: revert getMaxBid to old static formula
function createStaticBidFactory() {
    return (player, engine) => {
        const ai = new StrategicTradeAI(player, engine, markovEngine, valuator);
        ai.name = 'StaticBid';

        // Revert to old static getMaxBid
        ai.getMaxBid = function(position, state) {
            const square = BOARD[position];
            let maxWilling = square.price * (1 + ai.auctionConfig.baseBidPremium);

            if (ai.wouldCompleteMonopoly(position, state)) {
                maxWilling = Math.max(maxWilling,
                    square.price * ai.auctionConfig.monopolyCompletionMultiplier);
            }

            if (ai.auctionConfig.smartBlocking) {
                const blockingContext = ai.analyzeBlockingContext(position, state);
                if (blockingContext.shouldBlock && !blockingContext.isRedundant) {
                    maxWilling = Math.max(maxWilling,
                        square.price * ai.auctionConfig.blockingMultiplier);
                }
            } else {
                if (ai.wouldBlockMonopoly(position, state)) {
                    maxWilling = Math.max(maxWilling,
                        square.price * ai.auctionConfig.blockingMultiplier);
                }
            }

            return Math.floor(maxWilling);
        };

        return ai;
    };
}

// =============================================================================
// TOURNAMENT RUNNER
// =============================================================================

function runTest(label, newFactory, baseFactory, games, nPlayers, EngineClass) {
    let newWins = 0, baseWins = 0, timeouts = 0;
    const startTime = Date.now();

    const newCount = 1;
    const baseCount = nPlayers - newCount;

    for (let i = 0; i < games; i++) {
        const engine = new EngineClass({ maxTurns: 500 });
        const factories = [newFactory];
        for (let j = 0; j < baseCount; j++) factories.push(baseFactory);
        engine.newGame(nPlayers, factories);
        const result = engine.runGame();

        if (result.winner === 0) newWins++;
        else if (result.winner !== null) baseWins++;
        else timeouts++;

        if ((i + 1) % 500 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const wr = (newWins / (i + 1) * 100).toFixed(1);
            console.log('  [' + label + '] Game ' + (i + 1) + '/' + games +
                        '  wins=' + newWins + ' (' + wr + '%)' +
                        '  ' + elapsed.toFixed(0) + 's');
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const expected = 1 / nPlayers;
    const newRate = newWins / games;
    const z = (newRate - expected) / Math.sqrt(expected * (1 - expected) / games);

    console.log();
    console.log('-'.repeat(60));
    console.log(label + ':');
    console.log('  New: ' + newWins + '/' + games + ' (' + (newRate * 100).toFixed(1) + '%)');
    console.log('  Base: ' + baseWins + '/' + games + ' (avg ' +
        (baseWins / (games * baseCount) * 100).toFixed(1) + '% each)');
    console.log('  Timeouts: ' + timeouts);
    console.log('  Z=' + z.toFixed(2) +
        (Math.abs(z) > 2.58 ? ' ***HIGHLY SIGNIFICANT (p<0.01)***' :
         Math.abs(z) > 1.96 ? ' ***SIGNIFICANT (p<0.05)***' :
         Math.abs(z) > 1.64 ? ' *marginal*' : ''));
    console.log('  ' + elapsed.toFixed(0) + 's');
    console.log();

    return { label, winRate: (newRate * 100).toFixed(1), z: z.toFixed(2) };
}

// =============================================================================
// RUN TESTS
// =============================================================================

const GAMES = 2000;

console.log('='.repeat(80));
console.log('AUCTION BILATERAL TEST');
console.log(GAMES + ' games each, 1 new vs 3 baseline');
console.log('='.repeat(80));
console.log();
console.log('Tests:');
console.log('  1. Normal game: BilateralBid vs StaticBid');
console.log('  2. Auction-only: BilateralBid vs StaticBid');
console.log();

const results = [];

// Test 1: Normal game mode
console.log('--- NORMAL GAME MODE ---');
results.push(runTest(
    'Normal: BilateralBid vs StaticBid',
    createBilateralBidFactory(),
    createStaticBidFactory(),
    GAMES, 4, GameEngine
));

// Test 2: Auction-only mode
console.log('--- AUCTION-ONLY MODE ---');
results.push(runTest(
    'Auction: BilateralBid vs StaticBid',
    createBilateralBidFactory(),
    createStaticBidFactory(),
    GAMES, 4, AuctionGameEngine
));

console.log('='.repeat(80));
console.log('SUMMARY:');
console.log('='.repeat(80));
for (const r of results) {
    console.log('  ' + r.label.padEnd(45) + r.winRate + '%  Z=' + r.z);
}
console.log('  ' + 'Expected (no improvement)'.padEnd(45) + '25.0%  Z=0.00');
console.log('='.repeat(80));
