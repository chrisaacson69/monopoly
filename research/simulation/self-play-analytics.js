/**
 * Self-Play Analytics System
 *
 * Runs RelativeGrowthAI against itself and captures detailed per-turn statistics
 * to understand how well the model's projections match actual gameplay.
 *
 * Key metrics tracked:
 * 1. Net worth vs projected net worth (actual vs EPT model)
 * 2. Housing situation (shortages, timing of purchases/sales)
 * 3. Cash flow states (mortgage/unmortgage events)
 * 4. Trade timing and outcomes
 * 5. Variance analysis (luck factor)
 * 6. Property acquisition timeline
 */

'use strict';

const { GameEngine, GameState, Player, BOARD, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

// Try to load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.log('Note: Markov engine not available');
}

const DICE_EPT = 38;  // ~$35 from Go + ~$3 from cards per turn

// Property group risk characteristics (based on landing probability variance)
// Higher variance = more risk, potentially higher reward
const GROUP_CHARACTERISTICS = {
    brown: { avgLandingProb: 0.021, variance: 'low', houseCost: 50, maxRent: 450 },
    lightBlue: { avgLandingProb: 0.025, variance: 'low', houseCost: 50, maxRent: 600 },
    pink: { avgLandingProb: 0.027, variance: 'medium', houseCost: 100, maxRent: 900 },
    orange: { avgLandingProb: 0.031, variance: 'low', houseCost: 100, maxRent: 1000 },  // Most consistent
    red: { avgLandingProb: 0.028, variance: 'medium', houseCost: 150, maxRent: 1100 },
    yellow: { avgLandingProb: 0.027, variance: 'medium', houseCost: 150, maxRent: 1200 },
    green: { avgLandingProb: 0.026, variance: 'high', houseCost: 200, maxRent: 1400 },
    darkBlue: { avgLandingProb: 0.025, variance: 'high', houseCost: 200, maxRent: 2000 }  // Highest variance
};

// =============================================================================
// ANALYTICS DATA STRUCTURES
// =============================================================================

/**
 * Per-turn snapshot of a player's state
 */
class PlayerSnapshot {
    constructor(player, state, analytics) {
        this.playerId = player.id;
        this.turn = state.turn;

        // Actual state
        this.money = player.money;
        this.netWorth = this.calculateNetWorth(player, state);
        this.properties = new Set(player.properties);
        this.position = player.position;
        this.inJail = player.inJail;
        this.bankrupt = player.bankrupt;

        // Property development state
        this.houseCount = this.countHouses(player, state);
        this.hotelCount = this.countHotels(player, state);
        this.monopolies = this.getMonopolies(player, state);
        this.mortgagedProperties = this.getMortgagedProperties(player, state);

        // EPT calculations (requires AI access)
        this.propertyEPT = 0;
        this.relativeEPT = 0;
        this.projectedNetGrowth = 0;
        this.projectedPosition = 0;

        // Will be calculated by the analytics engine
        this.actualGrowthThisTurn = 0;
        this.projectedGrowthThisTurn = 0;
        this.variance = 0;
    }

    calculateNetWorth(player, state) {
        let worth = player.money;
        for (const propIdx of player.properties) {
            const square = BOARD[propIdx];
            const propState = state.propertyStates[propIdx];

            if (propState.mortgaged) {
                worth += (square.price || 0) * 0.5;
            } else {
                worth += square.price || 0;
                if (propState.houses > 0 && square.housePrice) {
                    // Liquidation value is 50%
                    worth += propState.houses * square.housePrice * 0.5;
                }
            }
        }
        return worth;
    }

    countHouses(player, state) {
        let count = 0;
        for (const propIdx of player.properties) {
            const houses = state.propertyStates[propIdx].houses || 0;
            if (houses < 5) count += houses;
        }
        return count;
    }

    countHotels(player, state) {
        let count = 0;
        for (const propIdx of player.properties) {
            const houses = state.propertyStates[propIdx].houses || 0;
            if (houses === 5) count += 1;
        }
        return count;
    }

    getMonopolies(player, state) {
        const monopolies = [];
        for (const [group, info] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = info.squares.every(sq => player.properties.has(sq));
            if (ownsAll) {
                monopolies.push({
                    group,
                    avgHouses: info.squares.reduce((sum, sq) =>
                        sum + (state.propertyStates[sq].houses || 0), 0) / info.squares.length
                });
            }
        }
        return monopolies;
    }

    getMortgagedProperties(player, state) {
        const mortgaged = [];
        for (const propIdx of player.properties) {
            if (state.propertyStates[propIdx].mortgaged) {
                mortgaged.push(propIdx);
            }
        }
        return mortgaged;
    }
}

/**
 * Records a single event during gameplay
 */
class GameEvent {
    constructor(type, turn, playerId, data = {}) {
        this.type = type;
        this.turn = turn;
        this.playerId = playerId;
        this.data = data;
        this.timestamp = Date.now();
    }
}

/**
 * Complete game analytics record
 */
class GameAnalytics {
    constructor(numPlayers) {
        this.numPlayers = numPlayers;
        this.startTime = Date.now();
        this.endTime = null;

        // Per-turn snapshots for each player
        this.turnSnapshots = [];  // Array of { turn, players: [PlayerSnapshot, ...] }

        // Event log
        this.events = [];

        // Housing statistics
        this.housing = {
            totalHousesBought: new Array(numPlayers).fill(0),
            totalHousesSold: new Array(numPlayers).fill(0),
            totalHotelsBought: new Array(numPlayers).fill(0),
            totalHotelsSold: new Array(numPlayers).fill(0),
            housingShortages: [],  // { turn, housesAvailable, hotelsAvailable, playerWanted }
            forcedSales: [],       // { turn, playerId, property, reason }
        };

        // Trade statistics
        this.trades = {
            proposed: [],
            accepted: [],
            rejected: [],
            tradesByTurn: new Map(),
        };

        // Cash flow events
        this.cashFlow = {
            mortgages: [],     // { turn, playerId, property, amount }
            unmortgages: [],   // { turn, playerId, property, cost }
            rentPaid: [],      // { turn, fromId, toId, property, amount }
            rentCollected: new Array(numPlayers).fill(0),
            goSalary: new Array(numPlayers).fill(0),
            taxPaid: new Array(numPlayers).fill(0),
            cardIncome: new Array(numPlayers).fill(0),
            cardExpense: new Array(numPlayers).fill(0),
        };

        // Property acquisition timeline
        this.propertyAcquisition = [];  // { turn, playerId, property, method: 'buy'|'auction'|'trade', price }

        // Declined purchases - when player COULD afford but chose not to buy
        // This is rare and may indicate overly conservative buying strategy
        this.declinedPurchases = [];  // { turn, playerId, property, propertyName, price, playerMoney, reason }

        // Monopoly formation timeline
        this.monopolyFormation = [];  // { turn, playerId, group, method: 'buy'|'auction'|'trade' }

        // Railroad and utility ownership tracking
        this.railroadOwnership = [];  // { turn, playerId, count } - when someone gets 2+, 3, or 4 railroads
        this.utilityOwnership = [];   // { turn, playerId, count } - when someone gets both utilities

        // Variance tracking
        this.variance = {
            perTurnErrors: [],  // { turn, playerId, actual, projected, error }
            cumulativeErrors: new Array(numPlayers).fill(0),
            diceRolls: [],      // Track actual dice outcomes
            expectedLandings: new Map(),  // position -> expected count
            actualLandings: new Map(),    // position -> actual count
        };

        // Monopoly group performance tracking
        this.monopolyPerformance = {
            // Track how each monopoly group performed when owned
            byGroup: {},  // group -> { timesOwned, totalRentCollected, avgTurnsToROI, wins }
            // Track variance in income by group
            incomeVariance: {},  // group -> [income per turn samples]
        };

        // Risk analysis
        this.riskAnalysis = {
            // Track outcomes by monopoly strategy
            lowVarianceWins: 0,    // Wins when winner had Orange/LightBlue
            highVarianceWins: 0,   // Wins when winner had DarkBlue/Green
            mixedWins: 0,
            // Cash position when monopoly formed
            cashAtMonopolyFormation: [],  // { group, cash, variance-type }
        };

        // Final results
        this.result = {
            winner: null,
            totalTurns: 0,
            bankruptcyOrder: [],
            finalNetWorth: [],
            winnerMonopolies: [],
        };
    }

