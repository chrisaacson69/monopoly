/**
 * Enhanced Relative Growth AI
 *
 * Builds on RelativeGrowthAI with auction insights:
 * 1. Parameterized bid premium (properties are undervalued at face price)
 * 2. Parameterized debt tolerance (moderate debt helps, excessive hurts)
 * 3. Proactive unmortgaging when cash allows
 *
 * Key findings from auction experiments:
 * - Winners avg peak debt: ~$510, Losers: ~$718 (+41%)
 * - 5% premium: 46% win rate (best)
 * - 10% premium: 41-46% win rate (good)
 * - 20% premium: 16-17% win rate (over-leverages)
 *
 * Insight: Moderate debt is fine, excessive debt kills you.
 */

'use strict';

const { BOARD, COLOR_GROUPS, SQUARE_TYPES } = require('./game-engine.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

// =============================================================================
// ENHANCED RELATIVE GROWTH AI
// =============================================================================

class EnhancedRelativeAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine = null, valuator = null, config = {}) {
        super(player, engine, markovEngine, valuator);

        // Auction/bidding parameters
        this.auctionConfig = {
            // Base premium above face value for normal properties (0.05 = 5%)
            baseBidPremium: config.baseBidPremium ?? 0.05,

            // Premium multiplier when completing monopoly (1.5 = 50% above face)
            monopolyCompletionMultiplier: config.monopolyCompletionMultiplier ?? 1.5,

            // Premium multiplier when blocking opponent monopoly
            blockingMultiplier: config.blockingMultiplier ?? 1.3,

            // Whether to use smart blocking (only pay premium if sole blocker)
            smartBlocking: config.smartBlocking ?? false,

            // Absolute minimum cash to keep (floor)
            absoluteMinCash: config.absoluteMinCash ?? 75,

            // Debt tolerance parameters
            // Max debt as fraction of total property value
            maxDebtRatio: config.maxDebtRatio ?? 0.3,

            // Max absolute debt willing to take on
            maxAbsoluteDebt: config.maxAbsoluteDebt ?? 600,

            // Whether to mortgage to fund bids
            mortgageForBids: config.mortgageForBids ?? true,

            // Cash threshold to trigger unmortgaging (as multiple of unmortgage cost)
            unmortgageThreshold: config.unmortgageThreshold ?? 2.0,
        };

        // Track current debt (mortgaged value)
        this.currentDebt = 0;

