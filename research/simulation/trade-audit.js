/**
 * Trade Audit — Post-hoc analysis of trade evaluations
 *
 * Runs N games, logs every trade with full context, then analyzes:
 * 1. Did "fair" trades produce equal outcomes?
 * 2. Did cash premiums correlate with game outcome?
 * 3. Were there systematic mis-evaluations?
 * 4. Did valuations vary by game state, or stay flat?
 *
 * Usage: node trade-audit.js [--games 500] [--players 4]
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS, SQUARE_TYPES } = require('./game-engine.js');
const { StrategicTradeAI, GROUP_QUALITY, GROUP_WIN_RATES } = require('./strategic-trade-ai.js');

let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.error('Warning: Could not load Markov/Valuator:', e.message);
}

// Parse CLI args
const args = process.argv.slice(2);
const NUM_GAMES = parseInt(args.find((_, i) => args[i - 1] === '--games') || '500');
const NUM_PLAYERS = parseInt(args.find((_, i) => args[i - 1] === '--players') || '4');

// Initialize shared engines
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

// ─── Trade Record Structure ──────────────────────────────────────────

class TradeRecord {
    constructor(trade, state, turn, gameId) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        this.gameId = gameId;
        this.turn = turn;
        this.gamePhase = turn < 20 ? 'early' : turn < 50 ? 'mid' : 'late';

        // Trade terms
        this.initiatorId = from.id;
        this.receiverId = to.id;
        this.propsGiven = Array.from(fromProperties || []);
        this.propsReceived = Array.from(toProperties || []);
        this.cashFromInitiator = fromCash || 0;

        // Property details
        this.givenGroups = this.propsGiven.map(p => BOARD[p]?.group).filter(Boolean);
        this.receivedGroups = this.propsReceived.map(p => BOARD[p]?.group).filter(Boolean);
        this.givenNames = this.propsGiven.map(p => BOARD[p]?.name || `sq${p}`);
        this.receivedNames = this.propsReceived.map(p => BOARD[p]?.name || `sq${p}`);

        // Face value of properties traded
        this.givenFaceValue = this.propsGiven.reduce((s, p) => s + (BOARD[p]?.price || 0), 0);
        this.receivedFaceValue = this.propsReceived.reduce((s, p) => s + (BOARD[p]?.price || 0), 0);

        // Net value transfer: positive = initiator paid more
        this.netCashToReceiver = this.cashFromInitiator + this.givenFaceValue - this.receivedFaceValue;

        // Player positions at trade time
        this.initiatorCash = from.money;
        this.receiverCash = to.money;
        this.initiatorProps = from.properties ? from.properties.size : 0;
        this.receiverProps = to.properties ? to.properties.size : 0;

        // Monopoly completion analysis
        this.initiatorCompletesMonopoly = this._checkMonopolyCompletion(
            from, this.propsReceived, this.propsGiven, state);
        this.receiverCompletesMonopoly = this._checkMonopolyCompletion(
            to, this.propsGiven, this.propsReceived, state);

        // Quality of completed monopolies
        this.initiatorMonopolyQuality = this._getCompletedQuality(
            from, this.propsReceived, this.propsGiven, state);
        this.receiverMonopolyQuality = this._getCompletedQuality(
            to, this.propsGiven, this.propsReceived, state);

        // Trade type classification
        if (this.initiatorCompletesMonopoly && this.receiverCompletesMonopoly) {
            this.tradeType = 'mutual_monopoly';
        } else if (this.initiatorCompletesMonopoly) {
            this.tradeType = 'initiator_monopoly';
        } else if (this.receiverCompletesMonopoly) {
            this.tradeType = 'receiver_monopoly';
        } else {
            this.tradeType = 'no_monopoly';
        }

        // Filled in after game ends
        this.winnerId = null;
        this.initiatorWon = null;
        this.receiverWon = null;
    }

    _checkMonopolyCompletion(player, gained, lost, state) {
        const myProps = player.properties ? [...player.properties] : [];
        const afterProps = [...myProps, ...gained].filter(p => !lost.includes(p));

        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const hadBefore = group.squares.every(sq => myProps.includes(sq));
            const hasAfter = group.squares.every(sq => afterProps.includes(sq));
            if (hasAfter && !hadBefore) return groupName;
        }
        return null;
    }

    _getCompletedQuality(player, gained, lost, state) {
        const group = this._checkMonopolyCompletion(player, gained, lost, state);
        if (!group) return 0;
        return GROUP_QUALITY[group] || 1.0;
    }
}

// ─── Monkey-patch GameEngine to capture trades ───────────────────────

function runAuditedGame(gameId, numPlayers) {
    const trades = [];

    const engine = new GameEngine({ maxTurns: 200, verbose: false });

    // Monkey-patch executeTrade to capture data
    const originalExecuteTrade = engine.executeTrade.bind(engine);
    engine.executeTrade = function(trade) {
        // Capture BEFORE execution (properties still belong to original owners)
        const record = new TradeRecord(trade, this.state, this.state.turn, gameId);
        trades.push(record);
        return originalExecuteTrade(trade);
    };

    // Create players
    const factories = [];
    for (let i = 0; i < numPlayers; i++) {
        factories.push((player, eng) =>
            new StrategicTradeAI(player, eng, markovEngine, valuator));
    }

    engine.newGame(numPlayers, factories);
    const result = engine.runGame();

    // Tag trades with outcome
    for (const trade of trades) {
        trade.winnerId = result.winner;
        trade.initiatorWon = result.winner === trade.initiatorId;
        trade.receiverWon = result.winner === trade.receiverId;
    }

    return { result, trades };
}

// ─── Run Games ───────────────────────────────────────────────────────

console.log('=' .repeat(70));
console.log(`TRADE AUDIT: ${NUM_GAMES} games, ${NUM_PLAYERS} players (StrategicTradeAI)`);
console.log('='.repeat(70));

const allTrades = [];
let wins = new Array(NUM_PLAYERS).fill(0);
let timeouts = 0;

for (let g = 0; g < NUM_GAMES; g++) {
    const { result, trades } = runAuditedGame(g, NUM_PLAYERS);
    allTrades.push(...trades);

    if (result.winner !== null) {
        wins[result.winner]++;
    } else {
        timeouts++;
    }

    if ((g + 1) % 100 === 0) {
        process.stdout.write(`  ${g + 1}/${NUM_GAMES} games, ${allTrades.length} trades...\r`);
    }
}

console.log(`\nCompleted: ${NUM_GAMES} games, ${allTrades.length} total trades`);
console.log(`Timeouts: ${timeouts} (${(timeouts / NUM_GAMES * 100).toFixed(1)}%)`);
console.log(`Avg trades/game: ${(allTrades.length / NUM_GAMES).toFixed(1)}`);

// ─── Analysis ────────────────────────────────────────────────────────

// 1. Trade type distribution
console.log('\n' + '─'.repeat(70));
console.log('1. TRADE TYPE DISTRIBUTION');
console.log('─'.repeat(70));

const byType = {};
for (const t of allTrades) {
    byType[t.tradeType] = (byType[t.tradeType] || 0) + 1;
}
for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count} (${(count / allTrades.length * 100).toFixed(1)}%)`);
}

// 2. Who wins after trading?
console.log('\n' + '─'.repeat(70));
console.log('2. TRADE OUTCOME: WHO WINS?');
console.log('─'.repeat(70));

const outcomeByType = {};
for (const t of allTrades) {
    if (t.winnerId === null) continue; // timeout
    if (!outcomeByType[t.tradeType]) {
        outcomeByType[t.tradeType] = { initiatorWins: 0, receiverWins: 0, neitherWins: 0, total: 0 };
    }
    const o = outcomeByType[t.tradeType];
    o.total++;
    if (t.initiatorWon) o.initiatorWins++;
    else if (t.receiverWon) o.receiverWins++;
    else o.neitherWins++;
}

for (const [type, o] of Object.entries(outcomeByType)) {
    const iPct = (o.initiatorWins / o.total * 100).toFixed(1);
    const rPct = (o.receiverWins / o.total * 100).toFixed(1);
    const nPct = (o.neitherWins / o.total * 100).toFixed(1);
    console.log(`  ${type} (n=${o.total}):`);
    console.log(`    Initiator wins: ${iPct}%  |  Receiver wins: ${rPct}%  |  Neither: ${nPct}%`);
}

// 3. Cash premium analysis
console.log('\n' + '─'.repeat(70));
console.log('3. CASH PREMIUM ANALYSIS');
console.log('─'.repeat(70));

const mutualTrades = allTrades.filter(t => t.tradeType === 'mutual_monopoly');
const initiatorOnly = allTrades.filter(t => t.tradeType === 'initiator_monopoly');
const receiverOnly = allTrades.filter(t => t.tradeType === 'receiver_monopoly');

function analyzeCash(trades, label) {
    if (trades.length === 0) return;
    const cashValues = trades.map(t => t.cashFromInitiator);
    const netValues = trades.map(t => t.netCashToReceiver);
    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const std = arr => {
        const m = avg(arr);
        return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    console.log(`  ${label} (n=${trades.length}):`);
    console.log(`    Cash from initiator: avg=$${avg(cashValues).toFixed(0)} (std=$${std(cashValues).toFixed(0)})`);
    console.log(`    Net value to receiver: avg=$${avg(netValues).toFixed(0)} (std=$${std(netValues).toFixed(0)})`);

    // Compare winners vs losers
    const winnerInitiated = trades.filter(t => t.initiatorWon);
    const winnerReceived = trades.filter(t => t.receiverWon);
    if (winnerInitiated.length > 0) {
        console.log(`    When initiator wins (n=${winnerInitiated.length}): avg cash=$${avg(winnerInitiated.map(t => t.cashFromInitiator)).toFixed(0)}`);
    }
    if (winnerReceived.length > 0) {
        console.log(`    When receiver wins (n=${winnerReceived.length}): avg cash=$${avg(winnerReceived.map(t => t.cashFromInitiator)).toFixed(0)}`);
    }
}

analyzeCash(mutualTrades, 'Mutual monopoly trades');
analyzeCash(initiatorOnly, 'Initiator-only monopoly');
analyzeCash(receiverOnly, 'Receiver-only monopoly');

// 4. Quality differential analysis
console.log('\n' + '─'.repeat(70));
console.log('4. MONOPOLY QUALITY vs OUTCOME');
console.log('─'.repeat(70));

if (mutualTrades.length > 0) {
    console.log('  Mutual monopoly trades — quality comparison:');

    // Bin by quality differential
    const qualityBins = { betterDeal: [], evenDeal: [], worseDeal: [] };
    for (const t of mutualTrades) {
        const diff = t.initiatorMonopolyQuality - t.receiverMonopolyQuality;
        if (diff > 0.1) qualityBins.betterDeal.push(t);
        else if (diff < -0.1) qualityBins.worseDeal.push(t);
        else qualityBins.evenDeal.push(t);
    }

    for (const [bin, trades] of Object.entries(qualityBins)) {
        if (trades.length === 0) continue;
        const iWinRate = trades.filter(t => t.initiatorWon).length / trades.length;
        const rWinRate = trades.filter(t => t.receiverWon).length / trades.length;
        const avgQDiff = trades.reduce((s, t) => s + t.initiatorMonopolyQuality - t.receiverMonopolyQuality, 0) / trades.length;
        console.log(`    ${bin} (n=${trades.length}, avgQualityDiff=${avgQDiff.toFixed(2)}):`);
        console.log(`      Initiator win: ${(iWinRate * 100).toFixed(1)}%  |  Receiver win: ${(rWinRate * 100).toFixed(1)}%`);
    }
}

// 5. Game phase analysis — do cash offers vary?
console.log('\n' + '─'.repeat(70));
console.log('5. GAME PHASE: DO VALUATIONS VARY?');
console.log('─'.repeat(70));

const byPhase = {};
for (const t of allTrades) {
    if (!byPhase[t.gamePhase]) byPhase[t.gamePhase] = [];
    byPhase[t.gamePhase].push(t);
}

for (const [phase, trades] of Object.entries(byPhase)) {
    const avgCash = trades.reduce((s, t) => s + Math.abs(t.cashFromInitiator), 0) / trades.length;
    const avgNet = trades.reduce((s, t) => s + t.netCashToReceiver, 0) / trades.length;
    const monopolyRate = trades.filter(t => t.tradeType === 'mutual_monopoly').length / trades.length;
    const iWinRate = trades.filter(t => t.initiatorWon).length /
                     trades.filter(t => t.winnerId !== null).length;

    console.log(`  ${phase} (n=${trades.length}, turns ${phase === 'early' ? '1-20' : phase === 'mid' ? '21-50' : '51+'}):`);
    console.log(`    Avg |cash|: $${avgCash.toFixed(0)}  |  Avg net to receiver: $${avgNet.toFixed(0)}`);
    console.log(`    Mutual monopoly rate: ${(monopolyRate * 100).toFixed(1)}%`);
    console.log(`    Initiator win rate: ${(iWinRate * 100).toFixed(1)}%`);
}

// 6. Specific monopoly group analysis
console.log('\n' + '─'.repeat(70));
console.log('6. MONOPOLY GROUP: COMPLETED → WIN RATE');
console.log('─'.repeat(70));

const groupOutcomes = {};
for (const t of allTrades) {
    if (t.winnerId === null) continue;

    for (const [role, group, won] of [
        ['initiator', t.initiatorCompletesMonopoly, t.initiatorWon],
        ['receiver', t.receiverCompletesMonopoly, t.receiverWon]
    ]) {
        if (!group) continue;
        if (!groupOutcomes[group]) groupOutcomes[group] = { wins: 0, total: 0 };
        groupOutcomes[group].total++;
        if (won) groupOutcomes[group].wins++;
    }
}

const sortedGroups = Object.entries(groupOutcomes)
    .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total));

console.log('  Group'.padEnd(14) + 'Trades'.padStart(8) + 'Wins'.padStart(8) +
            'Win%'.padStart(8) + 'Expected'.padStart(10) + 'Delta'.padStart(8));
console.log('  ' + '─'.repeat(54));

for (const [group, data] of sortedGroups) {
    const winPct = (data.wins / data.total * 100).toFixed(1);
    const expected = ((GROUP_WIN_RATES[group] || 0.4) * 100).toFixed(1);
    const delta = (parseFloat(winPct) - parseFloat(expected)).toFixed(1);
    const marker = Math.abs(parseFloat(delta)) > 5 ? ' ←' : '';
    console.log(`  ${group.padEnd(12)} ${String(data.total).padStart(8)} ${String(data.wins).padStart(8)} ` +
                `${winPct.padStart(7)}% ${expected.padStart(9)}% ${delta.padStart(7)}%${marker}`);
}

// 7. Valuation flatness test
console.log('\n' + '─'.repeat(70));
console.log('7. VALUATION FLATNESS: DO CASH OFFERS VARY BY CONTEXT?');
console.log('─'.repeat(70));

// Compare cash when initiator is leader vs underdog
const leaderInitiates = allTrades.filter(t =>
    t.initiatorCash > t.receiverCash * 1.5);
const underdogInitiates = allTrades.filter(t =>
    t.initiatorCash < t.receiverCash * 0.67);

if (leaderInitiates.length > 0 && underdogInitiates.length > 0) {
    const leaderAvgCash = leaderInitiates.reduce((s, t) => s + t.cashFromInitiator, 0) / leaderInitiates.length;
    const underdogAvgCash = underdogInitiates.reduce((s, t) => s + t.cashFromInitiator, 0) / underdogInitiates.length;
    console.log(`  When richer player initiates (n=${leaderInitiates.length}): avg cash offer $${leaderAvgCash.toFixed(0)}`);
    console.log(`  When poorer player initiates (n=${underdogInitiates.length}): avg cash offer $${underdogAvgCash.toFixed(0)}`);
    console.log(`  Difference: $${Math.abs(leaderAvgCash - underdogAvgCash).toFixed(0)} — ${
        Math.abs(leaderAvgCash - underdogAvgCash) < 50 ? 'FLAT (< $50 diff)' : 'VARIES'}`);
} else {
    console.log('  Insufficient data for leader/underdog comparison');
}

// Compare cash by property face value ratio
const expensiveProps = allTrades.filter(t => t.givenFaceValue > 400);
const cheapProps = allTrades.filter(t => t.givenFaceValue > 0 && t.givenFaceValue <= 200);

if (expensiveProps.length > 0 && cheapProps.length > 0) {
    const expAvg = expensiveProps.reduce((s, t) => s + t.cashFromInitiator, 0) / expensiveProps.length;
    const cheapAvg = cheapProps.reduce((s, t) => s + t.cashFromInitiator, 0) / cheapProps.length;
    console.log(`  Expensive props given (>$400, n=${expensiveProps.length}): avg cash $${expAvg.toFixed(0)}`);
    console.log(`  Cheap props given (≤$200, n=${cheapProps.length}): avg cash $${cheapAvg.toFixed(0)}`);
}

// 8. Rejected trade analysis (if we can infer)
console.log('\n' + '─'.repeat(70));
console.log('8. TRADE FREQUENCY vs GAME OUTCOME');
console.log('─'.repeat(70));

// Group trades by game, check if more trades = more decisive outcomes
const gameTradeCount = {};
const gameOutcome = {};
for (const t of allTrades) {
    gameTradeCount[t.gameId] = (gameTradeCount[t.gameId] || 0) + 1;
    if (t.winnerId !== null) gameOutcome[t.gameId] = t.winnerId;
}

const tradeCounts = Object.values(gameTradeCount);
const zeroTradeGames = NUM_GAMES - Object.keys(gameTradeCount).length;
const avgTradesInGamesWithTrades = tradeCounts.length > 0 ?
    tradeCounts.reduce((s, v) => s + v, 0) / tradeCounts.length : 0;

console.log(`  Games with 0 trades: ${zeroTradeGames} (${(zeroTradeGames / NUM_GAMES * 100).toFixed(1)}%)`);
console.log(`  Games with trades: ${tradeCounts.length} (avg ${avgTradesInGamesWithTrades.toFixed(1)} trades/game)`);

// Distribution
const dist = {};
for (const c of tradeCounts) {
    const bucket = c <= 3 ? c : c <= 6 ? '4-6' : '7+';
    dist[bucket] = (dist[bucket] || 0) + 1;
}
console.log('  Distribution:');
for (const [bucket, count] of Object.entries(dist).sort()) {
    console.log(`    ${bucket} trades: ${count} games`);
}

// 9. Summary verdict
console.log('\n' + '='.repeat(70));
console.log('VERDICT');
console.log('='.repeat(70));

// Check if initiator advantage exists
const allWithWinner = allTrades.filter(t => t.winnerId !== null);
const initiatorWinRate = allWithWinner.filter(t => t.initiatorWon).length / allWithWinner.length;
console.log(`\nOverall initiator win rate: ${(initiatorWinRate * 100).toFixed(1)}% (expected: ${(100/NUM_PLAYERS).toFixed(1)}%)`);

if (initiatorWinRate > 1/NUM_PLAYERS + 0.05) {
    console.log('→ INITIATOR ADVANTAGE detected: proposing trades correlates with winning.');
    console.log('  This suggests the initiator captures more value than the evaluation shows.');
} else if (initiatorWinRate < 1/NUM_PLAYERS - 0.05) {
    console.log('→ RECEIVER ADVANTAGE detected: accepting trades correlates with winning.');
    console.log('  This suggests receivers are undercharging for what they give up.');
} else {
    console.log('→ NO SIGNIFICANT ADVANTAGE: trades appear evenly valued.');
}

// Check quality-outcome correlation
if (mutualTrades.length > 20) {
    const higherQualityWins = mutualTrades.filter(t => {
        const iQ = t.initiatorMonopolyQuality;
        const rQ = t.receiverMonopolyQuality;
        return (iQ > rQ && t.initiatorWon) || (rQ > iQ && t.receiverWon);
    }).length;
    const qualityPredicts = higherQualityWins / mutualTrades.filter(t =>
        t.initiatorMonopolyQuality !== t.receiverMonopolyQuality && t.winnerId !== null
    ).length;
    console.log(`\nQuality predicts winner: ${(qualityPredicts * 100).toFixed(1)}% of mutual trades`);
    if (qualityPredicts > 0.55) {
        console.log('→ QUALITY MIS-PRICING: higher-quality monopoly wins more often than the trade compensates for.');
    } else {
        console.log('→ Quality does not strongly predict outcome — trades may be fairly priced on this axis.');
    }
}

// Check phase variation
const phases = Object.keys(byPhase);
if (phases.length >= 2) {
    const cashByPhase = phases.map(p => ({
        phase: p,
        avg: byPhase[p].reduce((s, t) => s + Math.abs(t.cashFromInitiator), 0) / byPhase[p].length
    }));
    const maxDiff = Math.max(...cashByPhase.map(p => p.avg)) - Math.min(...cashByPhase.map(p => p.avg));
    console.log(`\nCash variation across phases: $${maxDiff.toFixed(0)} max difference`);
    if (maxDiff < 30) {
        console.log('→ FLAT VALUATIONS: cash offers barely change by game phase.');
    } else {
        console.log('→ PHASE-SENSITIVE: valuations do shift across early/mid/late game.');
    }
}

console.log('\n' + '='.repeat(70));
