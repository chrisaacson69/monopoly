/**
 * Competitive Trading AI
 *
 * Makes trade decisions based on competitive position, not "fairness"
 *
 * Core principle: Accept a trade if it doesn't worsen my competitive position
 * relative to other players (with some slack to avoid "bargaining into last place")
 *
 * Position = Cash + EPT × turnsRemaining
 *
 * Trade acceptance criteria:
 * 1. My position must not decrease significantly
 * 2. I must not drop in rank (or if I do, have slack for recovery)
 * 3. Special case: if already last, accept anything that improves my position
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

class CompetitiveTradingAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'CompetitiveTradingAI';

        // Competitive parameters
        this.turnsHorizon = 40;          // How far ahead to project
        this.rankDropTolerance = 0;       // How many ranks we're willing to drop (0 = none)
        this.positionSlack = 0.05;        // Accept trades that worsen position by up to 5%
        this.lastPlaceAggression = true;  // Be more aggressive when in last place
    }

    /**
     * Calculate a player's EPT from their current holdings
     */
    calculatePlayerEPT(player, state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const opponents = activePlayers.length - 1;
        if (opponents === 0) return 0;

        let totalEPT = 0;

        for (const prop of player.properties) {
            const propState = state.propertyStates[prop];
            const square = BOARD[prop];

            if (!square.rent) continue;

            const houses = propState.houses || 0;
            let rent;

            if (square.group) {
                const groupSquares = COLOR_GROUPS[square.group].squares;
                const ownsAll = groupSquares.every(sq =>
                    state.propertyStates[sq]?.owner === player.id
                );

                if (ownsAll) {
                    rent = houses === 0 ? square.rent[0] * 2 : square.rent[houses];
                } else {
                    rent = square.rent[0];
                }
            } else {
                rent = square.rent[houses] || square.rent[0];
            }

            const prob = this.probs ? this.probs[prop] : 0.025;
            totalEPT += prob * rent * opponents;
        }

        return totalEPT;
    }

    /**
     * Calculate projected position for a player
     */
    calculatePosition(player, state) {
        const ept = this.calculatePlayerEPT(player, state);
        return player.money + ept * this.turnsHorizon;
    }

    /**
     * Get current rank (1 = first place)
     */
    getCurrentRank(player, state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const myPosition = this.calculatePosition(player, state);

        let rank = 1;
        for (const other of activePlayers) {
            if (other.id === player.id) continue;
            if (this.calculatePosition(other, state) > myPosition) rank++;
        }
        return rank;
    }

    /**
     * Simulate position after a trade
     */
    simulatePostTradePosition(player, cashChange, eptChange, state) {
        const currentEPT = this.calculatePlayerEPT(player, state);
        const newCash = player.money + cashChange;
        const newEPT = currentEPT + eptChange;
        return newCash + newEPT * this.turnsHorizon;
    }

    /**
     * Calculate what EPT gain the opponent gets from completing a monopoly
     */
    calculateOpponentMonopolyGain(properties, opponent, state) {
        for (const prop of properties) {
            const square = BOARD[prop];
            if (!square.group) continue;

            const groupSquares = COLOR_GROUPS[square.group].squares;

            // Check if opponent would complete this monopoly
            const wouldOwn = groupSquares.filter(sq =>
                state.propertyStates[sq]?.owner === opponent.id || properties.has(sq)
            ).length;

            if (wouldOwn === groupSquares.length) {
                // They complete the monopoly - calculate EPT gain at 3 houses
                const opponents = state.players.filter(p => !p.bankrupt).length - 1;
                let eptGain = 0;

                for (const sq of groupSquares) {
                    const prob = this.probs ? this.probs[sq] : 0.025;
                    const rent3H = BOARD[sq].rent[3];
                    eptGain += prob * rent3H * opponents;
                }

                return eptGain;
            }
        }
        return 0;
    }

    /**
     * Override trade evaluation with competitive position logic
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        const activePlayers = state.players.filter(p => !p.bankrupt);

        // Calculate my current position and rank
        const myCurrentPosition = this.calculatePosition(this.player, state);
        const myCurrentRank = this.getCurrentRank(this.player, state);
        const isLastPlace = myCurrentRank === activePlayers.length;

        // Calculate what I gain/lose
        let myEPTChange = 0;

        // EPT from properties I receive
        for (const prop of fromProperties) {
            const square = BOARD[prop];
            if (square.rent) {
                const prob = this.probs ? this.probs[prop] : 0.025;
                myEPTChange += prob * square.rent[0] * (activePlayers.length - 1);
            }

            // Bonus if it completes MY monopoly
            if (this.wouldCompleteMonopolyWith(prop, state, fromProperties)) {
                myEPTChange += this.calculateMonopolyGain(BOARD[prop].group, state);
            }
        }

        // EPT from properties I give up
        for (const prop of toProperties) {
            const square = BOARD[prop];
            if (square.rent) {
                const prob = this.probs ? this.probs[prop] : 0.025;
                myEPTChange -= prob * square.rent[0] * (activePlayers.length - 1);
            }
        }

        // My new position
        const myCashChange = fromCash;  // Positive = I receive cash
        const myNewPosition = this.simulatePostTradePosition(
            this.player, myCashChange, myEPTChange, state
        );

        // Calculate OPPONENT'S position change (this is the key insight!)
        const opponentEPTGain = this.calculateOpponentMonopolyGain(toProperties, from, state);
        const opponentPositionGain = (opponentEPTGain * this.turnsHorizon) - fromCash;

        // Calculate my new rank considering opponent's gain
        let myNewRank = 1;
        for (const other of activePlayers) {
            if (other.id === this.player.id) continue;

            let otherNewPosition = this.calculatePosition(other, state);

            // If this is the buyer, add their position gain
            if (other.id === from.id) {
                otherNewPosition += opponentPositionGain;
            }

            if (otherNewPosition > myNewPosition) myNewRank++;
        }

        // DECISION LOGIC
        const positionImproved = myNewPosition >= myCurrentPosition * (1 - this.positionSlack);
        const rankMaintained = myNewRank <= myCurrentRank + this.rankDropTolerance;

        // Special case: if in last place, accept anything that improves position
        if (isLastPlace && this.lastPlaceAggression) {
            return myNewPosition > myCurrentPosition;
        }

        // Normal case: must maintain position AND rank
        return positionImproved && rankMaintained;
    }

    /**
     * Override cash offer to be more competitive
     * Offer based on maintaining opponent's rank, not "fair value"
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        // What's the minimum I need to offer for them to accept?
        // They need to not drop in rank after my position jumps

        const activePlayers = state.players.filter(p => !p.bankrupt);

        // Find the seller
        let seller = null;
        for (const prop of properties) {
            const owner = state.propertyStates[prop]?.owner;
            if (owner !== null && owner !== this.player.id) {
                seller = activePlayers.find(p => p.id === owner);
                break;
            }
        }

        if (!seller) return 0;

        // My position gain from this monopoly
        const myPositionGain = eptGain * this.turnsHorizon;

        // Current positions
        const sellerPosition = this.calculatePosition(seller, state);
        const myPosition = this.calculatePosition(this.player, state);

        // After trade, my position jumps by myPositionGain - cash
        // Seller's position becomes: sellerPosition + cash

        // For seller to not drop below me:
        // sellerPosition + cash >= myPosition + myPositionGain - cash
        // 2 * cash >= myPosition + myPositionGain - sellerPosition
        // cash >= (myPosition + myPositionGain - sellerPosition) / 2

        const minCashForRankParity = Math.max(0,
            (myPosition + myPositionGain - sellerPosition) / 2
        );

        // But also consider: what's a good deal for ME?
        // I don't want to overpay just to be "fair"
        const maxIWouldPay = myPositionGain * 0.7;  // Keep 30% of the gain

        // Offer somewhere in between
        const offer = Math.min(minCashForRankParity, maxIWouldPay);

        // Cap at available cash
        const maxCash = Math.floor(this.player.money * this.maxCashOffer);

        return Math.min(offer, maxCash);
    }
}

module.exports = { CompetitiveTradingAI };
