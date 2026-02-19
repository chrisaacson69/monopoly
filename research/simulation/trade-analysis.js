/**
 * Trade and Housing Analysis
 *
 * Tracks:
 * - Trade fairness (who benefits more)
 * - Housing shortage occurrence
 * - Monopoly timing
 * - Development levels at game end
 * - Correlation between trade advantage and winning
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');
const { DynamicTradingAI } = require('./dynamic-trading-ai.js');

// Load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
    PropertyValuator = require('../property-valuator.js');
} catch (e) {
    console.error('Markov engine required');
    process.exit(1);
}

const markovEngine = new MarkovEngine();
markovEngine.initialize();
const valuator = new PropertyValuator.Valuator(markovEngine);
valuator.initialize();

// Get landing probabilities
const probs = markovEngine.getAllProbabilities('stay');

// =============================================================================
// INSTRUMENTED GAME ENGINE
// =============================================================================

class InstrumentedEngine extends GameEngine {
    constructor(options) {
        super(options);
        this.tradeLog = [];
        this.housingShortageLog = [];
        this.monopolyFormationLog = [];
    }

    /**
     * Override executeTrade to log trade details
     */
    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        // Calculate EPT value of properties being traded (raw)
        const fromPropsEPT = this.calculatePropertiesEPT(fromProperties);
        const toPropsEPT = this.calculatePropertiesEPT(toProperties);

        // Check if trade completes monopolies
        const fromCompletesMonopoly = this.wouldCompleteMonopoly(from, toProperties);
        const toCompletesMonopoly = this.wouldCompleteMonopoly(to, fromProperties);

        // Calculate monopoly EPT gains (the REAL value of the trade)
        let fromMonopolyGain = 0;
        let toMonopolyGain = 0;

        if (fromCompletesMonopoly) {
            fromMonopolyGain = this.calculateGroupEPT(fromCompletesMonopoly);
        }
        if (toCompletesMonopoly) {
            toMonopolyGain = this.calculateGroupEPT(toCompletesMonopoly);
        }

        // TRUE fairness: What monopoly EPT does each side gain, minus cash?
        // 'from' player: gains monopoly (if completing) + loses cash
        // 'to' player: gains monopoly (if completing) + gains cash
        const fromNetGain = fromMonopolyGain - fromCash * 0.02;  // Cash ~2% per turn value
        const toNetGain = toMonopolyGain + fromCash * 0.02;

        // Fairness gap based on net monopoly gains
        const fairnessGap = Math.abs(fromNetGain - toNetGain);

        // Categorize trade type
        let tradeType = 'other';
        if (fromCompletesMonopoly && toCompletesMonopoly) {
            tradeType = 'mutual_monopoly';  // Both complete monopolies - likely fair
        } else if (fromCompletesMonopoly && !toCompletesMonopoly) {
            tradeType = 'cash_for_monopoly';  // One side pays cash for monopoly
        } else if (!fromCompletesMonopoly && toCompletesMonopoly) {
            tradeType = 'cash_for_monopoly';
        }

        this.tradeLog.push({
            turn: this.state.turn,
            fromPlayer: from.id,
            toPlayer: to.id,
            fromProperties: Array.from(fromProperties),
            toProperties: Array.from(toProperties),
            cash: fromCash,
            fromPropsEPT,
            toPropsEPT,
            fromCompletesMonopoly,
            toCompletesMonopoly,
            fromMonopolyGain,
            toMonopolyGain,
            fromNetGain,
            toNetGain,
            fairnessGap,
            tradeType
        });

        // Track monopoly formation
        if (fromCompletesMonopoly) {
            this.monopolyFormationLog.push({
                turn: this.state.turn,
                player: from.id,
                group: fromCompletesMonopoly,
                method: 'trade',
                housesAvailable: this.state.housesAvailable
            });
        }
        if (toCompletesMonopoly) {
            this.monopolyFormationLog.push({
                turn: this.state.turn,
                player: to.id,
                group: toCompletesMonopoly,
                method: 'trade',
                housesAvailable: this.state.housesAvailable
            });
        }

        return super.executeTrade(trade);
    }

    /**
     * Calculate total EPT for a color group at 3 houses
     */
    calculateGroupEPT(group) {
        const groupSquares = COLOR_GROUPS[group].squares;
        const opponents = this.state.players.filter(p => !p.bankrupt).length - 1;
        let totalEPT = 0;

        for (const sq of groupSquares) {
            const prob = probs[sq] || 0.025;
            const rent = BOARD[sq].rent[3];
            totalEPT += prob * rent * opponents;
        }

        return totalEPT;
    }

    /**
     * Override buildHouse to track housing shortage
     */
    buildHouse(player, position) {
        const beforeHouses = this.state.housesAvailable;
        const beforeHotels = this.state.hotelsAvailable;

        const result = super.buildHouse(player, position);

        // Check for shortage
        if (this.state.housesAvailable <= 4 || this.state.hotelsAvailable <= 1) {
            this.housingShortageLog.push({
                turn: this.state.turn,
                housesAvailable: this.state.housesAvailable,
                hotelsAvailable: this.state.hotelsAvailable,
                player: player.id
            });
        }

        return result;
    }

    /**
     * Calculate EPT value of a set of properties
     */
    calculatePropertiesEPT(properties) {
        let totalEPT = 0;
        const opponents = this.state.players.filter(p => !p.bankrupt).length - 1;

        for (const prop of properties) {
            const square = BOARD[prop];
            if (!square.rent) continue;

            const prob = probs[prop] || 0.025;
            // Estimate at 3 houses (typical development)
            const rent = square.rent[3] || square.rent[0] * 2;
            totalEPT += prob * rent * opponents;
        }

        return totalEPT;
    }

    /**
     * Check if receiving these properties would complete a monopoly
     * Returns the group name if so, null otherwise
     */
    wouldCompleteMonopoly(player, properties) {
        for (const prop of properties) {
            const square = BOARD[prop];
            if (!square.group) continue;

            const groupSquares = COLOR_GROUPS[square.group].squares;
            const wouldOwn = groupSquares.filter(sq =>
                player.properties.has(sq) || properties.has(sq)
            ).length;

            if (wouldOwn === groupSquares.length) return square.group;
        }
        return null;
    }

    /**
     * Get analysis results
     */
    getAnalysis() {
        return {
            trades: this.tradeLog,
            housingShortages: this.housingShortageLog,
            monopolyFormations: this.monopolyFormationLog,
            finalHousesAvailable: this.state.housesAvailable,
            finalHotelsAvailable: this.state.hotelsAvailable
        };
    }
}

