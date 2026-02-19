/**
 * Blocking Analysis Simulation
 *
 * Runs games with trade analytics to understand N>2 blocking dynamics.
 * Key questions:
 * 1. How often are blocking decisions redundant (group already blocked)?
 * 2. How often do trades create chain reactions?
 * 3. How often do trades inadvertently help 3rd parties?
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradeAnalytics } = require('./trade-analytics.js');

// Import AIs
const { RelativeGrowthAI } = require('./relative-growth-ai.js');
const { EnhancedRelativeOptimal } = require('./enhanced-relative-ai.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');
const { TradingAI } = require('./trading-ai.js');

// Try to load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
    PropertyValuator = require('../property-valuator.js');
} catch (e) {
    console.log('Note: Markov engine not available');
}

/**
 * Instrumented Game Engine that tracks trades and blocking decisions
 */
class InstrumentedGameEngine extends GameEngine {
    constructor(options = {}) {
        super(options);
        this.tradeAnalytics = new TradeAnalytics();
    }

    /**
     * Override newGame to reset analytics
     */
    newGame(numPlayers, aiFactories) {
        super.newGame(numPlayers, aiFactories);
        this.tradeAnalytics.reset();
        // Take initial snapshot
        this.tradeAnalytics.snapshotGroups(this.state, 0);
    }

    /**
     * Override executeTrade to track trades
     */
    executeTrade(trade) {
        // Record trade before execution
        const tradeRecord = this.tradeAnalytics.recordTrade(trade, this.state, this.state.turn);

        // Execute the trade
        super.executeTrade(trade);

        // Take snapshot after trade
        this.tradeAnalytics.snapshotGroups(this.state, this.state.turn);

        // Check for monopoly formations
        this.checkMonopolyFormations(trade, tradeRecord);

        // Check for trade chains
        this.tradeAnalytics.checkForTradeChain(tradeRecord);

        // Analyze enabler effects
        this.tradeAnalytics.analyzeEnablerEffect(tradeRecord, this.state);
    }

    /**
     * Check if trade completed any monopolies
     */
    checkMonopolyFormations(trade, tradeRecord) {
        const { from, to, fromProperties, toProperties } = trade;

        // Check if 'from' player completed a monopoly (they received toProperties)
        for (const prop of toProperties) {
            const group = BOARD[prop].group;
            if (group && this.hasMonopoly(from.id, group)) {
                tradeRecord.completedMonopolies.push({ playerId: from.id, group });
                this.tradeAnalytics.recordMonopolyFormation(from.id, group, this.state.turn, 'trade');
            }
        }

        // Check if 'to' player completed a monopoly (they received fromProperties)
        for (const prop of fromProperties) {
            const group = BOARD[prop].group;
            if (group && this.hasMonopoly(to.id, group)) {
                tradeRecord.completedMonopolies.push({ playerId: to.id, group });
                this.tradeAnalytics.recordMonopolyFormation(to.id, group, this.state.turn, 'trade');
            }
        }
    }

    /**
     * Check if player has monopoly on a group
     */
    hasMonopoly(playerId, groupName) {
        const group = COLOR_GROUPS[groupName];
        if (!group) return false;

        return group.squares.every(sq =>
            this.state.propertyStates[sq].owner === playerId
        );
    }

    /**
     * Override runGame to return analytics
     */
    runGame() {
        const result = super.runGame();
        result.tradeAnalytics = this.tradeAnalytics;
        return result;
    }
}

/**
 * Instrumented AI that reports blocking decisions
 */
