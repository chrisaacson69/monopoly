/**
 * Auction-Only Monopoly Game Engine
 *
 * A variant where players cannot buy properties on landing -
 * ALL properties go immediately to auction. This taxes the AI's
 * valuation system and reveals true market prices.
 */

'use strict';

const {
    GameEngine,
    BOARD,
    SQUARE_TYPES
} = require('./game-engine.js');

// =============================================================================
// AUCTION ANALYTICS
// =============================================================================

/**
 * Tracks detailed auction data for analysis
 */
class AuctionAnalytics {
    constructor() {
        this.auctions = [];  // All auction results
        this.monopolyFormations = [];  // Track when monopolies are formed
        this.monopolyTrades = [];  // Track when monopolies are traded away (upgrades/downgrades)
    }

    recordAuction(data) {
        this.auctions.push({
            position: data.position,
            propertyName: data.propertyName,
            faceValue: data.faceValue,
            purchasePrice: data.purchasePrice,
            turn: data.turn,
            buyerId: data.buyerId,
            buyerName: data.buyerName,
            // Track all bids for deeper analysis
            allBids: data.allBids || [],
            // Was this contested (multiple bidders)?
            contested: data.contested || false
        });
    }

    recordMonopolyFormation(data) {
        this.monopolyFormations.push({
            turn: data.turn,
            playerId: data.playerId,
            group: data.group,
            method: data.method  // 'auction' or 'trade'
        });
    }

    recordMonopolyTrade(data) {
        this.monopolyTrades.push({
            turn: data.turn,
            playerId: data.playerId,
            soldGroup: data.soldGroup,        // Monopoly being given up
            gainedGroup: data.gainedGroup,    // Monopoly being acquired (if any)
            isUpgrade: data.isUpgrade,        // true if gaining higher-value group
            cashDelta: data.cashDelta         // Net cash change
        });
    }

    /**
     * Get summary statistics
     */
    getSummary() {
        const byProperty = {};
        const byPlayer = {};
        const byTurn = { early: [], mid: [], late: [] };

        for (const auction of this.auctions) {
            // By property
            if (!byProperty[auction.propertyName]) {
                byProperty[auction.propertyName] = {
                    position: auction.position,
                    faceValue: auction.faceValue,
                    sales: []
                };
            }
            byProperty[auction.propertyName].sales.push({
                price: auction.purchasePrice,
                turn: auction.turn,
                buyerId: auction.buyerId,
                contested: auction.contested
            });

            // By player
            if (auction.buyerId !== null) {
                if (!byPlayer[auction.buyerId]) {
                    byPlayer[auction.buyerId] = {
                        name: auction.buyerName,
                        purchases: []
                    };
                }
                byPlayer[auction.buyerId].purchases.push({
                    property: auction.propertyName,
                    price: auction.purchasePrice,
                    faceValue: auction.faceValue,
                    turn: auction.turn
                });
            }

            // By game phase
            if (auction.turn <= 20) {
                byTurn.early.push(auction);
            } else if (auction.turn <= 50) {
                byTurn.mid.push(auction);
            } else {
                byTurn.late.push(auction);
            }
        }

        return { byProperty, byPlayer, byTurn };
    }
}

// =============================================================================
// AUCTION-ONLY GAME ENGINE
// =============================================================================

class AuctionGameEngine extends GameEngine {
    constructor(options = {}) {
        super(options);
        this.auctionAnalytics = new AuctionAnalytics();

        // Debt tracking per player
        this.debtTracking = null;  // Initialized in newGame
    }

    /**
     * Override newGame to initialize debt tracking
     */
    newGame(numPlayers, aiFactories) {
        super.newGame(numPlayers, aiFactories);

        // Initialize debt tracking for each player
        this.debtTracking = [];
        for (let i = 0; i < numPlayers; i++) {
            this.debtTracking.push({
                playerId: i,
                mortgageEvents: [],      // { turn, property, amount }
                unmortgageEvents: [],    // { turn, property, cost }
                peakDebt: 0,             // Maximum mortgaged value at any point
                currentDebt: 0,          // Current mortgaged value
                debtHistory: [],         // { turn, debt } snapshots
                timesWentIntoDebt: 0,    // Count of transitions from 0 to >0 debt
                recoveredFromDebt: 0,    // Count of times debt went back to 0
            });
        }
    }

    /**
     * Override mortgageProperty to track debt
     */
    mortgageProperty(player, position) {
        const wasMortgaged = this.state.propertyStates[position].mortgaged;
        const result = super.mortgageProperty(player, position);

        if (result && !wasMortgaged) {
            const square = BOARD[position];
            const mortgageValue = Math.floor(square.price / 2);
            const tracking = this.debtTracking[player.id];

            // Record if this is a new debt (was at 0)
            if (tracking.currentDebt === 0) {
                tracking.timesWentIntoDebt++;
            }

            tracking.currentDebt += mortgageValue;
            tracking.peakDebt = Math.max(tracking.peakDebt, tracking.currentDebt);

            tracking.mortgageEvents.push({
                turn: this.state.turn,
                property: position,
                propertyName: square.name,
                amount: mortgageValue
            });

            tracking.debtHistory.push({
                turn: this.state.turn,
                debt: tracking.currentDebt
            });
        }

        return result;
    }