// =============================================================================
// RUN ANALYSIS
// =============================================================================

function runAnalysis(aiType, numGames) {
    const results = {
        games: [],
        totalTrades: 0,
        unfairTrades: 0,  // Fairness gap > 5
        veryUnfairTrades: 0,  // Fairness gap > 10
        tradeWinnerWins: 0,  // Player who got better trade wins game
        earlyMonopolyWins: 0,  // First to get monopoly wins
        housingShortageGames: 0,
        avgTurns: 0,
        avgHousesAtEnd: 0,
        avgTradesPerGame: 0,
        monopolyFormationTurns: [],
        tradeFairnessGaps: [],
        winnerTradeAdvantage: []  // How much trade advantage did winner have
    };

    for (let i = 0; i < numGames; i++) {
        const engine = new InstrumentedEngine({
            maxTurns: 500,
            verbose: false
        });

        const factories = aiType === 'dynamic'
            ? [
                (p, e) => new DynamicTradingAI(p, e, markovEngine, valuator),
                (p, e) => new DynamicTradingAI(p, e, markovEngine, valuator),
                (p, e) => new DynamicTradingAI(p, e, markovEngine, valuator),
                (p, e) => new DynamicTradingAI(p, e, markovEngine, valuator)
            ]
            : [
                (p, e) => new TradingAI(p, e, markovEngine, valuator),
                (p, e) => new TradingAI(p, e, markovEngine, valuator),
                (p, e) => new TradingAI(p, e, markovEngine, valuator),
                (p, e) => new TradingAI(p, e, markovEngine, valuator)
            ];

        engine.newGame(4, factories);
        const result = engine.runGame();
        const analysis = engine.getAnalysis();

        // Aggregate results
        results.totalTrades += analysis.trades.length;
        results.avgTurns += result.turns;
        results.avgHousesAtEnd += (32 - analysis.finalHousesAvailable);

        // Trade fairness analysis
        const playerTradeBalance = [0, 0, 0, 0];  // Net value gained from trades
        let mutualMonopolyTrades = 0;
        let cashForMonopolyTrades = 0;

        for (const trade of analysis.trades) {
            results.tradeFairnessGaps.push(trade.fairnessGap);

            if (trade.fairnessGap > 20) results.unfairTrades++;  // Adjusted threshold
            if (trade.fairnessGap > 40) results.veryUnfairTrades++;

            // Track trade types
            if (trade.tradeType === 'mutual_monopoly') mutualMonopolyTrades++;
            if (trade.tradeType === 'cash_for_monopoly') cashForMonopolyTrades++;

            playerTradeBalance[trade.fromPlayer] += trade.fromNetGain;
            playerTradeBalance[trade.toPlayer] += trade.toNetGain;
        }

        results.mutualMonopolyTrades = (results.mutualMonopolyTrades || 0) + mutualMonopolyTrades;
        results.cashForMonopolyTrades = (results.cashForMonopolyTrades || 0) + cashForMonopolyTrades;

        // Did the player with best trade balance win?
        if (result.winner !== null) {
            const maxBalance = Math.max(...playerTradeBalance);
            const bestTrader = playerTradeBalance.indexOf(maxBalance);
            if (bestTrader === result.winner) {
                results.tradeWinnerWins++;
            }
            results.winnerTradeAdvantage.push(playerTradeBalance[result.winner]);
        }

        // Monopoly formation timing
        if (analysis.monopolyFormations.length > 0) {
            const firstMonopoly = analysis.monopolyFormations[0];
            results.monopolyFormationTurns.push(firstMonopoly.turn);

            // Did first monopoly holder win?
            if (result.winner === firstMonopoly.player) {
                results.earlyMonopolyWins++;
            }
        }

        // Housing shortage
        if (analysis.housingShortages.length > 0) {
            results.housingShortageGames++;
        }

        results.games.push({
            turns: result.turns,
            winner: result.winner,
            trades: analysis.trades.length,
            housingShortage: analysis.housingShortages.length > 0,
            firstMonopolyTurn: analysis.monopolyFormations[0]?.turn || null,
            firstMonopolyPlayer: analysis.monopolyFormations[0]?.player || null
        });
    }

    // Calculate averages
    results.avgTurns /= numGames;
    results.avgHousesAtEnd /= numGames;
    results.avgTradesPerGame = results.totalTrades / numGames;
    results.avgFairnessGap = results.tradeFairnessGaps.length > 0
        ? results.tradeFairnessGaps.reduce((a, b) => a + b, 0) / results.tradeFairnessGaps.length
        : 0;
    results.avgMonopolyFormationTurn = results.monopolyFormationTurns.length > 0
        ? results.monopolyFormationTurns.reduce((a, b) => a + b, 0) / results.monopolyFormationTurns.length
        : 0;
    results.avgWinnerTradeAdvantage = results.winnerTradeAdvantage.length > 0
        ? results.winnerTradeAdvantage.reduce((a, b) => a + b, 0) / results.winnerTradeAdvantage.length
        : 0;

    return results;
}

