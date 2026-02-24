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
     * Bilateral growth simulation: both players develop simultaneously
     * with rent flowing between them.
     *
     * Each player state: { groups: [groupName, ...], cash: number, id: number }
     * - groups: monopoly group names this player owns
     * - cash: starting cash (single pool across all monopolies)
     * - id: player id for property state lookups
     *
     * Returns: { myTrajectory: [pos_t0..pos_tN], theirTrajectory: [pos_t0..pos_tN] }
     * Where pos_t = cash + property prices + house investment value
     *
     * Closes theory gaps #1 (rent interaction), #2 (cash double-counting),
     * #3 (trajectory output). See bilateral-trade-valuation.md.
     */
    simulateBilateralGrowth(myState, theirState, propertyStates, numOtherOpponents) {
        const horizon = this.projectionHorizon;  // 62 turns
        const getProb = (idx) => (this.probs && this.probs[idx]) || 0.025;

        // Build initial development state for both players
        const initPlayer = (pState) => {
            const groups = [];
            for (const groupName of pState.groups) {
                if (!COLOR_GROUPS[groupName]) continue;
                const squares = COLOR_GROUPS[groupName].squares;
                const houseCost = BOARD[squares[0]].housePrice;
                const houses = squares.map(sq =>
                    propertyStates[sq]?.houses || 0
                );
                groups.push({ name: groupName, squares, houseCost, houses });
            }
            // Count owned, unmortgaged railroads and utilities
            let rrCount = 0, utilCount = 0;
            for (const rrPos of [5, 15, 25, 35]) {
                if (propertyStates[rrPos]?.owner === pState.id &&
                    !propertyStates[rrPos]?.mortgaged) rrCount++;
            }
            for (const utilPos of [12, 28]) {
                if (propertyStates[utilPos]?.owner === pState.id &&
                    !propertyStates[utilPos]?.mortgaged) utilCount++;
            }
            return { cash: pState.cash, groups, id: pState.id, rrCount, utilCount };
        };

        const me = initPlayer(myState);
        const them = initPlayer(theirState);

        // Opponent count for EPT: each player faces the other + non-modeled players
        const myOpponents = 1 + numOtherOpponents;
        const theirOpponents = 1 + numOtherOpponents;

        // Helper: compute total EPT for a player at current development
        const computeEPT = (player, opponents) => {
            let totalEPT = 0;
            for (const g of player.groups) {
                for (let i = 0; i < g.squares.length; i++) {
                    const sq = g.squares[i];
                    const h = g.houses[i];
                    const prob = getProb(sq);
                    const rent = h === 0
                        ? BOARD[sq].rent[0] * 2  // monopoly, no houses
                        : BOARD[sq].rent[h];
                    totalEPT += prob * rent * opponents;
                }
            }
            // Railroad EPT (steady income, no development)
            if (player.rrCount > 0) {
                const rrRent = RAILROAD_RENT[player.rrCount];
                for (const rrPos of [5, 15, 25, 35]) {
                    if (propertyStates[rrPos]?.owner === player.id &&
                        !propertyStates[rrPos]?.mortgaged) {
                        totalEPT += getProb(rrPos) * rrRent * opponents;
                    }
                }
            }
            // Utility EPT (average dice roll = 7)
            if (player.utilCount > 0) {
                const utilRent = UTILITY_MULTIPLIER[player.utilCount] * 7;
                for (const utilPos of [12, 28]) {
                    if (propertyStates[utilPos]?.owner === player.id &&
                        !propertyStates[utilPos]?.mortgaged) {
                        totalEPT += getProb(utilPos) * utilRent * opponents;
                    }
                }
            }
            return totalEPT;
        };

        // Helper: build best available house (highest marginal ROI, even building)
        const tryBuild = (player) => {
            let bestROI = 0;
            let bestGroup = null;
            let bestSqIdx = -1;

            for (const g of player.groups) {
                const minH = Math.min(...g.houses);
                for (let i = 0; i < g.squares.length; i++) {
                    if (g.houses[i] >= 5) continue;
                    if (g.houses[i] > minH) continue;  // even building
                    if (player.cash < g.houseCost) continue;

                    const sq = g.squares[i];
                    const prob = getProb(sq);
                    const curRent = g.houses[i] === 0
                        ? BOARD[sq].rent[0] * 2
                        : BOARD[sq].rent[g.houses[i]];
                    const newRent = BOARD[sq].rent[g.houses[i] + 1];
                    const marginalEPT = prob * (newRent - curRent);
                    const roi = marginalEPT / g.houseCost;

                    if (roi > bestROI) {
                        bestROI = roi;
                        bestGroup = g;
                        bestSqIdx = i;
                    }
                }
            }

            if (bestGroup && player.cash >= bestGroup.houseCost) {
                player.cash -= bestGroup.houseCost;
                bestGroup.houses[bestSqIdx]++;
                return true;
            }
            return false;
        };

        // Helper: sell worst house (lowest marginal ROI, even-selling)
        const trySellHouse = (player) => {
            let worstROI = Infinity;
            let worstGroup = null;
            let worstSqIdx = -1;

            for (const g of player.groups) {
                const maxH = Math.max(...g.houses);
                for (let i = 0; i < g.squares.length; i++) {
                    if (g.houses[i] <= 0) continue;
                    if (g.houses[i] < maxH) continue;  // even-selling

                    const sq = g.squares[i];
                    const prob = getProb(sq);
                    const curRent = BOARD[sq].rent[g.houses[i]];
                    const prevRent = g.houses[i] === 1
                        ? BOARD[sq].rent[0] * 2
                        : BOARD[sq].rent[g.houses[i] - 1];
                    const marginalEPT = prob * (curRent - prevRent);
                    const roi = marginalEPT / g.houseCost;

                    if (roi < worstROI) {
                        worstROI = roi;
                        worstGroup = g;
                        worstSqIdx = i;
                    }
                }
            }

            if (worstGroup) {
                player.cash += Math.floor(worstGroup.houseCost / 2);  // 50% sale
                worstGroup.houses[worstSqIdx]--;
                return true;
            }
            return false;
        };

        // Helper: compute position (tangible value, not NPV)
        const computePosition = (player) => {
            let pos = player.cash;
            for (const g of player.groups) {
                for (let i = 0; i < g.squares.length; i++) {
                    pos += BOARD[g.squares[i]].price;
                    pos += g.houses[i] * g.houseCost;
                }
            }
            // Railroad and utility property values
            for (const rrPos of [5, 15, 25, 35]) {
                if (propertyStates[rrPos]?.owner === player.id) pos += 200;
            }
            for (const utilPos of [12, 28]) {
                if (propertyStates[utilPos]?.owner === player.id) pos += 150;
            }
            return pos;
        };

        const myTrajectory = [computePosition(me)];
        const theirTrajectory = [computePosition(them)];

        for (let t = 1; t <= horizon; t++) {
            // Income phase: both players earn and pay rent simultaneously
            const myEPT = computeEPT(me, myOpponents);
            const theirEPT = computeEPT(them, theirOpponents);

            me.cash += DICE_EPT + myEPT - theirEPT / myOpponents;
            them.cash += DICE_EPT + theirEPT - myEPT / theirOpponents;

            // Liquidation: sell houses at 50% when cash negative
            if (me.cash < 0) {
                while (me.cash < 0 && trySellHouse(me)) {}
                me.cash = Math.max(0, me.cash);  // mortgage buffer
            }
            if (them.cash < 0) {
                while (them.cash < 0 && trySellHouse(them)) {}
                them.cash = Math.max(0, them.cash);  // mortgage buffer
            }

            // Build phase: each player builds greedily
            while (tryBuild(me)) {}
            while (tryBuild(them)) {}

            myTrajectory.push(computePosition(me));
            theirTrajectory.push(computePosition(them));
        }

        return { myTrajectory, theirTrajectory };
    }

    /**
     * Helper: get monopoly groups for a player from property states
     */
    getPlayerMonopolyGroups(playerId, propertyStates) {
        const groups = [];
        for (const [gName, gData] of Object.entries(COLOR_GROUPS)) {
            if (gData.squares.every(sq =>
                propertyStates[sq]?.owner === playerId))
            {
                groups.push(gName);
            }
        }
        return groups;
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
     * Override: Trajectory-based cash for mutual trades (Nash bargaining).
     *
     * Uses simulateBilateralGrowth to find the cash amount where both
     * players' trajectory areas are equalized. This captures the competitive
     * feedback loop that the old NPV-snapshot approach missed.
     *
     * Closes theory gap #4 (no trajectory in pricing).
     */
    calculateMutualTradeCash(myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state) {
        // Fall back to static formula for non-street properties
        if (!myGroup || !theirGroup || !COLOR_GROUPS[myGroup] || !COLOR_GROUPS[theirGroup]) {
            return super.calculateMutualTradeCash(
                myGroup, theirGroup, myGain, theirGain, propsGained, propsGiven, state
            );
        }

        const activePlayers = state.players.filter(p => !p.bankrupt);
        const numOtherOpponents = activePlayers.length - 2;
        if (numOtherOpponents < 0) return 0;

        const myCash = this.player.money;
        const opponentId = state.propertyStates[propsGained[0]]?.owner;
        const opponent = state.players.find(p => p.id === opponentId);
        const theirCash = opponent ? opponent.money : 0;
        const maxCash = Math.floor(myCash * this.maxCashOffer);

        // Find each player's monopolies after the trade
        const getPostTradeGroups = (playerId, gainedGroup, lostGroup) => {
            const groups = [];
            for (const [gName, gData] of Object.entries(COLOR_GROUPS)) {
                if (gName === lostGroup) continue;
                if (gName === gainedGroup) {
                    groups.push(gName);
                    continue;
                }
                if (gData.squares.every(sq =>
                    state.propertyStates[sq]?.owner === playerId))
                {
                    groups.push(gName);
                }
            }
            return groups;
        };

        const myGroups = getPostTradeGroups(this.player.id, myGroup, theirGroup);
        const theirGroups = getPostTradeGroups(opponentId, theirGroup, myGroup);

        // Build post-trade property states
        const postTradePS = { ...state.propertyStates };
        for (const sq of propsGained) {
            postTradePS[sq] = { ...postTradePS[sq], owner: this.player.id };
        }
        for (const sq of propsGiven) {
            postTradePS[sq] = { ...postTradePS[sq], owner: opponentId };
        }

        // Face value as initial guess
        const myPropValue = propsGained.reduce((s, sq) => s + BOARD[sq].price, 0);
        const theirPropValue = propsGiven.reduce((s, sq) => s + BOARD[sq].price, 0);

        // Search: find cash where trajectory areas are equal
        let bestCash = Math.max(-maxCash,
            Math.min(maxCash, myPropValue - theirPropValue));
        let minAreaDiff = Infinity;

        const step = 50;
        const searchMin = Math.max(-maxCash, -500);
        const searchMax = Math.min(maxCash, myCash);

        for (let cash = searchMin; cash <= searchMax; cash += step) {
            const myCashAfter = myCash - cash;
            const theirCashAfter = theirCash + cash;
            if (myCashAfter < 0 || theirCashAfter < 0) continue;

            const { myTrajectory, theirTrajectory } =
                this.simulateBilateralGrowth(
                    { groups: myGroups, cash: myCashAfter,
                      id: this.player.id },
                    { groups: theirGroups, cash: theirCashAfter,
                      id: opponentId },
                    postTradePS, numOtherOpponents
                );

            // Convergence-point Nash: find the turn where trajectories
            // are closest, then use the signed gap at that point.
            // Nash price = cash where the gap at convergence is zero.
            let minGap = Infinity;
            let convergenceGap = 0;
            for (let t = 0; t < myTrajectory.length; t++) {
                const gap = Math.abs(myTrajectory[t] - theirTrajectory[t]);
                if (gap < minGap) {
                    minGap = gap;
                    convergenceGap = myTrajectory[t] - theirTrajectory[t];
                }
            }

            const gapMagnitude = Math.abs(convergenceGap);
            if (gapMagnitude < minAreaDiff) {
                minAreaDiff = gapMagnitude;
                bestCash = cash;
            }
        }

        return Math.max(-maxCash, Math.min(maxCash, bestCash));
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
     * Override: Evaluate trade using bilateral trajectory comparison.
     *
     * Runs simulateBilateralGrowth for pre-trade and post-trade states,
     * then compares trajectory improvement areas. Accepts if my trajectory
     * improvement is positive and not disproportionately smaller than theirs.
     *
     * Closes theory gaps #3 (snapshot → trajectory) and #6 (arbitrary 3x → derived).
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;
        if (to.id !== this.player.id) return false;

        const activePlayers = state.players.filter(p => !p.bankrupt);
        const numOtherOpponents = activePlayers.length - 2;
        if (numOtherOpponents < 0) return false;

        // Get monopoly groups for both players BEFORE trade
        const myGroupsBefore = this.getPlayerMonopolyGroups(
            this.player.id, state.propertyStates);
        const theirGroupsBefore = this.getPlayerMonopolyGroups(
            from.id, state.propertyStates);

        // Simulate pre-trade trajectories
        const preTrade = this.simulateBilateralGrowth(
            { groups: myGroupsBefore, cash: this.player.money,
              id: this.player.id },
            { groups: theirGroupsBefore, cash: from.money,
              id: from.id },
            state.propertyStates, numOtherOpponents
        );

        // Build post-trade state
        const afterState = this.simulateTradeState(state, offer);

        const myGroupsAfter = this.getPlayerMonopolyGroups(
            this.player.id, afterState.propertyStates);
        const theirGroupsAfter = this.getPlayerMonopolyGroups(
            from.id, afterState.propertyStates);
        const myPlayer = afterState.players.find(p => p.id === this.player.id);
        const theirPlayer = afterState.players.find(p => p.id === from.id);

        // Simulate post-trade trajectories
        const postTrade = this.simulateBilateralGrowth(
            { groups: myGroupsAfter, cash: myPlayer.money,
              id: this.player.id },
            { groups: theirGroupsAfter, cash: theirPlayer.money,
              id: from.id },
            afterState.propertyStates, numOtherOpponents
        );

        // Compare trajectory improvements (area under curve difference)
        const horizon = preTrade.myTrajectory.length;
        let myImprovement = 0;
        let theirImprovement = 0;

        for (let t = 0; t < horizon; t++) {
            myImprovement += postTrade.myTrajectory[t]
                           - preTrade.myTrajectory[t];
            theirImprovement += postTrade.theirTrajectory[t]
                              - preTrade.theirTrajectory[t];
        }

        // Accept if my trajectory improves and they don't gain disproportionately
        if (myImprovement < 0) return false;
        if (theirImprovement <= myImprovement) return true;

        // Allow them to gain up to 50% more if my improvement is positive
        if (myImprovement > 0 && theirImprovement <= myImprovement * 1.5) {
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
