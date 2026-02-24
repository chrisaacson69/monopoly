/**
 * Valuation Accuracy Analysis
 *
 * Measures how well the AI's valuation model predicts actual game outcomes:
 *
 * 1. Position prediction: Does the AI's position ranking at turn T
 *    predict who wins? (leader-at-turn-T win rate)
 *
 * 2. Relative EPT accuracy: Does having positive relativeEPT correlate
 *    with winning? How does predicted EPT compare to realized rent/turn?
 *
 * 3. Auction valuation: What's the spread between what players are
 *    willing to pay (getMaxBid) and what they actually pay?
 *    Do winners value properties more than losers?
 *
 * Runs in auction-only mode (maximum auction data) with all StrategicTradeAI.
 */

'use strict';

const { BOARD, COLOR_GROUPS, SQUARE_TYPES } = require('./game-engine.js');
const { AuctionGameEngine } = require('./auction-game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');
const { getCachedEngines } = require('./cached-engines.js');

const { markovEngine, valuator } = getCachedEngines();

// =============================================================================
// INSTRUMENTED GAME ENGINE
// =============================================================================

class InstrumentedAuctionEngine extends AuctionGameEngine {
    constructor(options = {}) {
        super(options);
        this.snapshots = [];        // Periodic position snapshots
        this.auctionBids = [];      // All players' max bids per auction
        this.snapshotInterval = options.snapshotInterval || 10;
    }

    /**
     * Override runGame to add periodic snapshots
     */
    runGame() {
        while (!this.state.isGameOver() && this.state.turn < this.options.maxTurns) {
            const turnBefore = this.state.turn;
            this.executeTurn();

            // Snapshot after each interval
            if (this.state.turn > 0 &&
                this.state.turn % this.snapshotInterval === 0 &&
                this.state.turn !== turnBefore) {
                this.takeSnapshot();
            }
        }

        // Final snapshot
        this.takeSnapshot();

        const winner = this.state.getWinner();
        const result = {
            winner: winner ? winner.id : null,
            turns: this.state.turn,
            stats: this.state.stats,
            finalState: this.state,
            auctionAnalytics: this.auctionAnalytics,
            debtTracking: this.debtTracking,
            // New analytics
            snapshots: this.snapshots,
            auctionBids: this.auctionBids
        };

        return result;
    }

    /**
     * Take a position snapshot for all active players
     * Uses the first active player's AI to compute positions
     */
    takeSnapshot() {
        const activePlayers = this.state.getActivePlayers();
        if (activePlayers.length < 2) return;

        // Use any active player's AI for calculations (they all have same methods)
        const ai = activePlayers[0].ai;
        if (!ai || !ai.calculateAllPositions) return;

        const positions = ai.calculateAllPositions(this.state);
        const eptMap = ai.calculateRelativeEPTs(this.state);

        const snapshot = {
            turn: this.state.turn,
            players: []
        };

        for (const player of this.state.players) {
            if (player.bankrupt) {
                snapshot.players.push({
                    id: player.id,
                    bankrupt: true
                });
                continue;
            }

            const posData = positions.find(p => p.id === player.id);
            const eptData = eptMap.get(player.id);

            snapshot.players.push({
                id: player.id,
                bankrupt: false,
                cash: player.money,
                netWorth: posData?.netWorth || player.money,
                position: posData?.position || player.money,
                rank: posData?.rank ?? 99,
                propertyEPT: eptData?.propertyEPT || 0,
                relativeEPT: eptData?.relativeEPT || 0,
                properties: player.properties.size,
                monopolies: this.getPlayerMonopolies(player.id)
            });
        }

        this.snapshots.push(snapshot);
    }

