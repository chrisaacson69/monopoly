/**
 * Strategic AI - Drop-in replacement for AITest
 *
 * This file wraps the MonopolyAI.StrategicAI class in a format compatible
 * with the existing game interface (same signature as AITest).
 *
 * Usage:
 * 1. Include markov-engine.js, property-valuator.js, and monopoly-ai.js first
 * 2. Then include this file
 * 3. Replace AITest references with StrategicAI:
 *    - Change: p.AI = new AITest(p);
 *    - To:     p.AI = new StrategicAI(p);
 *
 * Or use the hybrid approach:
 *    p.AI = new StrategicAI(p);  // Uses advanced EPT-based decisions
 */

/**
 * Strategic AI constructor compatible with the game's AI interface.
 *
 * @param {Object} p - The player object this AI controls
 */
function StrategicAI(p) {
    'use strict';

    // Static counter for naming
    if (!this.constructor.count) {
        this.constructor.count = 0;
    }
    this.constructor.count++;

    // Store reference to player
    this.player = p;
    this.alertList = "";

    // Set player name
    p.name = "Strategic AI " + this.constructor.count;

    // Create game state reference object
    // This provides access to global game state variables
    this.gameState = {
        get player() { return window.player; },
        get square() { return window.square; },
        get turn() { return window.turn; },
        get pcount() { return window.pcount; },
        get game() { return window.game; }
    };

    // Initialize Markov engine (shared across all AI instances)
    if (!StrategicAI._markovEngine) {
        console.log('StrategicAI: Initializing shared Markov engine...');
        StrategicAI._markovEngine = new MonopolyMarkov.MarkovEngine();
        StrategicAI._markovEngine.initialize();
    }
    this.markovEngine = StrategicAI._markovEngine;

    // Initialize Property Valuator (shared across all AI instances)
    if (!StrategicAI._valuator) {
        console.log('StrategicAI: Initializing shared Property Valuator...');
        StrategicAI._valuator = new PropertyValuator.Valuator(this.markovEngine);
        StrategicAI._valuator.initialize();
    }
    this.valuator = StrategicAI._valuator;

    // Configuration
    this.config = {
        // Minimum cash reserves
        MIN_RESERVE_EARLY: 200,
        MIN_RESERVE_MID: 150,
        MIN_RESERVE_LATE: 100,

        // Trade thresholds
        TRADE_ADVANTAGE_THRESHOLD: 0.05,
        MONOPOLY_COMPLETION_BONUS: 1.5,

        // Auction limits
        AUCTION_MAX_OVERPAY: 1.3,

        // Jail strategy
        JAIL_STAY_THRESHOLD: 4,

        // Debug output
        DEBUG: false
    };

    console.log(`StrategicAI: Player "${p.name}" initialized`);

    // =========================================================================
    // INTERFACE METHODS (same signature as AITest)
    // =========================================================================

    /**
     * Decide whether to buy a property the AI landed on.
     * @param {number} index - The property's index (0-39)
     * @returns {boolean} true to buy
     */
    this.buyProperty = function(index) {
        console.log("StrategicAI.buyProperty:", index);

        const sq = square[index];
        const analysis = this._analyzeGameState();

        // Can't buy if insufficient funds
        if (p.money < sq.price) {
            return false;
        }

        // Calculate reserve requirement
        const minReserve = this._getMinReserve(analysis);
        const availableFunds = p.money - minReserve;

        // Early game: buy most things
        if (analysis.gamePhase === 'early' && p.money > sq.price) {
            return true;
        }

        // Check if completing a monopoly
        if (this._completesMonopoly(index, analysis)) {
            // Worth stretching budget for monopoly completion
            return p.money >= sq.price;
        }

        // Check if blocking opponent's monopoly
        if (this._blocksOpponentMonopoly(index, analysis)) {
            return p.money >= sq.price;
        }

        // Standard purchase: check ROI
        if (availableFunds >= sq.price) {
            const diffValue = this._calculateDifferentialValue(index, analysis);
            const turnsToPay = sq.price / Math.max(diffValue, 0.01);

            if (this.config.DEBUG) {
                console.log(`Buy analysis: diffValue=${diffValue.toFixed(3)}, payback=${turnsToPay.toFixed(1)} turns`);
            }

            return turnsToPay < 40;  // Buy if payback within 40 turns
        }

        return false;
    };

    /**
     * Determine the response to an offered trade.
     * @param {Object} tradeObj - The proposed trade
     * @returns {boolean|Trade} true to accept, false to decline, Trade for counter-offer
     */
    this.acceptTrade = function(tradeObj) {
        console.log("StrategicAI.acceptTrade");

        const analysis = this._analyzeGameState();
        let myEPTChange = 0;

        // Evaluate each component of the trade
        const money = tradeObj.getMoney();

        // Property changes
        for (let i = 0; i < 40; i++) {
            const propTrade = tradeObj.getProperty(i);
            if (propTrade === 0) continue;

            const diffValue = this._calculateDifferentialValue(i, analysis);

            if (propTrade > 0) {
                // Receiving property
                myEPTChange += diffValue;
            } else {
                // Giving up property
                myEPTChange -= diffValue;
            }
        }

        // Convert money to EPT equivalent (rough: $200 ≈ 1 EPT unit)
        myEPTChange += money / 200;

        // Jail cards have minor value
        myEPTChange += tradeObj.getCommunityChestJailCard() * 0.05;
        myEPTChange += tradeObj.getChanceJailCard() * 0.05;

        if (this.config.DEBUG) {
            console.log(`Trade EPT change: ${myEPTChange.toFixed(4)}`);
        }

        // Accept if positive advantage
        if (myEPTChange > this.config.TRADE_ADVANTAGE_THRESHOLD) {
            return true;
        }

        // Simple counter-offer: ask for money to compensate
        if (myEPTChange > -0.5 && myEPTChange <= this.config.TRADE_ADVANTAGE_THRESHOLD) {
            const compensationNeeded = Math.ceil((this.config.TRADE_ADVANTAGE_THRESHOLD - myEPTChange) * 200) + 25;
            const initiator = tradeObj.getInitiator();

            if (initiator.money >= compensationNeeded + money) {
                // Create counter-offer with more money
                const property = [];
                for (let i = 0; i < 40; i++) {
                    property[i] = tradeObj.getProperty(i);
                }

                return new Trade(
                    initiator,
                    tradeObj.getRecipient(),
                    money + compensationNeeded,
                    property,
                    tradeObj.getCommunityChestJailCard(),
                    tradeObj.getChanceJailCard()
                );
            }
        }

        return false;
    };

    /**
     * Called before the AI's turn - manage property and trades.
     * @returns {boolean} true if a trade was proposed
     */
    this.beforeTurn = function() {
        console.log("StrategicAI.beforeTurn");

        const analysis = this._analyzeGameState();

        // Build houses on monopolies
        this._buildHouses(analysis);

        // Unmortgage properties if we have excess cash
        this._unmortgageProperties(analysis);

        // TODO: Initiate trades when advantageous
        // For now, don't initiate trades (complex negotiation)

        return false;
    };

    /**
     * Called when AI lands on a square - opportunity to trade.
     * @returns {boolean} true if trade proposed
     */
    this.onLand = function() {
        console.log("StrategicAI.onLand");
        // Could implement trade initiation here
        return false;
    };

    /**
     * Decide whether to post bail or use get-out-of-jail card.
     * @returns {boolean} true to post bail/use card
     */
    this.postBail = function() {
        console.log("StrategicAI.postBail");

        const analysis = this._analyzeGameState();
        const strategy = this._determineJailStrategy(analysis);

        // On 3rd turn, must leave
        if (p.jailroll >= 2) {
            return true;
        }

        // Leave early strategy
        if (strategy === 'leave') {
            // Use card if available, otherwise pay
            return true;
        }

        // Stay strategy: remain in jail
        return false;
    };

    /**
     * Mortgage properties to pay debt.
     */
    this.payDebt = function() {
        console.log("StrategicAI.payDebt");

        const analysis = this._analyzeGameState();
        const amountNeeded = Math.abs(p.money);

        // Get mortgageable properties sorted by lowest EPT impact
        const mortgageOptions = [];

        for (const sq of analysis.myProperties) {
            const sqData = square[sq];
            if (sqData.mortgage) continue;
            if ((sqData.house || 0) > 0) continue;

            const diffValue = this._calculateDifferentialValue(sq, analysis);
            const mortgageValue = sqData.price * 0.5;

            mortgageOptions.push({
                square: sq,
                mortgageValue,
                diffValue
            });
        }

        // Sort by lowest value first (sacrifice least valuable)
        mortgageOptions.sort((a, b) => a.diffValue - b.diffValue);

        let raised = 0;
        for (const opt of mortgageOptions) {
            if (raised >= amountNeeded || p.money >= 0) break;

            mortgage(opt.square);
            raised += opt.mortgageValue;

            if (this.config.DEBUG) {
                console.log(`Mortgaged ${square[opt.square].name} for $${opt.mortgageValue}`);
            }
        }
    };

    /**
     * Decide auction bid amount.
     * @param {number} property - Property index
     * @param {number} currentBid - Current highest bid
     * @returns {number} -1 to exit, 0 to pass, positive to bid
     */
    this.bid = function(property, currentBid) {
        console.log("StrategicAI.bid:", property, currentBid);

        const sq = square[property];
        const analysis = this._analyzeGameState();
        const minReserve = this._getMinReserve(analysis);
        const maxBid = p.money - minReserve;

        if (maxBid <= currentBid) {
            return -1;  // Exit auction
        }

        // Calculate max willing to pay
        let maxWilling = sq.price;

        // Bonus for completing monopoly
        if (this._completesMonopoly(property, analysis)) {
            maxWilling *= this.config.MONOPOLY_COMPLETION_BONUS;
        }

        // Bonus for blocking opponent
        if (this._blocksOpponentMonopoly(property, analysis)) {
            maxWilling *= 1.2;
        }

        // Cap at config limit
        maxWilling = Math.min(maxWilling, sq.price * this.config.AUCTION_MAX_OVERPAY);
        maxWilling = Math.min(maxWilling, maxBid);

        if (currentBid >= maxWilling) {
            return -1;  // Too expensive
        }

        // Bid incrementally
        const increment = Math.max(10, Math.round((maxWilling - currentBid) * 0.25));
        const bid = Math.min(currentBid + increment, maxWilling, maxBid);

        return bid;
    };

    // =========================================================================
    // INTERNAL HELPER METHODS
    // =========================================================================

    /**
     * Analyze current game state.
     */
    this._analyzeGameState = function() {
        const analysis = {
            myIndex: p.index,
            myMoney: p.money,
            myProperties: [],
            myMonopolies: [],
            myRailroads: 0,
            myUtilities: 0,
            opponentProperties: [],
            opponentDevelopedProperties: 0,
            unownedProperties: [],
            groupOwnership: {},
            gamePhase: 'early',
            opponents: []
        };

        // Analyze board
        for (let i = 0; i < 40; i++) {
            const sq = square[i];
            if (!sq.price) continue;

            const groupNum = sq.groupNumber;

            if (!analysis.groupOwnership[groupNum]) {
                analysis.groupOwnership[groupNum] = {
                    squares: [],
                    owners: new Set(),
                    totalSquares: 0
                };
            }
            analysis.groupOwnership[groupNum].squares.push(i);
            analysis.groupOwnership[groupNum].totalSquares++;

            if (sq.owner === 0) {
                analysis.unownedProperties.push(i);
            } else if (sq.owner === p.index) {
                analysis.myProperties.push(i);
                analysis.groupOwnership[groupNum].owners.add(p.index);

                if (groupNum === 1) analysis.myRailroads++;
                if (groupNum === 2) analysis.myUtilities++;
            } else {
                analysis.opponentProperties.push({
                    square: i,
                    owner: sq.owner,
                    houses: sq.house || 0
                });
                analysis.groupOwnership[groupNum].owners.add(sq.owner);

                if ((sq.house || 0) > 0) {
                    analysis.opponentDevelopedProperties++;
                }
            }
        }

        // Determine monopolies
        for (const [groupNum, info] of Object.entries(analysis.groupOwnership)) {
            if (info.owners.size === 1 && info.owners.has(p.index)) {
                analysis.myMonopolies.push(parseInt(groupNum));
            }
        }

        // Count opponents
        for (let i = 1; i <= pcount; i++) {
            if (i !== p.index && player[i]) {
                analysis.opponents.push({
                    index: i,
                    money: player[i].money
                });
            }
        }

        // Determine game phase
        const propertiesSold = analysis.myProperties.length + analysis.opponentProperties.length;
        if (propertiesSold < 12) {
            analysis.gamePhase = 'early';
        } else if (propertiesSold < 22 || analysis.myMonopolies.length === 0) {
            analysis.gamePhase = 'mid';
        } else {
            analysis.gamePhase = 'late';
        }

        return analysis;
    };

    /**
     * Get minimum cash reserve based on game phase.
     */
    this._getMinReserve = function(analysis) {
        switch (analysis.gamePhase) {
            case 'early': return this.config.MIN_RESERVE_EARLY;
            case 'mid': return this.config.MIN_RESERVE_MID;
            case 'late': return this.config.MIN_RESERVE_LATE;
            default: return this.config.MIN_RESERVE_EARLY;
        }
    };

    /**
     * Calculate differential value of owning a property.
     */
    this._calculateDifferentialValue = function(squareIndex, analysis) {
        const jailStrategy = this._determineJailStrategy(analysis);
        const prob = this.markovEngine.getLandingProbability(squareIndex, jailStrategy);
        const sq = square[squareIndex];

        if (!sq.price) return 0;

        // For regular properties
        const propData = PropertyValuator.PROPERTIES[squareIndex];
        if (propData) {
            // Check if completing monopoly
            let rent;
            if (this._completesMonopoly(squareIndex, analysis) || this._ownsMonopoly(sq.groupNumber, analysis)) {
                rent = propData.rent[3];  // Value at 3 houses
            } else {
                rent = propData.rent[0];  // Base rent
            }

            return prob * rent * analysis.opponents.length;
        }

        // Railroads
        if (sq.groupNumber === 1) {
            const rent = PropertyValuator.RAILROAD_RENT[analysis.myRailroads + 1] || 25;
            return prob * rent * analysis.opponents.length;
        }

        // Utilities
        if (sq.groupNumber === 2) {
            const multiplier = PropertyValuator.UTILITY_RENT_MULTIPLIER[analysis.myUtilities + 1] || 4;
            const rent = multiplier * 7;  // Expected dice roll
            return prob * rent * analysis.opponents.length;
        }

        return 0;
    };

    /**
     * Check if buying a property completes a monopoly.
     */
    this._completesMonopoly = function(squareIndex, analysis) {
        const sq = square[squareIndex];
        const groupNum = sq.groupNumber;
        if (!groupNum || groupNum <= 2) return false;  // Not a color group

        const groupInfo = analysis.groupOwnership[groupNum];
        if (!groupInfo) return false;

        // Count how many we own
        const myOwned = groupInfo.squares.filter(i =>
            i !== squareIndex && square[i].owner === p.index
        ).length;

        // Would complete if we own all but one and this is that one
        return myOwned === groupInfo.totalSquares - 1;
    };

    /**
     * Check if we own a monopoly on a group.
     */
    this._ownsMonopoly = function(groupNum, analysis) {
        return analysis.myMonopolies.includes(groupNum);
    };

    /**
     * Check if buying blocks an opponent's monopoly.
     */
    this._blocksOpponentMonopoly = function(squareIndex, analysis) {
        const sq = square[squareIndex];
        const groupNum = sq.groupNumber;
        if (!groupNum || groupNum <= 2) return false;

        const groupInfo = analysis.groupOwnership[groupNum];
        if (!groupInfo) return false;

        // Check if any opponent owns all but one in this group
        for (let oppIndex = 1; oppIndex <= pcount; oppIndex++) {
            if (oppIndex === p.index) continue;

            const oppOwned = groupInfo.squares.filter(i =>
                i !== squareIndex && square[i].owner === oppIndex
            ).length;

            if (oppOwned === groupInfo.totalSquares - 1) {
                return true;
            }
        }

        return false;
    };

    /**
     * Determine optimal jail strategy.
     */
    this._determineJailStrategy = function(analysis) {
        if (analysis.gamePhase === 'early') {
            return 'leave';
        }

        if (analysis.opponentDevelopedProperties >= this.config.JAIL_STAY_THRESHOLD) {
            return 'stay';
        }

        return 'leave';
    };

    /**
     * Build houses on monopolies.
     */
    this._buildHouses = function(analysis) {
        const minReserve = this._getMinReserve(analysis);
        let availableFunds = p.money - minReserve;

        if (availableFunds <= 0) return;

        // For each monopoly, try to build
        for (const groupNum of analysis.myMonopolies) {
            if (groupNum <= 2) continue;  // Skip railroads/utilities

            const groupSquares = analysis.groupOwnership[groupNum].squares;
            const firstProp = PropertyValuator.PROPERTIES[groupSquares[0]];
            if (!firstProp) continue;

            const housePrice = firstProp.housePrice;

            // Build evenly
            while (availableFunds >= housePrice) {
                // Find property with fewest houses
                let minHouses = 6;
                let targetSquare = null;

                for (const sq of groupSquares) {
                    const houses = square[sq].house || 0;
                    if (houses < minHouses && houses < 5) {
                        minHouses = houses;
                        targetSquare = sq;
                    }
                }

                if (targetSquare === null) break;

                // Build house
                buyHouse(targetSquare);
                availableFunds -= housePrice;

                if (this.config.DEBUG) {
                    console.log(`Built house on ${square[targetSquare].name}`);
                }
            }
        }
    };

    /**
     * Unmortgage properties if excess cash.
     */
    this._unmortgageProperties = function(analysis) {
        const minReserve = this._getMinReserve(analysis);
        let availableFunds = p.money - minReserve;

        if (availableFunds <= 0) return;

        // Find mortgaged properties
        const mortgaged = analysis.myProperties.filter(sq => square[sq].mortgage);

        // Sort by highest value first
        mortgaged.sort((a, b) =>
            this._calculateDifferentialValue(b, analysis) -
            this._calculateDifferentialValue(a, analysis)
        );

        for (const sq of mortgaged) {
            const cost = square[sq].price * 0.55;
            if (cost > availableFunds) continue;

            unmortgage(sq);
            availableFunds -= cost;

            if (this.config.DEBUG) {
                console.log(`Unmortgaged ${square[sq].name}`);
            }
        }
    };

    /**
     * Get landing probability for a square.
     */
    this.getLandingProbability = function(squareIndex, jailStrategy) {
        return this.markovEngine.getLandingProbability(squareIndex, jailStrategy || 'stay');
    };

    /**
     * Get all probabilities (for debugging/display).
     */
    this.getAllProbabilities = function(jailStrategy) {
        return this.markovEngine.getAllProbabilities(jailStrategy || 'stay');
    };

    /**
     * Get EPT tables (for debugging/display).
     */
    this.getEPTTables = function(jailStrategy) {
        return this.valuator.getTables(jailStrategy || 'stay');
    };
}

// Static counter
StrategicAI.count = 0;
