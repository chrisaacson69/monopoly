/**
 * Relative Growth AI
 *
 * Combines two key insights:
 * 1. Relative EPT (property EPT is zero-sum transfer between players)
 * 2. Growth curve simulation (development speed depends on cash flow)
 *
 * Position is calculated as:
 *   netWorth + integral(netGrowth over time)
 *
 * Where netGrowth = diceEPT + relativePropertyEPT
 * And relativePropertyEPT changes as houses are built
 */

'use strict';

const { BOARD, COLOR_GROUPS, RAILROAD_RENT, UTILITY_MULTIPLIER, SQUARE_TYPES } = require('./game-engine.js');
const { TradingAI } = require('./trading-ai.js');

const DICE_EPT = 38;  // ~$35 from Go + ~$3 from cards per turn

class RelativeGrowthAI extends TradingAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'RelativeGrowthAI';

        // Parameters (can be tuned by GA)
        this.projectionHorizon = 62;        // From GA results
        this.discountRate = 0.015;          // From GA results
        this.sellerShareThreshold = 0.30;   // From GA results
        this.leaderPenaltyMultiplier = 1.80;
        this.dominanceThreshold = 1.61;
        this.dominancePenaltyMultiplier = 2.30;
        this.underdogBonus = 0.65;
    }

    /**
     * Calculate property EPT for a player at a given development state
     * Includes streets, railroads, and utilities (all income-producing squares)
     */
    calculatePropertyEPT(playerId, propertyStates, playerProperties, opponents) {
        let totalEPT = 0;

        // Count railroads and utilities for rent calculation
        let railroadCount = 0;
        let utilityCount = 0;
        for (const prop of playerProperties) {
            const square = BOARD[prop];
            if (square.type === SQUARE_TYPES.RAILROAD) railroadCount++;
            if (square.type === SQUARE_TYPES.UTILITY) utilityCount++;
        }

        for (const prop of playerProperties) {
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
                const houses = propertyStates[prop]?.houses || 0;

                // Check for monopoly
                if (square.group) {
                    const groupSquares = COLOR_GROUPS[square.group].squares;
                    const hasMonopoly = groupSquares.every(sq =>
                        propertyStates[sq]?.owner === playerId
                    );

                    if (hasMonopoly && houses === 0) {
                        rent = square.rent[0] * 2;
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
     * Calculate relative EPT for all players
     * Returns map of playerId -> { propertyEPT, relativeEPT, netGrowth }
     */
    calculateRelativeEPTs(state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const numPlayers = activePlayers.length;
        const opponents = numPlayers - 1;

        if (numPlayers < 2) return new Map();

        const eptMap = new Map();

        // Calculate property EPT for each player
        let totalEPT = 0;
        for (const player of activePlayers) {
            const propEPT = this.calculatePropertyEPT(
                player.id,
                state.propertyStates,
                player.properties,
                opponents
            );
            eptMap.set(player.id, { propertyEPT: propEPT });
            totalEPT += propEPT;
        }

        // Calculate relative EPT
        const avgEPT = totalEPT / numPlayers;
        for (const [playerId, data] of eptMap) {
            data.relativeEPT = data.propertyEPT - avgEPT;
            data.netGrowth = DICE_EPT + data.relativeEPT;
        }

        return eptMap;
    }

    /**
     * Simulate growth curve for a monopoly given starting cash
     * Returns projected position value (NPV of income stream)
     */
    simulateGrowthCurve(group, startingCash, opponents, propertyStates, playerId) {
        const squares = COLOR_GROUPS[group].squares;
        const houseCost = BOARD[squares[0]].housePrice;
        const costPerLevel = houseCost * squares.length;

        // Clone property states for simulation
        const simStates = {};
        for (const sq of squares) {
            simStates[sq] = {
                owner: playerId,
                houses: propertyStates[sq]?.houses || 0
            };
        }

        let cash = startingCash;
        let totalNPV = 0;

        for (let t = 1; t <= this.projectionHorizon; t++) {
            // Calculate current EPT at current development level
            const currentHouses = simStates[squares[0]].houses;
            let ept = 0;
            for (const sq of squares) {
                const prob = this.probs ? this.probs[sq] : 0.025;
                const rent = currentHouses === 0
                    ? BOARD[sq].rent[0] * 2  // Monopoly bonus
                    : BOARD[sq].rent[currentHouses];
                ept += prob * rent * opponents;
            }

            // Add discounted EPT to NPV
            const discountFactor = 1 / Math.pow(1 + this.discountRate, t);
            totalNPV += ept * discountFactor;

            // Accumulate cash
            cash += ept + DICE_EPT;  // Property income + dice income

            // Build houses if possible
            while (currentHouses < 5 && cash >= costPerLevel) {
                cash -= costPerLevel;
                for (const sq of squares) {
                    simStates[sq].houses++;
                }
            }
        }

        return totalNPV;
    }

    /**
     * Calculate net worth
     */
    calculateNetWorth(player, state) {
        let netWorth = player.money;

        for (const prop of player.properties) {
            const square = BOARD[prop];
            netWorth += square.price || 0;

            const houses = state.propertyStates[prop]?.houses || 0;
            if (houses > 0 && square.housePrice) {
                netWorth += houses * square.housePrice * 0.5;  // Liquidation value
            }
        }

        return netWorth;
    }

    /**
     * Calculate full position for a player using growth simulation
     */
    calculatePosition(player, state) {
        const activePlayers = state.players.filter(p => !p.bankrupt);
        const opponents = activePlayers.length - 1;
        if (opponents === 0) return player.money;

        let position = this.calculateNetWorth(player, state);

        // Find monopolies and simulate their growth
        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = group.squares.every(sq =>
                state.propertyStates[sq]?.owner === player.id
            );

            if (ownsAll) {
                const npv = this.simulateGrowthCurve(
                    groupName,
                    player.money,
                    opponents,
                    state.propertyStates,
                    player.id
                );
                position += npv;
            }
        }

        // Add relative EPT effect for non-monopoly properties
        const eptData = this.calculateRelativeEPTs(state).get(player.id);
        if (eptData) {
            // Add discounted future relative income
            const relativeNPV = eptData.relativeEPT * this.projectionHorizon * 0.5;
            position += relativeNPV;
        }

        return position;
    }

    /**
     * Calculate all player positions and ranks
     */
    calculateAllPositions(state) {
        const positions = [];

        for (const player of state.players) {
            if (player.bankrupt) {
                positions.push({ id: player.id, position: 0, rank: 99 });
                continue;
            }

            const position = this.calculatePosition(player, state);
            const eptData = this.calculateRelativeEPTs(state).get(player.id);

            positions.push({
                id: player.id,
                position,
                netWorth: this.calculateNetWorth(player, state),
                relativeEPT: eptData?.relativeEPT || 0,
                netGrowth: eptData?.netGrowth || DICE_EPT
            });
        }

        positions.sort((a, b) => b.position - a.position);
        positions.forEach((p, i) => p.rank = i);

        return positions;
    }

    /**
     * Override: Calculate cash offer using growth simulation with relative EPT
     */
    calculateMonopolyCashOffer(properties, eptGain, state) {
        const firstProp = properties.values().next().value;
        const group = BOARD[firstProp].group;

        if (!group) {
            return super.calculateMonopolyCashOffer(properties, eptGain, state);
        }

        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        const myCash = this.player.money;

        // Simulate growth curve at different offer levels
        let bestOffer = 0;
        let maxProfit = -Infinity;

        const baseValue = Array.from(properties).reduce((sum, p) =>
            sum + (BOARD[p].price || 0), 0);

        for (let offer = baseValue; offer <= myCash * 0.7; offer += 50) {
            const cashAfter = myCash - offer;
            const npv = this.simulateGrowthCurve(
                group,
                cashAfter,
                opponents,
                state.propertyStates,
                this.player.id
            );

            const profit = npv - offer;
            if (profit > maxProfit) {
                maxProfit = profit;
                bestOffer = offer;
            }
        }

        return maxProfit > 0 ? bestOffer : 0;
    }

    /**
     * Override: Evaluate trade using relative position framework
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        const opponents = state.players.filter(p => !p.bankrupt).length - 1;
        if (opponents === 0) return false;

        // Get current positions
        const currentPositions = this.calculateAllPositions(state);
        const myCurrentPos = currentPositions.find(p => p.id === this.player.id);
        const theirCurrentPos = currentPositions.find(p => p.id === from.id);

        // Simulate state after trade
        const afterState = this.simulateTradeState(state, offer);

        // Get positions after trade
        const afterPositions = this.calculateAllPositions(afterState);
        const myAfterPos = afterPositions.find(p => p.id === this.player.id);
        const theirAfterPos = afterPositions.find(p => p.id === from.id);

        // Calculate changes
        const myPositionChange = myAfterPos.position - myCurrentPos.position;
        const theirPositionChange = theirAfterPos.position - theirCurrentPos.position;
        const myRelEPTChange = myAfterPos.relativeEPT - myCurrentPos.relativeEPT;

        // Leader-awareness adjustments
        let adjustmentMultiplier = 1.0;

        if (theirCurrentPos.rank === 0 && myCurrentPos.rank > 1) {
            // They're the leader, I'm not second
            adjustmentMultiplier *= this.leaderPenaltyMultiplier;
        }

        // Check for dominance creation
        if (theirAfterPos.position > currentPositions[0].position * this.dominanceThreshold) {
            adjustmentMultiplier *= this.dominancePenaltyMultiplier;
        }

        // Underdog bonus
        if (theirCurrentPos.rank > myCurrentPos.rank + 1) {
            adjustmentMultiplier *= this.underdogBonus;
        }

        // Decision criteria based on relative position
        // Accept if my position improves OR doesn't decrease much and they don't gain too much
        const myRequiredGain = -100 * adjustmentMultiplier;  // Allow small loss

        if (myPositionChange >= myRequiredGain) {
            // Check they don't gain disproportionately
            if (theirPositionChange <= myPositionChange * 3) {
                return true;
            }
        }

        // Also accept if my relative EPT improves significantly
        if (myRelEPTChange > 10 && myPositionChange > -500) {
            return true;
        }

        return false;
    }

    /**
     * Simulate state after trade (without modifying original)
     */
    simulateTradeState(state, offer) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        const newState = {
            ...state,
            players: state.players.map(p => ({
                ...p,
                money: p.money,
                properties: new Set(p.properties)
            })),
            propertyStates: { ...state.propertyStates }
        };

        const newFrom = newState.players.find(p => p.id === from.id);
        const newTo = newState.players.find(p => p.id === to.id);

        // Transfer cash
        newFrom.money -= fromCash;
        newTo.money += fromCash;

        // Transfer properties
        for (const prop of fromProperties) {
            newFrom.properties.delete(prop);
            newTo.properties.add(prop);
            newState.propertyStates[prop] = {
                ...newState.propertyStates[prop],
                owner: to.id
            };
        }

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
}

module.exports = { RelativeGrowthAI };