    /**
     * Override unmortgageProperty to track debt recovery
     */
    unmortgageProperty(player, position) {
        const wasMortgaged = this.state.propertyStates[position].mortgaged;
        const result = super.unmortgageProperty(player, position);

        if (result && wasMortgaged) {
            const square = BOARD[position];
            const mortgageValue = Math.floor(square.price / 2);
            const unmortgageCost = Math.floor(mortgageValue * 1.1);
            const tracking = this.debtTracking[player.id];

            tracking.currentDebt -= mortgageValue;

            // Record if this cleared all debt
            if (tracking.currentDebt === 0) {
                tracking.recoveredFromDebt++;
            }

            tracking.unmortgageEvents.push({
                turn: this.state.turn,
                property: position,
                propertyName: square.name,
                cost: unmortgageCost,
                principal: mortgageValue
            });

            tracking.debtHistory.push({
                turn: this.state.turn,
                debt: tracking.currentDebt
            });
        }

        return result;
    }

    /**
     * Override: ALL unowned properties go to auction (no direct purchase)
     */
    handlePropertyPurchase(player, position) {
        // Skip the buy decision - go straight to auction
        this.runTrackedAuction(position);
    }

    /**
     * Enhanced auction that tracks all bid data
     */
    runTrackedAuction(position) {
        const square = BOARD[position];
        let highBid = 0;
        let highBidder = null;
        const allBids = [];  // Track every bid

        // Get active players and randomize starting order
        const bidders = [...this.state.getActivePlayers()];

        // Shuffle bidders
        for (let i = bidders.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bidders[i], bidders[j]] = [bidders[j], bidders[i]];
        }

        // Track who is still in the auction
        const stillBidding = new Set(bidders.map(p => p.id));
        let uniqueBidders = new Set();

        // Round-robin bidding
        let rounds = 0;
        const maxRounds = 100;

        while (stillBidding.size > 1 && rounds < maxRounds) {
            rounds++;
            let anyBidThisRound = false;

            for (const player of bidders) {
                if (!stillBidding.has(player.id)) continue;

                let bid = 0;

                if (player.ai && player.ai.decideBid) {
                    bid = player.ai.decideBid(position, highBid, this.state);
                } else {
                    // Default: bid up to property price if can afford
                    const maxBid = Math.min(player.money - 50, square.price);
                    if (maxBid > highBid) {
                        bid = highBid + 10;
                    }
                }

                if (bid > highBid && bid <= player.money) {
                    highBid = bid;
                    highBidder = player;
                    anyBidThisRound = true;
                    uniqueBidders.add(player.id);

                    // Record this bid
                    allBids.push({
                        playerId: player.id,
                        playerName: player.name,
                        bid: bid,
                        round: rounds
                    });
                } else {
                    stillBidding.delete(player.id);
                }
            }

            if (!anyBidThisRound && highBidder) {
                break;
            }
        }

        // Complete the auction
        if (highBidder) {
            highBidder.money -= highBid;
            highBidder.properties.add(position);
            this.state.propertyStates[position].owner = highBidder.id;
            this.log(`${highBidder.name} won auction for ${square.name} at $${highBid}`);

            // Record analytics
            this.auctionAnalytics.recordAuction({
                position: position,
                propertyName: square.name,
                faceValue: square.price,
                purchasePrice: highBid,
                turn: this.state.turn,
                buyerId: highBidder.id,
                buyerName: highBidder.name,
                allBids: allBids,
                contested: uniqueBidders.size > 1
            });

            // Check if this completed a monopoly
            this.checkMonopolyFormation(highBidder, position, 'auction');
        } else {
            // No one bid - property remains unowned
            this.log(`No bids for ${square.name} - remains unowned`);

            this.auctionAnalytics.recordAuction({
                position: position,
                propertyName: square.name,
                faceValue: square.price,
                purchasePrice: 0,
                turn: this.state.turn,
                buyerId: null,
                buyerName: null,
                allBids: allBids,
                contested: false
            });
        }
    }

    /**
     * Check if acquisition completed a monopoly
     */
    checkMonopolyFormation(player, position, method) {
        const square = BOARD[position];
        if (!square.group) return;

        const { COLOR_GROUPS } = require('./game-engine.js');
        const groupSquares = COLOR_GROUPS[square.group].squares;

        const ownsAll = groupSquares.every(sq =>
            this.state.propertyStates[sq].owner === player.id
        );

        if (ownsAll) {
            // Check if already recorded
            const alreadyRecorded = this.auctionAnalytics.monopolyFormations.some(m =>
                m.playerId === player.id && m.group === square.group
            );

            if (!alreadyRecorded) {
                this.auctionAnalytics.recordMonopolyFormation({
                    turn: this.state.turn,
                    playerId: player.id,
                    group: square.group,
                    method
                });
            }
        }
    }

    /**
     * Override executeTrade to track monopoly formations and monopoly trades
     */
    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;
        const { COLOR_GROUPS } = require('./game-engine.js');

        // Before trade: check which monopolies each player has
        const fromMonopoliesBefore = this.getPlayerMonopolies(from.id);
        const toMonopoliesBefore = this.getPlayerMonopolies(to.id);

        const result = super.executeTrade(trade);

        if (result) {
            // After trade: check which monopolies each player has
            const fromMonopoliesAfter = this.getPlayerMonopolies(from.id);
            const toMonopoliesAfter = this.getPlayerMonopolies(to.id);

            // Check if trade completed any monopolies
            for (const prop of fromProperties) {
                this.checkMonopolyFormation(to, prop, 'trade');
            }
            for (const prop of toProperties) {
                this.checkMonopolyFormation(from, prop, 'trade');
            }

            // Track monopoly trades (upgrades/downgrades)
            // Did 'from' player lose a monopoly?
            const fromLostMonopolies = fromMonopoliesBefore.filter(g => !fromMonopoliesAfter.includes(g));
            const fromGainedMonopolies = fromMonopoliesAfter.filter(g => !fromMonopoliesBefore.includes(g));

            for (const soldGroup of fromLostMonopolies) {
                const gainedGroup = fromGainedMonopolies.length > 0 ? fromGainedMonopolies[0] : null;
                const isUpgrade = gainedGroup ? this.isMonopolyUpgrade(soldGroup, gainedGroup) : false;

                this.auctionAnalytics.recordMonopolyTrade({
                    turn: this.state.turn,
                    playerId: from.id,
                    soldGroup,
                    gainedGroup,
                    isUpgrade,
                    cashDelta: -fromCash  // from pays cash
                });
            }

            // Did 'to' player lose a monopoly?
            const toLostMonopolies = toMonopoliesBefore.filter(g => !toMonopoliesAfter.includes(g));
            const toGainedMonopolies = toMonopoliesAfter.filter(g => !toMonopoliesBefore.includes(g));

            for (const soldGroup of toLostMonopolies) {
                const gainedGroup = toGainedMonopolies.length > 0 ? toGainedMonopolies[0] : null;
                const isUpgrade = gainedGroup ? this.isMonopolyUpgrade(soldGroup, gainedGroup) : false;

                this.auctionAnalytics.recordMonopolyTrade({
                    turn: this.state.turn,
                    playerId: to.id,
                    soldGroup,
                    gainedGroup,
                    isUpgrade,
                    cashDelta: fromCash  // to receives cash
                });
            }
        }

        return result;
    }

    /**
     * Get list of monopoly groups a player owns
     */
    getPlayerMonopolies(playerId) {
        const { COLOR_GROUPS } = require('./game-engine.js');
        const monopolies = [];

        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = group.squares.every(sq =>
                this.state.propertyStates[sq].owner === playerId
            );
            if (ownsAll) {
                monopolies.push(groupName);
            }
        }

        return monopolies;
    }

    /**
     * Determine if trading soldGroup for gainedGroup is an "upgrade"
     * Based on max rent potential (proxy for late-game value)
     */
    isMonopolyUpgrade(soldGroup, gainedGroup) {
        // Max rent values at hotel (rough ordering by late-game power)
        const groupValue = {
            brown: 1,       // $450 max rent
            lightBlue: 2,   // $600 max rent
            pink: 3,        // $950 max rent
            orange: 4,      // $1050 max rent
            red: 5,         // $1150 max rent
            yellow: 6,      // $1200 max rent
            green: 7,       // $1400 max rent
            darkBlue: 8     // $2000 max rent
        };

        return (groupValue[gainedGroup] || 0) > (groupValue[soldGroup] || 0);
    }

    /**
     * Override runGame to return auction analytics
     */
    runGame() {
        const result = super.runGame();
        result.auctionAnalytics = this.auctionAnalytics;
        result.debtTracking = this.debtTracking;
        return result;
    }
}

