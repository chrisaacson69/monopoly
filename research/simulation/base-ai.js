/**
 * Base AI Classes for Monopoly Simulation
 *
 * Provides base classes and simple AI implementations for testing.
 * More sophisticated AIs will extend these.
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES, RAILROAD_RENT } = require('./game-engine.js');

// =============================================================================
// BASE AI CLASS
// =============================================================================

/**
 * Abstract base class for Monopoly AI
 */
class BaseAI {
    constructor(player, engine) {
        this.player = player;
        this.engine = engine;
        this.name = 'BaseAI';
    }

    /**
     * Decide whether to buy a property
     * @param {number} position - Property position
     * @param {GameState} state - Current game state
     * @returns {boolean} true to buy
     */
    decideBuy(position, state) {
        return false;
    }

    /**
     * Decide bid amount for auction
     * @param {number} position - Property position
     * @param {number} currentBid - Current highest bid
     * @param {GameState} state - Current game state
     * @returns {number} bid amount (0 to pass)
     */
    decideBid(position, currentBid, state) {
        return 0;
    }

    /**
     * Decide whether to post bail / use jail card
     * @param {GameState} state - Current game state
     * @returns {boolean} true to leave jail
     */
    decideJail(state) {
        return true;  // Default: leave jail
    }

    /**
     * Called before rolling dice - opportunity to build/trade
     * @param {GameState} state - Current game state
     */
    preTurn(state) {
        // Override in subclass
    }

    /**
     * Called after turn completes
     * @param {GameState} state - Current game state
     */
    postTurn(state) {
        // Override in subclass
    }

    /**
     * Evaluate a trade offer
     * @param {Object} offer - Trade offer details
     * @param {GameState} state - Current game state
     * @returns {boolean|Object} true to accept, false to reject, or counter-offer
     */
    evaluateTrade(offer, state) {
        return false;
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    /**
     * Get properties owned by this AI's player
     */
    getMyProperties(state) {
        return Array.from(this.player.properties);
    }

    /**
     * Get monopolies owned by this AI's player
     */
    getMyMonopolies(state) {
        return this.player.getMonopolies(state);
    }

    /**
     * Check if buying a property would complete a monopoly
     */
    wouldCompleteMonopoly(position, state) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;
        const owned = groupSquares.filter(sq =>
            this.player.properties.has(sq)
        ).length;

        return owned === groupSquares.length - 1;
    }

