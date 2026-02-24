/**
 * Monopoly Formation Tracker
 *
 * Tracks HOW monopolies form:
 * 1. Natural acquisition (same player lands on all properties)
 * 2. Direct trade (mutual monopoly swap - I have your 3rd, you have mine)
 * 3. Enabled trade (a prior trade created the conditions for this trade)
 * 4. Multi-party trade (3+ players involved)
 *
 * Also tracks the "formation probability" based on group size:
 * - 2-property groups: Higher natural formation rate
 * - 3-property groups: Usually require trades
 *
 * Key questions to answer:
 * - What % of monopolies form naturally vs via trade?
 * - Do 2-property groups form more naturally?
 * - Are trades enabling other trades? (upgrade potential)
 * - What's the typical "trade chain" depth?
 */

'use strict';

const { GameEngine, BOARD } = require('./game-engine.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');
const { EnhancedRelativeAI } = require('./enhanced-relative-ai.js');

// Color group definitions
const COLOR_GROUPS = {
    brown: { positions: [1, 3], size: 2 },
    lightBlue: { positions: [6, 8, 9], size: 3 },
    pink: { positions: [11, 13, 14], size: 3 },
    orange: { positions: [16, 18, 19], size: 3 },
    red: { positions: [21, 23, 24], size: 3 },
    yellow: { positions: [26, 27, 29], size: 3 },
    green: { positions: [31, 32, 34], size: 3 },
    darkBlue: { positions: [37, 39], size: 2 }
};

// Reverse lookup: position -> group
const POSITION_TO_GROUP = {};
for (const [group, data] of Object.entries(COLOR_GROUPS)) {
    for (const pos of data.positions) {
        POSITION_TO_GROUP[pos] = group;
    }
}

class FormationTracker {
    constructor() {
        this.reset();
    }

    reset() {
        // Track property ownership history
        this.propertyHistory = {};  // position -> [{turn, player, method}]

        // Track monopoly formations
        this.formations = [];  // {group, player, turn, method, details}

        // Track trades
        this.trades = [];  // {turn, from, to, propsGiven, propsReceived, cashDiff, enabledBy}

        // Track what trades enabled what
        this.tradeEnablers = {};  // tradeIndex -> [enabled trade indices]

        // Pre-trade state snapshots (to detect what changed)
        this.preTradeOwnership = null;

        // Current turn
        this.currentTurn = 0;

        // NEW: Enhanced tracking
        // Track group completion state at trade time
        this.groupStatesAtTrade = [];  // {tradeIndex, groupCompleteness: {group -> {player -> count}}}

        // Track which properties "unlocked" monopolies in chains
        this.chainUnlockers = [];  // {property, fromGroup, enabledGroup, tradeIndex, chainIndex}

        // Track timing between chain trades
        this.chainTimings = [];  // {chainIndex, trades: [{tradeIndex, turn}], totalDuration}
    }

    /**
     * Record a property acquisition
     */
    recordAcquisition(position, playerId, method, turn) {
        if (!this.propertyHistory[position]) {
            this.propertyHistory[position] = [];
        }

        this.propertyHistory[position].push({
            turn,
            player: playerId,
            method  // 'landing', 'auction', 'trade'
        });

        // Check if this completes a monopoly
        const group = POSITION_TO_GROUP[position];
        if (group) {
            this.checkMonopolyFormation(playerId, group, turn, method);
        }
    }

    /**
     * Take a snapshot of current ownership before a trade
     */
    snapshotOwnership(players) {
        this.preTradeOwnership = {};
        for (const player of players) {
            const playerProps = player.properties instanceof Set ?
                [...player.properties] : (player.properties || []);
            this.preTradeOwnership[player.id] = {
                properties: playerProps,
                monopolies: this.getPlayerMonopolies(player)
            };
        }
    }

    /**
     * Get monopolies a player currently has
     */
    getPlayerMonopolies(player) {
        const monopolies = [];
        const playerProps = player.properties instanceof Set ?
            [...player.properties] : (player.properties || []);

        for (const [group, data] of Object.entries(COLOR_GROUPS)) {
            const owned = data.positions.filter(p => playerProps.includes(p));
            if (owned.length === data.size) {
                monopolies.push(group);
            }
        }
        return monopolies;
    }

    /**
     * Get properties a player owns in each group
     */
    getPlayerGroupOwnership(player) {
        const ownership = {};
        for (const [group, data] of Object.entries(COLOR_GROUPS)) {
            ownership[group] = data.positions.filter(p => player.properties.includes(p));
        }
        return ownership;
    }

    /**
     * Get group completeness for all players (how many of each group each player owns)
     */
    getGroupCompleteness(players) {
        const completeness = {};
        for (const [group, data] of Object.entries(COLOR_GROUPS)) {
            completeness[group] = {};
            for (const player of players) {
                const playerProps = player.properties instanceof Set ?
                    [...player.properties] : (player.properties || []);
                const owned = data.positions.filter(p => playerProps.includes(p)).length;
                completeness[group][player.id] = owned;
            }
        }
        return completeness;
    }

    /**
     * Record a trade and analyze what it enabled
     */
    recordTrade(trade, players, turn) {
        const fromPlayer = players.find(p => p.id === trade.from);
        const toPlayer = players.find(p => p.id === trade.to);

        // What monopolies existed before?
        const fromMonopoliesBefore = this.preTradeOwnership[trade.from].monopolies;
        const toMonopoliesBefore = this.preTradeOwnership[trade.to].monopolies;

        // What monopolies exist after?
        const fromMonopoliesAfter = this.getPlayerMonopolies(fromPlayer);
        const toMonopoliesAfter = this.getPlayerMonopolies(toPlayer);

        // What changed?
        const fromGained = fromMonopoliesAfter.filter(m => !fromMonopoliesBefore.includes(m));
        const fromLost = fromMonopoliesBefore.filter(m => !fromMonopoliesAfter.includes(m));
        const toGained = toMonopoliesAfter.filter(m => !toMonopoliesBefore.includes(m));
        const toLost = toMonopoliesBefore.filter(m => !toMonopoliesAfter.includes(m));

        // Classify the trade
        let tradeType = 'property_swap';  // default

        if (fromGained.length > 0 && toGained.length > 0) {
            tradeType = 'mutual_monopoly';  // Both completed monopolies
        } else if (fromGained.length > 0 || toGained.length > 0) {
            tradeType = 'one_sided_monopoly';  // Only one side completed
        }

        // Check if this trade was enabled by a previous trade
        let enabledBy = null;
        if (this.trades.length > 0) {
            enabledBy = this.findEnablingTrade(trade, fromPlayer, toPlayer);
        }

        // NEW: Capture group completeness at trade time
        const groupCompleteness = this.getGroupCompleteness(players);

        // NEW: Identify which specific properties enabled which monopolies
        const unlockingProperties = [];
        for (const group of fromGained) {
            // Which property was received that completed this?
            const groupPositions = COLOR_GROUPS[group].positions;
            const receivedInGroup = (trade.propertiesReceived || []).filter(p => groupPositions.includes(p));
            for (const prop of receivedInGroup) {
                unlockingProperties.push({
                    property: prop,
                    propertyGroup: POSITION_TO_GROUP[prop],
                    enabledGroup: group,
                    beneficiary: trade.from
                });
            }
        }
        for (const group of toGained) {
            const groupPositions = COLOR_GROUPS[group].positions;
            const givenInGroup = (trade.propertiesGiven || []).filter(p => groupPositions.includes(p));
            for (const prop of givenInGroup) {
                unlockingProperties.push({
                    property: prop,
                    propertyGroup: POSITION_TO_GROUP[prop],
                    enabledGroup: group,
                    beneficiary: trade.to
                });
            }
        }

        const tradeRecord = {
            index: this.trades.length,
            turn,
            from: trade.from,
            to: trade.to,
            propsGiven: trade.propertiesGiven || [],
            propsReceived: trade.propertiesReceived || [],
            cashDiff: (trade.cashOffered || 0) - (trade.cashRequested || 0),
            tradeType,
            fromGained,
            fromLost,
            toGained,
            toLost,
            enabledBy,
            // NEW fields
            groupCompletenessSnapshot: groupCompleteness,
            unlockingProperties
        };

        this.trades.push(tradeRecord);

        // Store group state for analysis
        this.groupStatesAtTrade.push({
            tradeIndex: tradeRecord.index,
            turn,
            groupCompleteness
        });

        // Record property transfers
        for (const prop of (trade.propertiesGiven || [])) {
            this.recordAcquisition(prop, trade.to, 'trade', turn);
        }
        for (const prop of (trade.propertiesReceived || [])) {
            this.recordAcquisition(prop, trade.from, 'trade', turn);
        }

        // If this trade enabled a monopoly, record it
        for (const group of fromGained) {
            this.formations.push({
                group,
                player: trade.from,
                turn,
                method: 'trade',
                tradeType,
                tradeIndex: tradeRecord.index,
                enabledBy
            });
        }
        for (const group of toGained) {
            this.formations.push({
                group,
                player: trade.to,
                turn,
                method: 'trade',
                tradeType,
                tradeIndex: tradeRecord.index,
                enabledBy
            });
        }

        return tradeRecord;
    }

