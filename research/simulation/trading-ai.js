/**
 * Trading AI for Monopoly Simulation
 *
 * Extends StrategicAI with trading capabilities.
 * The key insight: trading almost always benefits both parties when it
 * creates monopolies, because EPT gains far exceed holding scattered properties.
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES, RAILROAD_RENT, UTILITY_MULTIPLIER, SQUARE_TYPES } = require('./game-engine.js');
const { StrategicAI } = require('./base-ai.js');

// =============================================================================
// TRADING AI
// =============================================================================

class TradingAI extends StrategicAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'TradingAI';

        // Trading parameters
        this.minTradeGain = 0;  // Minimum EPT gain to accept a trade (can be 0 for mutual benefit)
        this.maxCashOffer = 0.5;  // Max fraction of cash to offer in trades

        // Track recent trades to prevent loops
        this.recentTrades = [];  // Array of {turn, props} traded away
        this.tradeCooldown = 5;  // Turns before we can trade back the same property
    }

    /**
     * Called before rolling - opportunity to propose trades
     */
    preTurn(state) {
        // First, try to make trades
        this.attemptTrades(state);

        // Then build houses (inherited from StrategicAI)
        this.buildOptimalHouses(state);
    }

    /**
     * Attempt to make beneficial trades
     */
    attemptTrades(state) {
        // Clean up old trades from cooldown tracking
        this.recentTrades = this.recentTrades.filter(t =>
            state.turn - t.turn < this.tradeCooldown
        );

        // Find trade opportunities
        const opportunities = this.engine.findTradeOpportunities(this.player);

        for (const opp of opportunities) {
            if (opp.type === 'complete_monopoly') {
                const trade = this.evaluateMonopolyTrade(opp, state);
                if (trade) {
                    // Check cooldown - don't trade away properties we recently received
                    const tradingAwayCooled = Array.from(trade.fromProperties).some(prop =>
                        this.recentTrades.some(t => t.props.has(prop))
                    );
                    if (tradingAwayCooled) continue;

                    // Propose trade to other player's AI
                    const otherPlayer = opp.from;
                    if (otherPlayer.ai && otherPlayer.ai.evaluateTrade) {
                        const response = otherPlayer.ai.evaluateTrade(trade, state);
                        if (response === true) {
                            // Trade accepted!
                            this.engine.executeTrade(trade);

                            // Track what we traded away
                            this.recentTrades.push({
                                turn: state.turn,
                                props: trade.fromProperties
                            });

                            // Track what they traded (if they're also a TradingAI)
                            if (otherPlayer.ai.recentTrades) {
                                otherPlayer.ai.recentTrades.push({
                                    turn: state.turn,
                                    props: trade.toProperties
                                });
                            }

                            return;  // One trade per turn
                        }
                    }
                }
            }
        }
    }

    /**
     * Evaluate and construct a trade offer to complete a monopoly
     */
    evaluateMonopolyTrade(opportunity, state) {
        const { group, myOwned, needed, from: otherPlayer } = opportunity;

        // IMPORTANT: Only propose if this trade would actually complete our monopoly
        const groupSquares = COLOR_GROUPS[group].squares;
        const afterTradeOwned = myOwned.length + needed.length;
        if (afterTradeOwned !== groupSquares.length) {
            return null;  // Trade wouldn't complete monopoly
        }

        // Calculate what I gain from completing this monopoly
        const myGain = this.calculateMonopolyGain(group, state);

        // Find what I can offer in return
        // Look for properties that would help them complete a monopoly
        const theirNeeds = this.findWhatTheyNeed(otherPlayer, state);

        // Try to find a mutually beneficial trade
        for (const theirNeed of theirNeeds) {
            // Don't offer properties from the same color group we're trying to complete!
            if (theirNeed.group === group) continue;

            // Check if I own what they need
            const canOffer = theirNeed.needed.filter(sq =>
                this.player.properties.has(sq) &&
                state.propertyStates[sq].houses === 0
            );

            if (canOffer.length === 0) continue;

            // Check if giving them all these would complete THEIR monopoly
            const theirGroupSquares = COLOR_GROUPS[theirNeed.group].squares;
            const theyWouldOwn = theirNeed.theirOwned.length + canOffer.length;
            if (theyWouldOwn !== theirGroupSquares.length) {
                continue;  // Trade wouldn't complete their monopoly either
            }

            // Make sure I can give them ALL they need (partial trades don't help)
            if (canOffer.length !== theirNeed.needed.length) {
                continue;  // Can only give partial - not useful
            }

            // Calculate their gain
            const theirGain = this.calculateMonopolyGain(theirNeed.group, state);

            // If both sides gain, it's a good trade
            if (myGain > 0 && theirGain > 0) {
                // Determine cash differential based on relative gains
                let cashDiff = 0;

                // If their gain is significantly higher, they should pay us
                // If our gain is significantly higher, we should pay them
                const gainRatio = myGain / (myGain + theirGain);

                // Calculate property values being exchanged
                const myPropValue = needed.reduce((sum, sq) => sum + BOARD[sq].price, 0);
                const theirPropValue = canOffer.reduce((sum, sq) => sum + BOARD[sq].price, 0);

                // Base cash on property value difference, adjusted by gain ratio
                cashDiff = Math.floor((myPropValue - theirPropValue) * gainRatio);

                // Limit cash offer
                const maxCash = Math.floor(this.player.money * this.maxCashOffer);
                cashDiff = Math.max(-maxCash, Math.min(maxCash, cashDiff));

                // Check if we can afford it
                if (cashDiff > 0 && this.player.money < cashDiff) continue;

                return {
                    from: this.player,
                    to: otherPlayer,
                    fromProperties: new Set(canOffer),
                    toProperties: new Set(needed),
                    fromCash: cashDiff,
                    // Metadata for evaluation
                    myGain,
                    theirGain
                };
            }
        }

        // No mutual monopoly trade found
        // Try cash-for-property trade if our gain is high enough
        // We'll offer cash based on the property value + a premium for completing our monopoly

        const cashOffer = this.calculateMonopolyCashOffer(needed, myGain, state);
        if (cashOffer > 0 && this.player.money >= cashOffer) {
            return {
                from: this.player,
                to: otherPlayer,
                fromProperties: new Set(),
                toProperties: new Set(needed),
                fromCash: cashOffer,
                myGain,
                theirGain: 0
            };
        }

        return null;
    }

    /**
     * Calculate how much cash to offer for properties that complete our monopoly
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        // Base offer: property prices
        let baseValue = 0;
        for (const prop of properties) {
            baseValue += BOARD[prop].price;
        }

        // Add premium based on how valuable the monopoly is to us
        // EPT gain represents expected income per opponent turn
        // At 3 houses, we expect this income for many turns
        // Rule of thumb: pay up to ~20 turns worth of expected income as premium
        const premium = Math.floor(eptGain * 10);

        // Total offer
        const offer = baseValue + premium;

        // Cap at our available cash (keeping some reserve)
        const maxOffer = Math.floor(this.player.money * this.maxCashOffer);

        // Only offer if we can afford it AND it's worth it
        // (we should expect to recoup within ~30 turns)
        const houseCost = BOARD[properties.values().next().value].housePrice * 3 * properties.size;
        const totalInvestment = offer + houseCost;

        // If total investment payback is too long, reduce offer
        if (eptGain > 0 && totalInvestment / eptGain > 40) {
            return 0;  // Too expensive
        }

        return Math.min(offer, maxOffer);
    }

    /**
     * Find what monopolies another player is close to completing
     */
    findWhatTheyNeed(otherPlayer, state) {
        const needs = [];

        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const groupSquares = group.squares;

            const theirOwned = groupSquares.filter(sq =>
                state.propertyStates[sq].owner === otherPlayer.id
            );

            // They need to own at least 1 but not all
            if (theirOwned.length === 0) continue;
            if (theirOwned.length === groupSquares.length) continue;

            const needed = groupSquares.filter(sq =>
                state.propertyStates[sq].owner !== otherPlayer.id
            );

            needs.push({
                group: groupName,
                theirOwned,
                needed,
                priority: theirOwned.length / groupSquares.length
            });
        }

        // Sort by priority (closer to completion = higher priority)
        needs.sort((a, b) => b.priority - a.priority);

        return needs;
    }

    /**
     * Calculate the EPT gain from completing a monopoly
     */
    calculateMonopolyGain(group, state) {
        if (!this.probs) return 100;  // Default value if no Markov engine

        const groupSquares = COLOR_GROUPS[group].squares;
        const opponents = state.players.filter(p =>
            p.id !== this.player.id && !p.bankrupt
        ).length;

        // Calculate EPT at 3 houses (sweet spot)
        let totalEPT = 0;
        for (const sq of groupSquares) {
            const prob = this.probs[sq];
            const rent3H = BOARD[sq].rent[3];
            totalEPT += prob * rent3H * opponents;
        }

        // Subtract current EPT (scattered properties, no monopoly)
        let currentEPT = 0;
        for (const sq of groupSquares) {
            if (state.propertyStates[sq].owner === this.player.id) {
                const prob = this.probs[sq];
                const rent0 = BOARD[sq].rent[0];  // No monopoly bonus
                currentEPT += prob * rent0 * opponents;
            }
        }

        return totalEPT - currentEPT;
    }

    /**
     * Calculate a fair cash value for properties
     */
    calculateFairCashValue(properties, state) {
        let value = 0;

        for (const sq of properties) {
            const square = BOARD[sq];
            // Base value is property price
            value += square.price;

            // Add premium if it completes a monopoly for us
            if (this.wouldCompleteMonopoly(sq, state)) {
                value += square.price * 0.5;  // 50% monopoly premium
            }
        }

        return Math.floor(value);
    }

    /**
     * Evaluate a trade offer from another player
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        // We are 'to' (receiving the offer)
        if (to.id !== this.player.id) return false;

        // Calculate what we gain
        let ourGain = 0;
        let ourLoss = 0;

        // Properties we receive
        for (const prop of fromProperties) {
            ourGain += this.calculatePropertyValue(prop, state);

            // Extra value if it completes a monopoly
            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                ourGain += this.calculateMonopolyGain(BOARD[prop].group, state);
            }
        }

        // Properties we give up
        for (const prop of toProperties) {
            ourLoss += this.calculatePropertyValue(prop, state);

            // CRITICAL: Calculate BLOCKING VALUE
            // If this property completes opponent's monopoly, we're giving them
            // a huge strategic advantage - demand fair compensation
            const blockingValue = this.calculateBlockingValue(prop, from, state);
            if (blockingValue > 0) {
                // We should receive a significant portion of their monopoly value
                // Use 40% as our share (leaves them 60% of the gain as incentive)
                ourLoss += blockingValue * 0.4;
            } else if (this.wouldGiveUpMonopolyChance(prop, state)) {
                // Smaller penalty if just giving up our own potential
                ourLoss += 100;
            }
        }

        // Cash component
        ourGain += fromCash;  // Positive = we receive cash

        // Accept if net positive (or at least neutral for mutual benefit)
        const netGain = ourGain - ourLoss;

        // Be slightly generous to encourage trading
        return netGain >= -50;  // Accept even small losses to get trades flowing
    }

    /**
     * Calculate the blocking value of a property
     * i.e., what is it worth to the opponent if I sell it to them
     */
    calculateBlockingValue(position, opponent, state) {
        const square = BOARD[position];
        if (!square.group) return 0;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Count how many of this group opponent owns
        const opponentOwns = groupSquares.filter(sq =>
            state.propertyStates[sq].owner === opponent.id
        ).length;

        // If they own all but the ones being traded, this completes their monopoly
        const theyWouldOwn = opponentOwns + 1;  // +1 for this property

        if (theyWouldOwn !== groupSquares.length) {
            return 0;  // Doesn't complete their monopoly
        }

        // They would complete their monopoly!
        // Calculate the monopoly's EPT value
        return this.calculateMonopolyGain(square.group, state);
    }

    /**
     * Calculate base value of a property
     * Handles streets, railroads, and utilities
     */
    calculatePropertyValue(position, state) {
        const square = BOARD[position];
        if (!square.price) return 0;

        let value = square.price;

        // Handle railroads - value increases with count owned
        if (square.type === SQUARE_TYPES.RAILROAD) {
            const rrCount = this.player.getRailroadCount();
            // Value based on EPT contribution
            // More railroads = exponentially more valuable
            if (rrCount >= 3) {
                value *= 2.0;  // Having 3+ makes the 4th very valuable
            } else if (rrCount >= 2) {
                value *= 1.5;
            } else if (rrCount >= 1) {
                value *= 1.25;
            }
            return value;
        }

        // Handle utilities - value doubles if you have one already
        if (square.type === SQUARE_TYPES.UTILITY) {
            const utilCount = this.player.getUtilityCount();
            if (utilCount >= 1) {
                value *= 2.5;  // Second utility is very valuable (10x vs 4x multiplier)
            }
            return value;
        }

        // Handle street properties - adjust for monopoly potential
        if (square.group) {
            const groupSquares = COLOR_GROUPS[square.group].squares;
            const owned = groupSquares.filter(sq =>
                state.propertyStates[sq].owner === this.player.id
            ).length;

            // Higher value if we're closer to monopoly
            if (owned > 0) {
                value *= 1 + (owned / groupSquares.length);
            }
        }

        return value;
    }

    /**
     * Check if adding a property would complete a monopoly
     */
    wouldCompleteMonopolyWith(position, state, additionalProps) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;
        const wouldOwn = groupSquares.filter(sq =>
            state.propertyStates[sq].owner === this.player.id ||
            sq === position ||
            additionalProps.has(sq)
        ).length;

        return wouldOwn === groupSquares.length;
    }

    /**
     * Check if giving up a property would eliminate monopoly chance
     */
    wouldGiveUpMonopolyChance(position, state) {
        const square = BOARD[position];
        if (!square.group) return false;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Check if we own any in this group
        const ourOwned = groupSquares.filter(sq =>
            state.propertyStates[sq].owner === this.player.id
        ).length;

        // If we only own 1 in this group, giving it up eliminates our chance
        return ourOwned === 1;
    }
}