// =============================================================================
// AUCTION SIMULATION RUNNER
// =============================================================================

class AuctionSimulationRunner {
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

        try {
            const { MarkovEngine } = require('../markov-engine.js');
            const PropertyValuator = require('../property-valuator.js');

            if (MarkovEngine) {
                console.log('Initializing Markov engine...');
                this.markovEngine = new MarkovEngine();
                this.markovEngine.initialize();

                if (PropertyValuator) {
                    this.valuator = new PropertyValuator.Valuator(this.markovEngine);
                    this.valuator.initialize();
                }
            }
        } catch (e) {
            console.log('Markov engine not available:', e.message);
        }

        // Aggregate auction data across all games
        this.aggregateAuctions = [];
    }

    /**
     * Create AI factory
     */
    createAIFactory(aiType) {
        const self = this;

        // Import AI classes
        const { SimpleAI, StrategicAI, RandomAI } = require('./base-ai.js');
        const { TradingAI, AggressiveTradingAI, NoTradeAI, DynamicTradingAI } = require('./trading-ai.js');

        let NPVTradingAI, CompetitiveTradingAI;
        try {
            const npvModule = require('./npv-trading-ai.js');
            NPVTradingAI = npvModule.NPVTradingAI;
            CompetitiveTradingAI = npvModule.CompetitiveTradingAI;
        } catch (e) { }

        let GrowthTradingAI;
        try {
            const growthModule = require('./growth-trading-ai.js');
            GrowthTradingAI = growthModule.GrowthTradingAI;
        } catch (e) { }

        let LeaderAwareAI;
        try {
            const leaderModule = require('./leader-aware-ai.js');
            LeaderAwareAI = leaderModule.LeaderAwareAI;
        } catch (e) { }

        let RelativeGrowthAI;
        try {
            const relModule = require('./relative-growth-ai.js');
            RelativeGrowthAI = relModule.RelativeGrowthAI;
        } catch (e) { }

        let AggressiveBidder5, AggressiveBidder10, AggressiveBidder20;
        try {
            const bidderModule = require('./aggressive-bidder-ai.js');
            AggressiveBidder5 = bidderModule.AggressiveBidder5;
            AggressiveBidder10 = bidderModule.AggressiveBidder10;
            AggressiveBidder20 = bidderModule.AggressiveBidder20;
        } catch (e) { }

        let EnhancedRelativeOptimal, EnhancedRelative5, EnhancedRelative10, EnhancedRelative15;
        try {
            const enhancedModule = require('./enhanced-relative-ai.js');
            EnhancedRelativeOptimal = enhancedModule.EnhancedRelativeOptimal;
            EnhancedRelative5 = enhancedModule.EnhancedRelative5;
            EnhancedRelative10 = enhancedModule.EnhancedRelative10;
            EnhancedRelative15 = enhancedModule.EnhancedRelative15;
        } catch (e) { }

        return (player, engine) => {
            switch (aiType) {
                case 'simple':
                    return new SimpleAI(player, engine);
                case 'strategic':
                    return new StrategicAI(player, engine, self.markovEngine, self.valuator);
                case 'random':
                    return new RandomAI(player, engine);
                case 'trading':
                    return new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'aggressive':
                    return new AggressiveTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'notrade':
                    return new NoTradeAI(player, engine, self.markovEngine, self.valuator);
                case 'dynamic':
                    return new DynamicTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'npv':
                    return NPVTradingAI ?
                        new NPVTradingAI(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'competitive':
                    return CompetitiveTradingAI ?
                        new CompetitiveTradingAI(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'growth':
                    return GrowthTradingAI ?
                        new GrowthTradingAI(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'leader':
                case 'leaderaware':
                    return LeaderAwareAI ?
                        new LeaderAwareAI(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'relative':
                case 'relativegrowth':
                    return RelativeGrowthAI ?
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'bidder5':
                case 'aggressive5':
                    return AggressiveBidder5 ?
                        new AggressiveBidder5(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'bidder10':
                case 'aggressive10':
                    return AggressiveBidder10 ?
                        new AggressiveBidder10(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'bidder20':
                case 'aggressive20':
                    return AggressiveBidder20 ?
                        new AggressiveBidder20(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'optimal':
                case 'smartblock':
                case 'enhanced':
                    return EnhancedRelativeOptimal ?
                        new EnhancedRelativeOptimal(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced5':
                    return EnhancedRelative5 ?
                        new EnhancedRelative5(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced10':
                    return EnhancedRelative10 ?
                        new EnhancedRelative10(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced15':
                    return EnhancedRelative15 ?
                        new EnhancedRelative15(player, engine, self.markovEngine, self.valuator) :
                        new TradingAI(player, engine, self.markovEngine, self.valuator);
                default:
                    return new SimpleAI(player, engine);
            }
        };
    }

    /**
     * Run a single auction game
     */
    runSingleGame(aiTypes) {
        const engine = new AuctionGameEngine({
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose
        });

        const numPlayers = aiTypes.length;
        const factories = aiTypes.map(type => this.createAIFactory(type));

        engine.newGame(numPlayers, factories);
        return engine.runGame();
    }

    /**
     * Run full simulation
     */
    runSimulation(aiTypes, numGames = null) {
        numGames = numGames || this.options.games;

        console.log(`\n${'='.repeat(70)}`);
        console.log('AUCTION-ONLY SIMULATION');
        console.log(`${'='.repeat(70)}`);
        console.log(`Running ${numGames} games with AI types: ${aiTypes.join(', ')}`);
        console.log('Rule: No direct purchases - ALL properties go to auction\n');

        const results = {
            games: numGames,
            aiTypes,
            wins: new Array(aiTypes.length).fill(0),
            totalTurns: 0,
            timeouts: 0,
            allAuctions: [],
            // Monopoly tracking
            monopolyStats: {},  // group -> { timesFormed, wins, turnFormed: [], byTrade: 0 }
            // Monopoly trade tracking (upgrades/downgrades)
            monopolyTrades: {
                total: 0,
                upgrades: 0,
                downgrades: 0,
                byGroup: {},  // soldGroup -> { times, upgradedTo: {}, wins }
                upgradeWins: 0,  // wins where player did an upgrade
                downgradeWins: 0,
            },
            // Debt tracking aggregates per player
            debtStats: aiTypes.map((_, i) => ({
                playerId: i,
                totalMortgages: 0,
                totalUnmortgages: 0,
                totalPeakDebt: 0,
                maxPeakDebt: 0,
                timesWentIntoDebt: 0,
                timesRecovered: 0,
                gamesWithDebt: 0,
                gamesEndedInDebt: 0,
                winnerPeakDebts: [],    // Peak debt when this player won
                loserPeakDebts: [],     // Peak debt when this player lost
            }))
        };

        const startTime = Date.now();

        for (let i = 0; i < numGames; i++) {
            const gameResult = this.runSingleGame(aiTypes);

            if (gameResult.winner !== null) {
                results.wins[gameResult.winner]++;
            } else {
                results.timeouts++;
            }

            results.totalTurns += gameResult.turns;

            // Collect auction data
            if (gameResult.auctionAnalytics) {
                for (const auction of gameResult.auctionAnalytics.auctions) {
                    results.allAuctions.push({
                        ...auction,
                        gameNum: i + 1
                    });
                }

                // Collect monopoly formation data
                for (const mono of gameResult.auctionAnalytics.monopolyFormations) {
                    if (!results.monopolyStats[mono.group]) {
                        results.monopolyStats[mono.group] = {
                            timesFormed: 0,
                            wins: 0,
                            turnFormed: [],
                            byTrade: 0
                        };
                    }
                    results.monopolyStats[mono.group].timesFormed++;
                    results.monopolyStats[mono.group].turnFormed.push(mono.turn);
                    if (mono.method === 'trade') {
                        results.monopolyStats[mono.group].byTrade++;
                    }

                    // Check if this player won
                    if (gameResult.winner === mono.playerId) {
                        results.monopolyStats[mono.group].wins++;
                    }
                }

                // Collect monopoly trade data (upgrades/downgrades)
                for (const trade of gameResult.auctionAnalytics.monopolyTrades) {
                    results.monopolyTrades.total++;

                    if (trade.isUpgrade) {
                        results.monopolyTrades.upgrades++;
                        if (gameResult.winner === trade.playerId) {
                            results.monopolyTrades.upgradeWins++;
                        }
                    } else if (trade.gainedGroup) {
                        results.monopolyTrades.downgrades++;
                        if (gameResult.winner === trade.playerId) {
                            results.monopolyTrades.downgradeWins++;
                        }
                    }

                    // Track by sold group
                    if (!results.monopolyTrades.byGroup[trade.soldGroup]) {
                        results.monopolyTrades.byGroup[trade.soldGroup] = {
                            times: 0,
                            upgradedTo: {},
                            wins: 0
                        };
                    }
                    results.monopolyTrades.byGroup[trade.soldGroup].times++;

                    if (trade.gainedGroup) {
                        if (!results.monopolyTrades.byGroup[trade.soldGroup].upgradedTo[trade.gainedGroup]) {
                            results.monopolyTrades.byGroup[trade.soldGroup].upgradedTo[trade.gainedGroup] = 0;
                        }
                        results.monopolyTrades.byGroup[trade.soldGroup].upgradedTo[trade.gainedGroup]++;
                    }

                    if (gameResult.winner === trade.playerId) {
                        results.monopolyTrades.byGroup[trade.soldGroup].wins++;
                    }
                }
            }

            // Collect debt tracking data
            if (gameResult.debtTracking) {
                for (let p = 0; p < aiTypes.length; p++) {
                    const dt = gameResult.debtTracking[p];
                    const stats = results.debtStats[p];

                    stats.totalMortgages += dt.mortgageEvents.length;
                    stats.totalUnmortgages += dt.unmortgageEvents.length;
                    stats.totalPeakDebt += dt.peakDebt;
                    stats.maxPeakDebt = Math.max(stats.maxPeakDebt, dt.peakDebt);
                    stats.timesWentIntoDebt += dt.timesWentIntoDebt;
                    stats.timesRecovered += dt.recoveredFromDebt;

                    if (dt.peakDebt > 0) {
                        stats.gamesWithDebt++;
                    }
                    if (dt.currentDebt > 0) {
                        stats.gamesEndedInDebt++;
                    }

                    // Track debt vs winning
                    if (gameResult.winner === p) {
                        stats.winnerPeakDebts.push(dt.peakDebt);
                    } else {
                        stats.loserPeakDebts.push(dt.peakDebt);
                    }
                }
            }

            if ((i + 1) % 50 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`  Game ${i + 1}/${numGames} (${(i + 1) / elapsed.toFixed(1)} games/sec)`);
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;
        results.avgTurns = results.totalTurns / numGames;
        results.timeSeconds = totalTime;

        this.printResults(results);
        this.printAuctionAnalysis(results);
        this.printMonopolyAnalysis(results);
        this.printDebtAnalysis(results);

        return results;
    }

    /**
     * Print basic results
     */
    printResults(results) {
        console.log(`\n${'='.repeat(70)}`);
        console.log('GAME RESULTS');
        console.log(`${'='.repeat(70)}`);

        console.log(`\nGames played: ${results.games}`);
        console.log(`Time: ${results.timeSeconds.toFixed(1)} seconds`);
        console.log(`Average turns per game: ${results.avgTurns.toFixed(1)}`);
        console.log(`Timeouts: ${results.timeouts}`);

        console.log('\nWIN RATES:');
        for (let i = 0; i < results.aiTypes.length; i++) {
            const winRate = (results.wins[i] / results.games * 100).toFixed(1);
            console.log(`  Player ${i + 1} (${results.aiTypes[i]}): ${results.wins[i]} wins (${winRate}%)`);
        }
    }

    /**
     * Print detailed auction analysis
     */
    printAuctionAnalysis(results) {
        const auctions = results.allAuctions;
        if (auctions.length === 0) return;

        console.log(`\n${'='.repeat(70)}`);
        console.log('AUCTION ANALYSIS');
        console.log(`${'='.repeat(70)}`);

        console.log(`\nTotal auctions: ${auctions.length}`);
        console.log(`Auctions per game: ${(auctions.length / results.games).toFixed(1)}`);

        // Group by property
        const byProperty = {};
        for (const a of auctions) {
            if (!byProperty[a.propertyName]) {
                byProperty[a.propertyName] = {
                    position: a.position,
                    faceValue: a.faceValue,
                    prices: [],
                    turns: [],
                    buyers: {},
                    contested: 0,
                    unsold: 0
                };
            }
            const prop = byProperty[a.propertyName];

            if (a.buyerId !== null) {
                prop.prices.push(a.purchasePrice);
                prop.turns.push(a.turn);
                prop.buyers[a.buyerId] = (prop.buyers[a.buyerId] || 0) + 1;
                if (a.contested) prop.contested++;
            } else {
                prop.unsold++;
            }
        }

        // Property price analysis
        console.log('\n--- PROPERTY PRICE ANALYSIS ---');
        console.log('Property                    Face    AvgPrice  Min   Max   %Face  Contested  Unsold');
        console.log('-'.repeat(85));

        // Sort by position
        const sortedProps = Object.entries(byProperty)
            .sort((a, b) => a[1].position - b[1].position);

        for (const [name, data] of sortedProps) {
            if (data.prices.length === 0) {
                console.log(`${name.padEnd(26)} $${data.faceValue.toString().padStart(3)}    (never sold)`.padEnd(50) +
                    `              ${data.unsold.toString().padStart(3)}`);
                continue;
            }

            const avg = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
            const min = Math.min(...data.prices);
            const max = Math.max(...data.prices);
            const pctFace = (avg / data.faceValue * 100).toFixed(0);
            const contestedPct = (data.contested / data.prices.length * 100).toFixed(0);

            console.log(
                `${name.padEnd(26)} $${data.faceValue.toString().padStart(3)}    ` +
                `$${avg.toFixed(0).padStart(4)}   $${min.toString().padStart(3)}  $${max.toString().padStart(3)}   ` +
                `${pctFace.padStart(3)}%      ${contestedPct.padStart(3)}%       ${data.unsold.toString().padStart(3)}`
            );
        }

        // Group by color for summary
        console.log('\n--- COLOR GROUP SUMMARY ---');
        const colorGroups = {
            brown: [1, 3],
            lightBlue: [6, 8, 9],
            pink: [11, 13, 14],
            orange: [16, 18, 19],
            red: [21, 23, 24],
            yellow: [26, 27, 29],
            green: [31, 32, 34],
            darkBlue: [37, 39],
            railroad: [5, 15, 25, 35],
            utility: [12, 28]
        };

        console.log('Group        AvgPrice  %Face  Contested%');
        console.log('-'.repeat(45));

        for (const [group, positions] of Object.entries(colorGroups)) {
            let totalPrice = 0;
            let totalFace = 0;
            let count = 0;
            let contested = 0;

            for (const pos of positions) {
                for (const [name, data] of Object.entries(byProperty)) {
                    if (data.position === pos && data.prices.length > 0) {
                        totalPrice += data.prices.reduce((a, b) => a + b, 0);
                        totalFace += data.faceValue * data.prices.length;
                        count += data.prices.length;
                        contested += data.contested;
                    }
                }
            }

            if (count > 0) {
                const avgPrice = totalPrice / count;
                const avgFace = totalFace / count;
                const pctFace = (avgPrice / avgFace * 100).toFixed(0);
                const contestedPct = (contested / count * 100).toFixed(0);

                console.log(
                    `${group.padEnd(12)} $${avgPrice.toFixed(0).padStart(4)}     ${pctFace.padStart(3)}%      ${contestedPct.padStart(3)}%`
                );
            }
        }

        // Player analysis
        console.log('\n--- PLAYER PURCHASE ANALYSIS ---');
        const byPlayer = {};
        for (const a of auctions) {
            if (a.buyerId === null) continue;

            if (!byPlayer[a.buyerId]) {
                byPlayer[a.buyerId] = {
                    name: a.buyerName,
                    purchases: 0,
                    totalSpent: 0,
                    totalFaceValue: 0,
                    contested: 0
                };
            }
            byPlayer[a.buyerId].purchases++;
            byPlayer[a.buyerId].totalSpent += a.purchasePrice;
            byPlayer[a.buyerId].totalFaceValue += a.faceValue;
            if (a.contested) byPlayer[a.buyerId].contested++;
        }

        console.log('Player       Purchases  TotalSpent  AvgPrice  %Face  Contested%');
        console.log('-'.repeat(65));

        for (const [id, data] of Object.entries(byPlayer)) {
            const avgPrice = data.totalSpent / data.purchases;
            const avgFace = data.totalFaceValue / data.purchases;
            const pctFace = (avgPrice / avgFace * 100).toFixed(0);
            const contestedPct = (data.contested / data.purchases * 100).toFixed(0);

            console.log(
                `${data.name.padEnd(12)} ${data.purchases.toString().padStart(5)}      ` +
                `$${data.totalSpent.toString().padStart(5)}     $${avgPrice.toFixed(0).padStart(4)}    ` +
                `${pctFace.padStart(3)}%       ${contestedPct.padStart(3)}%`
            );
        }

        // Price by game phase
        console.log('\n--- PRICE BY GAME PHASE ---');
        const phases = { early: [], mid: [], late: [] };

        for (const a of auctions) {
            if (a.buyerId === null) continue;

            if (a.turn <= 20) {
                phases.early.push(a);
            } else if (a.turn <= 50) {
                phases.mid.push(a);
            } else {
                phases.late.push(a);
            }
        }

        console.log('Phase    Auctions  AvgPrice  %Face  Contested%');
        console.log('-'.repeat(50));

        for (const [phase, list] of Object.entries(phases)) {
            if (list.length === 0) continue;

            const avgPrice = list.reduce((s, a) => s + a.purchasePrice, 0) / list.length;
            const avgFace = list.reduce((s, a) => s + a.faceValue, 0) / list.length;
            const pctFace = (avgPrice / avgFace * 100).toFixed(0);
            const contested = list.filter(a => a.contested).length;
            const contestedPct = (contested / list.length * 100).toFixed(0);

            console.log(
                `${phase.padEnd(8)} ${list.length.toString().padStart(5)}     ` +
                `$${avgPrice.toFixed(0).padStart(4)}    ${pctFace.padStart(3)}%       ${contestedPct.padStart(3)}%`
            );
        }
    }

    /**
     * Print monopoly formation and win rate analysis
     */
    printMonopolyAnalysis(results) {
        const monoStats = results.monopolyStats;
        if (!monoStats || Object.keys(monoStats).length === 0) {
            console.log(`\n${'='.repeat(70)}`);
            console.log('MONOPOLY ANALYSIS');
            console.log(`${'='.repeat(70)}`);
            console.log('\n(No monopolies formed in these games)');
            return;
        }

        console.log(`\n${'='.repeat(70)}`);
        console.log('MONOPOLY ANALYSIS');
        console.log(`${'='.repeat(70)}`);

        // Sort by formation frequency
        const groupOrder = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

        console.log('\n--- MONOPOLY FORMATION & WIN RATES ---');
        console.log('Group        Formed  ByTrade%  Wins  WinRate  AvgTurn');
        console.log('-'.repeat(60));

        let totalFormed = 0;
        let totalWins = 0;

        for (const group of groupOrder) {
            const data = monoStats[group];
            if (data && data.timesFormed > 0) {
                totalFormed += data.timesFormed;
                totalWins += data.wins;

                const winRate = (data.wins / data.timesFormed * 100).toFixed(0);
                const avgTurn = data.turnFormed.reduce((a, b) => a + b, 0) / data.turnFormed.length;
                const tradeRate = (data.byTrade / data.timesFormed * 100).toFixed(0);

                console.log(
                    `${group.padEnd(12)} ${String(data.timesFormed).padStart(5)}   ` +
                    `${tradeRate.padStart(5)}%   ${String(data.wins).padStart(4)}   ` +
                    `${winRate.padStart(5)}%  ${avgTurn.toFixed(1).padStart(7)}`
                );
            } else {
                console.log(`${group.padEnd(12)}     0       -      0       -        -`);
            }
        }

        console.log('-'.repeat(60));
        const overallWinRate = totalFormed > 0 ? (totalWins / totalFormed * 100).toFixed(0) : 0;
        console.log(`${'TOTAL'.padEnd(12)} ${String(totalFormed).padStart(5)}           ${String(totalWins).padStart(4)}   ${overallWinRate.padStart(5)}%`);

        // Key insights
        console.log('\n--- KEY MONOPOLY INSIGHTS ---');

        // Most formed
        const sortedByFormed = Object.entries(monoStats)
            .sort((a, b) => b[1].timesFormed - a[1].timesFormed);
        if (sortedByFormed.length > 0) {
            const [topGroup, topData] = sortedByFormed[0];
            console.log(`  Most formed: ${topGroup} (${topData.timesFormed} times)`);
        }

        // Best win rate (min 10 formations)
        const sortedByWinRate = Object.entries(monoStats)
            .filter(([_, d]) => d.timesFormed >= 10)
            .sort((a, b) => (b[1].wins / b[1].timesFormed) - (a[1].wins / a[1].timesFormed));
        if (sortedByWinRate.length > 0) {
            const [bestGroup, bestData] = sortedByWinRate[0];
            const bestWR = (bestData.wins / bestData.timesFormed * 100).toFixed(0);
            console.log(`  Best win rate: ${bestGroup} (${bestWR}% from ${bestData.timesFormed} formations)`);
        }

        // Worst win rate (min 10 formations)
        if (sortedByWinRate.length > 1) {
            const [worstGroup, worstData] = sortedByWinRate[sortedByWinRate.length - 1];
            const worstWR = (worstData.wins / worstData.timesFormed * 100).toFixed(0);
            console.log(`  Worst win rate: ${worstGroup} (${worstWR}% from ${worstData.timesFormed} formations)`);
        }

        // Earliest average formation
        const sortedByTurn = Object.entries(monoStats)
            .filter(([_, d]) => d.timesFormed >= 5)
            .sort((a, b) => {
                const avgA = a[1].turnFormed.reduce((x, y) => x + y, 0) / a[1].turnFormed.length;
                const avgB = b[1].turnFormed.reduce((x, y) => x + y, 0) / b[1].turnFormed.length;
                return avgA - avgB;
            });
        if (sortedByTurn.length > 0) {
            const [earlyGroup, earlyData] = sortedByTurn[0];
            const earlyTurn = earlyData.turnFormed.reduce((a, b) => a + b, 0) / earlyData.turnFormed.length;
            console.log(`  Earliest formed: ${earlyGroup} (avg turn ${earlyTurn.toFixed(1)})`);
        }

        // Monopoly Trades (upgrades/downgrades)
        const trades = results.monopolyTrades;
        if (trades && trades.total > 0) {
            console.log('\n--- MONOPOLY TRADES (Upgrades/Downgrades) ---');
            console.log(`Total monopolies traded away: ${trades.total}`);
            console.log(`  Upgrades (sold lower, got higher): ${trades.upgrades}`);
            console.log(`  Downgrades (sold higher, got lower): ${trades.downgrades}`);
            console.log(`  Sold without gaining new monopoly: ${trades.total - trades.upgrades - trades.downgrades}`);

            if (trades.upgrades > 0) {
                const upgradeWinRate = (trades.upgradeWins / trades.upgrades * 100).toFixed(0);
                console.log(`\n  Upgrade win rate: ${upgradeWinRate}% (${trades.upgradeWins}/${trades.upgrades})`);
            }
            if (trades.downgrades > 0) {
                const downgradeWinRate = (trades.downgradeWins / trades.downgrades * 100).toFixed(0);
                console.log(`  Downgrade win rate: ${downgradeWinRate}% (${trades.downgradeWins}/${trades.downgrades})`);
            }

            // By group sold
            console.log('\n  Monopolies sold (by group):');
            console.log('  SoldGroup     Times  Wins  WinRate  UpgradedTo');
            console.log('  ' + '-'.repeat(55));

            const groupOrder = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];
            for (const group of groupOrder) {
                const data = trades.byGroup[group];
                if (data && data.times > 0) {
                    const winRate = (data.wins / data.times * 100).toFixed(0);
                    const upgradedTo = Object.entries(data.upgradedTo)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([g, c]) => `${g}(${c})`)
                        .join(', ') || '-';

                    console.log(
                        `  ${group.padEnd(12)} ${String(data.times).padStart(5)}  ` +
                        `${String(data.wins).padStart(4)}   ${winRate.padStart(5)}%  ${upgradedTo}`
                    );
                }
            }

            // Key insight
            console.log('\n  KEY INSIGHT:');
            const brownTrades = trades.byGroup['brown'];
            if (brownTrades && brownTrades.times > 0) {
                const brownWinRate = (brownTrades.wins / brownTrades.times * 100).toFixed(0);
                console.log(`  Players who traded away brown monopoly: ${brownTrades.times} times, ${brownWinRate}% win rate`);
                if (brownTrades.upgradedTo && Object.keys(brownTrades.upgradedTo).length > 0) {
                    const topUpgrade = Object.entries(brownTrades.upgradedTo)
                        .sort((a, b) => b[1] - a[1])[0];
                    if (topUpgrade) {
                        console.log(`  Most common upgrade from brown: ${topUpgrade[0]} (${topUpgrade[1]} times)`);
                    }
                }
            } else {
                console.log('  No brown monopolies were traded away (no upgrade attempts observed)');
            }
        } else {
            console.log('\n--- MONOPOLY TRADES ---');
            console.log('(No monopolies were traded away in these games)');
        }
    }

    /**
     * Print debt analysis
     */
    printDebtAnalysis(results) {
        const stats = results.debtStats;
        if (!stats || stats.length === 0) return;

        console.log(`\n${'='.repeat(70)}`);
        console.log('DEBT ANALYSIS');
        console.log(`${'='.repeat(70)}`);

        console.log('\n--- DEBT USAGE BY PLAYER ---');
        console.log('Player       Mortgages  Unmortgages  AvgPeak  MaxPeak  %WithDebt  %EndInDebt');
        console.log('-'.repeat(80));

        for (let i = 0; i < stats.length; i++) {
            const s = stats[i];
            const avgPeak = s.gamesWithDebt > 0 ? s.totalPeakDebt / results.games : 0;
            const pctWithDebt = (s.gamesWithDebt / results.games * 100).toFixed(0);
            const pctEndInDebt = (s.gamesEndedInDebt / results.games * 100).toFixed(0);

            console.log(
                `Player ${i + 1}     ` +
                `${(s.totalMortgages / results.games).toFixed(1).padStart(6)}/game  ` +
                `${(s.totalUnmortgages / results.games).toFixed(1).padStart(6)}/game   ` +
                `$${avgPeak.toFixed(0).padStart(4)}   $${s.maxPeakDebt.toString().padStart(4)}      ` +
                `${pctWithDebt.padStart(3)}%        ${pctEndInDebt.padStart(3)}%`
            );
        }

        // Debt vs Winning correlation
        console.log('\n--- DEBT VS WINNING ---');
        console.log('Player       WinRate  AvgPeakWhenWon  AvgPeakWhenLost  Debt Recovery%');
        console.log('-'.repeat(75));

        for (let i = 0; i < stats.length; i++) {
            const s = stats[i];
            const winRate = (results.wins[i] / results.games * 100).toFixed(1);

            const avgPeakWon = s.winnerPeakDebts.length > 0 ?
                s.winnerPeakDebts.reduce((a, b) => a + b, 0) / s.winnerPeakDebts.length : 0;
            const avgPeakLost = s.loserPeakDebts.length > 0 ?
                s.loserPeakDebts.reduce((a, b) => a + b, 0) / s.loserPeakDebts.length : 0;

            const recoveryRate = s.timesWentIntoDebt > 0 ?
                (s.timesRecovered / s.timesWentIntoDebt * 100).toFixed(0) : 'N/A';

            console.log(
                `Player ${i + 1}     ${winRate.padStart(5)}%     ` +
                `$${avgPeakWon.toFixed(0).padStart(4)}           ` +
                `$${avgPeakLost.toFixed(0).padStart(4)}             ` +
                `${typeof recoveryRate === 'string' ? recoveryRate.padStart(4) : recoveryRate.padStart(3) + '%'}`
            );
        }

        // Summary insights
        console.log('\n--- DEBT INSIGHTS ---');

        // Find player with most debt usage
        const mostDebt = stats.reduce((max, s, i) =>
            s.totalPeakDebt > stats[max].totalPeakDebt ? i : max, 0);
        const leastDebt = stats.reduce((min, s, i) =>
            s.totalPeakDebt < stats[min].totalPeakDebt ? i : min, 0);

        console.log(`  Most debt usage: Player ${mostDebt + 1} (${results.aiTypes[mostDebt]})`);
        console.log(`  Least debt usage: Player ${leastDebt + 1} (${results.aiTypes[leastDebt]})`);

        // Check if debt correlates with winning
        const winnerAvgDebt = stats.reduce((sum, s) => {
            if (s.winnerPeakDebts.length === 0) return sum;
            return sum + s.winnerPeakDebts.reduce((a, b) => a + b, 0) / s.winnerPeakDebts.length;
        }, 0) / stats.length;

        const loserAvgDebt = stats.reduce((sum, s) => {
            if (s.loserPeakDebts.length === 0) return sum;
            return sum + s.loserPeakDebts.reduce((a, b) => a + b, 0) / s.loserPeakDebts.length;
        }, 0) / stats.length;

        console.log(`  Average peak debt when winning: $${winnerAvgDebt.toFixed(0)}`);
        console.log(`  Average peak debt when losing: $${loserAvgDebt.toFixed(0)}`);

        if (winnerAvgDebt > loserAvgDebt * 1.1) {
            console.log(`  INSIGHT: Winners use MORE debt (+${((winnerAvgDebt / loserAvgDebt - 1) * 100).toFixed(0)}%) - aggressive leverage pays off`);
        } else if (loserAvgDebt > winnerAvgDebt * 1.1) {
            console.log(`  INSIGHT: Losers use MORE debt (+${((loserAvgDebt / winnerAvgDebt - 1) * 100).toFixed(0)}%) - over-leveraging hurts`);
        } else {
            console.log(`  INSIGHT: Debt usage similar between winners and losers`);
        }
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    AuctionGameEngine,
    AuctionAnalytics,
    AuctionSimulationRunner
};

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (require.main === module) {
    const runner = new AuctionSimulationRunner({
        games: 200,
        maxTurns: 500,
        verbose: false
    });

    // Default: run with top trading AIs
    runner.runSimulation(['relative', 'growth', 'leader', 'trading'], 200);
}
