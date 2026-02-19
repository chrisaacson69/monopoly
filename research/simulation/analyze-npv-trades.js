/**
 * Analyze NPV Trading Patterns
 *
 * Compare trade details between NPV and Standard trading
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');
const { NPVTradingAI } = require('./npv-trading-ai.js');

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
const probs = markovEngine.getAllProbabilities('stay');

// Track trades across games
class TradeTrackingEngine extends GameEngine {
    constructor(options) {
        super(options);
        this.trades = [];
    }

    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        // Check monopoly completion
        let fromMonopoly = null;
        let toMonopoly = null;

        for (const prop of toProperties) {
            const sq = BOARD[prop];
            if (!sq.group) continue;
            const groupSquares = COLOR_GROUPS[sq.group].squares;
            const wouldOwn = groupSquares.filter(s =>
                from.properties.has(s) || toProperties.has(s)
            ).length;
            if (wouldOwn === groupSquares.length) {
                fromMonopoly = sq.group;
                break;
            }
        }

        for (const prop of fromProperties) {
            const sq = BOARD[prop];
            if (!sq.group) continue;
            const groupSquares = COLOR_GROUPS[sq.group].squares;
            const wouldOwn = groupSquares.filter(s =>
                to.properties.has(s) || fromProperties.has(s)
            ).length;
            if (wouldOwn === groupSquares.length) {
                toMonopoly = sq.group;
                break;
            }
        }

        // Calculate monopoly EPT values
        let fromMonopolyEPT = 0;
        let toMonopolyEPT = 0;
        const opponents = this.state.players.filter(p => !p.bankrupt).length - 1;

        if (fromMonopoly) {
            for (const sq of COLOR_GROUPS[fromMonopoly].squares) {
                fromMonopolyEPT += (probs[sq] || 0.025) * BOARD[sq].rent[3] * opponents;
            }
        }

        if (toMonopoly) {
            for (const sq of COLOR_GROUPS[toMonopoly].squares) {
                toMonopolyEPT += (probs[sq] || 0.025) * BOARD[sq].rent[3] * opponents;
            }
        }

        // Calculate payback period for buyer
        let paybackPeriod = null;
        if (fromMonopoly && fromCash > 0 && fromMonopolyEPT > 0) {
            paybackPeriod = fromCash / fromMonopolyEPT;
        }

        this.trades.push({
            turn: this.state.turn,
            cash: fromCash,
            fromMonopoly,
            toMonopoly,
            fromMonopolyEPT,
            toMonopolyEPT,
            paybackPeriod,
            fromAI: from.ai?.name || 'unknown',
            toAI: to.ai?.name || 'unknown'
        });

        return super.executeTrade(trade);
    }
}

// Run analysis
function runAnalysis(aiType1, aiType2, label, numGames = 100) {
    console.log(`\n${label}`);
    console.log('-'.repeat(60));

    const allTrades = [];
    let totalTurns = 0;
    let gamesWithWinner = 0;

    for (let i = 0; i < numGames; i++) {
        const engine = new TradeTrackingEngine({ maxTurns: 300, verbose: false });

        const factories = [
            (p, e) => aiType1 === 'npv'
                ? new NPVTradingAI(p, e, markovEngine, valuator)
                : new TradingAI(p, e, markovEngine, valuator),
            (p, e) => aiType2 === 'npv'
                ? new NPVTradingAI(p, e, markovEngine, valuator)
                : new TradingAI(p, e, markovEngine, valuator),
            (p, e) => aiType1 === 'npv'
                ? new NPVTradingAI(p, e, markovEngine, valuator)
                : new TradingAI(p, e, markovEngine, valuator),
            (p, e) => aiType2 === 'npv'
                ? new NPVTradingAI(p, e, markovEngine, valuator)
                : new TradingAI(p, e, markovEngine, valuator)
        ];

        engine.newGame(4, factories);
        const result = engine.runGame();

        totalTurns += result.turns;
        if (result.winner !== null) gamesWithWinner++;
        allTrades.push(...engine.trades);
    }

    // Analyze trades
    const monopolyTrades = allTrades.filter(t => t.fromMonopoly || t.toMonopoly);
    const cashForMonopolyTrades = allTrades.filter(t => t.fromMonopoly && !t.toMonopoly && t.cash > 0);
    const mutualMonopolyTrades = allTrades.filter(t => t.fromMonopoly && t.toMonopoly);

    console.log(`Games: ${numGames}, Avg turns: ${(totalTurns/numGames).toFixed(0)}, Winners: ${gamesWithWinner}`);
    console.log(`Total trades: ${allTrades.length} (${(allTrades.length/numGames).toFixed(1)} per game)`);
    console.log(`Monopoly-completing trades: ${monopolyTrades.length}`);
    console.log(`  Cash-for-monopoly: ${cashForMonopolyTrades.length}`);
    console.log(`  Mutual monopoly: ${mutualMonopolyTrades.length}`);

    // Cash-for-monopoly analysis
    if (cashForMonopolyTrades.length > 0) {
        const avgCash = cashForMonopolyTrades.reduce((s, t) => s + t.cash, 0) / cashForMonopolyTrades.length;
        const avgEPT = cashForMonopolyTrades.reduce((s, t) => s + t.fromMonopolyEPT, 0) / cashForMonopolyTrades.length;
        const avgPayback = cashForMonopolyTrades.filter(t => t.paybackPeriod).reduce((s, t) => s + t.paybackPeriod, 0) /
                          cashForMonopolyTrades.filter(t => t.paybackPeriod).length;

        console.log(`\nCash-for-Monopoly Trade Analysis:`);
        console.log(`  Avg cash paid: $${avgCash.toFixed(0)}`);
        console.log(`  Avg monopoly EPT: $${avgEPT.toFixed(1)}`);
        console.log(`  Avg payback period: ${avgPayback.toFixed(1)} turns`);

        // Distribution of payback periods
        const paybackBuckets = { under5: 0, '5to10': 0, '10to20': 0, '20to40': 0, over40: 0 };
        for (const t of cashForMonopolyTrades) {
            if (!t.paybackPeriod) continue;
            if (t.paybackPeriod < 5) paybackBuckets.under5++;
            else if (t.paybackPeriod < 10) paybackBuckets['5to10']++;
            else if (t.paybackPeriod < 20) paybackBuckets['10to20']++;
            else if (t.paybackPeriod < 40) paybackBuckets['20to40']++;
            else paybackBuckets.over40++;
        }

        const total = cashForMonopolyTrades.filter(t => t.paybackPeriod).length;
        console.log(`\n  Payback distribution:`);
        console.log(`    <5 turns (GREAT deal): ${paybackBuckets.under5} (${(paybackBuckets.under5/total*100).toFixed(0)}%)`);
        console.log(`    5-10 turns (Good):     ${paybackBuckets['5to10']} (${(paybackBuckets['5to10']/total*100).toFixed(0)}%)`);
        console.log(`    10-20 turns (Fair):    ${paybackBuckets['10to20']} (${(paybackBuckets['10to20']/total*100).toFixed(0)}%)`);
        console.log(`    20-40 turns (Slow):    ${paybackBuckets['20to40']} (${(paybackBuckets['20to40']/total*100).toFixed(0)}%)`);
        console.log(`    >40 turns (Bad):       ${paybackBuckets.over40} (${(paybackBuckets.over40/total*100).toFixed(0)}%)`);
    }

    return { allTrades, cashForMonopolyTrades, mutualMonopolyTrades };
}

console.log('='.repeat(60));
console.log('NPV vs STANDARD TRADING - TRADE PATTERN ANALYSIS');
console.log('='.repeat(60));

const standardResults = runAnalysis('trading', 'trading', 'ALL STANDARD TRADING AI');
const npvResults = runAnalysis('npv', 'npv', 'ALL NPV TRADING AI');
const mixedResults = runAnalysis('npv', 'trading', 'NPV vs STANDARD (mixed)');

console.log('\n' + '='.repeat(60));
console.log('COMPARISON SUMMARY');
console.log('='.repeat(60));

console.log(`
                           Standard    NPV         Mixed
Trades per game:           ${(standardResults.allTrades.length/100).toFixed(1)}         ${(npvResults.allTrades.length/100).toFixed(1)}         ${(mixedResults.allTrades.length/100).toFixed(1)}
Cash-for-monopoly trades:  ${standardResults.cashForMonopolyTrades.length}          ${npvResults.cashForMonopolyTrades.length}          ${mixedResults.cashForMonopolyTrades.length}
Mutual monopoly trades:    ${standardResults.mutualMonopolyTrades.length}          ${npvResults.mutualMonopolyTrades.length}          ${mixedResults.mutualMonopolyTrades.length}

Key Insight:
NPV AI should make FEWER trades but at FAIRER prices.
Standard AI makes MORE trades but often at prices that favor one side.
`);
