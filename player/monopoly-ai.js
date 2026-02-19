/**
 * Monopoly AI - EPT-Based Decision Engine
 *
 * A financially-principled AI player for Monopoly that makes decisions based on
 * Earnings Per Turn (EPT) analysis and differential advantage strategy.
 *
 * Core Strategy:
 * - Maximize own EPT while minimizing opponents' potential EPT
 * - Use Markov chain probabilities for accurate landing calculations
 * - Consider game phase (early/mid/late) for tactical adjustments
 * - Maintain liquidity for opportunities and survival
 *
 * Based on work by Ash & Bishop and subsequent EPT analysis.
 */

// Assumes MonopolyMarkov and PropertyValuator are loaded
// In browser: <script src="markov-engine.js"></script>
// In Node: const MonopolyMarkov = require('./markov-engine');

const MonopolyAI = (function() {
    'use strict';

    // ==========================================================================
    // CONFIGURATION
    // ==========================================================================

    const CONFIG = {
        // Minimum cash reserves (don't spend below this)
        MIN_RESERVE_EARLY: 200,    // Early game - need flexibility
        MIN_RESERVE_MID: 150,      // Mid game
        MIN_RESERVE_LATE: 100,     // Late game - survival mode

        // Game phase thresholds (based on turns or properties sold)
        EARLY_GAME_MAX_TURNS: 20,
        MID_GAME_MAX_TURNS: 50,

        // Trade evaluation
        TRADE_ADVANTAGE_THRESHOLD: 0.05,  // Minimum EPT advantage to accept trade
        MONOPOLY_COMPLETION_BONUS: 1.5,   // Multiplier for completing a monopoly

        // Auction strategy
        AUCTION_MAX_OVERPAY: 1.3,  // Max multiple of property value to bid

        // Jail strategy
        JAIL_STAY_THRESHOLD: 4,    // Number of developed opponent properties to prefer staying

        // House building
        THIRD_HOUSE_PRIORITY: true,  // Prioritize 3rd house (best marginal ROI usually)

        // Debug
        DEBUG: false
    };

    // ==========================================================================
    // GAME STATE ANALYSIS
    // ==========================================================================

    /**
     * Analyzes the current board state to extract relevant information.
     *
     * @param {Object} gameState - Reference to game state (player array, square array, etc.)
     * @param {number} myIndex - This AI player's index
     * @returns {Object} Analyzed state
     */
    function analyzeGameState(gameState, myIndex) {
        const { player, square, turn } = gameState;
        const me = player[myIndex];

        const analysis = {
            myIndex,
            turn,
            myMoney: me.money,
            myProperties: [],
            myGroups: {},
            myMonopolies: [],
            myRailroads: 0,
            myUtilities: 0,

            opponents: [],
            opponentProperties: [],
            opponentMonopolies: [],
            opponentDevelopedProperties: 0,

            unownedProperties: [],
            groupOwnership: {},
            gamePhase: 'early'
        };

        // Analyze each square
        for (let i = 0; i < 40; i++) {
            const sq = square[i];
            if (!sq.price) continue;  // Not a property

            const groupNum = sq.groupNumber;

            // Track group ownership
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
            } else if (sq.owner === myIndex) {
                analysis.myProperties.push(i);
                analysis.groupOwnership[groupNum].owners.add(myIndex);

                // Track special properties
                if (groupNum === 1) analysis.myRailroads++;
                if (groupNum === 2) analysis.myUtilities++;
            } else {
                analysis.opponentProperties.push({
                    square: i,
                    owner: sq.owner,
                    houses: sq.house || 0,
                    mortgage: sq.mortgage || false
                });
                analysis.groupOwnership[groupNum].owners.add(sq.owner);

                if ((sq.house || 0) > 0) {
                    analysis.opponentDevelopedProperties++;
                }
            }
        }

        // Determine monopolies
        for (const [groupNum, info] of Object.entries(analysis.groupOwnership)) {
            if (info.owners.size === 1 && info.owners.has(myIndex)) {
                analysis.myMonopolies.push(parseInt(groupNum));
            } else if (info.owners.size === 1) {
                const owner = [...info.owners][0];
                if (owner !== myIndex && owner !== 0) {
                    analysis.opponentMonopolies.push({
                        group: parseInt(groupNum),
                        owner
                    });
                }
            }
        }

        // Analyze opponents
        for (let i = 1; i < player.length; i++) {
            if (i !== myIndex && player[i].money !== undefined) {
                analysis.opponents.push({
                    index: i,
                    money: player[i].money,
                    propertyCount: player[i].properties ? player[i].properties.length : 0
                });
            }
        }

        // Determine game phase
        const propertiesSold = 40 - analysis.unownedProperties.length -
                              analysis.unownedProperties.filter(i => !square[i].price).length;
        const anyMonopolies = analysis.myMonopolies.length > 0 || analysis.opponentMonopolies.length > 0;

        if (propertiesSold < 10 && !anyMonopolies) {
            analysis.gamePhase = 'early';
        } else if (propertiesSold < 20 || !anyMonopolies) {
            analysis.gamePhase = 'mid';
        } else {
            analysis.gamePhase = 'late';
        }

        return analysis;
    }

    /**
     * Calculate the minimum cash reserve based on game phase and board state.
     */
    function getMinReserve(analysis) {
        switch (analysis.gamePhase) {
            case 'early': return CONFIG.MIN_RESERVE_EARLY;
            case 'mid': return CONFIG.MIN_RESERVE_MID;
            case 'late': return CONFIG.MIN_RESERVE_LATE;
            default: return CONFIG.MIN_RESERVE_EARLY;
        }
    }

    // ==========================================================================
    // PROPERTY VALUATION
    // ==========================================================================

    /**
     * Calculate the "differential value" of owning a property.
     * This is: (EPT gained by owning) + (EPT denied to opponents)
     *
     * @param {Object} valuator - PropertyValuator instance
     * @param {number} squareIndex - Property index
     * @param {Object} analysis - Game state analysis
     * @param {string} jailStrategy - 'stay' or 'leave'
     * @returns {number} Differential value per turn
     */
    function calculateDifferentialValue(valuator, squareIndex, analysis, jailStrategy = 'stay') {
        const tables = valuator.getTables(jailStrategy);
        const propData = tables.properties[squareIndex];

        if (!propData) {
            // Might be railroad or utility
            const rrData = tables.railroads[squareIndex];
            if (rrData) {
                // Value of railroad increases with number owned
                const currentOwned = analysis.myRailroads;
                const newEPT = rrData.ept[`own${currentOwned + 1}`];
                return newEPT * analysis.opponents.length;
            }

            const utilData = tables.utilities[squareIndex];
            if (utilData) {
                const currentOwned = analysis.myUtilities;
                const newEPT = utilData.ept[`own${currentOwned + 1}`];
                return newEPT * analysis.opponents.length;
            }

            return 0;
        }

        // Check if this completes a monopoly
        const group = propData.group;
        const groupSquares = PropertyValuator.COLOR_GROUPS[group];
        const groupOwnership = analysis.groupOwnership[getGroupNumber(group)];

        let completesMonopoly = false;
        if (groupOwnership) {
            const myOwned = groupSquares.filter(sq =>
                analysis.myProperties.includes(sq)
            ).length;
            if (myOwned === groupSquares.length - 1) {
                completesMonopoly = true;
            }
        }

        // Base EPT value
        let myEPT = propData.ept.noMonopoly;
        if (completesMonopoly) {
            // If this completes monopoly, value jumps significantly
            // Consider potential for development
            myEPT = propData.ept.house3 * CONFIG.MONOPOLY_COMPLETION_BONUS;
        }

        // Denial value: prevent opponent from completing their monopoly
        let denialValue = 0;
        if (groupOwnership && groupOwnership.owners.size === 2) {
            // Opponent has some of this group - blocking them is valuable
            denialValue = propData.ept.house3 * 0.5;  // Half the potential value
        }

        // Total differential value per opponent turn
        return (myEPT + denialValue) * analysis.opponents.length;
    }

    /**
     * Map color group name to group number used in game.
     */
    function getGroupNumber(groupName) {
        const map = {
            'brown': 3, 'lightBlue': 4, 'pink': 5, 'orange': 6,
            'red': 7, 'yellow': 8, 'green': 9, 'darkBlue': 10
        };
        return map[groupName];
    }

    function getGroupName(groupNumber) {
        const map = {
            3: 'brown', 4: 'lightBlue', 5: 'pink', 6: 'orange',
            7: 'red', 8: 'yellow', 9: 'green', 10: 'darkBlue'
        };
        return map[groupNumber];
    }

    // ==========================================================================
    // DECISION FUNCTIONS
    // ==========================================================================

    /**
     * Decide whether to buy a property when landing on it.
     *
     * @param {number} squareIndex - Property index
     * @param {Object} gameState - Game state reference
     * @param {Object} valuator - PropertyValuator instance
     * @param {number} myIndex - AI player index
     * @returns {boolean} True to buy
     */
    function decideBuyProperty(squareIndex, gameState, valuator, myIndex) {
        const { square, player } = gameState;
        const sq = square[squareIndex];
        const me = player[myIndex];
        const analysis = analyzeGameState(gameState, myIndex);

        // Can't buy if we don't have enough money
        if (me.money < sq.price) {
            return false;
        }

        // Calculate minimum reserve
        const minReserve = getMinReserve(analysis);
        const availableFunds = me.money - minReserve;

        if (availableFunds < sq.price) {
            // We could buy, but it would leave us too low on cash
            // Only buy if it's very valuable (completes monopoly, etc.)
            const jailStrategy = determineJailStrategy(analysis);
            const diffValue = calculateDifferentialValue(valuator, squareIndex, analysis, jailStrategy);

            // If differential value is high enough, stretch the budget
            if (diffValue > sq.price * 0.1) {  // 10% return threshold
                return me.money >= sq.price;  // Buy even if dipping into reserve
            }
            return false;
        }

        // Early game: buy everything affordable to block opponents
        if (analysis.gamePhase === 'early') {
            return true;
        }

        // Mid/late game: be more selective
        const jailStrategy = determineJailStrategy(analysis);
        const diffValue = calculateDifferentialValue(valuator, squareIndex, analysis, jailStrategy);

        // Buy if expected value > price * threshold
        // This is a simplified ROI check
        const turnsToPay = sq.price / diffValue;

        if (CONFIG.DEBUG) {
            console.log(`Buy decision for ${sq.name}: diffValue=${diffValue.toFixed(2)}, turnsToPay=${turnsToPay.toFixed(1)}`);
        }

        // Buy if payback is within reasonable time (e.g., 30 turns)
        return turnsToPay < 30;
    }

    /**
     * Decide how much to bid in an auction.
     *
     * @param {number} squareIndex - Property being auctioned
     * @param {number} currentBid - Current highest bid
     * @param {Object} gameState - Game state
     * @param {Object} valuator - PropertyValuator
     * @param {number} myIndex - AI player index
     * @returns {number} Bid amount (-1 to exit, 0 to pass, positive to bid)
     */
    function decideAuctionBid(squareIndex, currentBid, gameState, valuator, myIndex) {
        const { square, player } = gameState;
        const sq = square[squareIndex];
        const me = player[myIndex];
        const analysis = analyzeGameState(gameState, myIndex);

        const minReserve = getMinReserve(analysis);
        const maxBid = me.money - minReserve;

        if (maxBid <= currentBid) {
            return -1;  // Exit auction
        }

        // Calculate property value
        const jailStrategy = determineJailStrategy(analysis);
        const diffValue = calculateDifferentialValue(valuator, squareIndex, analysis, jailStrategy);

        // Determine maximum willingness to pay
        // Base: property price
        // Adjusted by: differential value, monopoly completion, blocking opponents
        let maxWillingToPay = sq.price;

        // Check if this completes a monopoly for us
        const group = sq.groupNumber;
        const groupSquares = getGroupSquares(group);
        const myOwned = groupSquares.filter(i => square[i].owner === myIndex).length;

        if (myOwned === groupSquares.length - 1) {
            // This completes our monopoly - worth paying more
            maxWillingToPay *= CONFIG.MONOPOLY_COMPLETION_BONUS;
        }

        // Check if opponent is close to monopoly
        const opponentClose = groupSquares.some(i => {
            const owner = square[i].owner;
            return owner !== 0 && owner !== myIndex &&
                   groupSquares.filter(j => square[j].owner === owner).length >= groupSquares.length - 1;
        });

        if (opponentClose) {
            // Block opponent monopoly - worth paying more
            maxWillingToPay *= 1.2;
        }

        // Cap at maximum overpay config
        maxWillingToPay = Math.min(maxWillingToPay, sq.price * CONFIG.AUCTION_MAX_OVERPAY);

        // Cap at our available funds
        maxWillingToPay = Math.min(maxWillingToPay, maxBid);

        if (currentBid >= maxWillingToPay) {
            return -1;  // Exit - too expensive
        }

        // Bid incrementally
        const bidIncrement = Math.max(10, Math.round((maxWillingToPay - currentBid) * 0.2));
        const bid = currentBid + bidIncrement;

        return Math.min(bid, maxWillingToPay, maxBid);
    }

    /**
     * Get squares in a group by group number.
     */
    function getGroupSquares(groupNumber) {
        const groupName = getGroupName(groupNumber);
        if (groupName) {
            return PropertyValuator.COLOR_GROUPS[groupName];
        }
        // Railroads
        if (groupNumber === 1) return [5, 15, 25, 35];
        // Utilities
        if (groupNumber === 2) return [12, 28];
        return [];
    }

    /**
     * Determine optimal jail strategy based on game state.
     *
     * Early game: Leave quickly to buy properties
     * Late game: Stay to avoid landing on developed properties
     */
    function determineJailStrategy(analysis) {
        if (analysis.gamePhase === 'early') {
            return 'leave';
        }

        if (analysis.opponentDevelopedProperties >= CONFIG.JAIL_STAY_THRESHOLD) {
            return 'stay';
        }

        return 'leave';
    }

    /**
     * Decide whether to post bail or use get-out-of-jail card.
     *
     * @param {Object} gameState - Game state
     * @param {number} myIndex - AI player index
     * @param {number} jailTurn - Current turn in jail (0-2)
     * @returns {boolean} True to post bail/use card
     */
    function decidePostBail(gameState, myIndex, jailTurn) {
        const analysis = analyzeGameState(gameState, myIndex);
        const strategy = determineJailStrategy(analysis);

        if (strategy === 'leave') {
            return true;  // Leave immediately
        }

        // Stay strategy: only leave on 3rd turn (forced) or if we have card on 3rd turn
        if (jailTurn >= 2) {
            return true;  // Must leave
        }

        return false;  // Stay in jail
    }

    /**
     * Decide which houses to build before turn.
     *
     * @param {Object} gameState - Game state
     * @param {Object} valuator - PropertyValuator
     * @param {number} myIndex - AI player index
     * @returns {Array<{square: number, count: number}>} Houses to build
     */
    function decideHouseBuilding(gameState, valuator, myIndex) {
        const { square, player } = gameState;
        const me = player[myIndex];
        const analysis = analyzeGameState(gameState, myIndex);

        const toBuild = [];
        const minReserve = getMinReserve(analysis);
        let availableFunds = me.money - minReserve;

        if (availableFunds <= 0 || analysis.myMonopolies.length === 0) {
            return toBuild;
        }

        // Get marginal ROI for all possible house purchases
        const jailStrategy = determineJailStrategy(analysis);
        const opportunities = [];

        for (const groupNum of analysis.myMonopolies) {
            // Skip railroads/utilities (groups 1-2)
            if (groupNum <= 2) continue;

            const groupName = getGroupName(groupNum);
            const groupSquares = PropertyValuator.COLOR_GROUPS[groupName];

            // Check current house counts
            const houseCounts = groupSquares.map(sq => square[sq].house || 0);
            const minHouses = Math.min(...houseCounts);
            const maxHouses = Math.max(...houseCounts);

            // Must build evenly - can only add to properties with minimum houses
            for (const sq of groupSquares) {
                const currentHouses = square[sq].house || 0;
                if (currentHouses > minHouses) continue;  // Can't build here yet
                if (currentHouses >= 5) continue;  // Already have hotel

                const prop = PropertyValuator.PROPERTIES[sq];
                if (!prop) continue;

                const tables = valuator.getTables(jailStrategy);
                const propData = tables.properties[sq];
                if (!propData) continue;

                const marginalData = propData.marginalROI[`house${currentHouses + 1}`];
                if (marginalData && marginalData.cost <= availableFunds) {
                    opportunities.push({
                        square: sq,
                        cost: marginalData.cost,
                        marginalROI: marginalData.marginalROI,
                        targetHouses: currentHouses + 1,
                        group: groupNum
                    });
                }
            }
        }

        // Sort by marginal ROI (highest first)
        opportunities.sort((a, b) => b.marginalROI - a.marginalROI);

        // Third house priority: if enabled, prioritize getting to 3 houses
        if (CONFIG.THIRD_HOUSE_PRIORITY) {
            opportunities.sort((a, b) => {
                // Prioritize building 3rd house
                const aThird = a.targetHouses === 3 ? 1 : 0;
                const bThird = b.targetHouses === 3 ? 1 : 0;
                if (aThird !== bThird) return bThird - aThird;
                return b.marginalROI - a.marginalROI;
            });
        }

        // Build houses in ROI order while we have funds
        for (const opp of opportunities) {
            if (opp.cost > availableFunds) continue;

            // Verify even building rule
            const groupSquares = getGroupSquares(opp.group);
            const houseCounts = groupSquares.map(sq => square[sq].house || 0);
            const minHouses = Math.min(...houseCounts);

            if ((square[opp.square].house || 0) > minHouses) continue;

            toBuild.push({
                square: opp.square,
                count: 1
            });
            availableFunds -= opp.cost;

            // Update our view of house count for subsequent decisions
            square[opp.square].house = (square[opp.square].house || 0) + 1;
        }

        return toBuild;
    }

    /**
     * Evaluate a trade offer.
     *
     * @param {Object} tradeObj - Trade object from game
     * @param {Object} gameState - Game state
     * @param {Object} valuator - PropertyValuator
     * @param {number} myIndex - AI player index
     * @returns {boolean|Object} true to accept, false to decline, or counter-offer Trade
     */
    function evaluateTrade(tradeObj, gameState, valuator, myIndex) {
        const analysis = analyzeGameState(gameState, myIndex);
        const jailStrategy = determineJailStrategy(analysis);

        // Calculate EPT change from trade
        let myEPTChange = 0;
        let opponentEPTChange = 0;

        // Money component
        const moneyOffered = tradeObj.getMoney();  // Positive = I receive, negative = I pay

        // Property components
        for (let i = 0; i < 40; i++) {
            const propTrade = tradeObj.getProperty(i);
            if (propTrade === 0) continue;

            const diffValue = calculateDifferentialValue(valuator, i, analysis, jailStrategy);

            if (propTrade > 0) {
                // I'm receiving this property
                myEPTChange += diffValue;
            } else {
                // I'm giving up this property
                myEPTChange -= diffValue;
            }
        }

        // Convert money to EPT-equivalent
        // Rough heuristic: $200 ≈ 1 turn of EPT differential
        const moneyAsEPT = moneyOffered / 200;
        myEPTChange += moneyAsEPT;

        // Jail cards have small value
        myEPTChange += tradeObj.getCommunityChestJailCard() * 0.1;
        myEPTChange += tradeObj.getChanceJailCard() * 0.1;

        if (CONFIG.DEBUG) {
            console.log(`Trade evaluation: myEPTChange=${myEPTChange.toFixed(3)}`);
        }

        // Accept if net positive
        if (myEPTChange > CONFIG.TRADE_ADVANTAGE_THRESHOLD) {
            return true;
        }

        // Decline if significantly negative
        if (myEPTChange < -CONFIG.TRADE_ADVANTAGE_THRESHOLD) {
            return false;
        }

        // Marginal trade - decline for now
        // Future: could counter-offer
        return false;
    }

    /**
     * Decide what to mortgage when in debt.
     *
     * @param {Object} gameState - Game state
     * @param {Object} valuator - PropertyValuator
     * @param {number} myIndex - AI player index
     * @param {number} amountNeeded - How much money we need
     * @returns {Array<number>} Square indices to mortgage
     */
    function decideMortgaging(gameState, valuator, myIndex, amountNeeded) {
        const { square, player } = gameState;
        const me = player[myIndex];
        const analysis = analyzeGameState(gameState, myIndex);
        const jailStrategy = determineJailStrategy(analysis);

        const toMortgage = [];
        let raised = 0;

        // Prioritize mortgaging: lowest EPT properties first, unimproved first
        const mortgageOptions = [];

        for (const sq of analysis.myProperties) {
            const sqData = square[sq];
            if (sqData.mortgage) continue;  // Already mortgaged
            if ((sqData.house || 0) > 0) continue;  // Can't mortgage with houses

            const diffValue = calculateDifferentialValue(valuator, sq, analysis, jailStrategy);
            const mortgageValue = sqData.price * 0.5;  // Get half price for mortgage

            mortgageOptions.push({
                square: sq,
                mortgageValue,
                diffValue,
                efficiency: mortgageValue / Math.max(diffValue, 0.01)  // Money per EPT lost
            });
        }

        // Sort by efficiency (most money per EPT lost)
        mortgageOptions.sort((a, b) => b.efficiency - a.efficiency);

        for (const opt of mortgageOptions) {
            if (raised >= amountNeeded) break;

            toMortgage.push(opt.square);
            raised += opt.mortgageValue;
        }

        return toMortgage;
    }

    // ==========================================================================
    // MAIN AI CLASS
    // ==========================================================================

    /**
     * Main AI class that integrates with the game's AI interface.
     */
    class StrategicAI {
        constructor(player, gameState) {
            this.player = player;
            this.gameState = gameState;
            this.playerIndex = player.index;

            // Initialize engines
            this.markovEngine = new MonopolyMarkov.MarkovEngine();
            this.markovEngine.initialize();

            this.valuator = new PropertyValuator.Valuator(this.markovEngine);
            this.valuator.initialize();

            // Set player name
            if (!this.constructor.count) this.constructor.count = 0;
            this.constructor.count++;
            player.name = "Strategic AI " + this.constructor.count;

            console.log(`StrategicAI initialized for player ${player.name}`);
        }

        /**
         * Decide whether to buy a property landed on.
         * @param {number} index - Property index
         * @returns {boolean}
         */
        buyProperty(index) {
            return decideBuyProperty(index, this.gameState, this.valuator, this.playerIndex);
        }

        /**
         * Evaluate a trade offer.
         * @param {Object} tradeObj - Trade object
         * @returns {boolean|Object}
         */
        acceptTrade(tradeObj) {
            return evaluateTrade(tradeObj, this.gameState, this.valuator, this.playerIndex);
        }

        /**
         * Actions before rolling dice (manage property, trades).
         * @returns {boolean} True if a trade was proposed
         */
        beforeTurn() {
            // Build houses
            const housesToBuild = decideHouseBuilding(this.gameState, this.valuator, this.playerIndex);

            for (const build of housesToBuild) {
                if (typeof buyHouse === 'function') {
                    buyHouse(build.square);
                }
            }

            // Unmortgage properties if we have excess cash
            this._unmortgageProperties();

            // For now, don't initiate trades (complex to implement well)
            return false;
        }

        /**
         * Actions after landing (opportunity to trade).
         * @returns {boolean} True if trade proposed
         */
        onLand() {
            // Could implement trade initiation here
            return false;
        }

        /**
         * Decide whether to post bail.
         * @returns {boolean}
         */
        postBail() {
            const jailTurn = this.player.jailroll || 0;
            return decidePostBail(this.gameState, this.playerIndex, jailTurn);
        }

        /**
         * Handle debt by mortgaging/selling.
         */
        payDebt() {
            const amountNeeded = Math.abs(this.player.money);
            const toMortgage = decideMortgaging(this.gameState, this.valuator, this.playerIndex, amountNeeded);

            for (const sq of toMortgage) {
                if (typeof mortgage === 'function') {
                    mortgage(sq);
                }
                if (this.player.money >= 0) break;
            }
        }

        /**
         * Decide auction bid.
         * @param {number} property - Property index
         * @param {number} currentBid - Current highest bid
         * @returns {number} -1 to exit, 0 to pass, positive to bid
         */
        bid(property, currentBid) {
            return decideAuctionBid(property, currentBid, this.gameState, this.valuator, this.playerIndex);
        }

        /**
         * Internal: unmortgage properties if we have excess cash.
         */
        _unmortgageProperties() {
            const analysis = analyzeGameState(this.gameState, this.playerIndex);
            const minReserve = getMinReserve(analysis);
            let availableFunds = this.player.money - minReserve;

            if (availableFunds <= 0) return;

            const { square } = this.gameState;

            // Prioritize unmortgaging: highest EPT properties first
            const mortgaged = analysis.myProperties.filter(sq => square[sq].mortgage);

            const jailStrategy = determineJailStrategy(analysis);
            const unmortgageOptions = mortgaged.map(sq => ({
                square: sq,
                cost: square[sq].price * 0.55,  // 110% of mortgage value
                diffValue: calculateDifferentialValue(this.valuator, sq, analysis, jailStrategy)
            }));

            // Sort by value (highest EPT first)
            unmortgageOptions.sort((a, b) => b.diffValue - a.diffValue);

            for (const opt of unmortgageOptions) {
                if (opt.cost > availableFunds) continue;

                if (typeof unmortgage === 'function') {
                    unmortgage(opt.square);
                    availableFunds -= opt.cost;
                }
            }
        }

        /**
         * Get analysis summary for debugging/display.
         */
        getAnalysis() {
            return analyzeGameState(this.gameState, this.playerIndex);
        }

        /**
         * Get EPT tables for debugging/display.
         */
        getEPTTables(jailStrategy = 'stay') {
            return this.valuator.getTables(jailStrategy);
        }
    }

    // Static counter
    StrategicAI.count = 0;

    // ==========================================================================
    // EXPORTS
    // ==========================================================================

    return {
        StrategicAI,
        CONFIG,
        analyzeGameState,
        calculateDifferentialValue,
        decideBuyProperty,
        decideAuctionBid,
        decidePostBail,
        decideHouseBuilding,
        evaluateTrade,
        decideMortgaging,
        determineJailStrategy,
        getGroupNumber,
        getGroupName,
        getGroupSquares
    };

})();

// Export for Node.js / testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonopolyAI;
}