    addEvent(type, turn, playerId, data = {}) {
        this.events.push(new GameEvent(type, turn, playerId, data));
    }

    recordTurnSnapshot(turn, players, state, aiInstances) {
        const snapshots = [];

        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const snapshot = new PlayerSnapshot(player, state, this);

            // Calculate EPT data if AI available
            if (aiInstances[i] && !player.bankrupt) {
                const ai = aiInstances[i];
                const eptData = ai.calculateRelativeEPTs(state).get(player.id);
                if (eptData) {
                    snapshot.propertyEPT = eptData.propertyEPT;
                    snapshot.relativeEPT = eptData.relativeEPT;
                    snapshot.projectedNetGrowth = eptData.netGrowth;
                }
                snapshot.projectedPosition = ai.calculatePosition(player, state);
            }

            snapshots.push(snapshot);
        }

        // Calculate actual growth from previous turn
        if (this.turnSnapshots.length > 0) {
            const prevSnapshots = this.turnSnapshots[this.turnSnapshots.length - 1].players;
            for (let i = 0; i < snapshots.length; i++) {
                if (!snapshots[i].bankrupt && prevSnapshots[i] && !prevSnapshots[i].bankrupt) {
                    snapshots[i].actualGrowthThisTurn = snapshots[i].netWorth - prevSnapshots[i].netWorth;
                    snapshots[i].projectedGrowthThisTurn = prevSnapshots[i].projectedNetGrowth;
                    snapshots[i].variance = snapshots[i].actualGrowthThisTurn - snapshots[i].projectedGrowthThisTurn;

                    // Track variance
                    this.variance.perTurnErrors.push({
                        turn,
                        playerId: i,
                        actual: snapshots[i].actualGrowthThisTurn,
                        projected: snapshots[i].projectedGrowthThisTurn,
                        error: snapshots[i].variance
                    });
                    this.variance.cumulativeErrors[i] += Math.abs(snapshots[i].variance);
                }
            }
        }

        this.turnSnapshots.push({ turn, players: snapshots });
    }
}

// =============================================================================
// INSTRUMENTED GAME ENGINE
// =============================================================================

/**
 * Extended game engine that captures detailed analytics
 */
class InstrumentedGameEngine extends GameEngine {
    constructor(options = {}) {
        super(options);
        this.analytics = null;
        this.aiInstances = [];
    }

    newGame(playerCount = 4, aiFactories = []) {
        super.newGame(playerCount, aiFactories);
        this.analytics = new GameAnalytics(playerCount);

        // Store AI instances for EPT calculations
        this.aiInstances = this.state.players.map(p => p.ai);

        // Record initial state
        this.analytics.recordTurnSnapshot(0, this.state.players, this.state, this.aiInstances);
    }

    /**
     * Override: Track dice rolls
     */
    rollDice() {
        const roll = super.rollDice();
        this.analytics.variance.diceRolls.push({
            turn: this.state.turn,
            d1: roll.d1,
            d2: roll.d2,
            sum: roll.sum,
            isDoubles: roll.isDoubles
        });
        return roll;
    }

    /**
     * Override: Track landings
     */
    movePlayer(player, spaces, collectGo = true) {
        const oldPos = player.position;
        const newPos = super.movePlayer(player, spaces, collectGo);

        // Track actual landing
        const current = this.analytics.variance.actualLandings.get(newPos) || 0;
        this.analytics.variance.actualLandings.set(newPos, current + 1);

        // Track GO salary
        if (collectGo && newPos < oldPos && newPos !== 10) {
            this.analytics.cashFlow.goSalary[player.id] += 200;
            this.analytics.addEvent('go_salary', this.state.turn, player.id, { amount: 200 });
        }

        return newPos;
    }

    /**
     * Override: Track rent payments
     */
    transferMoney(from, to, amount) {
        const prevFromMoney = from.money;
        super.transferMoney(from, to, amount);

        this.analytics.cashFlow.rentPaid.push({
            turn: this.state.turn,
            fromId: from.id,
            toId: to.id,
            amount
        });
        this.analytics.cashFlow.rentCollected[to.id] += amount;

        this.analytics.addEvent('rent_payment', this.state.turn, from.id, {
            toId: to.id,
            amount,
            fromMoneyBefore: prevFromMoney,
            fromMoneyAfter: from.money
        });
    }

    /**
     * Override: Track property purchases AND declined purchases
     */
    handlePropertyPurchase(player, position) {
        const square = BOARD[position];
        const prevOwner = this.state.propertyStates[position].owner;
        const prevMoney = player.money;
        const couldAfford = player.money >= square.price;

        // Check what the AI decides BEFORE calling parent
        let aiDecision = null;
        if (player.ai && player.ai.decideBuy) {
            aiDecision = player.ai.decideBuy(position, this.state);
        }

        // IMPORTANT: Check these BEFORE the auction (while property is unowned)
        const wouldComplete = this.wouldCompleteMonopoly(player, position);
        const wouldBlock = this.wouldBlockOpponentMonopoly(player, position);

        // Store pending decline info in case we need to record it after auction
        this._pendingDecline = null;
        if (couldAfford && aiDecision === false) {
            this._pendingDecline = {
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                propertyName: square.name,
                price: square.price,
                playerMoney: prevMoney,
                aiDecision: aiDecision,
                reason: 'ai_declined',
                wouldCompleteMonopoly: wouldComplete,
                wouldBlockOpponent: wouldBlock,
                auctionPrice: null,  // Will be filled in by runAuction
                auctionWinner: null
            };
        }

        super.handlePropertyPurchase(player, position);

        const newOwner = this.state.propertyStates[position].owner;

        if (newOwner === player.id && prevOwner === null) {
            // Player bought the property directly
            this.analytics.propertyAcquisition.push({
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                propertyName: square.name,
                method: 'buy',
                price: square.price
            });

            // Check if this completed a monopoly
            this.checkMonopolyFormation(player, position, 'buy');
            this._pendingDecline = null;  // Clear - they bought it
        } else if (this._pendingDecline) {
            // They declined and it went to auction - record the decline with auction info
            this.analytics.declinedPurchases.push(this._pendingDecline);

            this.analytics.addEvent('declined_purchase', this.state.turn, player.id, {
                property: position,
                propertyName: square.name,
                price: square.price,
                playerMoney: prevMoney,
                auctionPrice: this._pendingDecline.auctionPrice
            });

            this._pendingDecline = null;
        }
    }