    /**
     * Check if a property would block an opponent's monopoly
     */
    wouldBlockMonopoly(position, state) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        for (const other of state.players) {
            if (other.id === this.player.id || other.bankrupt) continue;

            const theirOwned = groupSquares.filter(sq =>
                other.properties.has(sq)
            ).length;

            if (theirOwned === groupSquares.length - 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get minimum reserve cash based on game phase
     */
    getMinReserve(state) {
        switch (state.phase) {
            case 'early': return 200;
            case 'mid': return 150;
            case 'late': return 100;
            default: return 150;
        }
    }
}

// =============================================================================
// SIMPLE AI - BUYS EVERYTHING
// =============================================================================

/**
 * Simple AI that buys everything it can afford
 */
class SimpleAI extends BaseAI {
    constructor(player, engine) {
        super(player, engine);
        this.name = 'SimpleAI';
    }

    decideBuy(position, state) {
        const square = BOARD[position];
        const reserve = this.getMinReserve(state);
        return this.player.money - square.price >= reserve;
    }

    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        const maxBid = Math.min(
            this.player.money - this.getMinReserve(state),
            square.price
        );

        if (maxBid > currentBid) {
            return currentBid + 10;
        }
        return 0;
    }

    decideJail(state) {
        // Stay in jail late game if opponents have developed properties
        if (state.phase === 'late') {
            const opponentHouses = state.players
                .filter(p => p.id !== this.player.id && !p.bankrupt)
                .reduce((sum, p) => {
                    let houses = 0;
                    for (const prop of p.properties) {
                        houses += state.propertyStates[prop].houses || 0;
                    }
                    return sum + houses;
                }, 0);

            if (opponentHouses >= 6) {
                return false;  // Stay in jail
            }
        }
        return true;  // Leave jail
    }

    preTurn(state) {
        // Build houses on monopolies
        this.buildHouses(state);
    }

    buildHouses(state) {
        const monopolies = this.getMyMonopolies(state);
        const reserve = this.getMinReserve(state);

        for (const group of monopolies) {
            const groupSquares = COLOR_GROUPS[group].squares;
            const housePrice = BOARD[groupSquares[0]].housePrice;

            // Build evenly up to 3 houses (best marginal ROI)
            let built = true;
            while (built && this.player.money - housePrice >= reserve) {
                built = false;

                // Find property with fewest houses
                let minHouses = 6;
                let target = null;

                for (const sq of groupSquares) {
                    const houses = state.propertyStates[sq].houses || 0;
                    if (houses < minHouses && houses < 3) {  // Cap at 3 houses
                        minHouses = houses;
                        target = sq;
                    }
                }

                if (target !== null) {
                    if (this.engine.buildHouse(this.player, target)) {
                        built = true;
                    }
                }
            }
        }
    }
}

// =============================================================================
// STRATEGIC AI - EPT-BASED DECISIONS
// =============================================================================

/**
 * Strategic AI that uses EPT calculations
 * Requires markov-engine and property-valuator
 */
class StrategicAI extends BaseAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine);
        this.name = 'StrategicAI';
        this.markovEngine = markovEngine;
        this.valuator = valuator;

        // Cache landing probabilities
        this.probs = markovEngine ? markovEngine.getAllProbabilities('stay') : null;
    }

    decideBuy(position, state) {
        const square = BOARD[position];
        const reserve = this.getMinReserve(state);

        // ALWAYS buy if it completes our monopoly or blocks opponent's monopoly
        // This is worth going into debt for (can mortgage other properties)
        if (this.wouldCompleteMonopoly(position, state) ||
            this.wouldBlockMonopoly(position, state)) {
            return this.player.money >= square.price;
        }

        // Check reserve constraint
        if (this.player.money - square.price < reserve) {
            return false;
        }

        // Early game: buy most properties
        if (state.phase === 'early') {
            return true;
        }

        // Calculate differential EPT value
        const diffValue = this.calculateDifferentialValue(position, state);
        const payback = square.price / Math.max(diffValue, 0.01);

        // Buy if payback is reasonable
        return payback < 50;
    }

    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        const reserve = this.getMinReserve(state);
        const maxAfford = this.player.money - reserve;

        if (maxAfford <= currentBid) return 0;

        // Calculate max we're willing to pay
        let maxWilling = square.price;

        if (this.wouldCompleteMonopoly(position, state)) {
            maxWilling *= 1.5;
        }

        if (this.wouldBlockMonopoly(position, state)) {
            maxWilling *= 1.3;
        }

        maxWilling = Math.min(maxWilling, maxAfford);

        if (currentBid >= maxWilling) return 0;

        // Bid incrementally
        return Math.min(currentBid + 10, maxWilling);
    }

    decideJail(state) {
        // Early game: leave to buy properties
        if (state.phase === 'early') {
            return true;
        }

        // Count opponent development
        let opponentHouses = 0;
        for (const p of state.players) {
            if (p.id === this.player.id || p.bankrupt) continue;
            for (const prop of p.properties) {
                opponentHouses += state.propertyStates[prop].houses || 0;
            }
        }

        // Stay if opponents have significant development
        return opponentHouses < 6;
    }

    preTurn(state) {
        this.buildOptimalHouses(state);
    }

    /**
     * Calculate differential EPT value of a property
     */
    calculateDifferentialValue(position, state) {
        if (!this.probs) {
            // Fallback if no Markov engine
            return BOARD[position].price * 0.03;
        }

        const prob = this.probs[position];
        const square = BOARD[position];
        const opponents = state.players.filter(p =>
            p.id !== this.player.id && !p.bankrupt
        ).length;

        // Property
        if (PROPERTIES[position]) {
            let rent;
            if (this.wouldCompleteMonopoly(position, state)) {
                rent = square.rent[3];  // Assume 3 houses
            } else {
                rent = square.rent[0];
            }
            return prob * rent * opponents;
        }

        // Railroad
        if ([5, 15, 25, 35].includes(position)) {
            const rrCount = this.player.getRailroadCount() + 1;
            return prob * RAILROAD_RENT[rrCount] * opponents;
        }

        // Utility
        if ([12, 28].includes(position)) {
            const utilCount = this.player.getUtilityCount() + 1;
            const multiplier = utilCount === 1 ? 4 : 10;
            return prob * multiplier * 7 * opponents;
        }

        return 0;
    }

    /**
     * Build houses optimally based on marginal ROI
     */
    buildOptimalHouses(state) {
        const monopolies = this.getMyMonopolies(state);
        if (monopolies.length === 0) return;

        const reserve = this.getMinReserve(state);

        // Build based on marginal ROI
        let built = true;
        while (built && this.player.money > reserve) {
            built = false;

            // Find best house investment
            let bestROI = 0;
            let bestTarget = null;

            for (const group of monopolies) {
                const groupSquares = COLOR_GROUPS[group].squares;
                const housePrice = BOARD[groupSquares[0]].housePrice;

                if (this.player.money - housePrice < reserve) continue;

                for (const sq of groupSquares) {
                    const houses = state.propertyStates[sq].houses || 0;
                    if (houses >= 5) continue;

                    // Check even building
                    const minInGroup = Math.min(...groupSquares.map(s =>
                        state.propertyStates[s].houses || 0
                    ));
                    if (houses > minInGroup) continue;

                    // Calculate marginal ROI
                    const marginalROI = this.calculateMarginalROI(sq, houses, state);

                    if (marginalROI > bestROI) {
                        bestROI = marginalROI;
                        bestTarget = sq;
                    }
                }
            }

            // Build if we found a valid target (ROI > 0 means it's profitable)
            if (bestTarget !== null && bestROI > 0.001) {
                if (this.engine.buildHouse(this.player, bestTarget)) {
                    built = true;
                }
            }
        }
    }

    /**
     * Calculate marginal ROI for adding one house
     */
    calculateMarginalROI(position, currentHouses, state) {
        if (!this.probs) return 0.03;  // Default - assume decent ROI

        const prob = this.probs[position];
        const square = BOARD[position];
        const opponents = state.players.filter(p =>
            p.id !== this.player.id && !p.bankrupt
        ).length;

        const currentRent = currentHouses === 0
            ? square.rent[0] * 2  // Monopoly rent
            : square.rent[currentHouses];

        const newRent = square.rent[currentHouses + 1];
        const rentIncrease = newRent - currentRent;

        const eptIncrease = prob * rentIncrease * opponents;
        return eptIncrease / square.housePrice;
    }
}

