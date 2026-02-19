/**
 * Relative Position Estimator
 *
 * Implements the relative EPT framework for player position estimation.
 *
 * Key formulas:
 *   relativeEPT[i] = propertyEPT[i] - avgPropertyEPT
 *   netGrowth[i] = diceEPT + relativeEPT[i]
 *   position[i] = netWorth[i] + netGrowth[i] * turnsRemaining
 *
 * The sum of all relativeEPT = 0 (zero-sum property of transfers)
 */

'use strict';

const { BOARD, COLOR_GROUPS, RAILROAD_RENT, UTILITY_MULTIPLIER, SQUARE_TYPES } = require('./game-engine.js');

// Dice EPT (money from bank) - approximately constant
const DICE_EPT = 38;  // ~$35 from Go + ~$3 from cards

class RelativePositionEstimator {
    constructor(markovEngine) {
        this.probs = markovEngine ? markovEngine.getAllProbabilities('stay') : null;
    }

    /**
     * Calculate property EPT for a player
     * This is rent RECEIVED from opponents
     * Includes streets, railroads, and utilities (all income-producing squares)
     */
    calculatePropertyEPT(player, state) {
        const opponents = state.players.filter(p => !p.bankrupt && p.id !== player.id).length;
        if (opponents === 0) return 0;

        // Count railroads and utilities for rent calculation
        let railroadCount = 0;
        let utilityCount = 0;
        for (const prop of player.properties) {
            const square = BOARD[prop];
            if (square.type === SQUARE_TYPES.RAILROAD) railroadCount++;
            if (square.type === SQUARE_TYPES.UTILITY) utilityCount++;
        }

        let totalEPT = 0;

        for (const prop of player.properties) {
            const square = BOARD[prop];
            const prob = this.probs ? this.probs[prop] : 0.025;
            let rent = 0;

            // Handle railroads
            if (square.type === SQUARE_TYPES.RAILROAD) {
                rent = RAILROAD_RENT[railroadCount];
            }
            // Handle utilities (use expected dice roll of 7)
            else if (square.type === SQUARE_TYPES.UTILITY) {
                rent = UTILITY_MULTIPLIER[utilityCount] * 7;  // Average dice roll
            }
            // Handle street properties
            else if (square.rent) {
                const propState = state.propertyStates[prop];
                const houses = propState?.houses || 0;

                // Check for monopoly
                if (square.group) {
                    const hasMonopoly = this.hasMonopoly(player.id, square.group, state);
                    if (hasMonopoly && houses === 0) {
                        rent = square.rent[0] * 2;  // Monopoly bonus
                    } else {
                        rent = square.rent[houses];
                    }
                } else {
                    rent = square.rent[houses] || square.rent[0];
                }
            }

            if (rent > 0) {
                totalEPT += prob * rent * opponents;
            }
        }

        return totalEPT;
    }

    /**
     * Check if player has monopoly on a color group
     */
    hasMonopoly(playerId, group, state) {
        const squares = COLOR_GROUPS[group]?.squares;
        if (!squares) return false;

        return squares.every(sq => state.propertyStates[sq]?.owner === playerId);
    }

    /**
     * Calculate net worth (cash + property value + house value)
     */
    calculateNetWorth(player, state) {
        let netWorth = player.money;

        for (const prop of player.properties) {
            const square = BOARD[prop];
            netWorth += square.price || 0;

            // Add house value (houses cost housePrice each, sell for half)
            const propState = state.propertyStates[prop];
            const houses = propState?.houses || 0;
            if (houses > 0 && square.housePrice) {
                netWorth += houses * square.housePrice * 0.5;  // Liquidation value
            }
        }

        return netWorth;
    }

    /**
     * Calculate all players' relative EPT
     * Returns object with relativeEPT for each player
     */
    calculateRelativeEPTs(state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const numPlayers = activePlayers.length;

        if (numPlayers < 2) {
            return activePlayers.map(p => ({ id: p.id, propertyEPT: 0, relativeEPT: 0 }));
        }

        // Calculate property EPT for each player
        const playerEPTs = activePlayers.map(player => ({
            id: player.id,
            propertyEPT: this.calculatePropertyEPT(player, state)
        }));

        // Calculate average
        const totalEPT = playerEPTs.reduce((sum, p) => sum + p.propertyEPT, 0);
        const avgEPT = totalEPT / numPlayers;

        // Calculate relative EPT
        for (const p of playerEPTs) {
            p.relativeEPT = p.propertyEPT - avgEPT;
            p.netGrowth = DICE_EPT + p.relativeEPT;
        }

        return playerEPTs;
    }