    /**
     * Check if a previous trade enabled this one
     * A trade is "enabling" if it moved properties that made this trade possible
     */
    findEnablingTrade(currentTrade, fromPlayer, toPlayer) {
        // Look at recent trades (last 10)
        const recentTrades = this.trades.slice(-10);

        for (const prevTrade of recentTrades) {
            // Did the previous trade give either player properties they're now trading?
            const propsInCurrent = [
                ...(currentTrade.propertiesGiven || []),
                ...(currentTrade.propertiesReceived || [])
            ];

            const propsFromPrev = [
                ...(prevTrade.propsGiven || []),
                ...(prevTrade.propsReceived || [])
            ];

            // Check if any properties that moved in prev trade are being traded now
            const overlap = propsInCurrent.filter(p => propsFromPrev.includes(p));
            if (overlap.length > 0) {
                return {
                    tradeIndex: prevTrade.index,
                    sharedProperties: overlap
                };
            }

            // Also check if prev trade involved same players and changed their group ownership
            // in a way that enabled this trade
            if (prevTrade.from === currentTrade.from || prevTrade.to === currentTrade.from ||
                prevTrade.from === currentTrade.to || prevTrade.to === currentTrade.to) {
                // Same players involved - could be part of a chain
                if (prevTrade.turn < this.currentTurn - 1) {
                    // Not immediately consecutive, might be enabling
                    return {
                        tradeIndex: prevTrade.index,
                        reason: 'same_players_chain'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Check if a player just completed a monopoly naturally
     */
    checkMonopolyFormation(playerId, group, turn, method) {
        // Only check natural formations here (trades handled separately)
        if (method === 'trade') return;

        const groupData = COLOR_GROUPS[group];

        // Count how many of this group the player owns
        const history = groupData.positions.map(p => this.propertyHistory[p] || []);

        // Get current owner of each position
        const currentOwners = groupData.positions.map(p => {
            const h = this.propertyHistory[p];
            return h && h.length > 0 ? h[h.length - 1].player : null;
        });

        // Check if all owned by same player
        if (currentOwners.every(o => o === playerId)) {
            // Check if this is a new formation (not already recorded)
            const alreadyRecorded = this.formations.some(
                f => f.group === group && f.player === playerId
            );

            if (!alreadyRecorded) {
                this.formations.push({
                    group,
                    player: playerId,
                    turn,
                    method: 'natural',  // All acquired via landing/auction
                    tradeType: null,
                    tradeIndex: null,
                    enabledBy: null
                });
            }
        }
    }

    /**
     * Generate formation statistics
     */
    getStatistics() {
        const stats = {
            totalFormations: this.formations.length,
            naturalFormations: 0,
            tradeFormations: 0,
            mutualMonopolyTrades: 0,
            oneSidedTrades: 0,
            enabledTrades: 0,
            byGroup: {},
            byGroupSize: { two: { natural: 0, trade: 0 }, three: { natural: 0, trade: 0 } },
            tradeChains: [],
            averageTradeChainLength: 0,
            // New tracking
            tradeBait: {},           // position -> { timesMoved, players: Set }
            firstMover: [],          // { playerId, wasInitiator, gotMonopoly, tradeIndex }
            tradesByPlayer: {},      // playerId -> { initiated, received, monopoliesGained }
            propertyJourneys: {},    // position -> [{ from, to, turn, tradeIndex }]
            positioningTrades: 0,    // Trades that didn't complete monopolies
            chainParticipants: {},   // playerId -> { chainsParticipated, chainsInitiated }
            formations: this.formations  // Include raw formations for winner analysis
        };

        // Initialize group stats
        for (const group of Object.keys(COLOR_GROUPS)) {
            stats.byGroup[group] = { natural: 0, trade: 0, total: 0 };
        }

        // Analyze formations
        for (const f of this.formations) {
            const groupSize = COLOR_GROUPS[f.group].size;
            const sizeKey = groupSize === 2 ? 'two' : 'three';

            stats.byGroup[f.group].total++;

            if (f.method === 'natural') {
                stats.naturalFormations++;
                stats.byGroup[f.group].natural++;
                stats.byGroupSize[sizeKey].natural++;
            } else {
                stats.tradeFormations++;
                stats.byGroup[f.group].trade++;
                stats.byGroupSize[sizeKey].trade++;

                if (f.tradeType === 'mutual_monopoly') {
                    stats.mutualMonopolyTrades++;
                } else {
                    stats.oneSidedTrades++;
                }

                if (f.enabledBy) {
                    stats.enabledTrades++;
                }
            }
        }

        // Analyze trade chains
        const chainStarts = this.trades.filter(t => !t.enabledBy);
        for (const start of chainStarts) {
            const chain = this.buildTradeChain(start.index);
            if (chain.length > 1) {
                stats.tradeChains.push(chain);
            }
        }

        if (stats.tradeChains.length > 0) {
            stats.averageTradeChainLength =
                stats.tradeChains.reduce((sum, c) => sum + c.length, 0) / stats.tradeChains.length;
        }

        // === NEW ANALYSIS ===

        // 1. Trade Bait Analysis - which properties move multiple times
        for (const trade of this.trades) {
            const allProps = [...trade.propsGiven, ...trade.propsReceived];
            for (const prop of allProps) {
                if (!stats.tradeBait[prop]) {
                    stats.tradeBait[prop] = { timesMoved: 0, players: new Set() };
                }
                stats.tradeBait[prop].timesMoved++;
                stats.tradeBait[prop].players.add(trade.from);
                stats.tradeBait[prop].players.add(trade.to);
            }
        }

        // 2. First Mover Analysis & Trade-by-Player stats
        for (const trade of this.trades) {
            // Track initiator (from) and receiver (to)
            if (!stats.tradesByPlayer[trade.from]) {
                stats.tradesByPlayer[trade.from] = { initiated: 0, received: 0, monopoliesGained: 0 };
            }
            if (!stats.tradesByPlayer[trade.to]) {
                stats.tradesByPlayer[trade.to] = { initiated: 0, received: 0, monopoliesGained: 0 };
            }

            stats.tradesByPlayer[trade.from].initiated++;
            stats.tradesByPlayer[trade.to].received++;

            // Track monopoly gains
            stats.tradesByPlayer[trade.from].monopoliesGained += trade.fromGained.length;
            stats.tradesByPlayer[trade.to].monopoliesGained += trade.toGained.length;

            // First mover record
            stats.firstMover.push({
                playerId: trade.from,
                wasInitiator: true,
                gotMonopoly: trade.fromGained.length > 0,
                opponentGotMonopoly: trade.toGained.length > 0,
                tradeIndex: trade.index,
                tradeType: trade.tradeType
            });

            // Positioning trade (no monopolies formed)
            if (trade.fromGained.length === 0 && trade.toGained.length === 0) {
                stats.positioningTrades++;
            }
        }

        // 3. Property Journeys - track each property's movement history
        for (const trade of this.trades) {
            for (const prop of trade.propsGiven) {
                if (!stats.propertyJourneys[prop]) {
                    stats.propertyJourneys[prop] = [];
                }
                stats.propertyJourneys[prop].push({
                    from: trade.from,
                    to: trade.to,
                    turn: trade.turn,
                    tradeIndex: trade.index
                });
            }
            for (const prop of trade.propsReceived) {
                if (!stats.propertyJourneys[prop]) {
                    stats.propertyJourneys[prop] = [];
                }
                stats.propertyJourneys[prop].push({
                    from: trade.to,
                    to: trade.from,
                    turn: trade.turn,
                    tradeIndex: trade.index
                });
            }
        }

        // 4. Chain Participation
        for (const chain of stats.tradeChains) {
            const participants = new Set();
            let initiator = null;

            for (let i = 0; i < chain.length; i++) {
                const trade = this.trades[chain[i]];
                if (trade) {
                    participants.add(trade.from);
                    participants.add(trade.to);
                    if (i === 0) {
                        initiator = trade.from;
                    }
                }
            }

            for (const playerId of participants) {
                if (!stats.chainParticipants[playerId]) {
                    stats.chainParticipants[playerId] = { chainsParticipated: 0, chainsInitiated: 0 };
                }
                stats.chainParticipants[playerId].chainsParticipated++;
                if (playerId === initiator) {
                    stats.chainParticipants[playerId].chainsInitiated++;
                }
            }
        }

        // === ADDITIONAL ANALYSIS ===

        // 5. Chain Timing Analysis
        stats.chainTimings = [];
        for (let chainIdx = 0; chainIdx < stats.tradeChains.length; chainIdx++) {
            const chain = stats.tradeChains[chainIdx];
            const tradeTurns = chain.map(tradeIdx => this.trades[tradeIdx]?.turn).filter(t => t !== undefined);

            if (tradeTurns.length >= 2) {
                const minTurn = Math.min(...tradeTurns);
                const maxTurn = Math.max(...tradeTurns);
                const duration = maxTurn - minTurn;

                // Calculate gaps between consecutive trades
                const gaps = [];
                for (let i = 1; i < tradeTurns.length; i++) {
                    gaps.push(tradeTurns[i] - tradeTurns[i - 1]);
                }

                stats.chainTimings.push({
                    chainIndex: chainIdx,
                    chainLength: chain.length,
                    startTurn: minTurn,
                    endTurn: maxTurn,
                    duration,
                    gaps,
                    avgGap: gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
                });
            }
        }

        // 6. Unlocking Properties Analysis - which properties enable monopolies
        stats.unlockingProperties = {};  // property -> { timesUnlocked, enabledGroups: {} }
        for (const trade of this.trades) {
            if (trade.unlockingProperties) {
                for (const unlock of trade.unlockingProperties) {
                    if (!stats.unlockingProperties[unlock.property]) {
                        stats.unlockingProperties[unlock.property] = {
                            timesUnlocked: 0,
                            enabledGroups: {},
                            fromGroup: unlock.propertyGroup
                        };
                    }
                    stats.unlockingProperties[unlock.property].timesUnlocked++;
                    const eg = unlock.enabledGroup;
                    stats.unlockingProperties[unlock.property].enabledGroups[eg] =
                        (stats.unlockingProperties[unlock.property].enabledGroups[eg] || 0) + 1;
                }
            }
        }

        // 7. Group Completeness at Trade Time - how "ready" were groups when trades happened
        stats.groupReadiness = {};  // group -> { avgCompletenessWhenTraded, tradesAt1, tradesAt2, etc }
        for (const group of Object.keys(COLOR_GROUPS)) {
            stats.groupReadiness[group] = {
                tradesInvolving: 0,
                completenessDistribution: {},  // count -> frequency
                avgMaxCompleteness: 0
            };
        }

        for (const stateRecord of this.groupStatesAtTrade) {
            for (const [group, playerCounts] of Object.entries(stateRecord.groupCompleteness)) {
                const maxCount = Math.max(...Object.values(playerCounts));
                if (maxCount > 0 && maxCount < COLOR_GROUPS[group].size) {
                    // Group was partially complete but not monopolized
                    stats.groupReadiness[group].tradesInvolving++;
                    stats.groupReadiness[group].completenessDistribution[maxCount] =
                        (stats.groupReadiness[group].completenessDistribution[maxCount] || 0) + 1;
                }
            }
        }

        // Calculate average max completeness for each group
        for (const group of Object.keys(COLOR_GROUPS)) {
            const dist = stats.groupReadiness[group].completenessDistribution;
            let total = 0;
            let count = 0;
            for (const [completeness, freq] of Object.entries(dist)) {
                total += parseInt(completeness) * freq;
                count += freq;
            }
            stats.groupReadiness[group].avgMaxCompleteness = count > 0 ? total / count : 0;
        }

        // 8. "Accidental" vs "Intentional" Monopoly Correlation
        // Track which groups form as a side effect of trading other groups
        stats.accidentalMonopolies = {};  // group -> times formed when trading different group properties
        for (const trade of this.trades) {
            const tradedGroups = new Set();
            for (const prop of [...trade.propsGiven, ...trade.propsReceived]) {
                const g = POSITION_TO_GROUP[prop];
                if (g) tradedGroups.add(g);
            }

            // Check if any monopoly was gained in a group NOT being directly traded
            for (const gained of [...trade.fromGained, ...trade.toGained]) {
                if (!tradedGroups.has(gained)) {
                    // This monopoly formed "accidentally" - properties in this group weren't traded
                    stats.accidentalMonopolies[gained] = (stats.accidentalMonopolies[gained] || 0) + 1;
                }
            }
        }

        return stats;
    }

    /**
     * Build a chain of trades starting from a given trade
     */
    buildTradeChain(startIndex) {
        const chain = [startIndex];

        // Find trades enabled by this one
        for (const trade of this.trades) {
            if (trade.enabledBy && trade.enabledBy.tradeIndex === startIndex) {
                const subchain = this.buildTradeChain(trade.index);
                chain.push(...subchain);
            }
        }

        return chain;
    }
}

/**
 * Enhanced Game Engine with Formation Tracking
 */
class FormationTrackingEngine extends GameEngine {
    constructor(options = {}) {
        super(options);
        this.formationTracker = new FormationTracker();
    }

    /**
     * Override newGame to reset tracker
     */
    newGame(numPlayers, aiFactories) {
        super.newGame(numPlayers, aiFactories);
        this.formationTracker.reset();
    }

    /**
     * Override handlePropertyPurchase to track acquisitions
     */
    handlePropertyPurchase(player, position) {
        const square = BOARD[position];
        if (!square || !square.price) return;

        // Determine if player wants to buy
        let wantsToBuy = true;
        if (player.ai && player.ai.decideBuy) {
            wantsToBuy = player.ai.decideBuy(position, this.state);
        } else {
            wantsToBuy = player.money >= square.price;
        }

        if (wantsToBuy && player.money >= square.price) {
            player.money -= square.price;
            player.properties.add(position);
            this.state.propertyStates[position].owner = player.id;
            this.log(`${player.name} bought ${square.name} for $${square.price}`);
            this.state.stats.propertiesBought[player.id]++;

            // Track acquisition
            this.formationTracker.recordAcquisition(position, player.id, 'landing', this.state.turn);
        } else {
            // Auction - track winner
            this.runAuctionWithTracking(position);
        }
    }

    /**
     * Override runAuction to track acquisitions
     */
    runAuction(position) {
        this.runAuctionWithTracking(position);
    }

    /**
     * Run auction with tracking
     */
    runAuctionWithTracking(position) {
        const square = BOARD[position];
        let highBid = 0;
        let highBidder = null;

        const bidders = [...this.state.getActivePlayers()];
        for (let i = bidders.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bidders[i], bidders[j]] = [bidders[j], bidders[i]];
        }

        const stillBidding = new Set(bidders.map(p => p.id));
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
                    const maxBid = Math.min(player.money - 50, square.price);
                    if (maxBid > highBid) {
                        bid = highBid + 10;
                    }
                }

                if (bid > highBid && bid <= player.money) {
                    highBid = bid;
                    highBidder = player;
                    anyBidThisRound = true;
                } else {
                    stillBidding.delete(player.id);
                }
            }

            if (!anyBidThisRound && highBidder) break;
        }

        if (highBidder && highBid > 0) {
            highBidder.money -= highBid;
            highBidder.properties.add(position);
            this.state.propertyStates[position].owner = highBidder.id;
            this.log(`${highBidder.name} won auction for ${square.name} at $${highBid}`);

            // Track acquisition
            this.formationTracker.recordAcquisition(position, highBidder.id, 'auction', this.state.turn);
        }
    }

    /**
     * Override trade execution to track
     */
    executeTrade(trade) {
        // Snapshot before trade
        this.formationTracker.snapshotOwnership(this.state.players);
        this.formationTracker.currentTurn = this.state.turn;

        const result = super.executeTrade(trade);

        if (result) {
            // Convert trade format for tracker
            const trackableTrade = {
                from: trade.from.id,
                to: trade.to.id,
                propertiesGiven: [...(trade.fromProperties || [])],
                propertiesReceived: [...(trade.toProperties || [])],
                cashOffered: trade.fromCash > 0 ? trade.fromCash : 0,
                cashRequested: trade.fromCash < 0 ? -trade.fromCash : 0
            };
            this.formationTracker.recordTrade(trackableTrade, this.state.players, this.state.turn);
        }

        return result;
    }

    /**
     * Get formation statistics for this game
     */
    getFormationStats() {
        return this.formationTracker.getStatistics();
    }
}

/**
 * Formation Analysis Runner
 */
class FormationAnalysisRunner {
    constructor(options = {}) {
        this.options = {
            games: options.games || 500,
            maxTurns: options.maxTurns || 200,
            verbose: options.verbose || false
        };

        // Initialize Markov engine and valuator
        this.markovEngine = null;
        this.valuator = null;

        try {
            const { MarkovEngine } = require('../../ai/markov-engine.js');
            const PropertyValuator = require('../../ai/property-valuator.js');

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
    }

    createAIFactory(type) {
        const self = this;

        switch (type) {
            case 'relative':
                return (player, engine) => new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
            case 'enhanced5':
            case 'enhanced':
                return (player, engine) => new EnhancedRelativeAI(player, engine, self.markovEngine, self.valuator, { baseBidPremium: 0.05 });
            case 'enhanced10':
                return (player, engine) => new EnhancedRelativeAI(player, engine, self.markovEngine, self.valuator, { baseBidPremium: 0.10 });
            default:
                return (player, engine) => new EnhancedRelativeAI(player, engine, self.markovEngine, self.valuator, { baseBidPremium: 0.05 });
        }
    }

    runSingleGame(aiTypes) {
        const engine = new FormationTrackingEngine({
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose
        });

        const numPlayers = aiTypes.length;
        const factories = aiTypes.map(type => this.createAIFactory(type));

        engine.newGame(numPlayers, factories);
        const result = engine.runGame();

        return {
            ...result,
            formationStats: engine.getFormationStats()
        };
    }

    runAnalysis(aiTypes = ['enhanced5', 'enhanced5', 'enhanced5', 'enhanced5']) {
        console.log('='.repeat(80));
        console.log('MONOPOLY FORMATION ANALYSIS');
        console.log(`Running ${this.options.games} games...`);
        console.log('='.repeat(80));

        const aggregateStats = {
            totalGames: 0,
            totalFormations: 0,
            naturalFormations: 0,
            tradeFormations: 0,
            mutualMonopolyTrades: 0,
            oneSidedTrades: 0,
            enabledTrades: 0,
            byGroup: {},
            byGroupSize: { two: { natural: 0, trade: 0 }, three: { natural: 0, trade: 0 } },
            tradeChains: [],
            gamesWithChains: 0,
            // New aggregate stats
            tradeBaitAggregate: {},      // position -> { timesMoved, uniquePlayers }
            firstMoverWins: 0,           // Times trade initiator won the game
            firstMoverTotal: 0,          // Total first-mover situations
            positioningTrades: 0,        // Trades with no monopoly formed
            totalTrades: 0,
            winnerTradeStats: {          // Stats about winners' trading behavior
                initiated: 0,
                received: 0,
                monopoliesFromTrade: 0,
                chainParticipation: 0,
                chainInitiation: 0
            },
            loserTradeStats: {
                initiated: 0,
                received: 0,
                monopoliesFromTrade: 0,
                chainParticipation: 0,
                chainInitiation: 0
            },
            firstMoverByOutcome: {       // Did initiator or receiver benefit more?
                initiatorGotMonopoly: 0,
                receiverGotMonopoly: 0,
                bothGotMonopoly: 0,
                neitherGotMonopoly: 0
            },
            // New enhanced stats
            chainTimingStats: {
                totalChains: 0,
                avgDuration: 0,
                avgGap: 0,
                quickChains: 0,    // <= 5 turns
                slowChains: 0      // > 10 turns
            },
            unlockingPropertiesAggregate: {},  // property -> { timesUnlocked, enabledGroups }
            groupReadinessAggregate: {},       // group -> avg completeness when traded
            accidentalMonopoliesAggregate: {}, // group -> count
            winningMonopolyGroups: {},         // group -> times winner had this monopoly
            losingMonopolyGroups: {}           // group -> times loser had this monopoly
        };

        // Initialize group stats
        for (const group of Object.keys(COLOR_GROUPS)) {
            aggregateStats.byGroup[group] = { natural: 0, trade: 0, total: 0 };
        }

        for (let game = 0; game < this.options.games; game++) {
            if (game % 100 === 0) {
                console.log(`Game ${game}/${this.options.games}...`);
            }

            const gameResult = this.runSingleGame(aiTypes);
            const stats = gameResult.formationStats;
            const winner = gameResult.winner;

            aggregateStats.totalGames++;
            aggregateStats.totalFormations += stats.totalFormations;
            aggregateStats.naturalFormations += stats.naturalFormations;
            aggregateStats.tradeFormations += stats.tradeFormations;
            aggregateStats.mutualMonopolyTrades += stats.mutualMonopolyTrades;
            aggregateStats.oneSidedTrades += stats.oneSidedTrades;
            aggregateStats.enabledTrades += stats.enabledTrades;
            aggregateStats.positioningTrades += stats.positioningTrades;
            aggregateStats.totalTrades += stats.firstMover.length;

            for (const [group, data] of Object.entries(stats.byGroup)) {
                aggregateStats.byGroup[group].natural += data.natural;
                aggregateStats.byGroup[group].trade += data.trade;
                aggregateStats.byGroup[group].total += data.total;
            }

            aggregateStats.byGroupSize.two.natural += stats.byGroupSize.two.natural;
            aggregateStats.byGroupSize.two.trade += stats.byGroupSize.two.trade;
            aggregateStats.byGroupSize.three.natural += stats.byGroupSize.three.natural;
            aggregateStats.byGroupSize.three.trade += stats.byGroupSize.three.trade;

            if (stats.tradeChains.length > 0) {
                aggregateStats.gamesWithChains++;
                aggregateStats.tradeChains.push(...stats.tradeChains);
            }

            // Trade bait aggregate
            for (const [pos, data] of Object.entries(stats.tradeBait)) {
                if (!aggregateStats.tradeBaitAggregate[pos]) {
                    aggregateStats.tradeBaitAggregate[pos] = { timesMoved: 0, gamesInvolved: 0 };
                }
                aggregateStats.tradeBaitAggregate[pos].timesMoved += data.timesMoved;
                aggregateStats.tradeBaitAggregate[pos].gamesInvolved++;
            }

            // First mover analysis
            for (const fm of stats.firstMover) {
                aggregateStats.firstMoverTotal++;
                if (fm.gotMonopoly && !fm.opponentGotMonopoly) {
                    aggregateStats.firstMoverByOutcome.initiatorGotMonopoly++;
                } else if (!fm.gotMonopoly && fm.opponentGotMonopoly) {
                    aggregateStats.firstMoverByOutcome.receiverGotMonopoly++;
                } else if (fm.gotMonopoly && fm.opponentGotMonopoly) {
                    aggregateStats.firstMoverByOutcome.bothGotMonopoly++;
                } else {
                    aggregateStats.firstMoverByOutcome.neitherGotMonopoly++;
                }

                // Did the initiator win?
                if (winner !== null && fm.playerId === winner) {
                    aggregateStats.firstMoverWins++;
                }
            }

            // Winner vs Loser trade stats
            if (winner !== null) {
                for (const [playerId, pStats] of Object.entries(stats.tradesByPlayer)) {
                    const id = parseInt(playerId);
                    const target = id === winner ? aggregateStats.winnerTradeStats : aggregateStats.loserTradeStats;
                    target.initiated += pStats.initiated;
                    target.received += pStats.received;
                    target.monopoliesFromTrade += pStats.monopoliesGained;
                }

                for (const [playerId, pStats] of Object.entries(stats.chainParticipants)) {
                    const id = parseInt(playerId);
                    const target = id === winner ? aggregateStats.winnerTradeStats : aggregateStats.loserTradeStats;
                    target.chainParticipation += pStats.chainsParticipated;
                    target.chainInitiation += pStats.chainsInitiated;
                }
            }

            // Chain timing aggregation
            for (const timing of stats.chainTimings) {
                aggregateStats.chainTimingStats.totalChains++;
                aggregateStats.chainTimingStats.avgDuration += timing.duration;
                aggregateStats.chainTimingStats.avgGap += timing.avgGap;
                if (timing.duration <= 5) {
                    aggregateStats.chainTimingStats.quickChains++;
                } else if (timing.duration > 10) {
                    aggregateStats.chainTimingStats.slowChains++;
                }
            }

            // Unlocking properties aggregation
            for (const [prop, data] of Object.entries(stats.unlockingProperties)) {
                if (!aggregateStats.unlockingPropertiesAggregate[prop]) {
                    aggregateStats.unlockingPropertiesAggregate[prop] = {
                        timesUnlocked: 0,
                        enabledGroups: {},
                        fromGroup: data.fromGroup
                    };
                }
                aggregateStats.unlockingPropertiesAggregate[prop].timesUnlocked += data.timesUnlocked;
                for (const [group, count] of Object.entries(data.enabledGroups)) {
                    aggregateStats.unlockingPropertiesAggregate[prop].enabledGroups[group] =
                        (aggregateStats.unlockingPropertiesAggregate[prop].enabledGroups[group] || 0) + count;
                }
            }

            // Group readiness aggregation
            for (const [group, data] of Object.entries(stats.groupReadiness)) {
                if (!aggregateStats.groupReadinessAggregate[group]) {
                    aggregateStats.groupReadinessAggregate[group] = { totalCompleteness: 0, count: 0 };
                }
                if (data.tradesInvolving > 0) {
                    aggregateStats.groupReadinessAggregate[group].totalCompleteness += data.avgMaxCompleteness * data.tradesInvolving;
                    aggregateStats.groupReadinessAggregate[group].count += data.tradesInvolving;
                }
            }

            // Accidental monopolies aggregation
            for (const [group, count] of Object.entries(stats.accidentalMonopolies)) {
                aggregateStats.accidentalMonopoliesAggregate[group] =
                    (aggregateStats.accidentalMonopoliesAggregate[group] || 0) + count;
            }

            // Track which monopolies winners/losers had (from formations)
            if (winner !== null) {
                for (const formation of stats.formations || []) {
                    if (formation.player === winner) {
                        aggregateStats.winningMonopolyGroups[formation.group] =
                            (aggregateStats.winningMonopolyGroups[formation.group] || 0) + 1;
                    } else {
                        aggregateStats.losingMonopolyGroups[formation.group] =
                            (aggregateStats.losingMonopolyGroups[formation.group] || 0) + 1;
                    }
                }
            }
        }

        this.printResults(aggregateStats);
        return aggregateStats;
    }

    printResults(stats) {
        const perGame = (val) => (val / stats.totalGames).toFixed(2);
        const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '0%';

        console.log('\n' + '='.repeat(80));
        console.log('FORMATION ANALYSIS RESULTS');
        console.log('='.repeat(80));

        console.log(`\nGames analyzed: ${stats.totalGames}`);
        console.log(`Total monopolies formed: ${stats.totalFormations} (${perGame(stats.totalFormations)}/game)`);

        console.log('\n--- Formation Methods ---');
        console.log(`Natural (landed on all): ${stats.naturalFormations} (${pct(stats.naturalFormations, stats.totalFormations)})`);
        console.log(`Via Trade: ${stats.tradeFormations} (${pct(stats.tradeFormations, stats.totalFormations)})`);
        console.log(`  - Mutual monopoly trades: ${stats.mutualMonopolyTrades}`);
        console.log(`  - One-sided trades: ${stats.oneSidedTrades}`);
        console.log(`  - Enabled by prior trade: ${stats.enabledTrades} (${pct(stats.enabledTrades, stats.tradeFormations)} of trade formations)`);

        console.log('\n--- By Group Size ---');
        const twoTotal = stats.byGroupSize.two.natural + stats.byGroupSize.two.trade;
        const threeTotal = stats.byGroupSize.three.natural + stats.byGroupSize.three.trade;
        console.log(`2-property groups (brown, dark blue):`);
        console.log(`  Natural: ${stats.byGroupSize.two.natural} (${pct(stats.byGroupSize.two.natural, twoTotal)})`);
        console.log(`  Trade: ${stats.byGroupSize.two.trade} (${pct(stats.byGroupSize.two.trade, twoTotal)})`);
        console.log(`3-property groups:`);
        console.log(`  Natural: ${stats.byGroupSize.three.natural} (${pct(stats.byGroupSize.three.natural, threeTotal)})`);
        console.log(`  Trade: ${stats.byGroupSize.three.trade} (${pct(stats.byGroupSize.three.trade, threeTotal)})`);

        console.log('\n--- By Color Group ---');
        console.log('Group'.padEnd(12) + 'Total'.padStart(8) + 'Natural'.padStart(10) + 'Trade'.padStart(10) + 'Nat%'.padStart(8));
        console.log('-'.repeat(48));

        const groupOrder = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];
        for (const group of groupOrder) {
            const data = stats.byGroup[group];
            console.log(
                group.padEnd(12) +
                data.total.toString().padStart(8) +
                data.natural.toString().padStart(10) +
                data.trade.toString().padStart(10) +
                pct(data.natural, data.total).padStart(8)
            );
        }

        console.log('\n--- Trade Chains ---');
        console.log(`Games with trade chains: ${stats.gamesWithChains} (${pct(stats.gamesWithChains, stats.totalGames)})`);
        console.log(`Total chains found: ${stats.tradeChains.length}`);

        if (stats.tradeChains.length > 0) {
            const avgLength = stats.tradeChains.reduce((s, c) => s + c.length, 0) / stats.tradeChains.length;
            const maxLength = Math.max(...stats.tradeChains.map(c => c.length));
            console.log(`Average chain length: ${avgLength.toFixed(2)}`);
            console.log(`Maximum chain length: ${maxLength}`);

            // Chain length distribution
            const lengthDist = {};
            for (const chain of stats.tradeChains) {
                lengthDist[chain.length] = (lengthDist[chain.length] || 0) + 1;
            }
            console.log('Chain length distribution:');
            for (const [len, count] of Object.entries(lengthDist).sort((a, b) => a[0] - b[0])) {
                console.log(`  Length ${len}: ${count} chains`);
            }
        }

        console.log('\n--- Key Insights ---');

        // Calculate natural formation rate by group size
        const twoNatRate = twoTotal > 0 ? (stats.byGroupSize.two.natural / twoTotal) : 0;
        const threeNatRate = threeTotal > 0 ? (stats.byGroupSize.three.natural / threeTotal) : 0;

        console.log(`\n1. NATURAL FORMATION BY GROUP SIZE:`);
        console.log(`   2-property groups form naturally ${(twoNatRate * 100).toFixed(1)}% of the time`);
        console.log(`   3-property groups form naturally ${(threeNatRate * 100).toFixed(1)}% of the time`);
        console.log(`   Difference: ${((twoNatRate - threeNatRate) * 100).toFixed(1)} percentage points`);

        console.log(`\n2. TRADE DYNAMICS:`);
        const mutualRate = stats.tradeFormations > 0 ?
            stats.mutualMonopolyTrades / stats.tradeFormations : 0;
        console.log(`   ${(mutualRate * 100).toFixed(1)}% of trade formations are mutual monopolies`);
        console.log(`   ${pct(stats.enabledTrades, stats.tradeFormations)} of trades were enabled by a prior trade`);

        console.log(`\n3. UPGRADE POTENTIAL:`);
        if (stats.enabledTrades > 0) {
            console.log(`   ${stats.enabledTrades} monopoly formations were enabled by earlier trades`);
            console.log(`   This represents ${pct(stats.enabledTrades, stats.totalFormations)} of ALL formations`);
            console.log(`   --> There IS potential for "upgrade logic" in AI trading!`);
        } else {
            console.log(`   No evidence of trade chains enabling formations`);
            console.log(`   --> Upgrade logic may not be impactful`);
        }

        // === NEW SECTIONS ===

        console.log('\n' + '='.repeat(80));
        console.log('TRADE BAIT ANALYSIS');
        console.log('='.repeat(80));

        // Find properties that moved most often
        const tradeBaitList = Object.entries(stats.tradeBaitAggregate)
            .map(([pos, data]) => ({
                position: parseInt(pos),
                group: POSITION_TO_GROUP[pos],
                ...data,
                avgMovesPerGame: data.timesMoved / data.gamesInvolved
            }))
            .sort((a, b) => b.timesMoved - a.timesMoved);

        console.log('\nMost frequently traded properties (Trade Bait):');
        console.log('Pos  Group       Property           Times Traded  Games  Avg/Game');
        console.log('-'.repeat(70));

        const topBait = tradeBaitList.slice(0, 15);
        for (const item of topBait) {
            const propName = BOARD[item.position]?.name || `Position ${item.position}`;
            console.log(
                item.position.toString().padStart(3) + '  ' +
                (item.group || 'N/A').padEnd(11) +
                propName.padEnd(20) +
                item.timesMoved.toString().padStart(10) +
                item.gamesInvolved.toString().padStart(8) +
                item.avgMovesPerGame.toFixed(2).padStart(10)
            );
        }

        // Group summary - which color groups are most traded?
        const groupTradeFreq = {};
        for (const item of tradeBaitList) {
            if (item.group) {
                if (!groupTradeFreq[item.group]) {
                    groupTradeFreq[item.group] = 0;
                }
                groupTradeFreq[item.group] += item.timesMoved;
            }
        }

        console.log('\nTrades by color group:');
        const sortedGroups = Object.entries(groupTradeFreq).sort((a, b) => b[1] - a[1]);
        for (const [group, count] of sortedGroups) {
            const propsInGroup = COLOR_GROUPS[group].size;
            const avgPerProp = (count / propsInGroup).toFixed(1);
            console.log(`  ${group.padEnd(12)}: ${count} total trades (${avgPerProp} per property)`);
        }

        console.log('\n' + '='.repeat(80));
        console.log('FIRST MOVER ANALYSIS');
        console.log('='.repeat(80));

        console.log(`\nTotal trades analyzed: ${stats.totalTrades}`);
        console.log(`Positioning trades (no monopoly formed): ${stats.positioningTrades} (${pct(stats.positioningTrades, stats.totalTrades)})`);

        console.log('\nTrade outcomes by initiator vs receiver:');
        const fmo = stats.firstMoverByOutcome;
        const totalOutcomes = fmo.initiatorGotMonopoly + fmo.receiverGotMonopoly + fmo.bothGotMonopoly + fmo.neitherGotMonopoly;
        console.log(`  Only initiator got monopoly: ${fmo.initiatorGotMonopoly} (${pct(fmo.initiatorGotMonopoly, totalOutcomes)})`);
        console.log(`  Only receiver got monopoly:  ${fmo.receiverGotMonopoly} (${pct(fmo.receiverGotMonopoly, totalOutcomes)})`);
        console.log(`  Both got monopoly (mutual):  ${fmo.bothGotMonopoly} (${pct(fmo.bothGotMonopoly, totalOutcomes)})`);
        console.log(`  Neither got monopoly:        ${fmo.neitherGotMonopoly} (${pct(fmo.neitherGotMonopoly, totalOutcomes)})`);

        const initiatorAdvantage = (fmo.initiatorGotMonopoly + fmo.bothGotMonopoly) /
            (fmo.initiatorGotMonopoly + fmo.receiverGotMonopoly + fmo.bothGotMonopoly || 1);
        console.log(`\nInitiator monopoly rate: ${(initiatorAdvantage * 100).toFixed(1)}%`);
        console.log(`Receiver monopoly rate: ${((1 - initiatorAdvantage + (fmo.bothGotMonopoly / (totalOutcomes - fmo.neitherGotMonopoly || 1))) * 100).toFixed(1)}%`);

        console.log('\n' + '='.repeat(80));
        console.log('WINNER vs LOSER TRADE BEHAVIOR');
        console.log('='.repeat(80));

        const ws = stats.winnerTradeStats;
        const ls = stats.loserTradeStats;
        const numWinners = stats.totalGames;
        const numLosers = stats.totalGames * 3;  // Assuming 4 players

        console.log('\n                           Winners      Losers      Diff');
        console.log('-'.repeat(60));
        console.log(`Trades initiated (avg):   ${(ws.initiated / numWinners).toFixed(2).padStart(8)}   ${(ls.initiated / numLosers).toFixed(2).padStart(8)}   ${((ws.initiated / numWinners) - (ls.initiated / numLosers)).toFixed(2).padStart(8)}`);
        console.log(`Trades received (avg):    ${(ws.received / numWinners).toFixed(2).padStart(8)}   ${(ls.received / numLosers).toFixed(2).padStart(8)}   ${((ws.received / numWinners) - (ls.received / numLosers)).toFixed(2).padStart(8)}`);
        console.log(`Monopolies from trade:    ${(ws.monopoliesFromTrade / numWinners).toFixed(2).padStart(8)}   ${(ls.monopoliesFromTrade / numLosers).toFixed(2).padStart(8)}   ${((ws.monopoliesFromTrade / numWinners) - (ls.monopoliesFromTrade / numLosers)).toFixed(2).padStart(8)}`);
        console.log(`Chain participation:      ${(ws.chainParticipation / numWinners).toFixed(2).padStart(8)}   ${(ls.chainParticipation / numLosers).toFixed(2).padStart(8)}   ${((ws.chainParticipation / numWinners) - (ls.chainParticipation / numLosers)).toFixed(2).padStart(8)}`);
        console.log(`Chains initiated:         ${(ws.chainInitiation / numWinners).toFixed(2).padStart(8)}   ${(ls.chainInitiation / numLosers).toFixed(2).padStart(8)}   ${((ws.chainInitiation / numWinners) - (ls.chainInitiation / numLosers)).toFixed(2).padStart(8)}`);

        // Key insights
        console.log('\n' + '='.repeat(80));
        console.log('KEY INSIGHTS');
        console.log('='.repeat(80));

        const winnerInitRate = ws.initiated / numWinners;
        const loserInitRate = ls.initiated / numLosers;
        const initDiff = winnerInitRate - loserInitRate;

        console.log('\n4. FIRST MOVER RISK:');
        if (initDiff > 0.1) {
            console.log(`   Winners initiate ${initDiff.toFixed(2)} MORE trades per game than losers`);
            console.log(`   --> Being proactive in trading correlates with winning!`);
        } else if (initDiff < -0.1) {
            console.log(`   Winners initiate ${(-initDiff).toFixed(2)} FEWER trades per game than losers`);
            console.log(`   --> Over-trading may hurt your chances!`);
        } else {
            console.log(`   No significant difference in trade initiation between winners/losers`);
            console.log(`   --> Trade frequency alone doesn't determine outcome`);
        }

        const winnerMonoRate = ws.monopoliesFromTrade / numWinners;
        const loserMonoRate = ls.monopoliesFromTrade / numLosers;

        console.log('\n5. TRADE QUALITY:');
        console.log(`   Winners avg ${winnerMonoRate.toFixed(2)} monopolies from trades`);
        console.log(`   Losers avg ${loserMonoRate.toFixed(2)} monopolies from trades`);
        if (winnerMonoRate > loserMonoRate + 0.2) {
            console.log(`   --> Winners are ${((winnerMonoRate / loserMonoRate - 1) * 100).toFixed(0)}% more effective at completing monopolies via trade!`);
        }

        console.log('\n6. TRADE BAIT PROPERTIES:');
        if (topBait.length > 0) {
            const mostTraded = topBait[0];
            console.log(`   Most traded: ${BOARD[mostTraded.position]?.name || mostTraded.position} (${mostTraded.group})`);
            console.log(`   Moved ${mostTraded.timesMoved} times across ${mostTraded.gamesInvolved} games`);
            console.log(`   --> This property is frequently used as "trade bait" to enable deals`);
        }

        const positioningRate = stats.positioningTrades / stats.totalTrades;
        console.log('\n7. POSITIONING vs COMPLETING:');
        console.log(`   ${(positioningRate * 100).toFixed(1)}% of trades don't complete any monopoly`);
        if (positioningRate > 0.3) {
            console.log(`   --> Significant "positioning" trades happening - AI may be trading strategically!`);
        } else {
            console.log(`   --> Most trades are monopoly-completing, not speculative`);
        }

        // === NEW ENHANCED ANALYSIS ===

        console.log('\n' + '='.repeat(80));
        console.log('CHAIN TIMING ANALYSIS');
        console.log('='.repeat(80));

        const ct = stats.chainTimingStats;
        if (ct.totalChains > 0) {
            const avgDuration = ct.avgDuration / ct.totalChains;
            const avgGap = ct.avgGap / ct.totalChains;

            console.log(`\nTotal chains analyzed: ${ct.totalChains}`);
            console.log(`Average chain duration: ${avgDuration.toFixed(1)} turns`);
            console.log(`Average gap between trades: ${avgGap.toFixed(1)} turns`);
            console.log(`Quick chains (<= 5 turns): ${ct.quickChains} (${pct(ct.quickChains, ct.totalChains)})`);
            console.log(`Slow chains (> 10 turns): ${ct.slowChains} (${pct(ct.slowChains, ct.totalChains)})`);

            if (avgGap <= 3) {
                console.log(`\n--> Chains happen QUICKLY - likely intentional/strategic!`);
            } else if (avgGap >= 8) {
                console.log(`\n--> Chains happen SLOWLY - likely coincidental/luck-based`);
            } else {
                console.log(`\n--> Chain timing is moderate - mix of strategy and opportunity`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('UNLOCKING PROPERTIES ANALYSIS');
        console.log('='.repeat(80));

        // Find properties that unlock the most monopolies
        const unlockers = Object.entries(stats.unlockingPropertiesAggregate)
            .map(([pos, data]) => ({
                position: parseInt(pos),
                ...data
            }))
            .sort((a, b) => b.timesUnlocked - a.timesUnlocked);

        console.log('\nTop properties that "unlock" monopolies when traded:');
        console.log('Pos  From Group   Property             Unlocks  Enables Groups');
        console.log('-'.repeat(75));

        for (const item of unlockers.slice(0, 12)) {
            const propName = BOARD[item.position]?.name || `Position ${item.position}`;
            const enabledStr = Object.entries(item.enabledGroups)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([g, c]) => `${g}:${c}`)
                .join(', ');

            console.log(
                item.position.toString().padStart(3) + '  ' +
                (item.fromGroup || 'N/A').padEnd(12) +
                propName.padEnd(20) +
                item.timesUnlocked.toString().padStart(8) + '  ' +
                enabledStr
            );
        }

        // Analyze cross-group unlocking
        const crossGroupUnlocks = {};
        for (const [pos, data] of Object.entries(stats.unlockingPropertiesAggregate)) {
            for (const [enabledGroup, count] of Object.entries(data.enabledGroups)) {
                if (data.fromGroup && data.fromGroup !== enabledGroup) {
                    const key = `${data.fromGroup} -> ${enabledGroup}`;
                    crossGroupUnlocks[key] = (crossGroupUnlocks[key] || 0) + count;
                }
            }
        }

        if (Object.keys(crossGroupUnlocks).length > 0) {
            console.log('\nCross-group unlocking patterns:');
            const sorted = Object.entries(crossGroupUnlocks).sort((a, b) => b[1] - a[1]);
            for (const [pattern, count] of sorted.slice(0, 8)) {
                console.log(`  ${pattern.padEnd(25)}: ${count} times`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('ACCIDENTAL vs INTENTIONAL MONOPOLIES');
        console.log('='.repeat(80));

        const accidental = stats.accidentalMonopoliesAggregate;
        const totalAccidental = Object.values(accidental).reduce((a, b) => a + b, 0);

        console.log(`\nMonopolies formed without trading that group's properties:`);
        console.log(`Total "accidental" monopolies: ${totalAccidental} (${pct(totalAccidental, stats.tradeFormations)} of trade formations)`);

        if (Object.keys(accidental).length > 0) {
            console.log('\nBy group:');
            const sortedAccidental = Object.entries(accidental).sort((a, b) => b[1] - a[1]);
            for (const [group, count] of sortedAccidental) {
                const groupTotal = stats.byGroup[group]?.trade || 1;
                console.log(`  ${group.padEnd(12)}: ${count} accidental (${pct(count, groupTotal)} of ${group} trade formations)`);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('WINNING vs LOSING MONOPOLY GROUPS');
        console.log('='.repeat(80));

        console.log('\nMonopoly groups held by winners vs losers:');
        console.log('Group'.padEnd(12) + 'Winner Had'.padStart(12) + 'Loser Had'.padStart(12) + 'Win Rate'.padStart(12));
        console.log('-'.repeat(48));

        for (const group of groupOrder) {
            const winnerHad = stats.winningMonopolyGroups[group] || 0;
            const loserHad = stats.losingMonopolyGroups[group] || 0;
            const total = winnerHad + loserHad;
            const winRate = total > 0 ? (winnerHad / total * 100).toFixed(1) + '%' : 'N/A';

            console.log(
                group.padEnd(12) +
                winnerHad.toString().padStart(12) +
                loserHad.toString().padStart(12) +
                winRate.padStart(12)
            );
        }

        // Final summary insights
        console.log('\n' + '='.repeat(80));
        console.log('STRATEGIC INSIGHTS SUMMARY');
        console.log('='.repeat(80));

        console.log('\n8. CHAIN TIMING:');
        if (ct.totalChains > 0) {
            const avgGap = ct.avgGap / ct.totalChains;
            if (avgGap <= 3) {
                console.log(`   Avg ${avgGap.toFixed(1)} turns between chain trades - INTENTIONAL trading`);
            } else {
                console.log(`   Avg ${avgGap.toFixed(1)} turns between chain trades - mostly COINCIDENTAL`);
            }
        }

        console.log('\n9. TRADE BAIT vs WINNING GROUPS:');
        // Compare most traded groups with highest win rates
        const highTradeGroups = Object.entries(groupTradeFreq || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const highWinGroups = groupOrder
            .map(g => ({ group: g, winRate: (stats.winningMonopolyGroups[g] || 0) / ((stats.winningMonopolyGroups[g] || 0) + (stats.losingMonopolyGroups[g] || 0) || 1) }))
            .sort((a, b) => b.winRate - a.winRate)
            .slice(0, 3);

        console.log(`   Most TRADED: ${highTradeGroups.map(([g]) => g).join(', ')}`);
        console.log(`   Highest WIN RATE: ${highWinGroups.map(g => g.group).join(', ')}`);

        const tradeBaitGroups = highTradeGroups.map(([g]) => g);
        const winningGroups = highWinGroups.map(g => g.group);
        const overlap = tradeBaitGroups.filter(g => winningGroups.includes(g));

        if (overlap.length === 0) {
            console.log(`   --> DIFFERENT groups! Trade bait (${tradeBaitGroups.join(', ')}) != Winners (${winningGroups.join(', ')})`);
            console.log(`   --> AI may be giving away valuable properties!`);
        } else {
            console.log(`   --> Some overlap: ${overlap.join(', ')} are both traded frequently AND win often`);
        }

        console.log('\n10. ACCIDENTAL MONOPOLY RISK:');
        if (totalAccidental > 0) {
            const mostAccidental = Object.entries(accidental).sort((a, b) => b[1] - a[1])[0];
            console.log(`   ${mostAccidental[0]} forms "accidentally" most often (${mostAccidental[1]} times)`);
            console.log(`   --> Trading other groups can inadvertently complete ${mostAccidental[0]}!`);
        } else {
            console.log(`   No significant accidental monopoly patterns detected`);
        }
    }
}

// CLI entry point
if (require.main === module) {
    const games = parseInt(process.argv[2]) || 500;
    const runner = new FormationAnalysisRunner({ games });
    runner.runAnalysis();
}

module.exports = {
    FormationTracker,
    FormationTrackingEngine,
    FormationAnalysisRunner,
    COLOR_GROUPS,
    POSITION_TO_GROUP
};