// =============================================================================
// AGGRESSIVE TRADING AI
// =============================================================================

/**
 * More aggressive trading AI that actively seeks any beneficial trades
 */
class AggressiveTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'AggressiveTradingAI';
        this.minTradeGain = -100;  // Accept slightly bad trades to create action
        this.maxCashOffer = 0.7;   // Willing to spend more cash
    }

    /**
     * More lenient trade acceptance
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        // Check if we'd get a monopoly
        for (const prop of fromProperties) {
            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                // Accept almost any trade that gives us a monopoly
                // As long as we're not giving up a monopoly
                let givingUpMonopoly = false;
                for (const ourProp of toProperties) {
                    if (this.player.hasMonopoly && this.player.hasMonopoly(BOARD[ourProp].group, state)) {
                        givingUpMonopoly = true;
                        break;
                    }
                }

                if (!givingUpMonopoly) {
                    return true;  // Take the monopoly!
                }
            }
        }

        // Fall back to parent logic
        return super.evaluateTrade(offer, state);
    }
}

// =============================================================================
// NO-TRADE AI (for comparison)
// =============================================================================

/**
 * Strategic AI that explicitly refuses all trades
 * Useful for measuring the value of trading
 */
class NoTradeAI extends StrategicAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'NoTradeAI';
    }

    evaluateTrade(offer, state) {
        return false;  // Never accept trades
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    TradingAI,
    AggressiveTradingAI,
    NoTradeAI
};