    /**
     * Override tracked auction to also record all players' valuations
     */
    runTrackedAuction(position) {
        // Run the auction normally
        super.runTrackedAuction(position);

        // Now record what each player's model valued this property at
        const activePlayers = this.state.getActivePlayers();
        const bidRecord = {
            position,
            propertyName: BOARD[position].name,
            group: BOARD[position].group,
            faceValue: BOARD[position].price,
            turn: this.state.turn,
            playerBids: []
        };

        // Get actual auction result (last recorded auction)
        const lastAuction = this.auctionAnalytics.auctions[
            this.auctionAnalytics.auctions.length - 1
        ];
        bidRecord.winningPrice = lastAuction?.purchasePrice || 0;
        bidRecord.winnerId = lastAuction?.buyerId;

        for (const player of activePlayers) {
            if (player.ai && player.ai.getMaxBid) {
                // Clear cache to force fresh computation if state changed
                // (property may now be owned after auction)
                // Actually, we want the valuation BEFORE the auction resolved.
                // The cache from the auction is exactly what we want.
                // But the cache was cleared when the property changed owner.
                // We need to capture this DURING the auction, not after.
                // Workaround: record the maxBid from before state changed.
                // Since the auction already ran, we'll estimate from the
                // bid behavior instead.

                // For the winner: their getMaxBid was >= their winning bid
                // For losers: their getMaxBid was < winning bid (they dropped out)
                // The actual getMaxBid values would be most useful.

                // For now, record what we can from the bid history
                const playerBids = (lastAuction?.allBids || [])
                    .filter(b => b.playerId === player.id);
                const maxActualBid = playerBids.length > 0
                    ? Math.max(...playerBids.map(b => b.bid))
                    : 0;

                bidRecord.playerBids.push({
                    playerId: player.id,
                    maxActualBid,
                    participated: playerBids.length > 0
                });
            }
        }

        this.auctionBids.push(bidRecord);
    }
}

/**
 * Pre-auction valuation capture.
 * To get actual getMaxBid values, we hook into decideBid.
 */
class InstrumentedStrategicAI extends StrategicTradeAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this._lastMaxBid = null;
        this._bidLog = [];  // { position, turn, maxBid }
        this._bidSeen = new Set();  // Deduplicate: "position:turn"
    }

    decideBid(position, currentBid, state) {
        // Capture the getMaxBid value (will use cache if available)
        const maxBid = this.getMaxBid(position, state);
        this._lastMaxBid = maxBid;

        // Only log once per auction (position + turn is unique per auction)
        const key = position + ':' + state.turn;
        if (!this._bidSeen.has(key)) {
            this._bidSeen.add(key);
            this._bidLog.push({
                position,
                turn: state.turn,
                maxBid,
                cash: this.player.money
            });
        }

        return super.decideBid(position, currentBid, state);
    }
}

// =============================================================================
// ANALYTICS RUNNER
// =============================================================================

