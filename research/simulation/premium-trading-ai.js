/**
 * Premium Trading AI
 *
 * An AI that applies the auction insight to trades:
 * - Willing to pay a premium above fair value for properties
 * - Only pays premium for monopoly-completing trades (strategic value)
 * - Guards against frivolous trades with cooldowns and constraints
 *
 * Key safeguards against exploitation:
 * 1. Only trades that complete monopolies (no frivolous swaps)
 * 2. Per-property cooldown prevents ping-pong trading
 * 3. Premium only applies when ACQUIRING strategic properties
 * 4. Won't trade away monopoly-path properties without getting monopoly completion
 */

'use strict';

const { BOARD, COLOR_GROUPS, SQUARE_TYPES } = require('./game-engine.js');

// Try to import RelativeGrowthAI as base
let BaseClass;
try {
    const { RelativeGrowthAI } = require('./relative-growth-ai.js');
    BaseClass = RelativeGrowthAI;
} catch (e) {
    const { StrategicAI } = require('./base-ai.js');
    BaseClass = StrategicAI;
}

// =============================================================================
// PREMIUM TRADING AI
// =============================================================================

class PremiumTradingAI extends BaseClass {
    constructor(player, engine, markovEngine = null, valuator = null, config = {}) {
        super(player, engine, markovEngine, valuator);

        this.config = {
            // Premium to pay above fair value (0.10 = 10%)
            tradePremium: config.tradePremium || 0.10,

            // Cooldown: turns before same property can be involved in trade
            propertyCooldown: config.propertyCooldown || 10,

            // Maximum cash as % of current money
            maxCashOffer: config.maxCashOffer || 0.5,

            // Minimum cash reserve after trade
            minReserveAfterTrade: config.minReserveAfterTrade || 200,

            ...config
        };

        // Track properties involved in recent trades (with turn number)
        this.propertyTradeHistory = new Map();  // property -> lastTradeTurn

        // Track total premiums paid (for analysis)
        this.totalPremiumsPaid = 0;
    }

    /**
     * Override preTurn to attempt premium trades
     */
    preTurn(state) {
        // First, attempt our premium trades
        this.attemptPremiumTrades(state);

        // Then do parent's preTurn (may include building)
        super.preTurn(state);
    }

    /**
     * Clean up expired cooldowns
     */
    cleanupCooldowns(currentTurn) {
        for (const [prop, lastTurn] of this.propertyTradeHistory.entries()) {
            if (currentTurn - lastTurn >= this.config.propertyCooldown) {
                this.propertyTradeHistory.delete(prop);
            }
        }
    }

    /**
     * Check if property is on cooldown
     */
    isOnCooldown(property, currentTurn) {
        const lastTrade = this.propertyTradeHistory.get(property);
        if (lastTrade === undefined) return false;
        return (currentTurn - lastTrade) < this.config.propertyCooldown;
    }

    /**
     * Record properties involved in a trade
     */
    recordTrade(properties, currentTurn) {
        for (const prop of properties) {
            this.propertyTradeHistory.set(prop, currentTurn);
        }
    }

    /**
     * Attempt trades with premium logic
     */
    attemptPremiumTrades(state) {
        this.cleanupCooldowns(state.turn);

        // Find monopoly completion opportunities
        const opportunities = this.engine.findTradeOpportunities(this.player);

        for (const opp of opportunities) {
            if (opp.type !== 'complete_monopoly') continue;

            const trade = this.buildPremiumTrade(opp, state);
            if (!trade) continue;

            // Check cooldowns on all properties involved
            const allProps = [...trade.fromProperties, ...trade.toProperties];
            if (allProps.some(p => this.isOnCooldown(p, state.turn))) {
                continue;
            }

            // Propose to other player
            const otherPlayer = opp.from;
            if (otherPlayer.ai && otherPlayer.ai.evaluateTrade) {
                const response = otherPlayer.ai.evaluateTrade(trade, state);
                if (response === true) {
                    // Track premium paid
                    if (trade.premiumPaid) {
                        this.totalPremiumsPaid += trade.premiumPaid;
                    }

                    // Execute trade
                    this.engine.executeTrade(trade);

                    // Record cooldowns for both sides
                    this.recordTrade(allProps, state.turn);
                    if (otherPlayer.ai && otherPlayer.ai.recordTrade) {
                        otherPlayer.ai.recordTrade(allProps, state.turn);
                    }

                    return;  // One trade per turn
                }
            }
        }
    }

