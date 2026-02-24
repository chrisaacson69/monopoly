/**
 * Monopoly Property Valuator
 *
 * Computes Earnings Per Ply (EPT) and ROI for all properties based on
 * Markov chain landing probabilities.
 *
 * Key concepts:
 * - EPT = P(landing) × rent  (per-ply: one opponent's move; × opponents for round-level)
 * - ROI = EPT / total_investment
 * - Payback Period = total_investment / EPT (turns to recoup investment)
 *
 * Based on financial principles from Monopoly analysis literature.
 */

const PropertyValuator = (function() {
    'use strict';

    // ==========================================================================
    // PROPERTY DATA
    // ==========================================================================

    /**
     * Complete property data for standard US Monopoly board.
     * Includes purchase price, house cost, and rent at each development level.
     *
     * Rent levels: 0 = unimproved, 1-4 = houses, 5 = hotel
     * Note: Monopoly rent doubles with no houses when full color set is owned
     */
    const PROPERTIES = {
        // Brown (Group 3 in game)
        1: {  // Mediterranean Avenue
            name: 'Mediterranean Avenue',
            group: 'brown',
            price: 60,
            housePrice: 50,
            rent: [2, 10, 30, 90, 160, 250],
            monopolyRent: 4  // doubled base rent with monopoly
        },
        3: {  // Baltic Avenue
            name: 'Baltic Avenue',
            group: 'brown',
            price: 60,
            housePrice: 50,
            rent: [4, 20, 60, 180, 320, 450],
            monopolyRent: 8
        },

        // Light Blue (Group 4 in game)
        6: {  // Oriental Avenue
            name: 'Oriental Avenue',
            group: 'lightBlue',
            price: 100,
            housePrice: 50,
            rent: [6, 30, 90, 270, 400, 550],
            monopolyRent: 12
        },
        8: {  // Vermont Avenue
            name: 'Vermont Avenue',
            group: 'lightBlue',
            price: 100,
            housePrice: 50,
            rent: [6, 30, 90, 270, 400, 550],
            monopolyRent: 12
        },
        9: {  // Connecticut Avenue
            name: 'Connecticut Avenue',
            group: 'lightBlue',
            price: 120,
            housePrice: 50,
            rent: [8, 40, 100, 300, 450, 600],
            monopolyRent: 16
        },

        // Pink/Magenta (Group 5 in game)
        11: {  // St. Charles Place
            name: 'St. Charles Place',
            group: 'pink',
            price: 140,
            housePrice: 100,
            rent: [10, 50, 150, 450, 625, 750],
            monopolyRent: 20
        },
        13: {  // States Avenue
            name: 'States Avenue',
            group: 'pink',
            price: 140,
            housePrice: 100,
            rent: [10, 50, 150, 450, 625, 750],
            monopolyRent: 20
        },
        14: {  // Virginia Avenue
            name: 'Virginia Avenue',
            group: 'pink',
            price: 160,
            housePrice: 100,
            rent: [12, 60, 180, 500, 700, 900],
            monopolyRent: 24
        },

        // Orange (Group 6 in game)
        16: {  // St. James Place
            name: 'St. James Place',
            group: 'orange',
            price: 180,
            housePrice: 100,
            rent: [14, 70, 200, 550, 750, 950],
            monopolyRent: 28
        },
        18: {  // Tennessee Avenue
            name: 'Tennessee Avenue',
            group: 'orange',
            price: 180,
            housePrice: 100,
            rent: [14, 70, 200, 550, 750, 950],
            monopolyRent: 28
        },
        19: {  // New York Avenue
            name: 'New York Avenue',
            group: 'orange',
            price: 200,
            housePrice: 100,
            rent: [16, 80, 220, 600, 800, 1000],
            monopolyRent: 32
        },

        // Red (Group 7 in game)
        21: {  // Kentucky Avenue
            name: 'Kentucky Avenue',
            group: 'red',
            price: 220,
            housePrice: 150,
            rent: [18, 90, 250, 700, 875, 1050],
            monopolyRent: 36
        },
        23: {  // Indiana Avenue
            name: 'Indiana Avenue',
            group: 'red',
            price: 220,
            housePrice: 150,
            rent: [18, 90, 250, 700, 875, 1050],
            monopolyRent: 36
        },
        24: {  // Illinois Avenue
            name: 'Illinois Avenue',
            group: 'red',
            price: 240,
            housePrice: 150,
            rent: [20, 100, 300, 750, 925, 1100],
            monopolyRent: 40
        },

        // Yellow (Group 8 in game)
        26: {  // Atlantic Avenue
            name: 'Atlantic Avenue',
            group: 'yellow',
            price: 260,
            housePrice: 150,
            rent: [22, 110, 330, 800, 975, 1150],
            monopolyRent: 44
        },
        27: {  // Ventnor Avenue
            name: 'Ventnor Avenue',
            group: 'yellow',
            price: 260,
            housePrice: 150,
            rent: [22, 110, 330, 800, 975, 1150],
            monopolyRent: 44
        },
        29: {  // Marvin Gardens
            name: 'Marvin Gardens',
            group: 'yellow',
            price: 280,
            housePrice: 150,
            rent: [24, 120, 360, 850, 1025, 1200],
            monopolyRent: 48
        },

        // Green (Group 9 in game)
        31: {  // Pacific Avenue
            name: 'Pacific Avenue',
            group: 'green',
            price: 300,
            housePrice: 200,
            rent: [26, 130, 390, 900, 1100, 1275],
            monopolyRent: 52
        },
        32: {  // North Carolina Avenue
            name: 'North Carolina Avenue',
            group: 'green',
            price: 300,
            housePrice: 200,
            rent: [26, 130, 390, 900, 1100, 1275],
            monopolyRent: 52
        },
        34: {  // Pennsylvania Avenue
            name: 'Pennsylvania Avenue',
            group: 'green',
            price: 320,
            housePrice: 200,
            rent: [28, 150, 450, 1000, 1200, 1400],
            monopolyRent: 56
        },

        // Dark Blue (Group 10 in game)
        37: {  // Park Place
            name: 'Park Place',
            group: 'darkBlue',
            price: 350,
            housePrice: 200,
            rent: [35, 175, 500, 1100, 1300, 1500],
            monopolyRent: 70
        },
        39: {  // Boardwalk
            name: 'Boardwalk',
            group: 'darkBlue',
            price: 400,
            housePrice: 200,
            rent: [50, 200, 600, 1400, 1700, 2000],
            monopolyRent: 100
        }
    };

    /**
     * Railroad data.
     * Rent depends on number of railroads owned: 1=$25, 2=$50, 3=$100, 4=$200
     */
    const RAILROADS = {
        5: { name: 'Reading Railroad', price: 200 },
        15: { name: 'Pennsylvania Railroad', price: 200 },
        25: { name: 'B&O Railroad', price: 200 },
        35: { name: 'Short Line Railroad', price: 200 }
    };

    const RAILROAD_RENT = [0, 25, 50, 100, 200];  // indexed by count owned

    /**
     * Utility data.
     * Rent: 1 utility = 4× dice roll, 2 utilities = 10× dice roll
     * Expected dice roll = 7, so expected rent = 28 or 70
     */
    const UTILITIES = {
        12: { name: 'Electric Company', price: 150 },
        28: { name: 'Water Works', price: 150 }
    };

    const UTILITY_RENT_MULTIPLIER = [0, 4, 10];  // indexed by count owned
    const EXPECTED_DICE_ROLL = 7;

    // ==========================================================================
    // COLOR GROUP DEFINITIONS
    // ==========================================================================

    const COLOR_GROUPS = {
        brown: [1, 3],
        lightBlue: [6, 8, 9],
        pink: [11, 13, 14],
        orange: [16, 18, 19],
        red: [21, 23, 24],
        yellow: [26, 27, 29],
        green: [31, 32, 34],
        darkBlue: [37, 39]
    };

    // Number of properties in each group (for monopoly checking)
    const GROUP_SIZES = {
        brown: 2,
        lightBlue: 3,
        pink: 3,
        orange: 3,
        red: 3,
        yellow: 3,
        green: 3,
        darkBlue: 2
    };

    // ==========================================================================
    // EPT CALCULATIONS
    // ==========================================================================

    /**
     * Calculate Earnings Per Turn (EPT) for a property.
     *
     * @param {number} squareIndex - Board position (0-39)
     * @param {number} landingProbability - P(landing on this square)
     * @param {number} houseCount - Number of houses (0-5, where 5 = hotel)
     * @param {boolean} hasMonopoly - Whether player owns all properties in group
     * @returns {number} Expected earnings per opponent turn
     */
    function calculatePropertyEPT(squareIndex, landingProbability, houseCount = 0, hasMonopoly = false) {
        const prop = PROPERTIES[squareIndex];
        if (!prop) return 0;

        let rent;
        if (houseCount > 0) {
            rent = prop.rent[houseCount];
        } else if (hasMonopoly) {
            rent = prop.monopolyRent;
        } else {
            rent = prop.rent[0];
        }

        return landingProbability * rent;
    }

    /**
     * Calculate EPT for a railroad based on number owned.
     *
     * @param {number} squareIndex - Railroad position
     * @param {number} landingProbability - P(landing on this square)
     * @param {number} railroadsOwned - Number of railroads owned (1-4)
     * @returns {number} Expected earnings per opponent turn
     */
    function calculateRailroadEPT(squareIndex, landingProbability, railroadsOwned) {
        if (!RAILROADS[squareIndex]) return 0;
        const rent = RAILROAD_RENT[railroadsOwned] || 0;
        return landingProbability * rent;
    }

    /**
     * Calculate EPT for a utility based on number owned.
     *
     * @param {number} squareIndex - Utility position
     * @param {number} landingProbability - P(landing on this square)
     * @param {number} utilitiesOwned - Number of utilities owned (1-2)
     * @returns {number} Expected earnings per opponent turn
     */
    function calculateUtilityEPT(squareIndex, landingProbability, utilitiesOwned) {
        if (!UTILITIES[squareIndex]) return 0;
        const multiplier = UTILITY_RENT_MULTIPLIER[utilitiesOwned] || 0;
        const expectedRent = multiplier * EXPECTED_DICE_ROLL;
        return landingProbability * expectedRent;
    }

    // ==========================================================================
    // ROI CALCULATIONS
    // ==========================================================================

    /**
     * Calculate total investment to reach a development level.
     *
     * @param {number} squareIndex - Board position
     * @param {number} houseCount - Target house count (0-5)
     * @returns {number} Total cost (property + houses)
     */
    function calculateTotalInvestment(squareIndex, houseCount = 0) {
        const prop = PROPERTIES[squareIndex];
        if (!prop) return 0;

        return prop.price + (houseCount * prop.housePrice);
    }

    /**
     * Calculate payback period (turns to recoup investment).
     *
     * @param {number} squareIndex - Board position
     * @param {number} landingProbability - P(landing on this square)
     * @param {number} houseCount - Current house count
     * @param {boolean} hasMonopoly - Whether player owns monopoly
     * @param {number} opponentCount - Number of opponents (affects EPT multiplier)
     * @returns {number} Number of turns to recoup investment
     */
    function calculatePaybackPeriod(squareIndex, landingProbability, houseCount, hasMonopoly, opponentCount = 3) {
        const investment = calculateTotalInvestment(squareIndex, houseCount);
        const eptPerOpponent = calculatePropertyEPT(squareIndex, landingProbability, houseCount, hasMonopoly);
        const totalEPT = eptPerOpponent * opponentCount;

        if (totalEPT === 0) return Infinity;
        return investment / totalEPT;
    }

    /**
     * Calculate marginal ROI for adding one house.
     * This helps determine if building another house is worthwhile.
     *
     * @param {number} squareIndex - Board position
     * @param {number} landingProbability - P(landing)
     * @param {number} currentHouses - Current house count (0-4)
     * @param {boolean} hasMonopoly - Must be true to build
     * @returns {{cost: number, rentIncrease: number, eptIncrease: number, marginalROI: number}}
     */
    function calculateMarginalHouseROI(squareIndex, landingProbability, currentHouses, hasMonopoly = true) {
        const prop = PROPERTIES[squareIndex];
        if (!prop || !hasMonopoly || currentHouses >= 5) {
            return { cost: 0, rentIncrease: 0, eptIncrease: 0, marginalROI: 0 };
        }

        const cost = prop.housePrice;

        // Current rent (with monopoly if no houses, else with houses)
        const currentRent = currentHouses === 0 ? prop.monopolyRent : prop.rent[currentHouses];
        const newRent = prop.rent[currentHouses + 1];
        const rentIncrease = newRent - currentRent;

        const currentEPT = landingProbability * currentRent;
        const newEPT = landingProbability * newRent;
        const eptIncrease = newEPT - currentEPT;

        // Marginal ROI = EPT increase / cost
        const marginalROI = eptIncrease / cost;

        return { cost, rentIncrease, eptIncrease, marginalROI };
    }

    // ==========================================================================
    // GROUP ANALYSIS
    // ==========================================================================

    /**
     * Calculate total EPT for an entire color group at given development.
     *
     * @param {string} groupName - Color group name
     * @param {number[]} probabilities - Landing probabilities array (40 elements)
     * @param {number} houseCount - Houses on each property (assumes even building)
     * @returns {number} Total EPT for the group
     */
    function calculateGroupEPT(groupName, probabilities, houseCount = 0) {
        const squares = COLOR_GROUPS[groupName];
        if (!squares) return 0;

        let totalEPT = 0;
        for (const sq of squares) {
            const prob = probabilities[sq];
            totalEPT += calculatePropertyEPT(sq, prob, houseCount, true);
        }
        return totalEPT;
    }

    /**
     * Calculate total investment to fully develop a color group.
     *
     * @param {string} groupName - Color group name
     * @param {number} houseCount - Houses per property (0-5)
     * @returns {number} Total investment needed
     */
    function calculateGroupInvestment(groupName, houseCount = 0) {
        const squares = COLOR_GROUPS[groupName];
        if (!squares) return 0;

        let total = 0;
        for (const sq of squares) {
            total += calculateTotalInvestment(sq, houseCount);
        }
        return total;
    }

    /**
     * Compare all color groups at a given development level.
     *
     * @param {number[]} probabilities - Landing probabilities
     * @param {number} houseCount - Houses per property
     * @returns {Array<{group: string, ept: number, investment: number, roi: number}>}
     */
    function compareGroups(probabilities, houseCount = 3) {
        const results = [];

        for (const groupName of Object.keys(COLOR_GROUPS)) {
            const ept = calculateGroupEPT(groupName, probabilities, houseCount);
            const investment = calculateGroupInvestment(groupName, houseCount);
            const roi = investment > 0 ? ept / investment : 0;

            results.push({
                group: groupName,
                ept,
                investment,
                roi,
                paybackTurns: investment / (ept * 3)  // assuming 3 opponents
            });
        }

        return results.sort((a, b) => b.roi - a.roi);
    }

    // ==========================================================================
    // COMPLETE EPT TABLE GENERATION
    // ==========================================================================

    /**
     * Generate complete EPT tables for all properties at all development levels.
     * This is the core data structure for AI decision making.
     *
     * @param {number[]} probabilities - Landing probabilities (40 elements)
     * @returns {Object} Comprehensive EPT data
     */
    function generateEPTTables(probabilities) {
        const tables = {
            properties: {},
            railroads: {},
            utilities: {},
            groups: {},
            summary: {}
        };

        // Calculate EPT for each property at each development level
        for (const [sqStr, prop] of Object.entries(PROPERTIES)) {
            const sq = parseInt(sqStr);
            const prob = probabilities[sq];

            tables.properties[sq] = {
                name: prop.name,
                group: prop.group,
                probability: prob,
                price: prop.price,
                housePrice: prop.housePrice,
                ept: {
                    noMonopoly: calculatePropertyEPT(sq, prob, 0, false),
                    monopoly: calculatePropertyEPT(sq, prob, 0, true),
                    house1: calculatePropertyEPT(sq, prob, 1, true),
                    house2: calculatePropertyEPT(sq, prob, 2, true),
                    house3: calculatePropertyEPT(sq, prob, 3, true),
                    house4: calculatePropertyEPT(sq, prob, 4, true),
                    hotel: calculatePropertyEPT(sq, prob, 5, true)
                },
                investment: {
                    property: prop.price,
                    house1: prop.price + prop.housePrice,
                    house2: prop.price + 2 * prop.housePrice,
                    house3: prop.price + 3 * prop.housePrice,
                    house4: prop.price + 4 * prop.housePrice,
                    hotel: prop.price + 5 * prop.housePrice
                },
                marginalROI: {}
            };

            // Calculate marginal ROI for each house level
            for (let h = 0; h < 5; h++) {
                const marginal = calculateMarginalHouseROI(sq, prob, h, true);
                tables.properties[sq].marginalROI[`house${h + 1}`] = marginal;
            }
        }

        // Calculate EPT for railroads (at each ownership level)
        for (const [sqStr, rr] of Object.entries(RAILROADS)) {
            const sq = parseInt(sqStr);
            const prob = probabilities[sq];

            tables.railroads[sq] = {
                name: rr.name,
                probability: prob,
                price: rr.price,
                ept: {
                    own1: calculateRailroadEPT(sq, prob, 1),
                    own2: calculateRailroadEPT(sq, prob, 2),
                    own3: calculateRailroadEPT(sq, prob, 3),
                    own4: calculateRailroadEPT(sq, prob, 4)
                }
            };
        }

        // Calculate EPT for utilities
        for (const [sqStr, util] of Object.entries(UTILITIES)) {
            const sq = parseInt(sqStr);
            const prob = probabilities[sq];

            tables.utilities[sq] = {
                name: util.name,
                probability: prob,
                price: util.price,
                ept: {
                    own1: calculateUtilityEPT(sq, prob, 1),
                    own2: calculateUtilityEPT(sq, prob, 2)
                }
            };
        }

        // Calculate group totals
        for (const [groupName, squares] of Object.entries(COLOR_GROUPS)) {
            tables.groups[groupName] = {
                squares,
                totalProbability: squares.reduce((sum, sq) => sum + probabilities[sq], 0),
                ept: {},
                investment: {},
                roi: {}
            };

            for (let h = 0; h <= 5; h++) {
                const key = h === 0 ? 'monopoly' : h === 5 ? 'hotel' : `house${h}`;
                tables.groups[groupName].ept[key] = calculateGroupEPT(groupName, probabilities, h);
                tables.groups[groupName].investment[key] = calculateGroupInvestment(groupName, h);

                const inv = tables.groups[groupName].investment[key];
                const ept = tables.groups[groupName].ept[key];
                tables.groups[groupName].roi[key] = inv > 0 ? ept / inv : 0;
            }
        }

        // Summary statistics
        tables.summary = {
            bestROI: compareGroups(probabilities, 3),
            totalBoardProbability: probabilities.reduce((a, b) => a + b, 0)
        };

        return tables;
    }

    // ==========================================================================
    // MAIN CLASS
    // ==========================================================================

    class Valuator {
        constructor(markovEngine) {
            this.markovEngine = markovEngine;
            this._tables = {};
            this._initialized = false;
        }

        /**
         * Initialize with pre-computed EPT tables.
         */
        initialize() {
            if (!this.markovEngine) {
                throw new Error('MarkovEngine is required');
            }

            console.log('PropertyValuator: Generating EPT tables...');

            // Generate tables for both jail strategies
            const probStay = this.markovEngine.getAllProbabilities('stay');
            const probLeave = this.markovEngine.getAllProbabilities('leave');

            this._tables['stay'] = generateEPTTables(probStay);
            this._tables['leave'] = generateEPTTables(probLeave);

            this._initialized = true;
            console.log('PropertyValuator: Initialization complete.');
        }

        /**
         * Get EPT for a specific property.
         */
        getPropertyEPT(squareIndex, houseCount = 0, hasMonopoly = false, jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();

            const tables = this._tables[jailStrategy];
            const prop = tables.properties[squareIndex];
            if (!prop) return 0;

            if (houseCount > 0) {
                const key = houseCount === 5 ? 'hotel' : `house${houseCount}`;
                return prop.ept[key];
            } else if (hasMonopoly) {
                return prop.ept.monopoly;
            } else {
                return prop.ept.noMonopoly;
            }
        }

        /**
         * Get complete EPT tables.
         */
        getTables(jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();
            return this._tables[jailStrategy];
        }

        /**
         * Get best house investment opportunities ranked by marginal ROI.
         */
        getBestHouseInvestments(jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();

            const tables = this._tables[jailStrategy];
            const opportunities = [];

            for (const [sqStr, prop] of Object.entries(tables.properties)) {
                for (let h = 1; h <= 5; h++) {
                    const key = h === 5 ? 'house5' : `house${h}`;
                    const marginal = prop.marginalROI[key];
                    if (marginal && marginal.marginalROI > 0) {
                        opportunities.push({
                            square: parseInt(sqStr),
                            name: prop.name,
                            group: prop.group,
                            fromHouses: h - 1,
                            toHouses: h,
                            cost: marginal.cost,
                            eptIncrease: marginal.eptIncrease,
                            marginalROI: marginal.marginalROI
                        });
                    }
                }
            }

            return opportunities.sort((a, b) => b.marginalROI - a.marginalROI);
        }

        /**
         * Get group comparison ranked by ROI at specified development.
         */
        getGroupRankings(houseCount = 3, jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();

            const probs = this.markovEngine.getAllProbabilities(jailStrategy);
            return compareGroups(probs, houseCount);
        }
    }

    // ==========================================================================
    // EXPORTS
    // ==========================================================================

    return {
        Valuator,
        PROPERTIES,
        RAILROADS,
        UTILITIES,
        COLOR_GROUPS,
        GROUP_SIZES,
        RAILROAD_RENT,
        UTILITY_RENT_MULTIPLIER,
        EXPECTED_DICE_ROLL,

        // Expose calculation functions
        calculatePropertyEPT,
        calculateRailroadEPT,
        calculateUtilityEPT,
        calculateTotalInvestment,
        calculatePaybackPeriod,
        calculateMarginalHouseROI,
        calculateGroupEPT,
        calculateGroupInvestment,
        compareGroups,
        generateEPTTables
    };

})();

// Export for Node.js / testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PropertyValuator;
}
