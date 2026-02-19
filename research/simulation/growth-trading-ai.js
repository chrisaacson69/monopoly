/**
 * Growth-Based Trading AI
 *
 * Uses the EPT growth model to properly value trades.
 *
 * Key insight: The value of a monopoly depends on:
 * 1. The monopoly's rent schedule (EPT at each house level)
 * 2. House costs (how expensive to develop)
 * 3. CASH LEFT AFTER TRADE (determines development speed)
 *
 * A trade that leaves you cash-poor delays development and
 * dramatically reduces the NPV of the monopoly.
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

class GrowthTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'GrowthTradingAI';

        // Growth model parameters
        this.projectionHorizon = 50;    // Turns to project growth
        this.discountRate = 0.02;       // Per-turn discount rate
        this.minCashReserve = 100;      // Keep at least this much cash
    }

    /**
     * Calculate EPT for a monopoly at a given house level
     */
    calculateGroupEPT(group, houses, opponents) {
        const squares = COLOR_GROUPS[group].squares;
        let totalEPT = 0;

        for (const sq of squares) {
            const prob = this.probs ? this.probs[sq] : 0.025;
            let rent;

            if (houses === 0) {
                rent = BOARD[sq].rent[0] * 2;  // Monopoly bonus
            } else {
                rent = BOARD[sq].rent[houses];
            }

            totalEPT += prob * rent * opponents;
        }

        return totalEPT;
    }

    /**
     * Model the growth curve for a monopoly given starting cash
     * Returns cumulative NPV over the projection horizon
     */
    calculateGrowthNPV(group, startingCash, opponents) {
        const houseCost = BOARD[COLOR_GROUPS[group].squares[0]].housePrice;
        const groupSize = COLOR_GROUPS[group].squares.length;
        const costPerLevel = houseCost * groupSize;

        let cash = startingCash;
        let houses = 0;
        let npv = 0;

        for (let t = 1; t <= this.projectionHorizon; t++) {
            const ept = this.calculateGroupEPT(group, houses, opponents);

            // Add discounted EPT to NPV
            const discountFactor = 1 / Math.pow(1 + this.discountRate, t);
            npv += ept * discountFactor;

            // Earn EPT
            cash += ept;

            // Buy houses if possible (build evenly)
            while (houses < 5 && cash >= costPerLevel) {
                cash -= costPerLevel;
                houses++;
            }
        }

        return npv;
    }

    /**
     * Calculate the growth NPV for a player's current position
     */
    calculatePlayerGrowthNPV(player, state) {
        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        if (opponents === 0) return player.money;

        let totalNPV = player.money;  // Cash has face value

        // Find monopolies this player has
        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = group.squares.every(sq =>
                state.propertyStates[sq]?.owner === player.id
            );

            if (ownsAll) {
                // Calculate current development level
                const currentHouses = state.propertyStates[group.squares[0]].houses || 0;

                // Calculate remaining development potential
                if (currentHouses < 5) {
                    const houseCost = BOARD[group.squares[0]].housePrice;
                    const groupSize = group.squares.length;

                    // NPV of future earnings from this monopoly
                    // Start from current house level
                    const npv = this.calculateGrowthNPVFromLevel(
                        groupName, currentHouses, player.money, opponents
                    );
                    totalNPV += npv;
                }
            }
        }

        return totalNPV;
    }

    /**
     * Calculate growth NPV starting from a specific house level
     */
    calculateGrowthNPVFromLevel(group, startHouses, startingCash, opponents) {
        const houseCost = BOARD[COLOR_GROUPS[group].squares[0]].housePrice;
        const groupSize = COLOR_GROUPS[group].squares.length;
        const costPerLevel = houseCost * groupSize;

        let cash = startingCash;
        let houses = startHouses;
        let npv = 0;

        for (let t = 1; t <= this.projectionHorizon; t++) {
            const ept = this.calculateGroupEPT(group, houses, opponents);
            const discountFactor = 1 / Math.pow(1 + this.discountRate, t);
            npv += ept * discountFactor;

            cash += ept;

            while (houses < 5 && cash >= costPerLevel) {
                cash -= costPerLevel;
                houses++;
            }
        }

        return npv;
    }

    /**
     * Override: Calculate cash offer using growth model
     *
     * Key insight: The offer should account for cash LEFT AFTER paying.
     *
     * Strategy: Find the offer that maximizes profit (NPV - offer).
     * This naturally accounts for the fact that higher offers leave less
     * cash for development, which reduces NPV.
     *
     * The optimal offer is where marginal NPV loss = marginal offer increase.
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        const firstProp = properties.values().next().value;
        const group = BOARD[firstProp].group;

        if (!group) {
            return super.calculateMonopolyCashOffer(properties, eptGain, state);
        }

        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        const myCash = this.player.money;
        const maxOffer = myCash - this.minCashReserve;

        if (maxOffer <= 0) return 0;

        const houseCost = BOARD[COLOR_GROUPS[group].squares[0]].housePrice;
        const groupSize = COLOR_GROUPS[group].squares.length;
        const costPerHouseLevel = houseCost * groupSize;

        // Base offer: property values
        let baseValue = 0;
        for (const prop of properties) {
            baseValue += BOARD[prop].price;
        }

        // Find the offer that maximizes profit = NPV(cash_after) - offer
        // This automatically balances: higher offer = lower cash = lower NPV
        let bestOffer = 0;
        let maxProfit = -Infinity;
        const step = 50;

        // Sample offers from base value up to max
        for (let offer = baseValue; offer <= maxOffer; offer += step) {
            const cashAfterTrade = myCash - offer;
            const monopolyNPV = this.calculateGrowthNPV(group, cashAfterTrade, opponents);

            // Profit = value gained - price paid
            const profit = monopolyNPV - offer;

            if (profit > maxProfit) {
                maxProfit = profit;
                bestOffer = offer;
            }
        }

        // Only offer if profitable
        if (maxProfit <= 0) {
            return 0;
        }

        // Now, how much MORE should we offer to actually get the deal?
        // The max-profit offer might be too low to be accepted.
        // We should offer up to the point where profit is still positive
        // and we keep reasonable development cash.

        // Find the "acceptable range" - offers where profit > 0
        // Then choose an offer in that range that's likely to be accepted
        const minDevCash = costPerHouseLevel;  // Keep at least 1 house level
        const acceptableMaxOffer = Math.max(bestOffer, myCash - minDevCash);

        // Check profit at higher offers
        const profitAtAcceptableMax = this.calculateGrowthNPV(group, myCash - acceptableMaxOffer, opponents) - acceptableMaxOffer;

        // If profitable at higher offer, increase to improve acceptance chance
        if (profitAtAcceptableMax > maxProfit * 0.5) {
            // Still capturing >50% of max profit, worth offering more
            bestOffer = Math.floor((bestOffer + acceptableMaxOffer) / 2);
        }

        // Add premium to compete with Standard Trading AI's offers
        // Standard offers baseValue + eptGain*10, capped at 50% of cash
        const standardOffer = Math.min(baseValue + eptGain * 10, myCash * 0.5);

        // Match standard offer if our profit remains positive
        if (standardOffer > bestOffer) {
            const profitAtStandard = this.calculateGrowthNPV(group, myCash - standardOffer, opponents) - standardOffer;
            if (profitAtStandard > 0) {
                bestOffer = standardOffer;
            }
        }

        return Math.max(0, Math.floor(bestOffer));
    }

    /**
     * Override: Evaluate trade using growth model
     *
     * Key principle: Accept trades that improve our position.
     * "Position" = Cash + NPV of monopolies we have/will have.
     *
     * For cash-for-property trades (we sell property, get cash):
     * - The cash improves our development speed on existing/future monopolies
     * - But we lose future monopoly potential on the sold property
     *
     * For mutual-monopoly trades:
     * - Both sides gain a monopoly
     * - Compare our growth NPV vs their growth NPV
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        if (opponents === 0) return false;

        // Cash position after trade
        const myCashAfter = this.player.money + fromCash;

        // Check if I complete a monopoly from this trade
        let myMonopolyGroup = null;
        for (const prop of fromProperties) {
            const square = BOARD[prop];
            if (!square.group) continue;

            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                myMonopolyGroup = square.group;
                break;
            }
        }

        // Check if opponent completes a monopoly
        let opponentMonopolyGroup = null;
        for (const prop of toProperties) {
            const square = BOARD[prop];
            if (!square.group) continue;

            const groupSquares = COLOR_GROUPS[square.group].squares;
            const opponentWouldOwn = groupSquares.filter(sq =>
                state.propertyStates[sq]?.owner === from.id || toProperties.has(sq)
            ).length;

            if (opponentWouldOwn === groupSquares.length) {
                opponentMonopolyGroup = square.group;
                break;
            }
        }

        // Calculate values
        let myValue = fromCash;  // Cash I receive
        let theirValue = -fromCash;  // Cash they receive (negative of what I get)

        // If I get a monopoly, calculate its growth NPV
        if (myMonopolyGroup) {
            myValue += this.calculateGrowthNPV(myMonopolyGroup, myCashAfter, opponents);
        }

        // If they get a monopoly, calculate their growth NPV
        // This is what I'm "giving" them by enabling their monopoly
        if (opponentMonopolyGroup) {
            const opponentCashAfter = from.money - fromCash;
            theirValue += this.calculateGrowthNPV(opponentMonopolyGroup, opponentCashAfter, opponents);
        }

        // Calculate value of properties I give up (non-monopoly value)
        for (const prop of toProperties) {
            const square = BOARD[prop];
            if (square.rent) {
                // Simple NPV: prob * rent * opponents * turns (discounted)
                const prob = this.probs ? this.probs[prop] : 0.025;
                const simpleNPV = prob * square.rent[0] * opponents * 25;  // ~25 effective turns
                myValue -= simpleNPV;
            }
        }

        // Calculate value of properties I receive (non-monopoly value)
        for (const prop of fromProperties) {
            if (prop === myMonopolyGroup) continue;  // Already counted in monopoly NPV
            const square = BOARD[prop];
            if (square.rent) {
                const prob = this.probs ? this.probs[prop] : 0.025;
                const simpleNPV = prob * square.rent[0] * opponents * 25;
                myValue += simpleNPV;
            }
        }

        // DECISION LOGIC:
        //
        // Case 1: I get a monopoly, they don't
        // Accept if my monopoly NPV > what I pay (cash + properties)
        if (myMonopolyGroup && !opponentMonopolyGroup) {
            return myValue > 0;
        }

        // Case 2: They get a monopoly, I don't
        // Accept only if I'm getting paid well for enabling their monopoly
        //
        // Key insight: theirValue = -cash_paid + monopoly_NPV(cash_remaining)
        // As they pay more, their monopoly is worth less (less dev cash).
        //
        // Conservative approach: demand a substantial share of their gain.
        // Being too lenient enables cheap monopolies for opponents.
        if (opponentMonopolyGroup && !myMonopolyGroup) {
            // Demand 35% of their net gain (same as NPV AI)
            const minCashRequired = theirValue * 0.35;
            return fromCash >= minCashRequired;
        }

        // Case 3: Both get monopolies (mutual trade)
        // Accept if my NPV gain > their NPV gain, or close to equal
        if (myMonopolyGroup && opponentMonopolyGroup) {
            const myMonopolyNPV = this.calculateGrowthNPV(myMonopolyGroup, myCashAfter, opponents);
            const theirMonopolyNPV = this.calculateGrowthNPV(opponentMonopolyGroup, from.money - fromCash, opponents);

            // Accept if my gain is at least 80% of their gain
            // (allow some disadvantage to get trades flowing)
            return myMonopolyNPV >= theirMonopolyNPV * 0.8;
        }

        // Case 4: Neither gets a monopoly (property swap)
        // Accept if net value to me is positive
        return myValue > 0;
    }
}

module.exports = { GrowthTradingAI };
