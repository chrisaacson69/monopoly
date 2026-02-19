/**
 * Aggressive Bidder AI
 *
 * An AI variant that tests the hypothesis that paying above face value
 * for properties is worthwhile because EPT growth beats current net worth.
 *
 * Key behaviors:
 * 1. Willing to bid up to X% above face value (configurable: 10%, 20%)
 * 2. Willing to go below reserve to acquire properties
 * 3. Willing to mortgage existing properties to fund acquisitions
 * 4. Unmortgages properties when cash allows
 */

'use strict';

const { BOARD, COLOR_GROUPS, SQUARE_TYPES } = require('./game-engine.js');
const { StrategicAI } = require('./base-ai.js');

// Try to import RelativeGrowthAI as base, fall back to StrategicAI
let BaseClass;
try {
    const { RelativeGrowthAI } = require('./relative-growth-ai.js');
    BaseClass = RelativeGrowthAI;
} catch (e) {
    BaseClass = StrategicAI;
}

// =============================================================================
// AGGRESSIVE BIDDER AI
// =============================================================================

class AggressiveBidderAI extends BaseClass {
    constructor(player, engine, markovEngine = null, valuator = null, config = {}) {
        super(player, engine, markovEngine, valuator);

        // Configuration for aggressive bidding
        this.config = {
            // How much above face value to bid (0.10 = 10%, 0.20 = 20%)
            bidPremium: config.bidPremium || 0.10,

            // Minimum cash to keep (can go lower than normal reserve)
            absoluteMinCash: config.absoluteMinCash || 50,

            // Whether to mortgage to fund bids
            mortgageForBids: config.mortgageForBids !== false,

            // Priority multipliers for special situations
            monopolyCompletionMultiplier: config.monopolyCompletionMultiplier || 1.5,
            blockingMultiplier: config.blockingMultiplier || 1.3,

            ...config
        };

        this.name = `AggressiveBidder(+${(this.config.bidPremium * 100).toFixed(0)}%)`;
    }

    /**
     * Calculate maximum bid for a property
     */
    getMaxBid(position, state) {
        const square = BOARD[position];
        let maxWilling = square.price * (1 + this.config.bidPremium);

        // Increase willingness for strategic properties
        if (this.wouldCompleteMonopoly(position, state)) {
            maxWilling = square.price * this.config.monopolyCompletionMultiplier;
        }

        if (this.wouldBlockMonopoly(position, state)) {
            maxWilling = Math.max(maxWilling, square.price * this.config.blockingMultiplier);
        }

        return Math.floor(maxWilling);
    }

    /**
     * Calculate how much cash we can raise through mortgaging
     */
    getPotentialCash(state) {
        let potential = this.player.money;

        if (this.config.mortgageForBids) {
            for (const propIdx of this.player.properties) {
                const propState = state.propertyStates[propIdx];
                // Can only mortgage if not already mortgaged and no houses
                if (!propState.mortgaged && propState.houses === 0) {
                    const square = BOARD[propIdx];
                    potential += Math.floor(square.price / 2);
                }
            }
        }

        return potential;
    }

    /**
     * Mortgage properties to raise cash for a bid
     */
    mortgageForBid(targetAmount, state) {
        if (!this.config.mortgageForBids) return;

        // Sort properties by priority - mortgage least valuable first
        const mortgageable = [];
        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (!propState.mortgaged && propState.houses === 0) {
                const square = BOARD[propIdx];
                mortgageable.push({
                    position: propIdx,
                    value: square.price,
                    mortgageValue: Math.floor(square.price / 2),
                    // Prioritize keeping monopoly properties unmortgaged
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        // Sort: non-monopoly first, then by value (lowest first)
        mortgageable.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? 1 : -1;  // Non-monopoly first
            }
            return a.value - b.value;  // Lowest value first
        });

        // Mortgage until we have enough
        for (const prop of mortgageable) {
            if (this.player.money >= targetAmount) break;

            this.engine.mortgageProperty(this.player, prop.position);
        }
    }

    /**
     * Override: Aggressive bidding strategy
     */
    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        const maxWilling = this.getMaxBid(position, state);

        // Calculate what we can afford (including potential mortgages)
        const potentialCash = this.getPotentialCash(state);
        const maxAfford = potentialCash - this.config.absoluteMinCash;

        if (maxAfford <= currentBid) return 0;

        // Cap at what we're willing to pay
        const bidCap = Math.min(maxWilling, maxAfford);

        if (currentBid >= bidCap) return 0;

        // If we need to mortgage to make this bid, do it
        const bidAmount = Math.min(currentBid + 10, bidCap);
        if (bidAmount > this.player.money - this.config.absoluteMinCash) {
            this.mortgageForBid(bidAmount + this.config.absoluteMinCash, state);
        }

        // Final check - can we afford the bid?
        if (this.player.money - bidAmount < this.config.absoluteMinCash) {
            return 0;
        }

        return bidAmount;
    }

    /**
     * Override preTurn to unmortgage when possible
     */
    preTurn(state) {
        // First, unmortgage properties if we have spare cash
        this.unmortgageProperties(state);

        // Then do normal preTurn (trades, building)
        super.preTurn(state);
    }

    /**
     * Unmortgage properties when we have excess cash
     */
    unmortgageProperties(state) {
        const reserve = this.getMinReserve(state);

        // Find mortgaged properties, prioritize monopoly groups
        const mortgaged = [];
        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (propState.mortgaged) {
                const square = BOARD[propIdx];
                const unmortgageCost = Math.floor(square.price / 2 * 1.1);
                mortgaged.push({
                    position: propIdx,
                    cost: unmortgageCost,
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        // Sort: monopoly properties first, then by cost (lowest first)
        mortgaged.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? -1 : 1;  // Monopoly first
            }
            return a.cost - b.cost;  // Cheapest first
        });

        // Unmortgage what we can afford
        for (const prop of mortgaged) {
            if (this.player.money - prop.cost >= reserve) {
                this.engine.unmortgageProperty(this.player, prop.position);
            }
        }
    }

    /**
     * Helper: Check if we have a monopoly on a color group
     */
    hasMonopoly(group, state) {
        if (!group || !COLOR_GROUPS[group]) return false;

        const groupSquares = COLOR_GROUPS[group].squares;
        return groupSquares.every(pos =>
            state.propertyStates[pos].owner === this.player.id
        );
    }
}

// =============================================================================
// PRESET VARIANTS
// =============================================================================

/**
 * 10% premium bidder
 */
class AggressiveBidder10 extends AggressiveBidderAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            bidPremium: 0.10
        });
    }
}

/**
 * 20% premium bidder
 */
class AggressiveBidder20 extends AggressiveBidderAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            bidPremium: 0.20
        });
    }
}

/**
 * 5% premium bidder (conservative test)
 */
class AggressiveBidder5 extends AggressiveBidderAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            bidPremium: 0.05
        });
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    AggressiveBidderAI,
    AggressiveBidder5,
    AggressiveBidder10,
    AggressiveBidder20
};