        this.name = `EnhancedRelative(+${(this.auctionConfig.baseBidPremium * 100).toFixed(0)}%,debt${(this.auctionConfig.maxDebtRatio * 100).toFixed(0)}%)`;
    }

    /**
     * Calculate current mortgaged value (debt)
     */
    calculateCurrentDebt(state) {
        let debt = 0;
        for (const propIdx of this.player.properties) {
            if (state.propertyStates[propIdx].mortgaged) {
                const square = BOARD[propIdx];
                debt += Math.floor(square.price / 2);
            }
        }
        this.currentDebt = debt;
        return debt;
    }

    /**
     * Calculate total property value (for debt ratio)
     */
    calculateTotalPropertyValue(state) {
        let value = 0;
        for (const propIdx of this.player.properties) {
            const square = BOARD[propIdx];
            value += square.price || 0;

            const houses = state.propertyStates[propIdx].houses || 0;
            if (houses > 0 && square.housePrice) {
                value += houses * square.housePrice;
            }
        }
        return value;
    }

    /**
     * Calculate how much additional debt we're willing to take on
     */
    getAvailableDebtCapacity(state) {
        const currentDebt = this.calculateCurrentDebt(state);
        const totalPropValue = this.calculateTotalPropertyValue(state);

        // Two constraints: ratio-based and absolute
        const ratioLimit = Math.floor(totalPropValue * this.auctionConfig.maxDebtRatio);
        const absoluteLimit = this.auctionConfig.maxAbsoluteDebt;

        const maxAllowedDebt = Math.min(ratioLimit, absoluteLimit);
        const availableCapacity = Math.max(0, maxAllowedDebt - currentDebt);

        return availableCapacity;
    }

    /**
     * Get properties that can be mortgaged (not already mortgaged, no houses)
     */
    getMortgageableProperties(state) {
        const mortgageable = [];

        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (!propState.mortgaged && propState.houses === 0) {
                const square = BOARD[propIdx];
                mortgageable.push({
                    position: propIdx,
                    value: square.price,
                    mortgageValue: Math.floor(square.price / 2),
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        // Sort: non-monopoly first, then by value (lowest first)
        // This prioritizes keeping monopoly properties unmortgaged
        mortgageable.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? 1 : -1;
            }
            return a.value - b.value;
        });

        return mortgageable;
    }

    /**
     * Calculate potential cash including what we could raise through mortgaging
     * Respects debt capacity limits
     */
    getPotentialCash(state) {
        let potential = this.player.money;

        if (!this.auctionConfig.mortgageForBids) {
            return potential;
        }

        const debtCapacity = this.getAvailableDebtCapacity(state);
        const mortgageable = this.getMortgageableProperties(state);

        let addedDebt = 0;
        for (const prop of mortgageable) {
            if (addedDebt + prop.mortgageValue <= debtCapacity) {
                potential += prop.mortgageValue;
                addedDebt += prop.mortgageValue;
            }
        }

        return potential;
    }

    /**
     * Analyze blocking context for a property
     * Returns: { shouldBlock, isRedundant, leaderInGroup, otherBlockers }
     */
    analyzeBlockingContext(position, state) {
        const square = BOARD[position];
        if (!square.group) {
            return { shouldBlock: false, isRedundant: false, leaderInGroup: null, otherBlockers: [] };
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

        // Find if any opponent has N-1 (one away from monopoly)
        let leaderInGroup = null;
        let leaderCount = 0;

        for (const player of state.players) {
            if (player.id === this.player.id || player.bankrupt) continue;

            const theirCount = ownership[player.id] || 0;
            if (theirCount === groupSquares.length - 1) {
                leaderInGroup = player.id;
                leaderCount = theirCount;
                break;  // Found someone one away from monopoly
            }
        }

        if (leaderInGroup === null) {
            // No one is close to monopoly - no blocking needed
            return { shouldBlock: false, isRedundant: false, leaderInGroup: null, otherBlockers: [] };
        }

        // Find other blockers (anyone else who owns property in this group, besides leader and self)
        const otherBlockers = [];
        for (const [ownerId, count] of Object.entries(ownership)) {
            const id = parseInt(ownerId);
            if (id !== this.player.id && id !== leaderInGroup && count > 0) {
                otherBlockers.push(id);
            }
        }

        // Also check if I already own something in this group
        const myCount = ownership[this.player.id] || 0;

        // Blocking is redundant if:
        // 1. Someone else is already blocking (otherBlockers.length > 0), OR
        // 2. I already own property in this group (myCount > 0)
        const isRedundant = otherBlockers.length > 0 || myCount > 0;

        return {
            shouldBlock: true,
            isRedundant,
            leaderInGroup,
            otherBlockers,
            myCurrentCount: myCount
        };
    }

    /**
     * Calculate maximum bid for a property
     */
    getMaxBid(position, state) {
        const square = BOARD[position];
        let maxWilling = square.price * (1 + this.auctionConfig.baseBidPremium);

        // Increase willingness for strategic properties
        if (this.wouldCompleteMonopoly(position, state)) {
            maxWilling = Math.max(maxWilling,
                square.price * this.auctionConfig.monopolyCompletionMultiplier);
        }

        // Smart blocking: only pay premium if we're the sole blocker
        if (this.auctionConfig.smartBlocking) {
            const blockingContext = this.analyzeBlockingContext(position, state);
            if (blockingContext.shouldBlock && !blockingContext.isRedundant) {
                // We're the sole blocker - pay the premium
                maxWilling = Math.max(maxWilling,
                    square.price * this.auctionConfig.blockingMultiplier);
            }
            // If redundant, don't pay blocking premium (just base premium)
        } else {
            // Original behavior: always pay blocking premium if blocking
            if (this.wouldBlockMonopoly(position, state)) {
                maxWilling = Math.max(maxWilling,
                    square.price * this.auctionConfig.blockingMultiplier);
            }
        }

        return Math.floor(maxWilling);
    }

    /**
     * Mortgage properties to raise cash for a bid
     * Respects debt limits
     */
    mortgageForBid(targetAmount, state) {
        if (!this.auctionConfig.mortgageForBids) return;

        const debtCapacity = this.getAvailableDebtCapacity(state);
        if (debtCapacity <= 0) return;

        const mortgageable = this.getMortgageableProperties(state);
        let addedDebt = 0;

        for (const prop of mortgageable) {
            if (this.player.money >= targetAmount) break;
            if (addedDebt + prop.mortgageValue > debtCapacity) continue;

            const result = this.engine.mortgageProperty(this.player, prop.position);
            if (result > 0) {
                addedDebt += prop.mortgageValue;
            }
        }
    }

    /**
     * Override: Enhanced bidding strategy with premium and debt tolerance
     */
    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        const maxWilling = this.getMaxBid(position, state);

        // Calculate what we can afford (including potential mortgages)
        const potentialCash = this.getPotentialCash(state);
        const maxAfford = potentialCash - this.auctionConfig.absoluteMinCash;

        if (maxAfford <= currentBid) return 0;

        // Cap at what we're willing to pay
        const bidCap = Math.min(maxWilling, maxAfford);

        if (currentBid >= bidCap) return 0;

        // Calculate the bid
        const bidAmount = Math.min(currentBid + 10, bidCap);

        // If we need to mortgage to make this bid, do it
        if (bidAmount > this.player.money - this.auctionConfig.absoluteMinCash) {
            this.mortgageForBid(bidAmount + this.auctionConfig.absoluteMinCash, state);
        }

        // Final check - can we afford the bid?
        if (this.player.money - bidAmount < this.auctionConfig.absoluteMinCash) {
            return 0;
        }

        return bidAmount;
    }

    /**
     * Override preTurn to add unmortgaging
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

        // Find mortgaged properties
        const mortgaged = [];
        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (propState.mortgaged) {
                const square = BOARD[propIdx];
                const mortgageValue = Math.floor(square.price / 2);
                const unmortgageCost = Math.floor(mortgageValue * 1.1);

                mortgaged.push({
                    position: propIdx,
                    cost: unmortgageCost,
                    mortgageValue: mortgageValue,
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        if (mortgaged.length === 0) return;

        // Sort: monopoly properties first (unmortgage these first), then by cost
        mortgaged.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? -1 : 1;
            }
            return a.cost - b.cost;
        });

        // Unmortgage if we have enough excess cash
        for (const prop of mortgaged) {
            // Use threshold to ensure we have comfortable buffer
            const threshold = prop.cost * this.auctionConfig.unmortgageThreshold;

            if (this.player.money - prop.cost >= reserve + threshold) {
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
 * OPTIMAL CONFIGURATION (Tournament Winner)
 *
 * Based on extensive testing (1000+ games):
 * - 5% bid premium: captures undervalued properties without overextending
 * - 15% max debt ratio: moderate leverage helps, but conservative wins
 * - $400 max absolute debt: prevents over-leveraging
 * - $75 min cash: maintains liquidity
 * - Smart blocking: only pay blocking premium when sole blocker (saves ~6pp vs naive)
 *
 * Performance:
 * - vs RelativeGrowthAI: 61.7% vs 37.0% (head-to-head)
 * - vs naive blocking: 52.7% vs 46.3% (head-to-head)
 */
