/**
 * Dynamic Trading AI
 *
 * Trading parameters adjust based on game state:
 * - Turn number (early vs late game)
 * - Relative position (ahead vs behind)
 * - Monopoly status (have income vs need income)
 * - Opponent threat level
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

// =============================================================================
// DYNAMIC TRADING AI
// =============================================================================

class DynamicTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'DynamicTradingAI';
    }

    /**
     * Calculate game phase (0 = early, 1 = late)
     * Based on properties sold and development level
     */
    getGamePhase(state) {
        // Count total properties sold
        let propertiesSold = 0;
        let totalHouses = 0;

        // Only iterate over properties that exist in propertyStates
        for (const [idx, propState] of Object.entries(state.propertyStates)) {
            if (propState.owner !== null) {
                propertiesSold++;
                totalHouses += propState.houses;
            }
        }

        // 28 buyable properties total
        const propertySaturation = propertiesSold / 28;

        // Development level (rough estimate: max ~100 houses worth)
        const developmentLevel = totalHouses / 50;

        // Combine: more properties sold + more development = later game
        return Math.min(1, (propertySaturation * 0.6 + developmentLevel * 0.4));
    }

    /**
     * Calculate relative position (-1 = far behind, 0 = even, 1 = far ahead)
     */
    getRelativePosition(state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        if (activePlayers.length <= 1) return 0;

        // Calculate net worth for all players
        const netWorths = activePlayers.map(p => this.calculateNetWorth(p, state));
        const myNetWorth = this.calculateNetWorth(this.player, state);

        const avgNetWorth = netWorths.reduce((a, b) => a + b, 0) / netWorths.length;
        const maxNetWorth = Math.max(...netWorths);
        const minNetWorth = Math.min(...netWorths);

        if (maxNetWorth === minNetWorth) return 0;

        // Normalize to -1 to 1 range
        return (myNetWorth - avgNetWorth) / (maxNetWorth - minNetWorth);
    }

    /**
     * Calculate net worth including property and development value
     */
    calculateNetWorth(player, state) {
        let worth = player.money;

        for (const prop of player.properties) {
            const propState = state.propertyStates[prop];
            const square = BOARD[prop];

            if (square.price) {
                if (propState.mortgaged) {
                    worth += square.price * 0.5;
                } else {
                    worth += square.price;
                    if (propState.houses > 0 && square.housePrice) {
                        // Houses sell for half price
                        worth += propState.houses * square.housePrice * 0.5;
                    }
                }
            }
        }

        return worth;
    }

    /**
     * Check if I have any developed monopolies generating income
     */
    hasIncomeMonopoly(state) {
        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            if (this.player.hasMonopoly(groupName, state)) {
                // Check if any property in this monopoly has houses
                const hasHouses = group.squares.some(sq =>
                    state.propertyStates[sq].houses > 0
                );
                if (hasHouses) return true;
            }
        }
        return false;
    }

    /**
     * Calculate opponent threat level (how developed are their monopolies)
     */
    getOpponentThreat(state) {
        let maxThreat = 0;

        for (const player of state.players) {
            if (player.id === this.player.id || player.bankrupt) continue;

            let playerThreat = 0;

            for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
                if (player.hasMonopoly(groupName, state)) {
                    // Calculate EPT of their monopoly
                    let monopolyEPT = 0;
                    for (const sq of group.squares) {
                        const houses = state.propertyStates[sq].houses;
                        const rent = BOARD[sq].rent[houses] || BOARD[sq].rent[0] * 2;
                        const prob = this.probs ? this.probs[sq] : 0.025;
                        monopolyEPT += prob * rent;
                    }
                    playerThreat += monopolyEPT;
                }
            }

            maxThreat = Math.max(maxThreat, playerThreat);
        }

        // Normalize: 0 = no threat, 1 = severe threat (>$50 EPT)
        return Math.min(1, maxThreat / 50);
    }

    /**
     * Dynamic cash premium multiplier
     */
    getDynamicPremiumMultiplier(state) {
        const phase = this.getGamePhase(state);
        const position = this.getRelativePosition(state);
        const hasIncome = this.hasIncomeMonopoly(state);
        const threat = this.getOpponentThreat(state);

        // Base multiplier
        let multiplier = 10;

        // Late game: increase willingness to pay (monopolies are decisive)
        multiplier += phase * 5;  // Up to +5 in late game

        // If ahead: can afford to pay more
        if (position > 0.3) {
            multiplier += position * 5;  // Up to +5 if far ahead
        }

        // If behind and no income: more desperate, pay more
        if (position < -0.3 && !hasIncome) {
            multiplier += Math.abs(position) * 8;  // Up to +8 if desperate
        }

        // High threat: urgency to get monopoly
        multiplier += threat * 5;  // Up to +5 if opponents are developed

        return multiplier;
    }

    /**
     * Dynamic max cash offer percentage
     */
    getDynamicMaxCashOffer(state) {
        const phase = this.getGamePhase(state);
        const position = this.getRelativePosition(state);
        const hasIncome = this.hasIncomeMonopoly(state);
        const threat = this.getOpponentThreat(state);

        // Base: 50%
        let maxOffer = 0.5;

        // Early game with no income: be conservative
        if (phase < 0.3 && !hasIncome) {
            maxOffer = 0.4;
        }

        // If we have income: can spend more
        if (hasIncome) {
            maxOffer += 0.15;
        }

        // If far ahead: can afford to spend more
        if (position > 0.5) {
            maxOffer += 0.1;
        }

        // High threat and no income: desperate, spend more
        if (threat > 0.5 && !hasIncome) {
            maxOffer += 0.15;
        }

        // Cap at 80%
        return Math.min(0.8, maxOffer);
    }

    /**
     * Dynamic payback limit
     */
    getDynamicPaybackLimit(state) {
        const phase = this.getGamePhase(state);
        const position = this.getRelativePosition(state);

        // Base: 40 turns
        let limit = 40;

        // Early game: can wait longer for payback
        limit += (1 - phase) * 20;  // Up to +20 in early game

        // If ahead: can afford longer payback
        if (position > 0.3) {
            limit += 10;
        }

        // If behind in late game: need faster payback
        if (position < -0.3 && phase > 0.5) {
            limit -= 15;
        }

        return Math.max(20, limit);  // Minimum 20 turns
    }

    /**
     * Override cash offer calculation to use dynamic parameters
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        const premiumMultiplier = this.getDynamicPremiumMultiplier(state);
        const maxCashOffer = this.getDynamicMaxCashOffer(state);
        const paybackLimit = this.getDynamicPaybackLimit(state);

        // Base offer: property prices
        let baseValue = 0;
        for (const prop of properties) {
            baseValue += BOARD[prop].price;
        }

        // Dynamic premium
        const premium = Math.floor(eptGain * premiumMultiplier);
        const offer = baseValue + premium;
        const maxOffer = Math.floor(this.player.money * maxCashOffer);

        // Payback check
        const firstProp = properties.values().next().value;
        const houseCost = BOARD[firstProp].housePrice * 3 * properties.size;
        const totalInvestment = offer + houseCost;

        if (eptGain > 0 && totalInvestment / eptGain > paybackLimit) {
            return 0;
        }

        return Math.min(offer, maxOffer);
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    DynamicTradingAI
};
