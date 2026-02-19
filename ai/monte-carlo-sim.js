/**
 * Monte Carlo Monopoly Simulation
 *
 * Simulates many turns to empirically compute landing probabilities.
 * Uses the exact same rules as our Markov chain implementation for validation.
 *
 * Rules implemented:
 * - Doubles: roll again (up to 3 times)
 * - Triple doubles: go directly to jail
 * - Go-to-Jail square (30): go to jail, turn ends
 * - Chance cards: 10/16 move, 6/16 stay
 * - Community Chest: 2/16 move (Go, Jail), 14/16 stay
 * - Jail strategies: "long stay" (try doubles) vs "short stay" (pay immediately)
 */

const MonteCarloSim = (function() {
    'use strict';

    const BOARD_SIZE = 40;

    // Square indices
    const SQUARES = {
        GO: 0,
        COMMUNITY_CHEST_1: 2,
        READING_RR: 5,
        CHANCE_1: 7,
        JUST_VISITING: 10,
        ST_CHARLES: 11,
        ELECTRIC_COMPANY: 12,
        ILLINOIS: 24,
        PENNSYLVANIA_RR: 15,
        COMMUNITY_CHEST_2: 17,
        FREE_PARKING: 20,
        CHANCE_2: 22,
        B_AND_O_RR: 25,
        WATER_WORKS: 28,
        GO_TO_JAIL: 30,
        COMMUNITY_CHEST_3: 33,
        SHORT_LINE_RR: 35,
        CHANCE_3: 36,
        BOARDWALK: 39
    };

    const CHANCE_SQUARES = [7, 22, 36];
    const COMMUNITY_CHEST_SQUARES = [2, 17, 33];
    const RAILROAD_SQUARES = [5, 15, 25, 35];
    const UTILITY_SQUARES = [12, 28];

    /**
     * Roll two dice, return {sum, isDoubles}
     */
    function rollDice() {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        return {
            sum: d1 + d2,
            isDoubles: d1 === d2
        };
    }

    /**
     * Find nearest railroad moving forward from position
     */
    function nearestRailroad(from) {
        for (const rr of RAILROAD_SQUARES) {
            if (rr > from) return rr;
        }
        return RAILROAD_SQUARES[0]; // Wrap to Reading
    }

    /**
     * Find nearest utility moving forward from position
     */
    function nearestUtility(from) {
        if (from < 12 || from >= 28) return 12;
        return 28;
    }

    /**
     * Draw a Chance card and return new position (or same if no movement)
     * Also returns whether we went to jail (to end turn)
     */
    function drawChance(currentPos) {
        const card = Math.floor(Math.random() * 16);

        switch (card) {
            case 0: return { pos: SQUARES.BOARDWALK, toJail: false };           // Advance to Boardwalk
            case 1: return { pos: SQUARES.GO, toJail: false };                   // Advance to Go
            case 2: return { pos: SQUARES.ILLINOIS, toJail: false };             // Advance to Illinois
            case 3: return { pos: SQUARES.ST_CHARLES, toJail: false };           // Advance to St. Charles
            case 4: return { pos: SQUARES.READING_RR, toJail: false };           // Advance to Reading RR
            case 5: return { pos: SQUARES.JUST_VISITING, toJail: true };         // Go to Jail
            case 6: // Advance to nearest Railroad
            case 7: return { pos: nearestRailroad(currentPos), toJail: false };  // (2 cards)
            case 8: return { pos: nearestUtility(currentPos), toJail: false };   // Advance to nearest Utility
            case 9: // Go back 3 spaces
                const backPos = (currentPos - 3 + 40) % 40;
                // If we land on Community Chest, draw that card
                if (COMMUNITY_CHEST_SQUARES.includes(backPos)) {
                    const ccResult = drawCommunityChest(backPos);
                    return ccResult;
                }
                return { pos: backPos, toJail: false };
            default: // Cards 10-15: no movement
                return { pos: currentPos, toJail: false };
        }
    }

    /**
     * Draw a Community Chest card and return new position
     */
    function drawCommunityChest(currentPos) {
        const card = Math.floor(Math.random() * 16);

        switch (card) {
            case 0: return { pos: SQUARES.GO, toJail: false };                   // Advance to Go
            case 1: return { pos: SQUARES.JUST_VISITING, toJail: true };         // Go to Jail
            default: // Cards 2-15: no movement
                return { pos: currentPos, toJail: false };
        }
    }

    /**
     * Apply square effect (Chance, CC, Go-to-Jail)
     * Returns { pos, toJail }
     */
    function applySquareEffect(pos) {
        if (pos === SQUARES.GO_TO_JAIL) {
            return { pos: SQUARES.JUST_VISITING, toJail: true };
        }

        if (CHANCE_SQUARES.includes(pos)) {
            return drawChance(pos);
        }

        if (COMMUNITY_CHEST_SQUARES.includes(pos)) {
            return drawCommunityChest(pos);
        }

        return { pos, toJail: false };
    }

    /**
     * Simulate one complete turn from a starting position.
     *
     * @param {number} startPos - Starting board position (0-39)
     * @param {boolean} inJail - Whether player starts in jail
     * @param {number} jailTurns - How many turns already spent in jail (0-2)
     * @param {string} jailStrategy - 'stay' (long) or 'leave' (short)
     * @returns {Object} { finalPos, inJail, jailTurns, landings[] }
     */
    function simulateTurn(startPos, inJail, jailTurns, jailStrategy) {
        const landings = [];

        // Handle jail
        if (inJail) {
            if (jailStrategy === 'leave') {
                // SHORT STAY: Pay $50 and roll normally (with full doubles mechanics)
                inJail = false;
                jailTurns = 0;
                // Continue to normal turn from square 10
                startPos = SQUARES.JUST_VISITING;
            } else {
                // LONG STAY: Try to roll doubles
                const roll = rollDice();

                if (roll.isDoubles) {
                    // Escaped! Move that many spaces, but NO extra roll
                    inJail = false;
                    jailTurns = 0;
                    let newPos = (SQUARES.JUST_VISITING + roll.sum) % 40;
                    const effect = applySquareEffect(newPos);
                    newPos = effect.pos;

                    if (effect.toJail) {
                        landings.push(SQUARES.JUST_VISITING); // Landing "in jail"
                        return { finalPos: SQUARES.JUST_VISITING, inJail: true, jailTurns: 0, landings };
                    }

                    landings.push(newPos);
                    return { finalPos: newPos, inJail: false, jailTurns: 0, landings };

                } else if (jailTurns >= 2) {
                    // Turn 3: Must leave (pay $50), move but no doubles bonus
                    inJail = false;
                    jailTurns = 0;
                    let newPos = (SQUARES.JUST_VISITING + roll.sum) % 40;
                    const effect = applySquareEffect(newPos);
                    newPos = effect.pos;

                    if (effect.toJail) {
                        landings.push(SQUARES.JUST_VISITING);
                        return { finalPos: SQUARES.JUST_VISITING, inJail: true, jailTurns: 0, landings };
                    }

                    landings.push(newPos);
                    return { finalPos: newPos, inJail: false, jailTurns: 0, landings };

                } else {
                    // Stay in jail another turn (no landing event)
                    return { finalPos: SQUARES.JUST_VISITING, inJail: true, jailTurns: jailTurns + 1, landings };
                }
            }
        }

        // Normal turn with doubles mechanics
        let pos = startPos;
        let doublesCount = 0;

        while (true) {
            const roll = rollDice();

            if (roll.isDoubles) {
                doublesCount++;

                // Triple doubles = jail!
                if (doublesCount === 3) {
                    landings.push(SQUARES.JUST_VISITING); // Landing "in jail"
                    return { finalPos: SQUARES.JUST_VISITING, inJail: true, jailTurns: 0, landings };
                }
            }

            // Move
            pos = (pos + roll.sum) % 40;

            // Apply square effects
            const effect = applySquareEffect(pos);
            pos = effect.pos;

            // If sent to jail, turn ends
            if (effect.toJail) {
                landings.push(SQUARES.JUST_VISITING); // Landing "in jail"
                return { finalPos: SQUARES.JUST_VISITING, inJail: true, jailTurns: 0, landings };
            }

            // Record landing
            landings.push(pos);

            // If not doubles, turn ends
            if (!roll.isDoubles) {
                return { finalPos: pos, inJail: false, jailTurns: 0, landings };
            }

            // Doubles - roll again (continue loop)
        }
    }

    /**
     * Run Monte Carlo simulation
     *
     * @param {number} numTurns - Number of turns to simulate
     * @param {string} jailStrategy - 'stay' or 'leave'
     * @returns {Object} Simulation results
     */
    function runSimulation(numTurns = 1000000, jailStrategy = 'stay') {
        const landingCounts = new Array(40).fill(0);
        let totalLandings = 0;

        // Track state
        let pos = 0;  // Start at GO
        let inJail = false;
        let jailTurns = 0;

        for (let turn = 0; turn < numTurns; turn++) {
            const result = simulateTurn(pos, inJail, jailTurns, jailStrategy);

            // Count all landings this turn
            for (const landing of result.landings) {
                landingCounts[landing]++;
                totalLandings++;
            }

            // Update state
            pos = result.finalPos;
            inJail = result.inJail;
            jailTurns = result.jailTurns;
        }

        // Convert to probabilities
        const probabilities = landingCounts.map(count => count / totalLandings);

        return {
            probabilities,
            totalLandings,
            numTurns,
            landingsPerTurn: totalLandings / numTurns
        };
    }

    // Square names for display
    const SQUARE_NAMES = [
        'GO', 'Mediterranean Avenue', 'Community Chest', 'Baltic Avenue',
        'Income Tax', 'Reading Railroad', 'Oriental Avenue', 'Chance',
        'Vermont Avenue', 'Connecticut Avenue', 'Jail / Just Visiting',
        'St. Charles Place', 'Electric Company', 'States Avenue',
        'Virginia Avenue', 'Pennsylvania Railroad', 'St. James Place',
        'Community Chest', 'Tennessee Avenue', 'New York Avenue',
        'Free Parking', 'Kentucky Avenue', 'Chance', 'Indiana Avenue',
        'Illinois Avenue', 'B&O Railroad', 'Atlantic Avenue', 'Ventnor Avenue',
        'Water Works', 'Marvin Gardens', 'Go To Jail', 'Pacific Avenue',
        'North Carolina Avenue', 'Community Chest', 'Pennsylvania Avenue',
        'Short Line Railroad', 'Chance', 'Park Place', 'Luxury Tax', 'Boardwalk'
    ];

    return {
        runSimulation,
        SQUARE_NAMES,
        SQUARES
    };

})();

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonteCarloSim;
}