class InstrumentedRelativeAI extends EnhancedRelativeOptimal {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'InstrumentedAI';
    }

    /**
     * Override decideBid to track blocking decisions
     */
    decideBid(position, currentBid, state) {
        const bid = super.decideBid(position, currentBid, state);

        if (bid > 0 && this.engine.tradeAnalytics) {
            const square = BOARD[position];
            if (square.group) {
                const blockingInfo = this.analyzeBlockingContext(position, state);

                this.engine.tradeAnalytics.recordBlockingDecision({
                    playerId: this.player.id,
                    decisionType: 'auction_bid',
                    targetGroup: square.group,
                    opponentId: blockingInfo.leaderInGroup,
                    wasAlreadyBlocked: blockingInfo.alreadyBlocked,
                    otherBlockers: blockingInfo.otherBlockers,
                    valueAssigned: bid - square.price,  // Premium paid
                    turn: state.turn
                });
            }
        }

        return bid;
    }

    /**
     * Override evaluateTrade to track blocking decisions
     */
    evaluateTrade(offer, state) {
        const result = super.evaluateTrade(offer, state);

        if (this.engine.tradeAnalytics) {
            const { toProperties } = offer;

            for (const prop of toProperties) {
                const square = BOARD[prop];
                if (square.group) {
                    const blockingInfo = this.analyzeBlockingContext(prop, state);

                    this.engine.tradeAnalytics.recordBlockingDecision({
                        playerId: this.player.id,
                        decisionType: result ? 'trade_accept' : 'trade_reject',
                        targetGroup: square.group,
                        opponentId: offer.from.id,
                        wasAlreadyBlocked: blockingInfo.alreadyBlocked,
                        otherBlockers: blockingInfo.otherBlockers,
                        valueAssigned: 0,  // TODO: extract from trade valuation
                        turn: state.turn
                    });
                }
            }
        }

        return result;
    }

    /**
     * Analyze blocking context for a property
     */
    analyzeBlockingContext(position, state) {
        const square = BOARD[position];
        if (!square.group) {
            return { alreadyBlocked: false, otherBlockers: [], leaderInGroup: null };
        }

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Count ownership by player
        const ownership = {};
        for (const sq of groupSquares) {
            const owner = state.propertyStates[sq].owner;
            if (owner !== null) {
                ownership[owner] = (ownership[owner] || 0) + 1;
            }
        }

        const owners = Object.keys(ownership).map(Number);

        // Find leader (player with most properties in group, excluding self)
        let leaderInGroup = null;
        let maxCount = 0;
        for (const [ownerId, count] of Object.entries(ownership)) {
            const id = parseInt(ownerId);
            if (id !== this.player.id && count > maxCount) {
                maxCount = count;
                leaderInGroup = id;
            }
        }

        // Find other blockers (anyone else in the group besides leader and self)
        const otherBlockers = owners.filter(id =>
            id !== this.player.id && id !== leaderInGroup
        );

        // Group is "already blocked" if there are multiple owners besides the leader
        const alreadyBlocked = otherBlockers.length > 0 ||
            (ownership[this.player.id] && ownership[this.player.id] > 0);

        return { alreadyBlocked, otherBlockers, leaderInGroup };
    }
}

/**
 * Run blocking analysis simulation
 */
class BlockingAnalysisRunner {
    constructor(options = {}) {
        this.options = {
            games: options.games || 100,
            maxTurns: options.maxTurns || 500,
            verbose: options.verbose || false,
            ...options
        };

        // Initialize Markov engine
        this.markovEngine = null;
        this.valuator = null;

        if (MarkovEngine) {
            console.log('Initializing Markov engine...');
            this.markovEngine = new MarkovEngine();
            this.markovEngine.initialize();

            if (PropertyValuator) {
                this.valuator = new PropertyValuator.Valuator(this.markovEngine);
                this.valuator.initialize();
            }
        }
    }

    /**
     * Create instrumented AI factory
     */
    createInstrumentedAIFactory() {
        const self = this;
        return (player, engine) => {
            return new InstrumentedRelativeAI(player, engine, self.markovEngine, self.valuator);
        };
    }

