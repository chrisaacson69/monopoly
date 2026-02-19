/**
 * NPV-Based Trading AI
 *
 * Uses Net Present Value calculations to fairly value trades.
 *
 * Key financial principles:
 * 1. EPT acts as an "interest rate" on your position
 * 2. Discount rate = total EPT / total cash (velocity of money)
 * 3. Fair trade: NPV(give) ≈ NPV(receive)
 * 4. Payback period determines if trade is worthwhile
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

// =============================================================================
// NPV TRADING AI
// =============================================================================

class NPVTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'NPVTradingAI';

        // NPV-based parameters
        this.maxPaybackTurns = 30;      // Max turns to recoup investment
        this.minSellerShare = 0.35;     // Seller demands at least 35% of NPV
        this.maxBuyerShare = 0.65;      // Buyer won't pay more than 65% of NPV
    }

    /**
     * Calculate discount rate based on game state
     * Discount rate = EPT / Cash (money velocity)
     */
    calculateDiscountRate(state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        let totalEPT = 0;

        for (const player of activePlayers) {
            for (const prop of player.properties) {
                const propState = state.propertyStates[prop];
                const square = BOARD[prop];

                if (square.rent) {
                    const houses = propState.houses || 0;
                    let rent;

                    if (square.group && player.hasMonopoly && player.hasMonopoly(square.group, state)) {
                        rent = houses === 0 ? square.rent[0] * 2 : square.rent[houses];
                    } else {
                        rent = square.rent[houses] || square.rent[0];
                    }

                    const prob = this.probs ? this.probs[prop] : 0.025;
                    const opponents = activePlayers.length - 1;
                    totalEPT += prob * rent * opponents;
                }
            }
        }

        const totalCash = activePlayers.reduce((sum, p) => sum + p.money, 0);
        const discountRate = totalCash > 0 ? totalEPT / totalCash : 0.02;

        // Clamp to reasonable range (1% to 15% per turn)
        return Math.max(0.01, Math.min(0.15, discountRate));
    }

    /**
     * Estimate turns remaining in game
     */
    estimateTurnsRemaining(state) {
        let propertiesSold = 0;
        let totalHouses = 0;

        for (const [idx, propState] of Object.entries(state.propertyStates)) {
            if (propState.owner !== null) {
                propertiesSold++;
                totalHouses += propState.houses || 0;
            }
        }

        const developmentLevel = totalHouses / 32;
        const baseRemaining = 120 - state.turn;
        const adjustedRemaining = baseRemaining * (1 - developmentLevel * 0.5);

        return Math.max(20, Math.min(100, adjustedRemaining));
    }

    /**
     * Calculate NPV of an income stream
     * NPV = EPT × (1 - (1+r)^-n) / r
     */
    calculateNPV(ept, discountRate, turns) {
        if (discountRate <= 0 || ept <= 0 || turns <= 0) return 0;

        const pvFactor = (1 - Math.pow(1 + discountRate, -turns)) / discountRate;
        return ept * pvFactor;
    }

    /**
     * Calculate NPV of a monopoly (including house costs)
     */
    calculateMonopolyNPV(group, state) {
        const discountRate = this.calculateDiscountRate(state);
        const turnsRemaining = this.estimateTurnsRemaining(state);

        const groupSquares = COLOR_GROUPS[group].squares;
        const opponents = state.players.filter(p => !p.bankrupt).length - 1;

        // Calculate EPT at 3 houses
        let ept3H = 0;
        for (const sq of groupSquares) {
            const prob = this.probs ? this.probs[sq] : 0.025;
            const rent3H = BOARD[sq].rent[3];
            ept3H += prob * rent3H * opponents;
        }

        const grossNPV = this.calculateNPV(ept3H, discountRate, turnsRemaining);
        const houseCost = BOARD[groupSquares[0]].housePrice * 3 * groupSquares.length;

        return {
            ept: ept3H,
            discountRate,
            turnsRemaining,
            grossNPV,
            houseCost,
            netNPV: grossNPV - houseCost
        };
    }

    /**
     * Override cash offer calculation to use NPV
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        // Get the group from properties
        const firstProp = properties.values().next().value;
        const group = BOARD[firstProp].group;

        if (!group) {
            // Fall back to parent for non-color properties
            return super.calculateMonopolyCashOffer(properties, eptGain, state);
        }

        const monopolyValue = this.calculateMonopolyNPV(group, state);

        // Buyer's max offer: 65% of net NPV
        const maxFairOffer = monopolyValue.netNPV * this.maxBuyerShare;

        // Check payback period
        const paybackTurns = maxFairOffer / monopolyValue.ept;
        if (paybackTurns > this.maxPaybackTurns) {
            // Too long to recoup - reduce offer or skip
            return 0;
        }

        // Cap at available cash
        const maxCash = Math.floor(this.player.money * this.maxCashOffer);

        return Math.min(maxFairOffer, maxCash);
    }

    /**
     * Override trade evaluation to use NPV-based blocking value
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        let ourGain = 0;
        let ourLoss = 0;

        // Properties we receive
        for (const prop of fromProperties) {
            ourGain += this.calculatePropertyValue(prop, state);

            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                const group = BOARD[prop].group;
                const monopolyValue = this.calculateMonopolyNPV(group, state);
                ourGain += monopolyValue.netNPV;
            }
        }

        // Properties we give up
        for (const prop of toProperties) {
            ourLoss += this.calculatePropertyValue(prop, state);

            // Calculate NPV-based blocking value
            const blockingNPV = this.calculateBlockingNPV(prop, from, state);
            if (blockingNPV > 0) {
                // Demand our share of the NPV we're enabling
                ourLoss += blockingNPV * this.minSellerShare;
            } else if (this.wouldGiveUpMonopolyChance(prop, state)) {
                ourLoss += 100;
            }
        }

        // Cash component
        ourGain += fromCash;

        const netGain = ourGain - ourLoss;

        // Accept if net positive (small tolerance for mutual benefit)
        return netGain >= -50;
    }

    /**
     * Calculate NPV-based blocking value
     */
    calculateBlockingNPV(position, opponent, state) {
        const square = BOARD[position];
        if (!square.group) return 0;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Count how many opponent owns
        const opponentOwns = groupSquares.filter(sq =>
            state.propertyStates[sq].owner === opponent.id
        ).length;

        // Does this complete their monopoly?
        if (opponentOwns + 1 !== groupSquares.length) {
            return 0;
        }

        // Calculate NPV of the monopoly we'd be enabling
        const monopolyValue = this.calculateMonopolyNPV(square.group, state);
        return monopolyValue.netNPV;
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    NPVTradingAI
};
