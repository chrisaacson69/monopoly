/**
 * Roll EPT Calculator
 *
 * Calculates the expected income/expense per turn from "just rolling the dice"
 * independent of property ownership. This includes:
 *
 * INCOME:
 * - Passing GO: +$200
 * - Chance/CC cards that pay money
 *
 * EXPENSES:
 * - Income Tax (square 4): min($200, 10% of net worth)
 * - Luxury Tax (square 38): $100
 * - Chance/CC cards that cost money
 *
 * VARIABLE:
 * - Street Repairs cards depend on houses/hotels owned
 * - Income Tax depends on net worth
 */

const MonopolyMarkov = require('../ai/markov-engine.js');

const RollEPTCalculator = (function() {
    'use strict';

    // ==========================================================================
    // CARD DEFINITIONS
    // ==========================================================================

    /**
     * Chance cards (16 total)
     * 10 movement cards (handled in Markov), 6 money cards
     */
    const CHANCE_MONEY_CARDS = {
        // Positive (income)
        bankDividend: { amount: 50, count: 1 },
        buildingLoanMatures: { amount: 150, count: 1 },

        // Negative (expenses)
        speedingFine: { amount: -15, count: 1 },
        chairmanOfBoard: { amount: -50, count: 1 },  // Pay each player $50 (varies with player count)
        streetRepairs: { amount: 'variable', count: 1 },  // $25/house, $100/hotel

        // Get out of jail free - no money effect
        getOutOfJailFree: { amount: 0, count: 1 }
    };

    /**
     * Community Chest cards (16 total)
     * 2 movement cards (handled in Markov), 14 money cards
     */
    const COMMUNITY_CHEST_MONEY_CARDS = {
        // Positive (income)
        bankError: { amount: 200, count: 1 },
        doctorsFee: { amount: -50, count: 1 },  // Actually an expense, listed wrong in some sources
        saleOfStock: { amount: 50, count: 1 },
        grandOperaNight: { amount: 50, count: 1 },  // Collect from each player (varies)
        xmasFund: { amount: 100, count: 1 },
        incomeTaxRefund: { amount: 20, count: 1 },
        lifeInsurance: { amount: 100, count: 1 },
        hospitalFees: { amount: -100, count: 1 },  // Expense
        schoolFees: { amount: -50, count: 1 },  // Expense (was -150 in old versions)
        consultancyFee: { amount: 25, count: 1 },
        beautyContest: { amount: 10, count: 1 },
        inherit: { amount: 100, count: 1 },

        // Variable
        streetRepairs: { amount: 'variable', count: 1 },  // $40/house, $115/hotel

        // Get out of jail free - no money effect
        getOutOfJailFree: { amount: 0, count: 1 }
    };

    // Standard US Monopoly card values (verify against your edition)
    const CHANCE_CARD_VALUES = {
        // Fixed income
        income: [50, 150],  // Bank dividend, building loan
        // Fixed expenses
        expenses: [-15, -50],  // Speeding fine, chairman (base, per player)
        // Street repairs: $25/house, $100/hotel
        streetRepairsPerHouse: -25,
        streetRepairsPerHotel: -100
    };

    const CC_CARD_VALUES = {
        // Fixed income
        income: [200, 50, 50, 100, 20, 100, 25, 10, 100],  // Various positive cards
        // Fixed expenses
        expenses: [-50, -100, -50],  // Doctor, hospital, school
        // Street repairs: $40/house, $115/hotel
        streetRepairsPerHouse: -40,
        streetRepairsPerHotel: -115
    };

    // ==========================================================================
    // TAX SQUARES
    // ==========================================================================

    const INCOME_TAX_SQUARE = 4;
    const LUXURY_TAX_SQUARE = 38;
    const LUXURY_TAX_AMOUNT = -100;  // Some editions use $75

    // ==========================================================================
    // GO CALCULATION
    // ==========================================================================

    /**
     * Calculate the probability of passing GO on a given turn.
     *
     * This is more complex than landing probability because:
     * - You pass GO when your position wraps from high numbers to low
     * - Multiple rolls (doubles) can pass GO multiple times
     * - Cards that move you (Advance to Go, etc.) may or may not count
     *
     * For simplicity, we approximate using the transition matrix:
     * P(pass GO from square X) ≈ P(land on squares 0 to (dice_max-1) from X)
     *
     * More precisely: if you're on square X and roll R, you pass GO if X + R >= 40
     */
    function calculatePassGoProbability(markovEngine) {
        const probs = markovEngine.getAllProbabilities('stay');

        // For each starting square, compute probability of passing GO
        // This requires looking at the dice roll distribution
        const DICE_PROB = MonopolyMarkov.DICE_PROB;

        // Probability of passing GO from each square (single roll, no doubles complexity)
        // If at square X, pass GO if X + roll >= 40, i.e., roll >= 40 - X
        const passGoFromSquare = [];

        for (let sq = 0; sq < 40; sq++) {
            let passProb = 0;
            const minRollToPass = 40 - sq;

            for (let roll = Math.max(2, minRollToPass); roll <= 12; roll++) {
                passProb += DICE_PROB[roll];
            }

            passGoFromSquare[sq] = passProb;
        }

        // Weight by steady-state probability of being at each square
        // This is an approximation - doesn't account for doubles chains well
        let expectedPassGo = 0;
        for (let sq = 0; sq < 40; sq++) {
            expectedPassGo += probs[sq] * passGoFromSquare[sq];
        }

        // Account for "Advance to Go" cards
        // Chance: 1/16 chance when landing on Chance squares
        // CC: 1/16 chance when landing on CC squares
        const chanceSquares = [7, 22, 36];
        const ccSquares = [2, 17, 33];

        let advanceToGoProb = 0;
        for (const sq of chanceSquares) {
            advanceToGoProb += probs[sq] * (1/16);  // Advance to Go card
        }
        for (const sq of ccSquares) {
            advanceToGoProb += probs[sq] * (1/16);  // Advance to Go card
        }

        // Note: "Advance to Go" explicitly says "Collect $200", so it counts
        // But we need to avoid double-counting if the Advance to Go also
        // means passing Go normally would have happened anyway

        return {
            fromRolling: expectedPassGo,
            fromCards: advanceToGoProb,
            total: expectedPassGo + advanceToGoProb,  // Slight overcount but close
            goIncome: (expectedPassGo + advanceToGoProb) * 200
        };
    }

    // ==========================================================================
    // CARD INCOME/EXPENSE CALCULATION
    // ==========================================================================

    /**
     * Calculate expected income/expense from Chance cards per turn.
     *
     * @param {number[]} probs - Landing probabilities
     * @param {number} houseCount - Total houses owned
     * @param {number} hotelCount - Total hotels owned
     * @param {number} playerCount - Number of players (for "pay each player" cards)
     */
    function calculateChanceCardEPT(probs, houseCount = 0, hotelCount = 0, playerCount = 4) {
        const chanceSquares = [7, 22, 36];

        // Probability of landing on ANY Chance square
        let pChance = 0;
        for (const sq of chanceSquares) {
            pChance += probs[sq];
        }

        // When you land on Chance, probability of drawing each card type
        // 16 cards total, 10 movement (handled elsewhere), 6 money-related
        const pDraw = 1/16;

        // Fixed income cards
        const bankDividend = 50 * pDraw;
        const buildingLoan = 150 * pDraw;

        // Fixed expense cards
        const speedingFine = -15 * pDraw;
        const chairman = -50 * (playerCount - 1) * pDraw;  // Pay each OTHER player

        // Street repairs (variable)
        const streetRepairs = (-25 * houseCount - 100 * hotelCount) * pDraw;

        // Get out of jail - no direct money value (could model as $50 saved later)

        const expectedPerChanceLanding = bankDividend + buildingLoan + speedingFine + chairman + streetRepairs;

        return {
            probability: pChance,
            expectedPerLanding: expectedPerChanceLanding,
            expectedPerTurn: pChance * expectedPerChanceLanding,
            breakdown: {
                bankDividend: pChance * bankDividend,
                buildingLoan: pChance * buildingLoan,
                speedingFine: pChance * speedingFine,
                chairman: pChance * chairman,
                streetRepairs: pChance * streetRepairs
            }
        };
    }

    /**
     * Calculate expected income/expense from Community Chest cards per turn.
     */
    function calculateCCCardEPT(probs, houseCount = 0, hotelCount = 0, playerCount = 4) {
        const ccSquares = [2, 17, 33];

        let pCC = 0;
        for (const sq of ccSquares) {
            pCC += probs[sq];
        }

        const pDraw = 1/16;

        // Fixed income cards (9 cards)
        const bankError = 200 * pDraw;
        const saleOfStock = 50 * pDraw;
        const grandOpera = 50 * (playerCount - 1) * pDraw;  // Collect from each OTHER player
        const xmasFund = 100 * pDraw;
        const taxRefund = 20 * pDraw;
        const lifeInsurance = 100 * pDraw;
        const consultancy = 25 * pDraw;
        const beautyContest = 10 * pDraw;
        const inherit = 100 * pDraw;

        // Fixed expense cards (3 cards)
        const doctorFee = -50 * pDraw;
        const hospitalFee = -100 * pDraw;
        const schoolFee = -50 * pDraw;

        // Street repairs (variable) - 1 card
        const streetRepairs = (-40 * houseCount - 115 * hotelCount) * pDraw;

        const expectedPerCCLanding = bankError + saleOfStock + grandOpera + xmasFund +
                                      taxRefund + lifeInsurance + consultancy + beautyContest +
                                      inherit + doctorFee + hospitalFee + schoolFee + streetRepairs;

        return {
            probability: pCC,
            expectedPerLanding: expectedPerCCLanding,
            expectedPerTurn: pCC * expectedPerCCLanding,
            breakdown: {
                income: pCC * (bankError + saleOfStock + grandOpera + xmasFund + taxRefund +
                              lifeInsurance + consultancy + beautyContest + inherit),
                expenses: pCC * (doctorFee + hospitalFee + schoolFee),
                streetRepairs: pCC * streetRepairs
            }
        };
    }

    // ==========================================================================
    // TAX CALCULATION
    // ==========================================================================

    /**
     * Calculate expected tax expense per turn.
     *
     * @param {number[]} probs - Landing probabilities
     * @param {number} netWorth - Player's total net worth (for Income Tax calculation)
     */
    function calculateTaxEPT(probs, netWorth = 1500) {
        const pIncomeTax = probs[INCOME_TAX_SQUARE];
        const pLuxuryTax = probs[LUXURY_TAX_SQUARE];

        // Income Tax: min($200, 10% of net worth)
        const incomeTaxAmount = -Math.min(200, Math.floor(netWorth * 0.10));

        return {
            incomeTax: {
                probability: pIncomeTax,
                amount: incomeTaxAmount,
                expectedPerTurn: pIncomeTax * incomeTaxAmount
            },
            luxuryTax: {
                probability: pLuxuryTax,
                amount: LUXURY_TAX_AMOUNT,
                expectedPerTurn: pLuxuryTax * LUXURY_TAX_AMOUNT
            },
            totalExpectedPerTurn: pIncomeTax * incomeTaxAmount + pLuxuryTax * LUXURY_TAX_AMOUNT
        };
    }

    // ==========================================================================
    // COMBINED ROLL EPT
    // ==========================================================================

    /**
     * Calculate the total expected income/expense per turn from rolling.
     * This is independent of rent - just board mechanics.
     *
     * @param {Object} markovEngine - Initialized MarkovEngine
     * @param {Object} gameState - Current game state
     */
    function calculateRollEPT(markovEngine, gameState = {}) {
        const {
            netWorth = 1500,
            houseCount = 0,
            hotelCount = 0,
            playerCount = 4,
            jailStrategy = 'stay'
        } = gameState;

        const probs = markovEngine.getAllProbabilities(jailStrategy);

        // Calculate each component
        const goCalc = calculatePassGoProbability(markovEngine);
        const chanceCalc = calculateChanceCardEPT(probs, houseCount, hotelCount, playerCount);
        const ccCalc = calculateCCCardEPT(probs, houseCount, hotelCount, playerCount);
        const taxCalc = calculateTaxEPT(probs, netWorth);

        // Total EPT
        const totalEPT = goCalc.goIncome +
                         chanceCalc.expectedPerTurn +
                         ccCalc.expectedPerTurn +
                         taxCalc.totalExpectedPerTurn;

        return {
            total: totalEPT,
            breakdown: {
                passingGo: goCalc.goIncome,
                chanceCards: chanceCalc.expectedPerTurn,
                communityChest: ccCalc.expectedPerTurn,
                taxes: taxCalc.totalExpectedPerTurn
            },
            details: {
                go: goCalc,
                chance: chanceCalc,
                communityChest: ccCalc,
                taxes: taxCalc
            },
            gameState: {
                netWorth,
                houseCount,
                hotelCount,
                playerCount,
                jailStrategy
            }
        };
    }

    // ==========================================================================
    // ANALYSIS FUNCTIONS
    // ==========================================================================

    /**
     * Show how Roll EPT changes with different game states.
     */
    function analyzeRollEPTSensitivity(markovEngine) {
        console.log('================================================================================');
        console.log('ROLL EPT SENSITIVITY ANALYSIS');
        console.log('================================================================================\n');

        console.log('How expected income/expense from "just rolling" changes with game state:\n');

        // Baseline (start of game)
        console.log('NET WORTH IMPACT (Income Tax threshold):');
        console.log('─'.repeat(60));
        console.log('Net Worth'.padEnd(15) + 'Income Tax'.padStart(12) + 'Roll EPT'.padStart(12));
        console.log('─'.repeat(60));

        for (const netWorth of [1500, 2000, 2500, 3000, 4000, 5000]) {
            const result = calculateRollEPT(markovEngine, { netWorth, houseCount: 0, hotelCount: 0 });
            const incomeTax = Math.min(200, Math.floor(netWorth * 0.10));
            console.log(
                ('$' + netWorth).padEnd(15) +
                ('$' + incomeTax).padStart(12) +
                ('$' + result.total.toFixed(2)).padStart(12)
            );
        }

        console.log('\n\nHOUSE/HOTEL IMPACT (Street Repairs cards):');
        console.log('─'.repeat(60));
        console.log('Houses'.padEnd(10) + 'Hotels'.padEnd(10) + 'Repair Cost*'.padStart(15) + 'Roll EPT'.padStart(12));
        console.log('─'.repeat(60));

        for (const [houses, hotels] of [[0,0], [3,0], [6,0], [9,0], [12,0], [0,3], [0,6], [6,3]]) {
            const result = calculateRollEPT(markovEngine, {
                netWorth: 2000,  // Fixed to isolate house effect
                houseCount: houses,
                hotelCount: hotels
            });
            // Combined repair cost from both cards when drawn
            const chanceRepair = 25 * houses + 100 * hotels;
            const ccRepair = 40 * houses + 115 * hotels;
            console.log(
                (houses.toString()).padEnd(10) +
                (hotels.toString()).padEnd(10) +
                ('$' + chanceRepair + '/$' + ccRepair).padStart(15) +
                ('$' + result.total.toFixed(2)).padStart(12)
            );
        }
        console.log('* Chance card / CC card repair costs when drawn');

        console.log('\n\nPLAYER COUNT IMPACT (Collect/Pay each player cards):');
        console.log('─'.repeat(60));
        console.log('Players'.padEnd(10) + 'Chairman Cost*'.padStart(15) + 'Opera Income*'.padStart(15) + 'Roll EPT'.padStart(12));
        console.log('─'.repeat(60));

        for (const playerCount of [2, 3, 4, 5, 6]) {
            const result = calculateRollEPT(markovEngine, {
                netWorth: 2000,
                houseCount: 0,
                hotelCount: 0,
                playerCount
            });
            const chairmanCost = 50 * (playerCount - 1);
            const operaIncome = 50 * (playerCount - 1);
            console.log(
                playerCount.toString().padEnd(10) +
                ('$' + chairmanCost).padStart(15) +
                ('$' + operaIncome).padStart(15) +
                ('$' + result.total.toFixed(2)).padStart(12)
            );
        }
        console.log('* When the respective card is drawn');
    }

    // ==========================================================================
    // EXPORTS
    // ==========================================================================

    return {
        calculateRollEPT,
        calculatePassGoProbability,
        calculateChanceCardEPT,
        calculateCCCardEPT,
        calculateTaxEPT,
        analyzeRollEPTSensitivity,

        // Constants for reference
        CHANCE_CARD_VALUES,
        CC_CARD_VALUES,
        INCOME_TAX_SQUARE,
        LUXURY_TAX_SQUARE,
        LUXURY_TAX_AMOUNT
    };
})();

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RollEPTCalculator;
}