    /**
     * Run single game with analytics
     */
    runSingleGame() {
        const engine = new InstrumentedGameEngine({
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose
        });

        const factory = this.createInstrumentedAIFactory();
        engine.newGame(4, [factory, factory, factory, factory]);

        return engine.runGame();
    }

    /**
     * Run full analysis
     */
    runAnalysis(numGames = null) {
        numGames = numGames || this.options.games;

        console.log(`\n${'='.repeat(70)}`);
        console.log('BLOCKING ANALYSIS SIMULATION');
        console.log(`${'='.repeat(70)}`);
        console.log(`Running ${numGames} games with 4 InstrumentedAI players`);
        console.log('Tracking: trades, trade chains, blocking decisions, monopoly formations\n');

        // Aggregate analytics
        const aggregate = {
            totalGames: 0,
            totalTrades: 0,
            totalTradeChains: 0,
            totalEnablerTrades: 0,
            totalMonopolies: 0,
            totalBlockingDecisions: 0,
            redundantBlocks: 0,
            blockingByType: {},
            tradeChainGroups: {},
            monopoliesByType: {},
            monopoliesByGroup: {},
            gameResults: []
        };

        const startTime = Date.now();

        for (let i = 0; i < numGames; i++) {
            const result = this.runSingleGame();
            aggregate.totalGames++;

            if (result.tradeAnalytics) {
                const report = result.tradeAnalytics.generateReport();

                aggregate.totalTrades += report.totalTrades;
                aggregate.totalTradeChains += report.tradeChains;
                aggregate.totalEnablerTrades += report.enablerTrades;
                aggregate.totalMonopolies += report.monopolyFormations;
                aggregate.totalBlockingDecisions += report.blockingDecisions.total;
                aggregate.redundantBlocks += report.blockingDecisions.redundant;

                // Aggregate by type
                for (const [type, data] of Object.entries(report.blockingDecisions.byType)) {
                    if (!aggregate.blockingByType[type]) {
                        aggregate.blockingByType[type] = { total: 0, redundant: 0 };
                    }
                    aggregate.blockingByType[type].total += data.total;
                    aggregate.blockingByType[type].redundant += data.redundant;
                }

                // Aggregate monopoly data
                if (report.monopolyDetails) {
                    for (const [type, count] of Object.entries(report.monopolyDetails.byType)) {
                        aggregate.monopoliesByType[type] = (aggregate.monopoliesByType[type] || 0) + count;
                    }
                    for (const [group, count] of Object.entries(report.monopolyDetails.byGroup)) {
                        aggregate.monopoliesByGroup[group] = (aggregate.monopoliesByGroup[group] || 0) + count;
                    }
                }

                // Aggregate trade chain groups
                if (report.tradeChainDetails) {
                    for (const [group, count] of Object.entries(report.tradeChainDetails.commonGroups)) {
                        aggregate.tradeChainGroups[group] = (aggregate.tradeChainGroups[group] || 0) + count;
                    }
                }
            }

            aggregate.gameResults.push({
                winner: result.winner,
                turns: result.turns
            });

            if ((i + 1) % 20 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`  Game ${i + 1}/${numGames} (${((i + 1) / elapsed).toFixed(1)} games/sec)`);
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;

        this.printResults(aggregate, totalTime);

        return aggregate;
    }

    /**
     * Print analysis results
     */
    printResults(aggregate, totalTime) {
        console.log(`\n${'='.repeat(70)}`);
        console.log('BLOCKING ANALYSIS RESULTS');
        console.log(`${'='.repeat(70)}`);

        console.log(`\nGames played: ${aggregate.totalGames}`);
        console.log(`Time: ${totalTime.toFixed(1)} seconds`);

        // Trade statistics
        console.log('\n--- TRADE STATISTICS ---');
        console.log(`Total trades: ${aggregate.totalTrades}`);
        console.log(`Trades per game: ${(aggregate.totalTrades / aggregate.totalGames).toFixed(2)}`);
        console.log(`Trade chains: ${aggregate.totalTradeChains}`);
        console.log(`Enabler trades (helped 3rd party): ${aggregate.totalEnablerTrades}`);

        // Blocking statistics
        console.log('\n--- BLOCKING DECISIONS ---');
        console.log(`Total blocking considerations: ${aggregate.totalBlockingDecisions}`);
        console.log(`Redundant blocks: ${aggregate.redundantBlocks}`);
        if (aggregate.totalBlockingDecisions > 0) {
            const redundantPct = (aggregate.redundantBlocks / aggregate.totalBlockingDecisions * 100).toFixed(1);
            console.log(`Redundant block rate: ${redundantPct}%`);
        }

        console.log('\nBy decision type:');
        for (const [type, data] of Object.entries(aggregate.blockingByType)) {
            const pct = data.total > 0 ? (data.redundant / data.total * 100).toFixed(0) : 0;
            console.log(`  ${type.padEnd(15)} ${data.total.toString().padStart(5)} total, ${data.redundant.toString().padStart(4)} redundant (${pct}%)`);
        }

        // Monopoly statistics
        console.log('\n--- MONOPOLY FORMATIONS ---');
        console.log(`Total monopolies: ${aggregate.totalMonopolies}`);
        console.log(`Monopolies per game: ${(aggregate.totalMonopolies / aggregate.totalGames).toFixed(2)}`);

        if (Object.keys(aggregate.monopoliesByType).length > 0) {
            console.log('\nBy formation type:');
            for (const [type, count] of Object.entries(aggregate.monopoliesByType)) {
                const pct = (count / aggregate.totalMonopolies * 100).toFixed(0);
                console.log(`  ${type.padEnd(12)} ${count.toString().padStart(4)} (${pct}%)`);
            }
        }

        if (Object.keys(aggregate.monopoliesByGroup).length > 0) {
            console.log('\nBy color group:');
            const sorted = Object.entries(aggregate.monopoliesByGroup)
                .sort((a, b) => b[1] - a[1]);
            for (const [group, count] of sorted) {
                console.log(`  ${group.padEnd(12)} ${count}`);
            }
        }

        // Trade chain analysis
        if (Object.keys(aggregate.tradeChainGroups).length > 0) {
            console.log('\n--- TRADE CHAIN ANALYSIS ---');
            console.log('Most common groups in trade chains:');
            const sorted = Object.entries(aggregate.tradeChainGroups)
                .sort((a, b) => b[1] - a[1]);
            for (const [group, count] of sorted) {
                console.log(`  ${group.padEnd(12)} ${count}`);
            }
        }

        // Key insights
        console.log('\n--- KEY INSIGHTS ---');

        if (aggregate.totalBlockingDecisions > 0) {
            const redundantPct = (aggregate.redundantBlocks / aggregate.totalBlockingDecisions * 100);
            if (redundantPct > 30) {
                console.log(`! ${redundantPct.toFixed(0)}% of blocking decisions are redundant - opportunity for optimization`);
            } else {
                console.log(`  Redundant blocking rate (${redundantPct.toFixed(0)}%) is reasonable`);
            }
        }

        if (aggregate.totalEnablerTrades > 0) {
            const enablerPct = (aggregate.totalEnablerTrades / aggregate.totalTrades * 100);
            console.log(`  ${enablerPct.toFixed(1)}% of trades inadvertently helped 3rd parties`);
        }

        if (aggregate.totalTradeChains > 0) {
            const chainPct = (aggregate.totalTradeChains / aggregate.totalTrades * 100);
            console.log(`  ${chainPct.toFixed(1)}% of trades are part of chain reactions`);
        }
    }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
    const runner = new BlockingAnalysisRunner({
        games: 100,
        maxTurns: 500,
        verbose: false
    });

    runner.runAnalysis(100);
}

module.exports = { BlockingAnalysisRunner, InstrumentedGameEngine, InstrumentedRelativeAI, TradeAnalytics };