class EnhancedRelativeOptimal extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true
        });
        this.name = 'EnhancedRelativeOptimal';
    }
}

/**
 * Conservative: 5% premium, 15% max debt ratio, smart blocking (same as Optimal)
 * Alias for backward compatibility
 */
class EnhancedRelative5 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true
        });
        this.name = 'EnhancedRelative5';
    }
}

/**
 * Moderate: 10% premium, 20% max debt ratio
 * Slightly more aggressive - good but not optimal
 */
class EnhancedRelative10 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.10,
            maxDebtRatio: 0.20,
            maxAbsoluteDebt: 500,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelative10';
    }
}

/**
 * Aggressive: 15% premium, 25% max debt ratio
 * Too aggressive - included for comparison only
 */
class EnhancedRelative15 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.15,
            maxDebtRatio: 0.25,
            maxAbsoluteDebt: 600,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelative15';
    }
}

/**
 * No debt variant: premium bidding but no mortgaging for bids
 * Tests if the premium alone helps without debt
 */
class EnhancedRelativeNoDebt extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            mortgageForBids: false,
            maxDebtRatio: 0,
            maxAbsoluteDebt: 0,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelativeNoDebt';
    }
}

/**
 * Smart Blocking variant: Only pays blocking premium when sole blocker
 *
 * Blocking analysis showed 24% of auction blocking decisions are redundant
 * (someone else is already blocking). This variant avoids overpaying in those cases.
 */
class EnhancedRelativeSmartBlock extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true  // Only pay blocking premium if sole blocker
        });
        this.name = 'EnhancedRelativeSmartBlock';
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    EnhancedRelativeAI,
    EnhancedRelativeOptimal,
    EnhancedRelative5,
    EnhancedRelative10,
    EnhancedRelative15,
    EnhancedRelativeNoDebt,
    EnhancedRelativeSmartBlock
};