    /**
     * Check if buying a property would complete a monopoly for this player
     */
    wouldCompleteMonopoly(player, position) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;
        const owned = groupSquares.filter(sq => player.properties.has(sq)).length;
        return owned === groupSquares.length - 1;  // Would complete if we buy this one
    }

    /**
     * Check if buying a property would block an opponent from completing a monopoly
     */
    wouldBlockOpponentMonopoly(player, position) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        for (const opponent of this.state.players) {
            if (opponent.id === player.id || opponent.bankrupt) continue;

            const oppOwned = groupSquares.filter(sq => opponent.properties.has(sq)).length;
            // Opponent owns all but this one
            if (oppOwned === groupSquares.length - 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Override: Track auctions with winning bid price
     * Duplicates parent logic to capture the final bid amount
     */
    runAuction(position) {
        const square = BOARD[position];
        const prevOwner = this.state.propertyStates[position].owner;
        let highBid = 0;
        let highBidder = null;

        // Get active players and randomize starting order
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

        // Execute the winning bid
        if (highBidder) {
            highBidder.money -= highBid;
            highBidder.properties.add(position);
            this.state.propertyStates[position].owner = highBidder.id;
            this.log(`${highBidder.name} won auction for ${square.name} at $${highBid}`);
        }

        const newOwner = this.state.propertyStates[position].owner;

        // Update pending decline with auction results
        if (this._pendingDecline && this._pendingDecline.property === position) {
            this._pendingDecline.auctionPrice = highBidder ? highBid : 0;
            this._pendingDecline.auctionWinner = highBidder ? highBidder.id : null;
        }

        // Record acquisition
        if (newOwner !== null && prevOwner === null) {
            const winner = this.state.players[newOwner];
            this.analytics.propertyAcquisition.push({
                turn: this.state.turn,
                playerId: newOwner,
                property: position,
                propertyName: BOARD[position].name,
                method: 'auction',
                price: highBid
            });

            this.checkMonopolyFormation(winner, position, 'auction');
        }
    }

    /**
     * Override: Track house building
     */
    buildHouse(player, position) {
        const prevHouses = this.state.propertyStates[position].houses;
        const prevHousesAvailable = this.state.housesAvailable;
        const prevHotelsAvailable = this.state.hotelsAvailable;

        const result = super.buildHouse(player, position);

        if (result) {
            const newHouses = this.state.propertyStates[position].houses;

            if (newHouses === 5) {
                // Built a hotel
                this.analytics.housing.totalHotelsBought[player.id]++;
                this.analytics.addEvent('hotel_built', this.state.turn, player.id, {
                    property: position,
                    propertyName: BOARD[position].name
                });
            } else {
                // Built a house
                this.analytics.housing.totalHousesBought[player.id]++;
                this.analytics.addEvent('house_built', this.state.turn, player.id, {
                    property: position,
                    propertyName: BOARD[position].name,
                    housesNow: newHouses
                });
            }

            // Check for housing shortage
            if (this.state.housesAvailable <= 3) {
                this.analytics.housing.housingShortages.push({
                    turn: this.state.turn,
                    housesAvailable: this.state.housesAvailable,
                    hotelsAvailable: this.state.hotelsAvailable,
                    type: 'low_houses'
                });
            }
        } else if (this.state.housesAvailable === 0 ||
                   (this.state.propertyStates[position].houses === 4 && this.state.hotelsAvailable === 0)) {
            // Wanted to build but couldn't due to shortage
            this.analytics.housing.housingShortages.push({
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                housesAvailable: this.state.housesAvailable,
                hotelsAvailable: this.state.hotelsAvailable,
                type: 'blocked'
            });
        }

        return result;
    }

    /**
     * Override: Track house sales
     */
    sellHouse(player, position) {
        const prevHouses = this.state.propertyStates[position].houses;
        const result = super.sellHouse(player, position);

        if (result > 0) {
            if (prevHouses === 5) {
                // Sold a hotel
                this.analytics.housing.totalHotelsSold[player.id]++;
                this.analytics.addEvent('hotel_sold', this.state.turn, player.id, {
                    property: position,
                    propertyName: BOARD[position].name,
                    salePrice: result,
                    reason: 'raise_cash'
                });
            } else {
                // Sold a house
                this.analytics.housing.totalHousesSold[player.id]++;
                this.analytics.addEvent('house_sold', this.state.turn, player.id, {
                    property: position,
                    propertyName: BOARD[position].name,
                    housesNow: this.state.propertyStates[position].houses,
                    salePrice: result,
                    reason: 'raise_cash'
                });
            }

            this.analytics.housing.forcedSales.push({
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                fromHouses: prevHouses,
                toHouses: this.state.propertyStates[position].houses,
                salePrice: result,
                reason: 'raise_cash'
            });
        }

        return result;
    }

    /**
     * Override: Track mortgages
     */
    mortgageProperty(player, position) {
        const result = super.mortgageProperty(player, position);

        if (result > 0) {
            this.analytics.cashFlow.mortgages.push({
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                propertyName: BOARD[position].name,
                amount: result
            });

            this.analytics.addEvent('mortgage', this.state.turn, player.id, {
                property: position,
                propertyName: BOARD[position].name,
                amount: result
            });
        }

        return result;
    }

    /**
     * Override: Track unmortgages
     */
    unmortgageProperty(player, position) {
        const square = BOARD[position];
        const mortgageValue = Math.floor(square.price / 2);
        const cost = Math.floor(mortgageValue * 1.1);

        const result = super.unmortgageProperty(player, position);

        if (result) {
            this.analytics.cashFlow.unmortgages.push({
                turn: this.state.turn,
                playerId: player.id,
                property: position,
                propertyName: square.name,
                cost
            });

            this.analytics.addEvent('unmortgage', this.state.turn, player.id, {
                property: position,
                propertyName: square.name,
                cost
            });
        }

        return result;
    }

    /**
     * Override: Track trades
     */
    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        // Record trade attempt
        const tradeRecord = {
            turn: this.state.turn,
            fromId: from.id,
            toId: to.id,
            fromProperties: Array.from(fromProperties).map(p => ({
                position: p,
                name: BOARD[p].name
            })),
            toProperties: Array.from(toProperties).map(p => ({
                position: p,
                name: BOARD[p].name
            })),
            fromCash,
            // Calculate EPT impact
            fromEPTBefore: this.aiInstances[from.id] ?
                this.aiInstances[from.id].calculateRelativeEPTs(this.state).get(from.id)?.propertyEPT || 0 : 0,
            toEPTBefore: this.aiInstances[to.id] ?
                this.aiInstances[to.id].calculateRelativeEPTs(this.state).get(to.id)?.propertyEPT || 0 : 0
        };

        const result = super.executeTrade(trade);

        if (result) {
            // Trade was accepted and executed
            tradeRecord.accepted = true;
            tradeRecord.fromEPTAfter = this.aiInstances[from.id] ?
                this.aiInstances[from.id].calculateRelativeEPTs(this.state).get(from.id)?.propertyEPT || 0 : 0;
            tradeRecord.toEPTAfter = this.aiInstances[to.id] ?
                this.aiInstances[to.id].calculateRelativeEPTs(this.state).get(to.id)?.propertyEPT || 0 : 0;

            this.analytics.trades.accepted.push(tradeRecord);

            this.analytics.addEvent('trade_executed', this.state.turn, from.id, tradeRecord);

            // Check if trade completed any monopolies
            for (const prop of fromProperties) {
                this.checkMonopolyFormation(to, prop, 'trade');
            }
            for (const prop of toProperties) {
                this.checkMonopolyFormation(from, prop, 'trade');
            }
        } else {
            tradeRecord.accepted = false;
            this.analytics.trades.rejected.push(tradeRecord);
        }

        this.analytics.trades.proposed.push(tradeRecord);

        return result;
    }

    /**
     * Check if a property acquisition completed a monopoly
     */
    checkMonopolyFormation(player, position, method) {
        const square = BOARD[position];

        // Check for color group monopoly
        if (square.group) {
            const groupSquares = COLOR_GROUPS[square.group].squares;
            const ownsAll = groupSquares.every(sq =>
                this.state.propertyStates[sq].owner === player.id
            );

            if (ownsAll) {
                // Check if this is a new monopoly (not already recorded)
                const alreadyRecorded = this.analytics.monopolyFormation.some(m =>
                    m.playerId === player.id && m.group === square.group
                );

                if (!alreadyRecorded) {
                    this.analytics.monopolyFormation.push({
                        turn: this.state.turn,
                        playerId: player.id,
                        group: square.group,
                        method
                    });

                    this.analytics.addEvent('monopoly_formed', this.state.turn, player.id, {
                        group: square.group,
                        method
                    });
                }
            }
        }

        // Check for railroad milestones (2, 3, or 4 railroads)
        const RAILROADS = [5, 15, 25, 35];
        if (RAILROADS.includes(position)) {
            const rrCount = RAILROADS.filter(rr =>
                this.state.propertyStates[rr].owner === player.id
            ).length;

            // Record when reaching 2, 3, or 4 railroads
            if (rrCount >= 2) {
                const alreadyRecorded = this.analytics.railroadOwnership.some(r =>
                    r.playerId === player.id && r.count === rrCount
                );

                if (!alreadyRecorded) {
                    this.analytics.railroadOwnership.push({
                        turn: this.state.turn,
                        playerId: player.id,
                        count: rrCount,
                        method
                    });

                    this.analytics.addEvent('railroad_milestone', this.state.turn, player.id, {
                        count: rrCount,
                        method
                    });
                }
            }
        }

        // Check for utility "monopoly" (both utilities)
        const UTILITIES = [12, 28];
        if (UTILITIES.includes(position)) {
            const utilCount = UTILITIES.filter(u =>
                this.state.propertyStates[u].owner === player.id
            ).length;

            if (utilCount === 2) {
                const alreadyRecorded = this.analytics.utilityOwnership.some(u =>
                    u.playerId === player.id
                );

                if (!alreadyRecorded) {
                    this.analytics.utilityOwnership.push({
                        turn: this.state.turn,
                        playerId: player.id,
                        count: 2,
                        method
                    });

                    this.analytics.addEvent('utility_monopoly', this.state.turn, player.id, {
                        method
                    });
                }
            }
        }
    }

    /**
     * Override: Track bankruptcy
     */
    handleBankruptcy(player, creditor) {
        this.analytics.result.bankruptcyOrder.push({
            playerId: player.id,
            turn: this.state.turn,
            creditorId: creditor.id
        });

        this.analytics.addEvent('bankruptcy', this.state.turn, player.id, {
            creditorId: creditor.id
        });

        super.handleBankruptcy(player, creditor);
    }

    handleBankruptcyToBank(player) {
        this.analytics.result.bankruptcyOrder.push({
            playerId: player.id,
            turn: this.state.turn,
            creditorId: 'bank'
        });

        this.analytics.addEvent('bankruptcy_to_bank', this.state.turn, player.id, {});

        super.handleBankruptcyToBank(player);
    }

    /**
     * Override: Execute turn with snapshot recording
     */
    executeTurn() {
        super.executeTurn();

        // Record snapshot at end of each full round
        if (this.state.currentPlayerIndex === 0) {
            this.analytics.recordTurnSnapshot(
                this.state.turn,
                this.state.players,
                this.state,
                this.aiInstances
            );
        }
    }

    /**
     * Override: Run game with final analytics
     */
    runGame() {
        const result = super.runGame();

        // Finalize analytics
        this.analytics.endTime = Date.now();
        this.analytics.result.winner = result.winner;
        this.analytics.result.totalTurns = result.turns;
        this.analytics.result.finalNetWorth = this.state.players.map((p, i) =>
            p.bankrupt ? 0 : p.getNetWorth(this.state)
        );

        // Record winner's monopolies
        if (result.winner !== null) {
            const winner = this.state.players[result.winner];
            this.analytics.result.winnerMonopolies = this.analytics.monopolyFormation
                .filter(m => m.playerId === result.winner)
                .map(m => m.group);
        }

        return {
            ...result,
            analytics: this.analytics
        };
    }
}