// =============================================================================
// MAIN
// =============================================================================

console.log('='.repeat(70));
console.log('TRADE AND HOUSING ANALYSIS');
console.log('='.repeat(70));

const NUM_GAMES = 200;

// Analyze Static Trading AI
console.log('\n>>> Analyzing Static Trading AI...');
const staticResults = runAnalysis('static', NUM_GAMES);

// Analyze Dynamic Trading AI
console.log('>>> Analyzing Dynamic Trading AI...');
const dynamicResults = runAnalysis('dynamic', NUM_GAMES);

// Report
console.log('\n' + '='.repeat(70));
console.log('RESULTS');
console.log('='.repeat(70));

function printResults(name, r) {
    const gamesWithWinner = r.games.filter(g => g.winner !== null).length;

    console.log(`\n${name}:`);
    console.log('-'.repeat(50));
    console.log(`  Games: ${NUM_GAMES}`);
    console.log(`  Avg turns: ${r.avgTurns.toFixed(1)}`);
    console.log(`  Games with winner: ${gamesWithWinner} (${(gamesWithWinner/NUM_GAMES*100).toFixed(0)}%)`);

    console.log(`\n  TRADES:`);
    console.log(`    Total trades: ${r.totalTrades} (${r.avgTradesPerGame.toFixed(2)} per game)`);
    console.log(`    Unfair trades (gap > 5 EPT): ${r.unfairTrades} (${(r.unfairTrades/r.totalTrades*100).toFixed(1)}%)`);
    console.log(`    Very unfair (gap > 10 EPT): ${r.veryUnfairTrades} (${(r.veryUnfairTrades/r.totalTrades*100).toFixed(1)}%)`);
    console.log(`    Avg fairness gap: ${r.avgFairnessGap.toFixed(2)} EPT`);

    console.log(`\n  TRADE -> WIN CORRELATION:`);
    console.log(`    Best trader wins: ${r.tradeWinnerWins}/${gamesWithWinner} (${(r.tradeWinnerWins/gamesWithWinner*100).toFixed(1)}%)`);
    console.log(`    Avg winner's trade advantage: ${r.avgWinnerTradeAdvantage.toFixed(2)} EPT`);

    console.log(`\n  MONOPOLY TIMING:`);
    console.log(`    Avg first monopoly turn: ${r.avgMonopolyFormationTurn.toFixed(1)}`);
    console.log(`    First monopoly holder wins: ${r.earlyMonopolyWins}/${gamesWithWinner} (${(r.earlyMonopolyWins/gamesWithWinner*100).toFixed(1)}%)`);

    console.log(`\n  HOUSING:`);
    console.log(`    Avg houses in play at end: ${r.avgHousesAtEnd.toFixed(1)} / 32`);
    console.log(`    Games with shortage: ${r.housingShortageGames} (${(r.housingShortageGames/NUM_GAMES*100).toFixed(1)}%)`);
}