    /**
     * Build a trade offer with premium
     */
    buildPremiumTrade(opportunity, state) {
        const { group, myOwned, needed, from: otherPlayer } = opportunity;

        // Verify this completes our monopoly
        const groupSquares = COLOR_GROUPS[group].squares;
        if (myOwned.length + needed.length !== groupSquares.length) {
            return null;
        }

        // Find what we can offer them
        const theirNeeds = this.findWhatTheyNeed(otherPlayer, state);

        for (const theirNeed of theirNeeds) {
            // Don't offer properties from the monopoly we're completing
            if (theirNeed.group === group) continue;

            // Find properties we can offer
            const canOffer = theirNeed.needed.filter(sq =>
                this.player.properties.has(sq) &&
                state.propertyStates[sq].houses === 0 &&
                !this.isOnCooldown(sq, state.turn)
            );

            if (canOffer.length === 0) continue;

            // Check if this completes THEIR monopoly
            const theirGroupSquares = COLOR_GROUPS[theirNeed.group].squares;
            if (theirNeed.theirOwned.length + canOffer.length !== theirGroupSquares.length) {
                continue;
            }

            // Must give all they need
            if (canOffer.length !== theirNeed.needed.length) {
                continue;
            }

            // Calculate property values
            const weReceiveValue = needed.reduce((sum, sq) => sum + BOARD[sq].price, 0);
            const weGiveValue = canOffer.reduce((sum, sq) => sum + BOARD[sq].price, 0);

            // Base cash = difference in property values
            let baseCash = weReceiveValue - weGiveValue;

            // Add premium on what we're receiving (the strategic value)
            const premium = Math.floor(weReceiveValue * this.config.tradePremium);
            let totalCash = baseCash + premium;

            // Check if we can afford it
            const maxCash = Math.floor(this.player.money * this.config.maxCashOffer);
            if (totalCash > maxCash) {
                // Try without premium
                totalCash = Math.min(baseCash, maxCash);
            }

            // Ensure we keep minimum reserve
            if (totalCash > 0 && this.player.money - totalCash < this.config.minReserveAfterTrade) {
                totalCash = Math.max(0, this.player.money - this.config.minReserveAfterTrade);
            }

            // Build the trade
            return {
                from: this.player,
                to: otherPlayer,
                fromProperties: new Set(canOffer),
                toProperties: new Set(needed),
                fromCash: totalCash,
                premiumPaid: Math.max(0, totalCash - baseCash)
            };
        }

        // Try cash-only trade if we have no properties they want
        return this.buildCashOnlyTrade(opportunity, state);
    }

    /**
     * Build a cash-only trade (we give cash, they give property)
     */
    buildCashOnlyTrade(opportunity, state) {
        const { group, myOwned, needed, from: otherPlayer } = opportunity;

        // Verify this completes our monopoly
        const groupSquares = COLOR_GROUPS[group].squares;
        if (myOwned.length + needed.length !== groupSquares.length) {
            return null;
        }

        // Calculate property value
        const propertyValue = needed.reduce((sum, sq) => sum + BOARD[sq].price, 0);

        // Offer property value + premium
        const premium = Math.floor(propertyValue * this.config.tradePremium);
        let cashOffer = propertyValue + premium;

        // Cap at what we can afford
        const maxCash = Math.floor(this.player.money * this.config.maxCashOffer);
        cashOffer = Math.min(cashOffer, maxCash);

        // Ensure minimum reserve
        if (this.player.money - cashOffer < this.config.minReserveAfterTrade) {
            cashOffer = Math.max(0, this.player.money - this.config.minReserveAfterTrade);
        }

        // Only offer if it's at least property value
        if (cashOffer < propertyValue) {
            return null;
        }

        return {
            from: this.player,
            to: otherPlayer,
            fromProperties: new Set(),
            toProperties: new Set(needed),
            fromCash: cashOffer,
            premiumPaid: Math.max(0, cashOffer - propertyValue)
        };
    }

    /**
     * Find what properties another player needs for monopolies
     */
    findWhatTheyNeed(otherPlayer, state) {
        const needs = [];

        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const groupSquares = group.squares;

            const theirOwned = groupSquares.filter(sq =>
                state.propertyStates[sq].owner === otherPlayer.id
            );

            // Skip if they already have monopoly or no progress
            if (theirOwned.length === 0) continue;
            if (theirOwned.length === groupSquares.length) continue;

            // Find what they still need
            const needed = groupSquares.filter(sq =>
                state.propertyStates[sq].owner !== otherPlayer.id &&
                state.propertyStates[sq].owner !== null
            );

            if (needed.length > 0) {
                needs.push({
                    group: groupName,
                    theirOwned,
                    needed
                });
            }
        }

        return needs;
    }

    /**
     * Override evaluateTrade to accept reasonable offers
     * (We're willing to give up properties for fair value + small premium from them)
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        // Check cooldowns on properties we'd be giving away
        for (const prop of toProperties) {
            if (this.isOnCooldown(prop, state.turn)) {
                return false;
            }
        }

        // Use parent's evaluation (relative position based)
        const parentResult = super.evaluateTrade(offer, state);

        // If parent accepts, we accept
        if (parentResult) {
            // Record cooldowns
            const allProps = [...fromProperties, ...toProperties];
            this.recordTrade(allProps, state.turn);
            return true;
        }

        // Additional check: accept if they're paying us a premium
        const weReceiveValue = [...fromProperties].reduce((sum, sq) => sum + BOARD[sq].price, 0);
        const weGiveValue = [...toProperties].reduce((sum, sq) => sum + BOARD[sq].price, 0);
        const fairCash = weGiveValue - weReceiveValue;

        // If they're offering more than fair value, consider accepting
        if (fromCash >= fairCash * 1.05) {  // 5% premium threshold
            // But only if this doesn't break our monopoly path significantly
            // Check if we're giving up properties that would complete our monopoly
            for (const prop of toProperties) {
                const square = BOARD[prop];
                if (square.group && this.wouldCompleteMonopoly(prop, state)) {
                    return false;  // Don't give up monopoly-completing properties
                }
            }

            // Accept the offer
            const allProps = [...fromProperties, ...toProperties];
            this.recordTrade(allProps, state.turn);
            return true;
        }

        return false;
    }
}

// =============================================================================
// PRESET VARIANTS
// =============================================================================

class PremiumTrader5 extends PremiumTradingAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, { tradePremium: 0.05 });
    }
}

class PremiumTrader10 extends PremiumTradingAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, { tradePremium: 0.10 });
    }
}

class PremiumTrader20 extends PremiumTradingAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, { tradePremium: 0.20 });
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    PremiumTradingAI,
    PremiumTrader5,
    PremiumTrader10,
    PremiumTrader20
};