function runValuationAnalysis(numGames, nPlayers = 4) {
    console.log('='.repeat(80));
    console.log('VALUATION ACCURACY ANALYSIS');
    console.log(numGames + ' games, ' + nPlayers + ' StrategicTradeAI, auction-only');
    console.log('='.repeat(80));
    console.log();

    const startTime = Date.now();

    // Aggregated data
    const leaderWins = {};      // turn -> { correct, total }
    const eptCorrelation = [];  // { relEPT, won } at each snapshot
    const auctionValuations = []; // per-auction valuation data
    const realizedVsPredicted = []; // EPT accuracy per game
    const positionDeltas = {};  // turn -> [winner_pos - avg_loser_pos]

    for (let g = 0; g < numGames; g++) {
        const engine = new InstrumentedAuctionEngine({
            maxTurns: 500,
            snapshotInterval: 10
        });

        const factories = [];
        for (let i = 0; i < nPlayers; i++) {
            factories.push((player, eng) => {
                return new InstrumentedStrategicAI(player, eng, markovEngine, valuator);
            });
        }

        engine.newGame(nPlayers, factories);
        const result = engine.runGame();

        if (result.winner === null) continue;  // Skip timeouts

        const winner = result.winner;

        // --- 1. Position prediction accuracy ---
        for (const snap of result.snapshots) {
            const turn = snap.turn;
            const activePlayers = snap.players.filter(p => !p.bankrupt);
            if (activePlayers.length < 2) continue;

            // Who does the model say is leading?
            const leader = activePlayers.reduce((best, p) =>
                p.position > best.position ? p : best
            );

            if (!leaderWins[turn]) leaderWins[turn] = { correct: 0, total: 0 };
            leaderWins[turn].total++;
            if (leader.id === winner) leaderWins[turn].correct++;

            // Position delta: winner's position minus avg loser position
            const winnerData = activePlayers.find(p => p.id === winner);
            const losers = activePlayers.filter(p => p.id !== winner);
            if (winnerData && losers.length > 0) {
                const avgLoserPos = losers.reduce((s, p) => s + p.position, 0) / losers.length;
                if (!positionDeltas[turn]) positionDeltas[turn] = [];
                positionDeltas[turn].push(winnerData.position - avgLoserPos);
            }

            // EPT correlation: for each player at this snapshot
            for (const p of activePlayers) {
                eptCorrelation.push({
                    turn,
                    relativeEPT: p.relativeEPT,
                    propertyEPT: p.propertyEPT,
                    won: p.id === winner
                });
            }
        }

        // --- 2. Auction valuation data ---
        // Collect from instrumented AIs
        const players = engine.state.players;
        for (const player of players) {
            if (!player.ai || !player.ai._bidLog) continue;
            for (const bid of player.ai._bidLog) {
                auctionValuations.push({
                    ...bid,
                    playerId: player.id,
                    isWinner: player.id === winner,
                    faceValue: BOARD[bid.position].price,
                    group: BOARD[bid.position].group
                        || (BOARD[bid.position].type === SQUARE_TYPES.RAILROAD ? 'railroad' : null)
                        || (BOARD[bid.position].type === SQUARE_TYPES.UTILITY ? 'utility' : null)
                });
            }
        }

        // --- 3. Realized EPT accuracy ---
        // Compare predicted propertyEPT at each snapshot vs actual rent/turn
        // collected from that point forward. This measures: "given the board
        // state at turn T, how well does Markov EPT predict future rent?"
        const totalTurns = result.turns;
        if (totalTurns > 20) {
            for (const player of players) {
                const collected = result.stats.rentCollected[player.id] || 0;
                const paid = result.stats.rentPaid[player.id] || 0;

                // Use mid-game snapshot for prediction (turn 30 or closest)
                let midSnap = null;
                let bestDist = Infinity;
                for (const snap of result.snapshots) {
                    const pData = snap.players.find(p =>
                        p.id === player.id && !p.bankrupt
                    );
                    if (pData && Math.abs(snap.turn - 30) < bestDist) {
                        bestDist = Math.abs(snap.turn - 30);
                        midSnap = { turn: snap.turn, ...pData };
                    }
                }

                // Full game averages
                const realizedCollectedPerTurn = collected / totalTurns;
                const realizedPaidPerTurn = paid / totalTurns;
                const realizedNetEPT = realizedCollectedPerTurn - realizedPaidPerTurn;

                realizedVsPredicted.push({
                    playerId: player.id,
                    realizedCollectedPerTurn,
                    realizedPaidPerTurn,
                    realizedNetEPT,
                    predictedPropertyEPT: midSnap?.propertyEPT || 0,
                    predictedRelativeEPT: midSnap?.relativeEPT || 0,
                    snapshotTurn: midSnap?.turn || 0,
                    totalRentCollected: collected,
                    totalRentPaid: paid,
                    turns: totalTurns,
                    won: player.id === winner
                });
            }
        }

        if ((g + 1) % 100 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log('  Game ' + (g + 1) + '/' + numGames +
                        '  ' + elapsed.toFixed(0) + 's');
        }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\nCompleted in ' + totalTime.toFixed(1) + 's\n');

    // ==========================================================================
    // REPORT
    // ==========================================================================

    // --- 1. Leader Prediction Accuracy ---
    console.log('='.repeat(80));
    console.log('1. POSITION LEADER PREDICTION ACCURACY');
    console.log('   "Does the player ranked #1 at turn T end up winning?"');
    console.log('='.repeat(80));
    console.log();
    console.log('Turn     Leader Wins    Total    Accuracy    Random Baseline');
    console.log('-'.repeat(65));

    const sortedTurns = Object.keys(leaderWins).map(Number).sort((a, b) => a - b);
    for (const turn of sortedTurns) {
        const data = leaderWins[turn];
        if (data.total < 10) continue;
        const accuracy = (data.correct / data.total * 100).toFixed(1);
        const baseline = (100 / nPlayers).toFixed(1);
        const bar = '#'.repeat(Math.round(data.correct / data.total * 40));
        console.log(
            String(turn).padStart(4) +
            String(data.correct).padStart(12) +
            String(data.total).padStart(9) +
            (accuracy + '%').padStart(11) +
            (baseline + '%').padStart(16) +
            '  ' + bar
        );
    }

    // --- Position delta (winner vs losers) ---
    console.log();
    console.log('='.repeat(80));
    console.log('2. WINNER POSITION ADVANTAGE OVER TIME');
    console.log('   "How far ahead is the eventual winner in position units?"');
    console.log('='.repeat(80));
    console.log();
    console.log('Turn     AvgDelta    Median     StdDev     N');
    console.log('-'.repeat(55));

    for (const turn of sortedTurns) {
        const deltas = positionDeltas[turn];
        if (!deltas || deltas.length < 10) continue;

        const avg = deltas.reduce((s, v) => s + v, 0) / deltas.length;
        const sorted = [...deltas].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const variance = deltas.reduce((s, v) => s + (v - avg) ** 2, 0) / deltas.length;
        const stddev = Math.sqrt(variance);

        console.log(
            String(turn).padStart(4) +
            ('$' + avg.toFixed(0)).padStart(11) +
            ('$' + median.toFixed(0)).padStart(10) +
            ('$' + stddev.toFixed(0)).padStart(10) +
            String(deltas.length).padStart(7)
        );
    }

    // --- 3. Relative EPT Correlation ---
    console.log();
    console.log('='.repeat(80));
    console.log('3. RELATIVE EPT vs WINNING');
    console.log('   "Does positive relativeEPT predict winning?"');
    console.log('='.repeat(80));
    console.log();

    // Bucket by turn ranges
    const eptBuckets = {
        'Turn 1-20': eptCorrelation.filter(e => e.turn <= 20),
        'Turn 21-40': eptCorrelation.filter(e => e.turn > 20 && e.turn <= 40),
        'Turn 41-60': eptCorrelation.filter(e => e.turn > 40 && e.turn <= 60),
        'Turn 61+': eptCorrelation.filter(e => e.turn > 60)
    };

    console.log('Phase         Positive EPT    Win%    Negative EPT    Win%    Zero EPT    Win%');
    console.log('-'.repeat(85));

    for (const [label, entries] of Object.entries(eptBuckets)) {
        if (entries.length === 0) continue;

        const positive = entries.filter(e => e.relativeEPT > 1);
        const negative = entries.filter(e => e.relativeEPT < -1);
        const zero = entries.filter(e => Math.abs(e.relativeEPT) <= 1);

        const posWin = positive.length > 0
            ? (positive.filter(e => e.won).length / positive.length * 100).toFixed(1)
            : 'N/A';
        const negWin = negative.length > 0
            ? (negative.filter(e => e.won).length / negative.length * 100).toFixed(1)
            : 'N/A';
        const zeroWin = zero.length > 0
            ? (zero.filter(e => e.won).length / zero.length * 100).toFixed(1)
            : 'N/A';

        console.log(
            label.padEnd(14) +
            String(positive.length).padStart(8) +
            (posWin + '%').padStart(11) +
            String(negative.length).padStart(12) +
            (negWin + '%').padStart(8) +
            String(zero.length).padStart(11) +
            (zeroWin + '%').padStart(8)
        );
    }

    // EPT magnitude vs win rate
    console.log();
    console.log('--- EPT Magnitude Buckets (all turns) ---');
    console.log('RelEPT Range       N       Win%');
    console.log('-'.repeat(40));

    const ranges = [
        { label: '< -$50', min: -Infinity, max: -50 },
        { label: '-$50 to -$20', min: -50, max: -20 },
        { label: '-$20 to -$5', min: -20, max: -5 },
        { label: '-$5 to $5', min: -5, max: 5 },
        { label: '$5 to $20', min: 5, max: 20 },
        { label: '$20 to $50', min: 20, max: 50 },
        { label: '> $50', min: 50, max: Infinity }
    ];

    for (const range of ranges) {
        const bucket = eptCorrelation.filter(e =>
            e.relativeEPT > range.min && e.relativeEPT <= range.max
        );
        if (bucket.length < 10) continue;

        const winRate = (bucket.filter(e => e.won).length / bucket.length * 100).toFixed(1);
        console.log(
            range.label.padEnd(18) +
            String(bucket.length).padStart(6) +
            (winRate + '%').padStart(10)
        );
    }

    // --- 4. Auction Valuation Analysis ---
    console.log();
    console.log('='.repeat(80));
    console.log('4. AUCTION VALUATION ANALYSIS');
    console.log('   "What do players think properties are worth vs what they pay?"');
    console.log('='.repeat(80));
    console.log();

    // Group by color
    const auctionByGroup = {};
    for (const v of auctionValuations) {
        const group = v.group || 'other';
        if (!auctionByGroup[group]) auctionByGroup[group] = [];
        auctionByGroup[group].push(v);
    }

    console.log('Group        AvgMaxBid  AvgFace  Ratio   MaxBid Range     N');
    console.log('-'.repeat(65));

    const groupOrder = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue', 'railroad', 'utility'];
    for (const group of groupOrder) {
        const entries = auctionByGroup[group];
        if (!entries || entries.length === 0) continue;

        const avgMaxBid = entries.reduce((s, e) => s + e.maxBid, 0) / entries.length;
        const avgFace = entries.reduce((s, e) => s + e.faceValue, 0) / entries.length;
        const ratio = (avgMaxBid / avgFace * 100).toFixed(0);
        const minBid = Math.min(...entries.map(e => e.maxBid));
        const maxBid = Math.max(...entries.map(e => e.maxBid));

        console.log(
            group.padEnd(12) +
            ('$' + avgMaxBid.toFixed(0)).padStart(8) +
            ('$' + avgFace.toFixed(0)).padStart(8) +
            (ratio + '%').padStart(7) +
            ('$' + minBid + '-$' + maxBid).padStart(16) +
            String(entries.length).padStart(7)
        );
    }

    // Winners vs losers auction behavior
    console.log();
    console.log('--- Winner vs Loser Auction Behavior ---');

    const winnerBids = auctionValuations.filter(v => v.isWinner);
    const loserBids = auctionValuations.filter(v => !v.isWinner);

    if (winnerBids.length > 0 && loserBids.length > 0) {
        const winAvgRatio = winnerBids.reduce((s, v) => s + v.maxBid / v.faceValue, 0)
            / winnerBids.length;
        const loseAvgRatio = loserBids.reduce((s, v) => s + v.maxBid / v.faceValue, 0)
            / loserBids.length;

        const winAvgMaxBid = winnerBids.reduce((s, v) => s + v.maxBid, 0) / winnerBids.length;
        const loseAvgMaxBid = loserBids.reduce((s, v) => s + v.maxBid, 0) / loserBids.length;

        console.log('                    AvgMaxBid   AvgRatio    N');
        console.log('-'.repeat(50));
        console.log(
            'Winners'.padEnd(20) +
            ('$' + winAvgMaxBid.toFixed(0)).padStart(8) +
            (  (winAvgRatio * 100).toFixed(0) + '%').padStart(10) +
            String(winnerBids.length).padStart(7)
        );
        console.log(
            'Losers'.padEnd(20) +
            ('$' + loseAvgMaxBid.toFixed(0)).padStart(8) +
            ((loseAvgRatio * 100).toFixed(0) + '%').padStart(10) +
            String(loserBids.length).padStart(7)
        );
    }

    // Monopoly-completing bids vs normal bids
    console.log();
    console.log('--- Strategic vs Non-Strategic Bids ---');

    const strategicBids = auctionValuations.filter(v =>
        v.maxBid > v.faceValue * 1.1  // More than 10% over face = strategic
    );
    const normalBids = auctionValuations.filter(v =>
        v.maxBid <= v.faceValue * 1.1
    );

    if (strategicBids.length > 0 && normalBids.length > 0) {
        const stratWinRate = (strategicBids.filter(v => v.isWinner).length /
            strategicBids.length * 100).toFixed(1);
        const normWinRate = (normalBids.filter(v => v.isWinner).length /
            normalBids.length * 100).toFixed(1);

        const stratAvgRatio = (strategicBids.reduce((s, v) => s + v.maxBid / v.faceValue, 0)
            / strategicBids.length * 100).toFixed(0);

        console.log('Type             N        AvgRatio    Win%');
        console.log('-'.repeat(50));
        console.log(
            'Strategic'.padEnd(16) +
            String(strategicBids.length).padStart(6) +
            (stratAvgRatio + '%').padStart(12) +
            (stratWinRate + '%').padStart(9)
        );
        console.log(
            'Non-strategic'.padEnd(16) +
            String(normalBids.length).padStart(6) +
            '105%'.padStart(12) +
            (normWinRate + '%').padStart(9)
        );
    }

    // --- 5. Realized EPT vs Predicted ---
    console.log();
    console.log('='.repeat(80));
    console.log('5. REALIZED EPT vs PREDICTED (Markov Accuracy)');
    console.log('   "Does the Markov-predicted EPT match actual rent collected?"');
    console.log('='.repeat(80));
    console.log();

    if (realizedVsPredicted.length > 0) {
        const winnerEPT = realizedVsPredicted.filter(e => e.won);
        const loserEPT = realizedVsPredicted.filter(e => !e.won);

        console.log('--- Rent Collected vs Predicted PropertyEPT (at ~turn 30) ---');
        console.log();

        const computeStats = (arr, label) => {
            if (arr.length === 0) return;

            const avgCollected = arr.reduce((s, e) => s + e.realizedCollectedPerTurn, 0) / arr.length;
            const avgPaid = arr.reduce((s, e) => s + e.realizedPaidPerTurn, 0) / arr.length;
            const avgNetRealized = arr.reduce((s, e) => s + e.realizedNetEPT, 0) / arr.length;
            const avgPredPropEPT = arr.reduce((s, e) => s + e.predictedPropertyEPT, 0) / arr.length;
            const avgPredRelEPT = arr.reduce((s, e) => s + e.predictedRelativeEPT, 0) / arr.length;

            // How well does predicted propertyEPT match realized collected?
            const collectRatios = arr.filter(e => e.predictedPropertyEPT > 0)
                .map(e => e.realizedCollectedPerTurn / e.predictedPropertyEPT);
            const avgCollectRatio = collectRatios.length > 0
                ? (collectRatios.reduce((s, r) => s + r, 0) / collectRatios.length * 100).toFixed(0)
                : 'N/A';

            console.log(label + ' (N=' + arr.length + '):');
            console.log('  Predicted propertyEPT:  $' + avgPredPropEPT.toFixed(1) + '/turn');
            console.log('  Predicted relativeEPT:  $' + avgPredRelEPT.toFixed(1) + '/turn');
            console.log('  Realized collected:     $' + avgCollected.toFixed(1) + '/turn');
            console.log('  Realized paid (to opp): $' + avgPaid.toFixed(1) + '/turn');
            console.log('  Realized net:           $' + avgNetRealized.toFixed(1) + '/turn');
            console.log('  Collected/Predicted:    ' + avgCollectRatio + '%');
            console.log();
        };

        computeStats(realizedVsPredicted, 'All Players');
        computeStats(winnerEPT, 'Winners');
        computeStats(loserEPT, 'Losers');

        // Key insight: does the RANKING hold even if absolute numbers differ?
        console.log('--- Does EPT Ranking Predict Outcome? ---');
        console.log('  "Player with highest predicted propertyEPT at ~turn 30 wins?"');

        // Group by game (every 4 entries = 1 game)
        let correctRanking = 0;
        let totalGames = 0;
        for (let i = 0; i < realizedVsPredicted.length; i += nPlayers) {
            const gameEntries = realizedVsPredicted.slice(i, i + nPlayers);
            if (gameEntries.length < nPlayers) break;

            const bestPredicted = gameEntries.reduce((best, e) =>
                e.predictedPropertyEPT > best.predictedPropertyEPT ? e : best
            );

            totalGames++;
            if (bestPredicted.won) correctRanking++;
        }

        if (totalGames > 0) {
            const pct = (correctRanking / totalGames * 100).toFixed(1);
            console.log('  Highest-predicted-EPT wins: ' + correctRanking + '/' +
                totalGames + ' (' + pct + '%)');
            console.log('  Random baseline: ' + (100 / nPlayers).toFixed(1) + '%');
        }

        // Correlation: predicted relativeEPT vs realized net EPT
        console.log();
        console.log('--- Predicted relativeEPT vs Realized Net Rent ---');
        console.log('Pred relEPT Range    Avg Realized Net    N');
        console.log('-'.repeat(50));

        const relBuckets = [
            { label: '< -$40', min: -Infinity, max: -40 },
            { label: '-$40 to -$10', min: -40, max: -10 },
            { label: '-$10 to $0', min: -10, max: 0 },
            { label: '$0 to $10', min: 0, max: 10 },
            { label: '$10 to $40', min: 10, max: 40 },
            { label: '> $40', min: 40, max: Infinity }
        ];

        for (const bucket of relBuckets) {
            const entries = realizedVsPredicted.filter(e =>
                e.predictedRelativeEPT > bucket.min &&
                e.predictedRelativeEPT <= bucket.max
            );
            if (entries.length < 5) continue;

            const avgRealized = entries.reduce((s, e) => s + e.realizedNetEPT, 0)
                / entries.length;

            console.log(
                bucket.label.padEnd(20) +
                ('$' + avgRealized.toFixed(1)).padStart(12) +
                String(entries.length).padStart(7)
            );
        }
    }

    console.log();
    console.log('='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));
}

// =============================================================================
// CLI
// =============================================================================

const games = parseInt(process.argv[2]) || 500;
runValuationAnalysis(games);