    /**
     * Calculate full position analysis for all players
     */
    calculatePositions(state, turnsRemaining = 50) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const relativeEPTs = this.calculateRelativeEPTs(state);

        const positions = activePlayers.map(player => {
            const eptData = relativeEPTs.find(e => e.id === player.id);
            const netWorth = this.calculateNetWorth(player, state);

            const position = netWorth + eptData.netGrowth * turnsRemaining;

            // Estimate turns until broke (if negative growth)
            let turnsUntilBroke = Infinity;
            if (eptData.netGrowth < 0) {
                turnsUntilBroke = netWorth / Math.abs(eptData.netGrowth);
            }

            return {
                id: player.id,
                cash: player.money,
                netWorth,
                propertyEPT: eptData.propertyEPT,
                relativeEPT: eptData.relativeEPT,
                netGrowth: eptData.netGrowth,
                position,
                turnsUntilBroke,
                isGainingGround: eptData.relativeEPT > 0,
                isLosingGround: eptData.relativeEPT < -10
            };
        });

        // Sort by position and assign ranks
        positions.sort((a, b) => b.position - a.position);
        positions.forEach((p, i) => p.rank = i);

        return positions;
    }

    /**
     * Estimate position change from a trade
     */
    estimateTradeImpact(offer, state, turnsRemaining = 50) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        // Current positions
        const currentPositions = this.calculatePositions(state, turnsRemaining);
        const fromCurrent = currentPositions.find(p => p.id === from.id);
        const toCurrent = currentPositions.find(p => p.id === to.id);

        // Simulate state after trade
        const afterState = this.simulateTradeState(state, offer);
        const afterPositions = this.calculatePositions(afterState, turnsRemaining);
        const fromAfter = afterPositions.find(p => p.id === from.id);
        const toAfter = afterPositions.find(p => p.id === to.id);

        return {
            from: {
                positionChange: fromAfter.position - fromCurrent.position,
                relativeEPTChange: fromAfter.relativeEPT - fromCurrent.relativeEPT,
                netGrowthChange: fromAfter.netGrowth - fromCurrent.netGrowth,
                rankChange: fromAfter.rank - fromCurrent.rank
            },
            to: {
                positionChange: toAfter.position - toCurrent.position,
                relativeEPTChange: toAfter.relativeEPT - toCurrent.relativeEPT,
                netGrowthChange: toAfter.netGrowth - toCurrent.netGrowth,
                rankChange: toAfter.rank - toCurrent.rank
            }
        };
    }

    /**
     * Create a simulated state after a trade (without modifying original)
     */
    simulateTradeState(state, offer) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        // Deep copy relevant parts
        const newState = {
            ...state,
            players: state.players.map(p => ({
                ...p,
                money: p.money,
                properties: new Set(p.properties)
            })),
            propertyStates: { ...state.propertyStates }
        };

        // Find players in new state
        const newFrom = newState.players.find(p => p.id === from.id);
        const newTo = newState.players.find(p => p.id === to.id);

        // Transfer cash
        newFrom.money -= fromCash;
        newTo.money += fromCash;

        // Transfer properties from -> to
        for (const prop of fromProperties) {
            newFrom.properties.delete(prop);
            newTo.properties.add(prop);
            newState.propertyStates[prop] = {
                ...newState.propertyStates[prop],
                owner: to.id
            };
        }

        // Transfer properties to -> from
        for (const prop of toProperties) {
            newTo.properties.delete(prop);
            newFrom.properties.add(prop);
            newState.propertyStates[prop] = {
                ...newState.propertyStates[prop],
                owner: from.id
            };
        }

        return newState;
    }

    /**
     * Evaluate if a trade is good based on relative position
     * Returns recommendation and reasoning
     */
    evaluateTradeForPlayer(playerId, offer, state, turnsRemaining = 50) {
        const impact = this.estimateTradeImpact(offer, state, turnsRemaining);
        const isReceiver = offer.to.id === playerId;

        const myImpact = isReceiver ? impact.to : impact.from;
        const theirImpact = isReceiver ? impact.from : impact.to;

        // Criteria for accepting
        const positionImproves = myImpact.positionChange > 0;
        const relativeGrowthImproves = myImpact.relativeEPTChange > 0;
        const dontLoseRank = myImpact.rankChange <= 0;
        const theyDontGainTooMuch = theirImpact.positionChange < myImpact.positionChange * 2;

        return {
            recommend: positionImproves || (myImpact.positionChange > -100 && !theyDontGainTooMuch),
            myImpact,
            theirImpact,
            reasoning: {
                positionImproves,
                relativeGrowthImproves,
                dontLoseRank,
                theyDontGainTooMuch
            }
        };
    }
}

module.exports = { RelativePositionEstimator, DICE_EPT };