printResults('STATIC TRADING AI', staticResults);
printResults('DYNAMIC TRADING AI', dynamicResults);

// Comparison
console.log('\n' + '='.repeat(70));
console.log('COMPARISON');
console.log('='.repeat(70));

console.log(`
                              Static      Dynamic
  ----------------------------------------------------------------
  Avg turns to completion:    ${staticResults.avgTurns.toFixed(0).padStart(6)}      ${dynamicResults.avgTurns.toFixed(0).padStart(6)}
  Trades per game:            ${staticResults.avgTradesPerGame.toFixed(2).padStart(6)}      ${dynamicResults.avgTradesPerGame.toFixed(2).padStart(6)}
  Avg fairness gap (EPT):     ${staticResults.avgFairnessGap.toFixed(2).padStart(6)}      ${dynamicResults.avgFairnessGap.toFixed(2).padStart(6)}
  Best trader wins %:         ${(staticResults.tradeWinnerWins/staticResults.games.filter(g=>g.winner!==null).length*100).toFixed(0).padStart(5)}%      ${(dynamicResults.tradeWinnerWins/dynamicResults.games.filter(g=>g.winner!==null).length*100).toFixed(0).padStart(5)}%
  First monopoly wins %:      ${(staticResults.earlyMonopolyWins/staticResults.games.filter(g=>g.winner!==null).length*100).toFixed(0).padStart(5)}%      ${(dynamicResults.earlyMonopolyWins/dynamicResults.games.filter(g=>g.winner!==null).length*100).toFixed(0).padStart(5)}%
  Housing shortage %:         ${(staticResults.housingShortageGames/NUM_GAMES*100).toFixed(0).padStart(5)}%      ${(dynamicResults.housingShortageGames/NUM_GAMES*100).toFixed(0).padStart(5)}%
`);

// Key insight
console.log('KEY INSIGHTS:');
console.log('-'.repeat(50));

const staticFirstMonopolyWinRate = staticResults.earlyMonopolyWins / staticResults.games.filter(g => g.winner !== null).length;
const dynamicFirstMonopolyWinRate = dynamicResults.earlyMonopolyWins / dynamicResults.games.filter(g => g.winner !== null).length;

if (staticFirstMonopolyWinRate > 0.6 || dynamicFirstMonopolyWinRate > 0.6) {
    console.log('  ! First monopoly is highly predictive of winning');
    console.log('    This suggests trades may not be "fair" - early deals are decisive');
}

if (staticResults.avgFairnessGap > 5 || dynamicResults.avgFairnessGap > 5) {
    console.log('  ! High average fairness gap suggests one side consistently benefits');
}

if (staticResults.housingShortageGames / NUM_GAMES < 0.1) {
    console.log('  ! Low housing shortage rate - games end before housing becomes a factor');
    console.log('    This supports the "early monopoly dominates" hypothesis');
}

const staticBestTraderWinRate = staticResults.tradeWinnerWins / staticResults.games.filter(g => g.winner !== null).length;
if (staticBestTraderWinRate > 0.4) {
    console.log(`  ! Best trader wins ${(staticBestTraderWinRate*100).toFixed(0)}% of time - trade skill matters!`);
}

console.log('\n' + '='.repeat(70));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(70));