// =============================================================================
// RANDOM AI - FOR BASELINE COMPARISON
// =============================================================================

/**
 * Random AI that makes random decisions
 * Useful as a baseline for comparison
 */
class RandomAI extends BaseAI {
    constructor(player, engine) {
        super(player, engine);
        this.name = 'RandomAI';
    }

    decideBuy(position, state) {
        const square = BOARD[position];
        if (this.player.money < square.price) return false;
        return Math.random() > 0.3;  // 70% chance to buy
    }

    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        if (currentBid >= this.player.money - 50) return 0;
        if (currentBid >= square.price * 1.2) return 0;
        if (Math.random() > 0.5) return 0;
        return currentBid + Math.floor(Math.random() * 20) + 1;
    }

    decideJail(state) {
        return Math.random() > 0.3;  // 70% chance to leave
    }

    preTurn(state) {
        // Randomly build houses
        const monopolies = this.getMyMonopolies(state);
        for (const group of monopolies) {
            const groupSquares = COLOR_GROUPS[group].squares;
            const sq = groupSquares[Math.floor(Math.random() * groupSquares.length)];
            if (Math.random() > 0.5) {
                this.engine.buildHouse(this.player, sq);
            }
        }
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    BaseAI,
    SimpleAI,
    StrategicAI,
    RandomAI
};