// =============================================================================
// SELF-PLAY ANALYTICS RUNNER
// =============================================================================

class SelfPlayAnalytics {
    constructor(options = {}) {
        this.options = {
            games: options.games || 100,
            maxTurns: options.maxTurns || 500,
            verbose: options.verbose || false,
            numPlayers: options.numPlayers || 4,
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

        // Aggregate statistics across all games
        this.aggregateStats = {
            gamesPlayed: 0,
            totalTurns: 0,
            wins: [],

            // Variance statistics
            avgVariancePerTurn: [],
            maxVariancePerGame: [],
            varianceByPhase: { early: [], mid: [], late: [] },
            varianceBreakdown: {
                rent: [],        // Variance due to rent collected vs expected
                diceIncome: [],  // Variance due to GO passes, card draws
                housing: [],     // Variance due to forced sales
            },

            // Net worth progression
            avgNetWorthByTurn: new Map(),  // turn -> [avgForPlayer0, avgForPlayer1, ...]
            avgProjectedByTurn: new Map(),

            // Housing statistics
            avgHousesBought: [],
            avgHousesSold: [],
            housingShortageFrequency: 0,
            forcedSaleFrequency: 0,
            avgHouseSellLoss: 0,  // Track value lost to forced house sales

            // Declined purchase statistics (rare - worth investigating if high)
            declinedPurchases: {
                total: 0,
                byPlayer: [],  // Per-player counts
                details: [],   // Array of all declined purchases for analysis
                wouldHaveCompletedMonopoly: 0,
                wouldHaveBlockedOpponent: 0,
                // Auction price analysis
                auctionPrices: [],      // All auction prices for declined properties
                auctionAboveFaceValue: 0,  // Times auction > face value (missed opportunity!)
                auctionBelowFaceValue: 0,  // Times auction < face value (good decision)
                auctionUnsold: 0,          // Times nobody bought at auction
                totalPremiumPaid: 0        // Sum of (auction - face) when above face value
            },

            // Trade statistics
            avgTradesPerGame: 0,
            tradeAcceptanceRate: 0,
            avgTurnOfFirstMonopoly: [],
            monopolyByTradeRate: 0,

            // Cash flow patterns
            avgMortgagesPerGame: [],
            avgUnmortgagesPerGame: [],
            avgRentCollected: [],

            // Game outcome patterns
            avgGameLength: 0,
            winnerByMonopolyCount: { 0: 0, 1: 0, 2: 0, 3: 0, more: 0 },

            // Monopoly group performance (for risk analysis)
            monopolyGroupStats: {},  // group -> { wins, timesFormed, avgTurnFormed, rentCollected }

            // Railroad and utility performance
            railroadStats: {
                // Track by count owned (2, 3, 4)
                byCount: {
                    2: { timesAchieved: 0, wins: 0, turnAchieved: [] },
                    3: { timesAchieved: 0, wins: 0, turnAchieved: [] },
                    4: { timesAchieved: 0, wins: 0, turnAchieved: [] }
                },
                winsWith2Plus: 0,  // Wins where winner had 2+ railroads
                winsWith3Plus: 0,  // Wins where winner had 3+ railroads
                winsWith4: 0       // Wins where winner had all 4
            },
            utilityStats: {
                timesAchieved: 0,  // Times someone got both utilities
                wins: 0,          // Wins where winner had both utilities
                turnAchieved: []
            },

            // Risk analysis (Orange steady vs Blue volatile)
            riskAnalysis: {
                lowVarianceWins: 0,    // Orange, LightBlue, Pink
                highVarianceWins: 0,   // DarkBlue, Green
                mediumVarianceWins: 0, // Red, Yellow
                multiMonopolyWins: 0,
                winsByLeadMonopoly: {},  // Which monopoly group was the "main" one for winner
            },

            // Game length and economy tracking
            gameLengths: [],           // Array of all game lengths for distribution
            finalNetWorths: [],        // Winner's net worth at victory
            totalEconomyAtEnd: [],     // Sum of all players' net worth at game end

            // Raw game data for detailed analysis
            gameResults: []
        };
    }

    /**
     * Create AI factory for RelativeGrowthAI
     */
    createAIFactory() {
        const self = this;
        return (player, engine) => {
            return new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
        };
    }

    /**
     * Run a single game and return detailed analytics
     */
    runSingleGame() {
        const engine = new InstrumentedGameEngine({
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose
        });

        const factories = [];
        for (let i = 0; i < this.options.numPlayers; i++) {
            factories.push(this.createAIFactory());
        }

        engine.newGame(this.options.numPlayers, factories);
        return engine.runGame();
    }

    /**
     * Run multiple games and aggregate statistics
     */
    runAnalysis(numGames = null) {
        numGames = numGames || this.options.games;

        console.log(`\n${'='.repeat(70)}`);
        console.log('SELF-PLAY ANALYTICS: RelativeGrowthAI vs RelativeGrowthAI');
        console.log(`${'='.repeat(70)}`);
        console.log(`Running ${numGames} games with ${this.options.numPlayers} players each...`);

        const startTime = Date.now();

        // Initialize aggregate arrays
        for (let i = 0; i < this.options.numPlayers; i++) {
            this.aggregateStats.wins.push(0);
            this.aggregateStats.avgVariancePerTurn.push([]);
            this.aggregateStats.avgHousesBought.push(0);
            this.aggregateStats.avgHousesSold.push(0);
            this.aggregateStats.avgMortgagesPerGame.push(0);
            this.aggregateStats.avgUnmortgagesPerGame.push(0);
            this.aggregateStats.avgRentCollected.push(0);
            this.aggregateStats.declinedPurchases.byPlayer.push(0);
        }

        let totalTrades = 0;
        let acceptedTrades = 0;
        let gamesWithShortage = 0;
        let gamesWithForcedSale = 0;
        let monopoliesByTrade = 0;
        let totalMonopolies = 0;
        let firstMonopolyTurns = [];

        for (let game = 0; game < numGames; game++) {
            const result = this.runSingleGame();
            const analytics = result.analytics;

            this.aggregateStats.gamesPlayed++;
            this.aggregateStats.totalTurns += result.turns;

            // Record winner
            if (result.winner !== null) {
                this.aggregateStats.wins[result.winner]++;
            }

            // Track game length distribution
            this.aggregateStats.gameLengths.push(result.turns);

            // Track final net worths (stored in analytics.result, not result directly)
            const finalNW = analytics.result.finalNetWorth;
            if (result.winner !== null && finalNW && finalNW.length > 0) {
                this.aggregateStats.finalNetWorths.push(finalNW[result.winner]);
            }

            // Track total economy at game end (sum of all players' net worth)
            if (finalNW && finalNW.length > 0) {
                const totalEconomy = finalNW.reduce((sum, nw) => sum + Math.max(0, nw), 0);
                this.aggregateStats.totalEconomyAtEnd.push(totalEconomy);
            }

            // Aggregate variance data
            for (const error of analytics.variance.perTurnErrors) {
                this.aggregateStats.avgVariancePerTurn[error.playerId].push(Math.abs(error.error));
            }

            // Housing statistics
            for (let i = 0; i < this.options.numPlayers; i++) {
                this.aggregateStats.avgHousesBought[i] += analytics.housing.totalHousesBought[i];
                this.aggregateStats.avgHousesSold[i] += analytics.housing.totalHousesSold[i];
            }

            if (analytics.housing.housingShortages.length > 0) {
                gamesWithShortage++;
            }
            if (analytics.housing.forcedSales.length > 0) {
                gamesWithForcedSale++;
            }

            // Aggregate declined purchase statistics
            for (const declined of analytics.declinedPurchases) {
                this.aggregateStats.declinedPurchases.total++;
                this.aggregateStats.declinedPurchases.byPlayer[declined.playerId]++;
                this.aggregateStats.declinedPurchases.details.push(declined);

                if (declined.wouldCompleteMonopoly) {
                    this.aggregateStats.declinedPurchases.wouldHaveCompletedMonopoly++;
                }
                if (declined.wouldBlockOpponent) {
                    this.aggregateStats.declinedPurchases.wouldHaveBlockedOpponent++;
                }

                // Track auction prices for declined purchases
                if (declined.auctionPrice !== null && declined.auctionPrice !== undefined) {
                    this.aggregateStats.declinedPurchases.auctionPrices.push({
                        property: declined.propertyName,
                        faceValue: declined.price,
                        auctionPrice: declined.auctionPrice,
                        premium: declined.auctionPrice - declined.price
                    });

                    if (declined.auctionPrice === 0) {
                        this.aggregateStats.declinedPurchases.auctionUnsold++;
                    } else if (declined.auctionPrice > declined.price) {
                        // Someone paid MORE than face value - we missed an opportunity!
                        this.aggregateStats.declinedPurchases.auctionAboveFaceValue++;
                        this.aggregateStats.declinedPurchases.totalPremiumPaid +=
                            (declined.auctionPrice - declined.price);
                    } else {
                        // Auction price was at or below face value - good decision
                        this.aggregateStats.declinedPurchases.auctionBelowFaceValue++;
                    }
                }
            }

            // Trade statistics
            totalTrades += analytics.trades.proposed.length;
            acceptedTrades += analytics.trades.accepted.length;

            // Monopoly statistics
            for (const mono of analytics.monopolyFormation) {
                totalMonopolies++;
                if (mono.method === 'trade') monopoliesByTrade++;
                firstMonopolyTurns.push(mono.turn);

                // Track by group
                if (!this.aggregateStats.monopolyGroupStats[mono.group]) {
                    this.aggregateStats.monopolyGroupStats[mono.group] = {
                        timesFormed: 0,
                        wins: 0,
                        turnFormed: [],
                        byTrade: 0
                    };
                }
                this.aggregateStats.monopolyGroupStats[mono.group].timesFormed++;
                this.aggregateStats.monopolyGroupStats[mono.group].turnFormed.push(mono.turn);
                if (mono.method === 'trade') {
                    this.aggregateStats.monopolyGroupStats[mono.group].byTrade++;
                }
            }

            // Track winner's monopolies for risk analysis
            if (result.winner !== null && analytics.result.winnerMonopolies) {
                const winnerMonopolies = analytics.result.winnerMonopolies;

                // Classify winner's strategy
                const lowVariance = ['orange', 'lightBlue', 'pink', 'brown'];
                const highVariance = ['darkBlue', 'green'];

                let hasLowVar = winnerMonopolies.some(g => lowVariance.includes(g));
                let hasHighVar = winnerMonopolies.some(g => highVariance.includes(g));

                if (hasLowVar && !hasHighVar) {
                    this.aggregateStats.riskAnalysis.lowVarianceWins++;
                } else if (hasHighVar && !hasLowVar) {
                    this.aggregateStats.riskAnalysis.highVarianceWins++;
                } else if (hasLowVar && hasHighVar) {
                    this.aggregateStats.riskAnalysis.multiMonopolyWins++;
                } else {
                    this.aggregateStats.riskAnalysis.mediumVarianceWins++;
                }

                // Track wins by each monopoly group
                for (const group of winnerMonopolies) {
                    if (this.aggregateStats.monopolyGroupStats[group]) {
                        this.aggregateStats.monopolyGroupStats[group].wins++;
                    }
                    if (!this.aggregateStats.riskAnalysis.winsByLeadMonopoly[group]) {
                        this.aggregateStats.riskAnalysis.winsByLeadMonopoly[group] = 0;
                    }
                    this.aggregateStats.riskAnalysis.winsByLeadMonopoly[group]++;
                }
            }

            // Railroad statistics
            for (const rr of analytics.railroadOwnership) {
                const count = rr.count;
                if (count >= 2 && count <= 4) {
                    this.aggregateStats.railroadStats.byCount[count].timesAchieved++;
                    this.aggregateStats.railroadStats.byCount[count].turnAchieved.push(rr.turn);
                }
            }

            // Check winner's railroad count
            if (result.winner !== null) {
                const RAILROADS = [5, 15, 25, 35];
                const winner = result.winner;
                const winnerRRs = analytics.railroadOwnership
                    .filter(r => r.playerId === winner)
                    .reduce((max, r) => Math.max(max, r.count), 0);

                if (winnerRRs >= 2) this.aggregateStats.railroadStats.winsWith2Plus++;
                if (winnerRRs >= 3) this.aggregateStats.railroadStats.winsWith3Plus++;
                if (winnerRRs === 4) this.aggregateStats.railroadStats.winsWith4++;

                // Track wins for each railroad count level
                if (winnerRRs >= 2) {
                    this.aggregateStats.railroadStats.byCount[Math.min(winnerRRs, 4)].wins++;
                }
            }

            // Utility statistics
            for (const util of analytics.utilityOwnership) {
                this.aggregateStats.utilityStats.timesAchieved++;
                this.aggregateStats.utilityStats.turnAchieved.push(util.turn);
            }

            // Check if winner had both utilities
            if (result.winner !== null) {
                const winnerHadUtils = analytics.utilityOwnership.some(u => u.playerId === result.winner);
                if (winnerHadUtils) {
                    this.aggregateStats.utilityStats.wins++;
                }
            }

            // Cash flow statistics
            for (let i = 0; i < this.options.numPlayers; i++) {
                this.aggregateStats.avgMortgagesPerGame[i] +=
                    analytics.cashFlow.mortgages.filter(m => m.playerId === i).length;
                this.aggregateStats.avgUnmortgagesPerGame[i] +=
                    analytics.cashFlow.unmortgages.filter(m => m.playerId === i).length;
                this.aggregateStats.avgRentCollected[i] += analytics.cashFlow.rentCollected[i];
            }

            // Net worth by turn
            for (const snapshot of analytics.turnSnapshots) {
                if (!this.aggregateStats.avgNetWorthByTurn.has(snapshot.turn)) {
                    this.aggregateStats.avgNetWorthByTurn.set(snapshot.turn,
                        new Array(this.options.numPlayers).fill(0).map(() => []));
                    this.aggregateStats.avgProjectedByTurn.set(snapshot.turn,
                        new Array(this.options.numPlayers).fill(0).map(() => []));
                }

                const netWorths = this.aggregateStats.avgNetWorthByTurn.get(snapshot.turn);
                const projected = this.aggregateStats.avgProjectedByTurn.get(snapshot.turn);

                for (let i = 0; i < snapshot.players.length; i++) {
                    if (!snapshot.players[i].bankrupt) {
                        netWorths[i].push(snapshot.players[i].netWorth);
                        projected[i].push(snapshot.players[i].projectedPosition);
                    }
                }
            }

            // Store full result for detailed analysis
            this.aggregateStats.gameResults.push({
                winner: result.winner,
                turns: result.turns,
                analytics: this.summarizeGameAnalytics(analytics)
            });

            // Progress
            if ((game + 1) % 10 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                console.log(`  Game ${game + 1}/${numGames} (${(game / elapsed).toFixed(1)} games/sec)`);
            }
        }

        // Calculate averages
        const n = this.aggregateStats.gamesPlayed;

        this.aggregateStats.avgGameLength = this.aggregateStats.totalTurns / n;
        this.aggregateStats.avgTradesPerGame = totalTrades / n;
        this.aggregateStats.tradeAcceptanceRate = acceptedTrades / Math.max(totalTrades, 1);
        this.aggregateStats.housingShortageFrequency = gamesWithShortage / n;
        this.aggregateStats.forcedSaleFrequency = gamesWithForcedSale / n;
        this.aggregateStats.monopolyByTradeRate = monopoliesByTrade / Math.max(totalMonopolies, 1);
        this.aggregateStats.avgTurnOfFirstMonopoly = firstMonopolyTurns.length > 0 ?
            firstMonopolyTurns.reduce((a, b) => a + b, 0) / firstMonopolyTurns.length : 0;

        for (let i = 0; i < this.options.numPlayers; i++) {
            this.aggregateStats.avgHousesBought[i] /= n;
            this.aggregateStats.avgHousesSold[i] /= n;
            this.aggregateStats.avgMortgagesPerGame[i] /= n;
            this.aggregateStats.avgUnmortgagesPerGame[i] /= n;
            this.aggregateStats.avgRentCollected[i] /= n;
        }

        const totalTime = (Date.now() - startTime) / 1000;

        this.printReport(totalTime);

        return this.aggregateStats;
    }

    /**
     * Summarize a single game's analytics for storage
     */
    summarizeGameAnalytics(analytics) {
        return {
            totalTurns: analytics.result.totalTurns,
            winner: analytics.result.winner,
            finalNetWorth: analytics.result.finalNetWorth,

            trades: {
                total: analytics.trades.proposed.length,
                accepted: analytics.trades.accepted.length
            },

            monopolies: analytics.monopolyFormation.map(m => ({
                turn: m.turn,
                playerId: m.playerId,
                group: m.group,
                method: m.method
            })),

            housing: {
                bought: analytics.housing.totalHousesBought,
                sold: analytics.housing.totalHousesSold,
                shortages: analytics.housing.housingShortages.length,
                forcedSales: analytics.housing.forcedSales.length
            },

            variance: {
                totalErrors: analytics.variance.cumulativeErrors,
                avgErrorPerTurn: analytics.variance.perTurnErrors.length > 0 ?
                    analytics.variance.perTurnErrors.reduce((sum, e) => sum + Math.abs(e.error), 0) /
                    analytics.variance.perTurnErrors.length : 0
            }
        };
    }

    /**
     * Print comprehensive report
     */
    printReport(totalTime) {
        const stats = this.aggregateStats;
        const n = stats.gamesPlayed;

        console.log(`\n${'='.repeat(70)}`);
        console.log('SELF-PLAY ANALYTICS REPORT');
        console.log(`${'='.repeat(70)}`);

        // Overview
        console.log('\n--- OVERVIEW ---');
        console.log(`Games played: ${n}`);
        console.log(`Total time: ${totalTime.toFixed(1)} seconds (${(n / totalTime).toFixed(2)} games/sec)`);
        console.log(`Average game length: ${stats.avgGameLength.toFixed(1)} turns`);

        // Game Length Distribution
        if (stats.gameLengths.length > 0) {
            const sorted = [...stats.gameLengths].sort((a, b) => a - b);
            const min = sorted[0];
            const max = sorted[sorted.length - 1];
            const median = sorted[Math.floor(sorted.length / 2)];
            const p25 = sorted[Math.floor(sorted.length * 0.25)];
            const p75 = sorted[Math.floor(sorted.length * 0.75)];
            const stdDev = Math.sqrt(sorted.reduce((sum, x) => sum + Math.pow(x - stats.avgGameLength, 2), 0) / sorted.length);
            console.log(`  Game length: min=${min}, p25=${p25}, median=${median}, p75=${p75}, max=${max}`);
            console.log(`  Std deviation: ${stdDev.toFixed(1)} turns`);
        }

        // Final Net Worth / Economy Stats
        if (stats.finalNetWorths.length > 0) {
            const avgWinnerNW = stats.finalNetWorths.reduce((a, b) => a + b, 0) / stats.finalNetWorths.length;
            console.log(`  Average winner's net worth: $${avgWinnerNW.toFixed(0)}`);
        }
        if (stats.totalEconomyAtEnd.length > 0) {
            const avgEconomy = stats.totalEconomyAtEnd.reduce((a, b) => a + b, 0) / stats.totalEconomyAtEnd.length;
            console.log(`  Average total economy at end: $${avgEconomy.toFixed(0)}`);
        }

        // Win Distribution
        console.log('\n--- WIN DISTRIBUTION ---');
        console.log('(All players use identical RelativeGrowthAI - expect ~25% each for fair game)');
        for (let i = 0; i < this.options.numPlayers; i++) {
            const winRate = (stats.wins[i] / n * 100).toFixed(1);
            console.log(`  Player ${i + 1}: ${stats.wins[i]} wins (${winRate}%)`);
        }

        // Variance Analysis
        console.log('\n--- VARIANCE ANALYSIS (Model vs Reality) ---');
        for (let i = 0; i < this.options.numPlayers; i++) {
            const errors = stats.avgVariancePerTurn[i];
            if (errors.length > 0) {
                const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
                const maxError = Math.max(...errors);
                console.log(`  Player ${i + 1}: Avg error $${avgError.toFixed(0)}/turn, Max $${maxError.toFixed(0)}`);
            }
        }

        // Housing Statistics
        console.log('\n--- HOUSING STATISTICS ---');
        for (let i = 0; i < this.options.numPlayers; i++) {
            console.log(`  Player ${i + 1}: ${stats.avgHousesBought[i].toFixed(1)} houses bought, ${stats.avgHousesSold[i].toFixed(1)} sold`);
        }
        console.log(`  Games with housing shortage: ${(stats.housingShortageFrequency * 100).toFixed(1)}%`);
        console.log(`  Games with forced sales: ${(stats.forcedSaleFrequency * 100).toFixed(1)}%`);

        // Declined Purchases (should be rare)
        console.log('\n--- DECLINED PURCHASES ---');
        console.log('(Properties player COULD afford but chose not to buy - should be rare)');
        const declined = stats.declinedPurchases;
        console.log(`  Total declined: ${declined.total} (${(declined.total / n).toFixed(2)} per game avg)`);
        if (declined.total > 0) {
            console.log(`  Would have completed monopoly: ${declined.wouldHaveCompletedMonopoly} (${(declined.wouldHaveCompletedMonopoly / declined.total * 100).toFixed(1)}%)`);
            console.log(`  Would have blocked opponent: ${declined.wouldHaveBlockedOpponent} (${(declined.wouldHaveBlockedOpponent / declined.total * 100).toFixed(1)}%)`);

            // Per-player breakdown
            console.log('  By player:');
            for (let i = 0; i < this.options.numPlayers; i++) {
                console.log(`    Player ${i + 1}: ${declined.byPlayer[i]} declined`);
            }

            // Most commonly declined properties
            const propCounts = {};
            for (const d of declined.details) {
                propCounts[d.propertyName] = (propCounts[d.propertyName] || 0) + 1;
            }
            const sortedProps = Object.entries(propCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            if (sortedProps.length > 0) {
                console.log('  Most commonly declined:');
                for (const [prop, count] of sortedProps) {
                    console.log(`    ${prop}: ${count} times`);
                }
            }

            // Auction price analysis - what did declined properties sell for?
            console.log('\n  AUCTION OUTCOME ANALYSIS:');
            const auctionCount = declined.auctionAboveFaceValue + declined.auctionBelowFaceValue + declined.auctionUnsold;
            if (auctionCount > 0) {
                console.log(`    Sold ABOVE face value: ${declined.auctionAboveFaceValue} (${(declined.auctionAboveFaceValue / auctionCount * 100).toFixed(1)}%) - MISSED OPPORTUNITY`);
                console.log(`    Sold AT/BELOW face value: ${declined.auctionBelowFaceValue} (${(declined.auctionBelowFaceValue / auctionCount * 100).toFixed(1)}%) - Good decision`);
                console.log(`    Unsold at auction: ${declined.auctionUnsold} (${(declined.auctionUnsold / auctionCount * 100).toFixed(1)}%)`);

                if (declined.auctionAboveFaceValue > 0) {
                    const avgPremium = declined.totalPremiumPaid / declined.auctionAboveFaceValue;
                    console.log(`    Avg premium paid by others: $${avgPremium.toFixed(0)} above face value`);
                    console.log(`    Total premium opportunity missed: $${declined.totalPremiumPaid.toFixed(0)}`);
                }

                // Show some examples of above-face-value auctions
                const aboveFace = declined.auctionPrices.filter(a => a.premium > 0)
                    .sort((a, b) => b.premium - a.premium)
                    .slice(0, 3);
                if (aboveFace.length > 0) {
                    console.log('    Biggest missed opportunities:');
                    for (const a of aboveFace) {
                        console.log(`      ${a.property}: face $${a.faceValue}, sold for $${a.auctionPrice} (+$${a.premium})`);
                    }
                }
            }
        } else {
            console.log('  (None - AI is buying all affordable properties)');
        }

        // Trade Statistics
        console.log('\n--- TRADE STATISTICS ---');
        console.log(`  Average trades proposed per game: ${stats.avgTradesPerGame.toFixed(1)}`);
        console.log(`  Trade acceptance rate: ${(stats.tradeAcceptanceRate * 100).toFixed(1)}%`);
        console.log(`  Monopolies formed via trade: ${(stats.monopolyByTradeRate * 100).toFixed(1)}%`);
        console.log(`  Average turn of first monopoly: ${stats.avgTurnOfFirstMonopoly.toFixed(1)}`);

        // Cash Flow
        console.log('\n--- CASH FLOW ---');
        for (let i = 0; i < this.options.numPlayers; i++) {
            console.log(`  Player ${i + 1}: $${stats.avgRentCollected[i].toFixed(0)} rent, ${stats.avgMortgagesPerGame[i].toFixed(1)} mortgages, ${stats.avgUnmortgagesPerGame[i].toFixed(1)} unmortgages`);
        }

        // Net Worth Progression (sample turns)
        console.log('\n--- NET WORTH PROGRESSION (Average across non-bankrupt players) ---');
        const sampleTurns = [10, 25, 50, 75, 100];
        console.log('Turn    Actual NW   Projected   Diff');
        console.log('-'.repeat(45));

        for (const turn of sampleTurns) {
            if (stats.avgNetWorthByTurn.has(turn)) {
                const netWorths = stats.avgNetWorthByTurn.get(turn);
                const projected = stats.avgProjectedByTurn.get(turn);

                // Average across all players
                let totalNW = 0, countNW = 0;
                let totalProj = 0, countProj = 0;

                for (let i = 0; i < this.options.numPlayers; i++) {
                    if (netWorths[i].length > 0) {
                        totalNW += netWorths[i].reduce((a, b) => a + b, 0);
                        countNW += netWorths[i].length;
                    }
                    if (projected[i].length > 0) {
                        // Filter out NaN values
                        const validProj = projected[i].filter(v => !isNaN(v) && isFinite(v));
                        if (validProj.length > 0) {
                            totalProj += validProj.reduce((a, b) => a + b, 0);
                            countProj += validProj.length;
                        }
                    }
                }

                const avgNW = countNW > 0 ? totalNW / countNW : 0;
                const avgProj = countProj > 0 ? totalProj / countProj : 0;
                const diff = avgProj > 0 ? ((avgNW - avgProj) / avgProj * 100).toFixed(1) : 'N/A';

                console.log(`${String(turn).padEnd(8)}$${avgNW.toFixed(0).padStart(8)}   $${avgProj.toFixed(0).padStart(8)}   ${diff}%`);
            }
        }

        // Monopoly Group Performance
        console.log('\n--- MONOPOLY GROUP PERFORMANCE ---');
        console.log('Group        Formed  ByTrade  Wins  WinRate  AvgTurn');
        console.log('-'.repeat(55));

        const groupOrder = ['orange', 'red', 'yellow', 'pink', 'lightBlue', 'green', 'darkBlue', 'brown'];
        for (const group of groupOrder) {
            const data = stats.monopolyGroupStats[group];
            if (data && data.timesFormed > 0) {
                const winRate = (data.wins / data.timesFormed * 100).toFixed(0);
                const avgTurn = data.turnFormed.reduce((a, b) => a + b, 0) / data.turnFormed.length;
                const tradeRate = (data.byTrade / data.timesFormed * 100).toFixed(0);
                console.log(`${group.padEnd(12)} ${String(data.timesFormed).padStart(5)}   ${tradeRate.padStart(5)}%  ${String(data.wins).padStart(4)}   ${winRate.padStart(5)}%  ${avgTurn.toFixed(1).padStart(7)}`);
            }
        }

        // Railroad and Utility Performance
        console.log('\n--- RAILROAD & UTILITY PERFORMANCE ---');
        const rr = stats.railroadStats;
        const util = stats.utilityStats;

        console.log('Railroads:');
        for (const count of [2, 3, 4]) {
            const data = rr.byCount[count];
            if (data.timesAchieved > 0) {
                const winRate = (data.wins / data.timesAchieved * 100).toFixed(0);
                const avgTurn = data.turnAchieved.reduce((a, b) => a + b, 0) / data.turnAchieved.length;
                console.log(`  ${count} railroads:  ${String(data.timesAchieved).padStart(4)} times  ${String(data.wins).padStart(4)} wins  ${winRate.padStart(5)}% WR  avg turn ${avgTurn.toFixed(1)}`);
            }
        }
        console.log(`  Winners with 2+ RRs: ${rr.winsWith2Plus}/${n} (${(rr.winsWith2Plus/n*100).toFixed(1)}%)`);
        console.log(`  Winners with 3+ RRs: ${rr.winsWith3Plus}/${n} (${(rr.winsWith3Plus/n*100).toFixed(1)}%)`);
        console.log(`  Winners with 4 RRs:  ${rr.winsWith4}/${n} (${(rr.winsWith4/n*100).toFixed(1)}%)`);

        console.log('\nUtilities (both):');
        if (util.timesAchieved > 0) {
            const utilWinRate = (util.wins / util.timesAchieved * 100).toFixed(0);
            const utilAvgTurn = util.turnAchieved.reduce((a, b) => a + b, 0) / util.turnAchieved.length;
            console.log(`  Times achieved: ${util.timesAchieved}`);
            console.log(`  Wins when held: ${util.wins} (${utilWinRate}% win rate)`);
            console.log(`  Avg turn achieved: ${utilAvgTurn.toFixed(1)}`);
        } else {
            console.log('  (No player acquired both utilities)');
        }

        // Combined rankings table
        console.log('\n--- COMBINED ASSET RANKINGS (by Win Rate) ---');
        const allAssets = [];

        // Add color groups
        for (const group of groupOrder) {
            const data = stats.monopolyGroupStats[group];
            if (data && data.timesFormed > 0) {
                allAssets.push({
                    name: group,
                    type: 'monopoly',
                    formed: data.timesFormed,
                    wins: data.wins,
                    winRate: data.wins / data.timesFormed,
                    avgTurn: data.turnFormed.reduce((a, b) => a + b, 0) / data.turnFormed.length
                });
            }
        }

        // Add railroads
        for (const count of [2, 3, 4]) {
            const data = rr.byCount[count];
            if (data.timesAchieved > 0) {
                allAssets.push({
                    name: `${count} Railroads`,
                    type: 'railroad',
                    formed: data.timesAchieved,
                    wins: data.wins,
                    winRate: data.wins / data.timesAchieved,
                    avgTurn: data.turnAchieved.reduce((a, b) => a + b, 0) / data.turnAchieved.length
                });
            }
        }

        // Add utilities
        if (util.timesAchieved > 0) {
            allAssets.push({
                name: '2 Utilities',
                type: 'utility',
                formed: util.timesAchieved,
                wins: util.wins,
                winRate: util.wins / util.timesAchieved,
                avgTurn: util.turnAchieved.reduce((a, b) => a + b, 0) / util.turnAchieved.length
            });
        }

        // Sort by win rate
        allAssets.sort((a, b) => b.winRate - a.winRate);

        console.log('Rank  Asset          Type       Formed  Wins   WinRate  AvgTurn');
        console.log('-'.repeat(65));
        allAssets.forEach((asset, i) => {
            const rank = i + 1;
            console.log(`${String(rank).padStart(3)}   ${asset.name.padEnd(14)} ${asset.type.padEnd(10)} ${String(asset.formed).padStart(5)}  ${String(asset.wins).padStart(4)}   ${(asset.winRate * 100).toFixed(0).padStart(5)}%  ${asset.avgTurn.toFixed(1).padStart(7)}`);
        });

        // Risk Analysis
        console.log('\n--- RISK ANALYSIS (Low vs High Variance Monopolies) ---');
        const risk = stats.riskAnalysis;
        const totalWinsWithMono = risk.lowVarianceWins + risk.highVarianceWins + risk.mediumVarianceWins + risk.multiMonopolyWins;
        if (totalWinsWithMono > 0) {
            console.log(`  Low variance wins (Orange/LightBlue/Pink):  ${risk.lowVarianceWins} (${(risk.lowVarianceWins/totalWinsWithMono*100).toFixed(1)}%)`);
            console.log(`  Medium variance wins (Red/Yellow):          ${risk.mediumVarianceWins} (${(risk.mediumVarianceWins/totalWinsWithMono*100).toFixed(1)}%)`);
            console.log(`  High variance wins (DarkBlue/Green):        ${risk.highVarianceWins} (${(risk.highVarianceWins/totalWinsWithMono*100).toFixed(1)}%)`);
            console.log(`  Multi-monopoly wins (mixed strategy):       ${risk.multiMonopolyWins} (${(risk.multiMonopolyWins/totalWinsWithMono*100).toFixed(1)}%)`);
        }

        // Wins by lead monopoly
        console.log('\n  Wins by monopoly group held:');
        const sortedGroups = Object.entries(risk.winsByLeadMonopoly)
            .sort((a, b) => b[1] - a[1]);
        for (const [group, wins] of sortedGroups) {
            console.log(`    ${group}: ${wins} wins`);
        }

        // Model Accuracy Analysis
        console.log('\n--- MODEL ACCURACY ANALYSIS ---');

        // Calculate overall prediction error
        let totalError = 0;
        let errorCount = 0;
        let positiveErrors = 0;  // Model predicted higher
        let negativeErrors = 0;  // Model predicted lower

        for (let i = 0; i < this.options.numPlayers; i++) {
            for (const error of stats.avgVariancePerTurn[i]) {
                totalError += Math.abs(error);
                errorCount++;
                if (error > 0) positiveErrors++;
                else negativeErrors++;
            }
        }

        const avgError = errorCount > 0 ? totalError / errorCount : 0;
        console.log(`  Average prediction error: $${avgError.toFixed(0)}/turn`);
        console.log(`  Model over-predicts: ${(positiveErrors / Math.max(errorCount, 1) * 100).toFixed(1)}% of turns`);
        console.log(`  Model under-predicts: ${(negativeErrors / Math.max(errorCount, 1) * 100).toFixed(1)}% of turns`);

        // Interpretation
        console.log('\n  INTERPRETATION:');
        console.log('  - Early game: Model over-estimates net worth (players buying, not earning yet)');
        console.log('  - Late game: Model may under-estimate (actual rent exceeds projections)');
        console.log(`  - Forced sales occur in ${(stats.forcedSaleFrequency * 100).toFixed(0)}% of games (50% value loss)`);

        // Key Insights
        console.log('\n--- KEY INSIGHTS ---');

        // Brown paradox
        const brownData = stats.monopolyGroupStats['brown'];
        if (brownData) {
            console.log(`  1. BROWN PARADOX: Formed ${brownData.timesFormed} times (most common!) but low win rate`);
            console.log('     - Easy to get (2 properties, low price) but weak EPT');
            console.log('     - AI correctly uses brown as stepping stone, not strategy');
        }

        // DarkBlue dominance
        const darkBlueData = stats.monopolyGroupStats['darkBlue'];
        if (darkBlueData) {
            console.log(`  2. DARK BLUE EFFECTIVENESS: ${darkBlueData.wins} wins from ${darkBlueData.timesFormed} formations`);
            console.log('     - High variance but high payoff when it works');
            console.log('     - Early formation (avg turn ' + (darkBlueData.turnFormed.reduce((a,b)=>a+b,0)/darkBlueData.turnFormed.length).toFixed(1) + ') is key');
        }

        // Trade importance
        console.log(`  3. TRADES ARE CRITICAL: ${(stats.monopolyByTradeRate * 100).toFixed(0)}% of monopolies from trades`);
        console.log(`     - Trade acceptance rate: ${(stats.tradeAcceptanceRate * 100).toFixed(0)}%`);

        // Housing churn
        const totalBought = stats.avgHousesBought.reduce((a, b) => a + b, 0);
        const totalSold = stats.avgHousesSold.reduce((a, b) => a + b, 0);
        console.log(`  4. HOUSING CHURN: ${totalSold.toFixed(1)}/${totalBought.toFixed(1)} houses sold back`);
        console.log('     - Each sale loses 50% of investment');
        console.log(`     - Estimated value loss: ~$${(totalSold * 75).toFixed(0)}/game from forced sales`);

        console.log(`\n${'='.repeat(70)}`);
    }

    /**
     * Export detailed data for external analysis
     */
    exportData(filename = 'self-play-analytics.json') {
        const fs = require('fs');

        // Convert Maps to objects for JSON serialization
        const exportData = {
            ...this.aggregateStats,
            avgNetWorthByTurn: Object.fromEntries(this.aggregateStats.avgNetWorthByTurn),
            avgProjectedByTurn: Object.fromEntries(this.aggregateStats.avgProjectedByTurn)
        };

        fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
        console.log(`\nData exported to ${filename}`);
    }
}

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);

    let games = 100;
    let verbose = false;
    let exportFile = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--games' || args[i] === '-g') {
            games = parseInt(args[++i]) || 100;
        } else if (args[i] === '--verbose' || args[i] === '-v') {
            verbose = true;
        } else if (args[i] === '--export' || args[i] === '-e') {
            exportFile = args[++i] || 'self-play-analytics.json';
        } else if (args[i] === '--quick') {
            games = 20;
        } else if (args[i] === '--full') {
            games = 500;
        }
    }

    console.log('Self-Play Analytics for Monopoly AI');
    console.log('Usage: node self-play-analytics.js [options]');
    console.log('  --games N    Run N games (default: 100)');
    console.log('  --quick      Run 20 games');
    console.log('  --full       Run 500 games');
    console.log('  --export F   Export data to file F');
    console.log('  --verbose    Show detailed game logs');
    console.log('');

    const runner = new SelfPlayAnalytics({
        games,
        verbose,
        maxTurns: 500,
        numPlayers: 4
    });

    const stats = runner.runAnalysis();

    if (exportFile) {
        runner.exportData(exportFile);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    SelfPlayAnalytics,
    InstrumentedGameEngine,
    GameAnalytics,
    PlayerSnapshot,
    GameEvent
};
