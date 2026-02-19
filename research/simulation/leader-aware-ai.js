/**
 * Leader-Aware Trading AI
 *
 * Extends GrowthTradingAI with awareness of player positions.
 * Implements the "gang up on the leader" strategy.
 *
 * Key principles:
 * 1. Don't help the leader unless well-compensated
 * 2. Don't make trades that would make someone the dominant leader
 * 3. Be more willing to trade with players behind you
 * 4. Consider whether a trade helps your relative position, not just absolute
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');

class LeaderAwareAI extends GrowthTradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'LeaderAwareAI';

        // Leader-awareness parameters (tunable by GA)
        this.leaderPenaltyMultiplier = 1.5;     // Demand 50% more when helping leader
        this.dominanceThreshold = 1.5;          // Player is "dominant" if 1.5x second place
        this.dominancePenaltyMultiplier = 2.0;  // Demand 2x when creating dominant leader
        this.underdogBonus = 0.8;               // Accept 20% less when trading with underdog
    }

    /**
     * Calculate player positions (estimated total value)
     * Position = Cash + NPV of monopolies + estimated property value
     */
    calculatePlayerPositions(state) {
        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        const positions = [];

        for (const player of state.players) {
            if (player.bankrupt) {
                positions.push({ id: player.id, value: 0, rank: 99 });
                continue;
            }

            let value = player.money;

            // Add value of monopolies
            for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
                const ownsAll = group.squares.every(sq =>
                    state.propertyStates[sq]?.owner === player.id
                );

                if (ownsAll) {
                    // Use growth NPV for monopolies
                    const currentHouses = state.propertyStates[group.squares[0]]?.houses || 0;
                    if (currentHouses < 5) {
                        value += this.calculateGrowthNPVFromLevel(
                            groupName, currentHouses, player.money, opponents
                        );
                    } else {
                        // Fully developed - just use EPT * turns
                        value += this.calculateGroupEPT(groupName, 5, opponents) * 30;
                    }
                } else {
                    // Partial ownership - add property values
                    for (const sq of group.squares) {
                        if (state.propertyStates[sq]?.owner === player.id) {
                            value += BOARD[sq].price;
                        }
                    }
                }
            }

            positions.push({ id: player.id, value });
        }

        // Sort by value descending and assign ranks
        positions.sort((a, b) => b.value - a.value);
        positions.forEach((p, i) => p.rank = i);

        return positions;
    }

    /**
     * Get a player's rank (0 = leader, 1 = second, etc.)
     */
    getPlayerRank(playerId, positions) {
        const pos = positions.find(p => p.id === playerId);
        return pos ? pos.rank : 99;
    }

    /**
     * Get a player's value
     */
    getPlayerValue(playerId, positions) {
        const pos = positions.find(p => p.id === playerId);
        return pos ? pos.value : 0;
    }

    /**
     * Check if a player would become a dominant leader after a trade
     */
    wouldBecomeDominant(playerId, valueGain, positions) {
        const currentValue = this.getPlayerValue(playerId, positions);
        const newValue = currentValue + valueGain;

        // Find the would-be second place value
        let secondPlaceValue = 0;
        for (const p of positions) {
            if (p.id !== playerId && p.value > secondPlaceValue) {
                // This could be second place if playerId becomes first
                if (p.value < newValue) {
                    secondPlaceValue = Math.max(secondPlaceValue, p.value);
                }
            }
        }

        // Check if they'd be "dominant" (1.5x second place)
        return secondPlaceValue > 0 && newValue > secondPlaceValue * this.dominanceThreshold;
    }

    /**
     * Estimate how much value a trade gives to a player
     */
    estimateTradeValue(player, offer, state, isReceiver) {
        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        let value = 0;

        if (isReceiver) {
            // Properties they receive
            for (const prop of offer.toProperties) {
                const square = BOARD[prop];
                if (square.group) {
                    // Check if this completes a monopoly
                    const groupSquares = COLOR_GROUPS[square.group].squares;
                    const wouldOwn = groupSquares.filter(sq =>
                        state.propertyStates[sq]?.owner === player.id || offer.toProperties.has(sq)
                    ).length;

                    if (wouldOwn === groupSquares.length) {
                        // Completing a monopoly!
                        const cashAfter = player.money + offer.fromCash;
                        value += this.calculateGrowthNPV(square.group, cashAfter, opponents);
                    } else {
                        value += square.price || 0;
                    }
                }
            }
            // Cash they pay (negative)
            value -= offer.fromCash;
        } else {
            // Properties they receive (the ones we're giving up)
            for (const prop of offer.fromProperties) {
                const square = BOARD[prop];
                if (square.group) {
                    const groupSquares = COLOR_GROUPS[square.group].squares;
                    const wouldOwn = groupSquares.filter(sq =>
                        state.propertyStates[sq]?.owner === player.id || offer.fromProperties.has(sq)
                    ).length;

                    if (wouldOwn === groupSquares.length) {
                        const cashAfter = player.money - offer.fromCash;
                        value += this.calculateGrowthNPV(square.group, cashAfter, opponents);
                    } else {
                        value += square.price || 0;
                    }
                }
            }
            // Cash they receive
            value += offer.fromCash;
        }

        return value;
    }

    /**
     * Override: Evaluate trade with leader-awareness
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        if (opponents === 0) return false;

        // Calculate current positions
        const positions = this.calculatePlayerPositions(state);
        const myRank = this.getPlayerRank(this.player.id, positions);
        const theirRank = this.getPlayerRank(from.id, positions);

        // Estimate trade values
        const theirGain = this.estimateTradeValue(from, offer, state, false);

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

        // Calculate base requirement using parent logic
        const myCashAfter = this.player.money + fromCash;
        let myValue = fromCash;
        let theirValue = -fromCash;

        if (myMonopolyGroup) {
            myValue += this.calculateGrowthNPV(myMonopolyGroup, myCashAfter, opponents);
        }

        if (opponentMonopolyGroup) {
            const opponentCashAfter = from.money - fromCash;
            theirValue += this.calculateGrowthNPV(opponentMonopolyGroup, opponentCashAfter, opponents);
        }

        // Calculate value of properties exchanged
        for (const prop of toProperties) {
            const square = BOARD[prop];
            if (square.rent) {
                const prob = this.probs ? this.probs[prop] : 0.025;
                const simpleNPV = prob * square.rent[0] * opponents * 25;
                myValue -= simpleNPV;
            }
        }

        for (const prop of fromProperties) {
            if (myMonopolyGroup && BOARD[prop].group === myMonopolyGroup) continue;
            const square = BOARD[prop];
            if (square.rent) {
                const prob = this.probs ? this.probs[prop] : 0.025;
                const simpleNPV = prob * square.rent[0] * opponents * 25;
                myValue += simpleNPV;
            }
        }

        // =====================================================================
        // LEADER-AWARENESS ADJUSTMENTS
        // =====================================================================

        let adjustmentMultiplier = 1.0;
        let rejectReason = null;

        // Rule 1: If they're the leader and I'm not second place, demand more
        if (theirRank === 0 && myRank > 1) {
            adjustmentMultiplier *= this.leaderPenaltyMultiplier;
        }

        // Rule 2: If this trade would make them a dominant leader, demand much more
        if (this.wouldBecomeDominant(from.id, theirGain, positions)) {
            adjustmentMultiplier *= this.dominancePenaltyMultiplier;
        }

        // Rule 3: If they're behind me (underdog), be more lenient
        if (theirRank > myRank + 1) {
            adjustmentMultiplier *= this.underdogBonus;
        }

        // Rule 4: If I'm the leader and this helps second place catch up, be careful
        if (myRank === 0 && theirRank === 1 && opponentMonopolyGroup) {
            adjustmentMultiplier *= this.leaderPenaltyMultiplier;
        }

        // =====================================================================
        // DECISION LOGIC (with adjustments)
        // =====================================================================

        // Case 1: I get a monopoly, they don't
        if (myMonopolyGroup && !opponentMonopolyGroup) {
            return myValue > 0;
        }

        // Case 2: They get a monopoly, I don't
        if (opponentMonopolyGroup && !myMonopolyGroup) {
            // Base requirement: 35% of their net gain
            const baseMinCash = theirValue * 0.35;
            // Apply leader-awareness adjustment
            const adjustedMinCash = baseMinCash * adjustmentMultiplier;
            return fromCash >= adjustedMinCash;
        }

        // Case 3: Both get monopolies (mutual trade)
        if (myMonopolyGroup && opponentMonopolyGroup) {
            const myMonopolyNPV = this.calculateGrowthNPV(myMonopolyGroup, myCashAfter, opponents);
            const theirMonopolyNPV = this.calculateGrowthNPV(opponentMonopolyGroup, from.money - fromCash, opponents);

            // Base: accept if I get at least 80% of their value
            // With adjustment, require more if they're the leader
            const requiredRatio = 0.8 * adjustmentMultiplier;
            return myMonopolyNPV >= theirMonopolyNPV * requiredRatio;
        }

        // Case 4: Neither gets a monopoly
        return myValue > 0;
    }

    /**
     * Override: When making offers, consider opponent's position
     */
    evaluateMonopolyTrade(opportunity, state) {
        // Get base trade from parent
        const trade = super.evaluateMonopolyTrade(opportunity, state);
        if (!trade) return null;

        // Calculate positions
        const positions = this.calculatePlayerPositions(state);
        const theirRank = this.getPlayerRank(opportunity.from.id, positions);
        const myRank = this.getPlayerRank(this.player.id, positions);

        // If they're behind us, we might need to offer less (they're more desperate)
        // If they're ahead, we might need to offer more (they have leverage)
        if (theirRank < myRank && trade.fromCash > 0) {
            // They're ahead - they have leverage, don't reduce offer
        } else if (theirRank > myRank + 1 && trade.fromCash > 0) {
            // They're well behind - they might accept less
            trade.fromCash = Math.floor(trade.fromCash * 0.85);
        }

        return trade;
    }
}

module.exports = { LeaderAwareAI };
