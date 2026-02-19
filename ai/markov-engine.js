/**
 * Monopoly Markov Chain Engine
 *
 * Computes landing probabilities for each square using Markov chain analysis.
 * Based on the work of Ash & Bishop "Monopoly as a Markov Process" and subsequent
 * research on Earnings Per Turn (EPT) analysis.
 *
 * Key features:
 * - Exact analytical solution (not Monte Carlo simulation)
 * - Full doubles mechanic: roll again on doubles, up to 3 times
 * - Triple doubles sends player to jail (without moving on 3rd roll)
 * - Accounts for Chance and Community Chest card redirections
 * - Card effects applied at each intermediate position during doubles chains
 * - Go-to-Jail card ends turn immediately (no more doubles rolls)
 * - Handles Go-to-Jail square
 * - Supports both jail strategies (leave early vs stay)
 *
 * @author AI Implementation based on established Monopoly mathematics
 */

const MonopolyMarkov = (function() {
    'use strict';

    // ==========================================================================
    // CONSTANTS: Board Layout
    // ==========================================================================

    const BOARD_SIZE = 40;

    // Square indices
    const SQUARES = {
        GO: 0,
        MEDITERRANEAN: 1,
        COMMUNITY_CHEST_1: 2,
        BALTIC: 3,
        INCOME_TAX: 4,
        READING_RR: 5,
        ORIENTAL: 6,
        CHANCE_1: 7,
        VERMONT: 8,
        CONNECTICUT: 9,
        JUST_VISITING: 10,  // "Just Visiting" - normal landing on square 10
        ST_CHARLES: 11,
        ELECTRIC_COMPANY: 12,
        STATES: 13,
        VIRGINIA: 14,
        PENNSYLVANIA_RR: 15,
        ST_JAMES: 16,
        COMMUNITY_CHEST_2: 17,
        TENNESSEE: 18,
        NEW_YORK: 19,
        FREE_PARKING: 20,
        KENTUCKY: 21,
        CHANCE_2: 22,
        INDIANA: 23,
        ILLINOIS: 24,
        B_AND_O_RR: 25,
        ATLANTIC: 26,
        VENTNOR: 27,
        WATER_WORKS: 28,
        MARVIN_GARDENS: 29,
        GO_TO_JAIL: 30,
        PACIFIC: 31,
        NORTH_CAROLINA: 32,
        COMMUNITY_CHEST_3: 33,
        PENNSYLVANIA_AVE: 34,
        SHORT_LINE_RR: 35,
        CHANCE_3: 36,
        PARK_PLACE: 37,
        LUXURY_TAX: 38,
        BOARDWALK: 39,
        // Special marker for "sent to jail" (NOT "just visiting")
        // This is used internally to distinguish jail events
        IN_JAIL: 50  // Virtual state - will be mapped to extended state 40
    };

    // Chance square positions
    const CHANCE_SQUARES = [7, 22, 36];

    // Community Chest square positions
    const COMMUNITY_CHEST_SQUARES = [2, 17, 33];

    // Railroad positions
    const RAILROAD_SQUARES = [5, 15, 25, 35];

    // Utility positions
    const UTILITY_SQUARES = [12, 28];

    // ==========================================================================
    // CONSTANTS: Dice Probabilities
    // ==========================================================================

    /**
     * Probability of rolling each sum with two six-sided dice.
     * Index 0-1 unused; index 2-12 = P(rolling that sum)
     */
    const DICE_PROB = [
        0,      // 0 - impossible
        0,      // 1 - impossible
        1/36,   // 2 (1+1)
        2/36,   // 3 (1+2, 2+1)
        3/36,   // 4 (1+3, 2+2, 3+1)
        4/36,   // 5 (1+4, 2+3, 3+2, 4+1)
        5/36,   // 6 (1+5, 2+4, 3+3, 4+2, 5+1)
        6/36,   // 7 (1+6, 2+5, 3+4, 4+3, 5+2, 6+1)
        5/36,   // 8 (2+6, 3+5, 4+4, 5+3, 6+2)
        4/36,   // 9 (3+6, 4+5, 5+4, 6+3)
        3/36,   // 10 (4+6, 5+5, 6+4)
        2/36,   // 11 (5+6, 6+5)
        1/36    // 12 (6+6)
    ];

    /**
     * Probability of rolling doubles (1/6 overall)
     * For a specific sum that can be doubles: P(doubles | sum=2k) = 1/(ways to make 2k)
     */
    const DOUBLES_PROB = 1/6;

    /**
     * Probability of rolling a specific sum AND it being doubles.
     * Only even sums 2,4,6,8,10,12 can be doubles.
     */
    const DICE_DOUBLES_PROB = [
        0, 0,
        1/36,   // 2: only 1+1
        0,      // 3: no doubles possible
        1/36,   // 4: only 2+2 (1 of 3 ways)
        0,      // 5: no doubles possible
        1/36,   // 6: only 3+3 (1 of 5 ways)
        0,      // 7: no doubles possible
        1/36,   // 8: only 4+4 (1 of 5 ways)
        0,      // 9: no doubles possible
        1/36,   // 10: only 5+5 (1 of 3 ways)
        0,      // 11: no doubles possible
        1/36    // 12: only 6+6
    ];

    // ==========================================================================
    // CONSTANTS: Card Probabilities
    // ==========================================================================

    const CARDS_IN_DECK = 16;
    const CARD_PROB = 1 / CARDS_IN_DECK;

    /**
     * Chance card effects.
     * Cards that move the player are tracked with their destination.
     * Cards that don't move keep the player on the Chance square.
     *
     * Movement cards (10 of 16):
     * - Advance to Boardwalk (1)
     * - Advance to Go (1)
     * - Advance to Illinois (1)
     * - Advance to St. Charles (1)
     * - Advance to Reading RR (1)
     * - Go to Jail (1)
     * - Advance to nearest Railroad (2 cards)
     * - Advance to nearest Utility (1)
     * - Go back 3 spaces (1)
     *
     * Non-movement cards (6 of 16):
     * - Get out of jail free (1)
     * - Street repairs (1)
     * - Speeding fine (1)
     * - Chairman of board (1)
     * - Bank dividend (1)
     * - Building loan matures (1)
     */
    const CHANCE_STAY_PROB = 6 / CARDS_IN_DECK;  // 6 cards don't move you

    /**
     * Community Chest card effects.
     * Only 2 of 16 cards move the player.
     *
     * Movement cards (2 of 16):
     * - Advance to Go (1)
     * - Go to Jail (1)
     *
     * Non-movement cards (14 of 16)
     */
    const CC_STAY_PROB = 14 / CARDS_IN_DECK;  // 14 cards don't move you

    // ==========================================================================
    // HELPER FUNCTIONS
    // ==========================================================================

    /**
     * Creates a zero-filled 2D array (matrix).
     */
    function createMatrix(rows, cols) {
        const matrix = [];
        for (let i = 0; i < rows; i++) {
            matrix[i] = new Array(cols).fill(0);
        }
        return matrix;
    }

    /**
     * Creates a zero-filled array (vector).
     */
    function createVector(size) {
        return new Array(size).fill(0);
    }

    /**
     * Wraps a position around the board (mod 40).
     */
    function wrapPosition(pos) {
        return ((pos % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    }

    /**
     * Find nearest railroad from a given position (moving forward).
     */
    function nearestRailroad(from) {
        if (from < 5 || from >= 35) return 5;   // Reading
        if (from < 15) return 15;                // Pennsylvania
        if (from < 25) return 25;                // B&O
        return 35;                               // Short Line
    }

    /**
     * Find nearest utility from a given position (moving forward).
     */
    function nearestUtility(from) {
        if (from < 12 || from >= 28) return 12;  // Electric Company
        return 28;                                // Water Works
    }

    // ==========================================================================
    // TRANSITION MATRIX CONSTRUCTION
    // ==========================================================================

    /**
     * Probability of rolling non-doubles = 5/6
     * Probability of rolling doubles = 1/6
     * Probability of triple doubles (jail) = (1/6)^3 = 1/216
     */
    const NON_DOUBLES_PROB = 5/6;

    /**
     * Builds dice roll transition probabilities INCLUDING the doubles mechanic.
     *
     * Doubles rules:
     * - Roll doubles once: move, then roll again
     * - Roll doubles twice: move, then roll again
     * - Roll doubles three times: go directly to jail (don't complete 3rd move)
     *
     * This is computed by considering all possible roll sequences:
     *
     * Turn ends after:
     * - 1 roll (no doubles): P = 5/6
     * - 2 rolls (doubles then non-doubles): P = 1/6 * 5/6 = 5/36
     * - 3 rolls (doubles, doubles, non-doubles): P = 1/6 * 1/6 * 5/6 = 5/216
     * - 3 rolls (doubles, doubles, doubles -> jail): P = 1/6 * 1/6 * 1/6 = 1/216
     *
     * @returns {number[][]} 40x40 transition matrix with doubles accounted for
     */
    function buildDiceTransitions() {
        const T = createMatrix(BOARD_SIZE, BOARD_SIZE);

        for (let from = 0; from < BOARD_SIZE; from++) {
            // Case 1: Single roll, no doubles (probability 5/6)
            // Player rolls non-doubles and turn ends
            for (let roll1 = 2; roll1 <= 12; roll1++) {
                // Probability of this specific roll AND it being non-doubles
                const probNonDoubles = DICE_PROB[roll1] - DICE_DOUBLES_PROB[roll1];
                const to = wrapPosition(from + roll1);
                T[from][to] += probNonDoubles;
            }

            // Case 2: Two rolls - first is doubles, second is not (probability 1/6 * 5/6 = 5/36)
            for (let roll1 = 2; roll1 <= 12; roll1 += 2) {  // Only even rolls can be doubles
                const prob1 = DICE_DOUBLES_PROB[roll1];  // 1/36 for each doubles
                if (prob1 === 0) continue;

                const pos1 = wrapPosition(from + roll1);  // Position after first roll

                for (let roll2 = 2; roll2 <= 12; roll2++) {
                    // Second roll is non-doubles
                    const prob2NonDoubles = DICE_PROB[roll2] - DICE_DOUBLES_PROB[roll2];
                    const to = wrapPosition(pos1 + roll2);
                    T[from][to] += prob1 * prob2NonDoubles;
                }
            }

            // Case 3: Three rolls - first two are doubles, third is not (probability 1/36 * 5/6)
            for (let roll1 = 2; roll1 <= 12; roll1 += 2) {
                const prob1 = DICE_DOUBLES_PROB[roll1];
                if (prob1 === 0) continue;

                const pos1 = wrapPosition(from + roll1);

                for (let roll2 = 2; roll2 <= 12; roll2 += 2) {
                    const prob2 = DICE_DOUBLES_PROB[roll2];
                    if (prob2 === 0) continue;

                    const pos2 = wrapPosition(pos1 + roll2);

                    for (let roll3 = 2; roll3 <= 12; roll3++) {
                        // Third roll is non-doubles - turn ends normally
                        const prob3NonDoubles = DICE_PROB[roll3] - DICE_DOUBLES_PROB[roll3];
                        const to = wrapPosition(pos2 + roll3);
                        T[from][to] += prob1 * prob2 * prob3NonDoubles;
                    }
                }
            }

            // Case 4: Three doubles - go to jail! (probability 1/216)
            // Note: We don't move on the third roll - go directly to jail
            for (let roll1 = 2; roll1 <= 12; roll1 += 2) {
                const prob1 = DICE_DOUBLES_PROB[roll1];
                if (prob1 === 0) continue;

                for (let roll2 = 2; roll2 <= 12; roll2 += 2) {
                    const prob2 = DICE_DOUBLES_PROB[roll2];
                    if (prob2 === 0) continue;

                    for (let roll3 = 2; roll3 <= 12; roll3 += 2) {
                        const prob3 = DICE_DOUBLES_PROB[roll3];
                        if (prob3 === 0) continue;

                        // Triple doubles - go to jail (position 10)
                        T[from][SQUARES.JAIL] += prob1 * prob2 * prob3;
                    }
                }
            }
        }

        return T;
    }

    /**
     * Apply the effect of landing on a square (Chance/CC/Go-to-Jail).
     * Returns a distribution of final positions after card effects.
     *
     * IMPORTANT: Uses SQUARES.IN_JAIL (50) to mark "sent to jail" events,
     * which is DIFFERENT from landing on square 10 normally ("just visiting").
     *
     * @param {number} square - The square landed on
     * @returns {Object} Map of {destinationSquare: probability}
     */
    function applySquareEffect(square) {
        const result = {};

        // Check if it's a Chance square
        if (CHANCE_SQUARES.includes(square)) {
            // 6/16 cards don't move you
            result[square] = (result[square] || 0) + CHANCE_STAY_PROB;

            // Movement cards (10/16):
            result[SQUARES.BOARDWALK] = (result[SQUARES.BOARDWALK] || 0) + CARD_PROB;
            result[SQUARES.GO] = (result[SQUARES.GO] || 0) + CARD_PROB;
            result[SQUARES.ILLINOIS] = (result[SQUARES.ILLINOIS] || 0) + CARD_PROB;
            result[SQUARES.ST_CHARLES] = (result[SQUARES.ST_CHARLES] || 0) + CARD_PROB;
            result[SQUARES.READING_RR] = (result[SQUARES.READING_RR] || 0) + CARD_PROB;
            result[SQUARES.IN_JAIL] = (result[SQUARES.IN_JAIL] || 0) + CARD_PROB;  // Go to jail card (IN JAIL, not visiting!)

            // Nearest Railroad (2 cards)
            const nearRR = nearestRailroad(square);
            result[nearRR] = (result[nearRR] || 0) + 2 * CARD_PROB;

            // Nearest Utility (1 card)
            const nearUtil = nearestUtility(square);
            result[nearUtil] = (result[nearUtil] || 0) + CARD_PROB;

            // Go back 3 spaces (1 card)
            const backThree = wrapPosition(square - 3);
            // If back 3 lands on Community Chest (square 33 from Chance 36), apply CC effect
            if (COMMUNITY_CHEST_SQUARES.includes(backThree)) {
                // Chain: go back 3 -> land on CC -> draw CC card
                result[backThree] = (result[backThree] || 0) + CARD_PROB * CC_STAY_PROB;
                result[SQUARES.GO] = (result[SQUARES.GO] || 0) + CARD_PROB * CARD_PROB;
                result[SQUARES.IN_JAIL] = (result[SQUARES.IN_JAIL] || 0) + CARD_PROB * CARD_PROB;  // Go to jail card from CC
            } else {
                result[backThree] = (result[backThree] || 0) + CARD_PROB;
            }

            return result;
        }

        // Check if it's a Community Chest square
        if (COMMUNITY_CHEST_SQUARES.includes(square)) {
            // 14/16 cards don't move you
            result[square] = (result[square] || 0) + CC_STAY_PROB;

            // Movement cards (2/16):
            result[SQUARES.GO] = (result[SQUARES.GO] || 0) + CARD_PROB;
            result[SQUARES.IN_JAIL] = (result[SQUARES.IN_JAIL] || 0) + CARD_PROB;  // Go to jail card (IN JAIL, not visiting!)

            return result;
        }

        // Check if it's Go-to-Jail square
        if (square === SQUARES.GO_TO_JAIL) {
            result[SQUARES.IN_JAIL] = 1.0;  // Sent to jail (IN JAIL, not visiting!)
            return result;
        }

        // Normal square - just stay there (including square 10 = "just visiting")
        result[square] = 1.0;
        return result;
    }

    /**
     * Builds dice roll transition probabilities INCLUDING the doubles mechanic
     * AND Chance/Community Chest/Go-to-Jail effects properly applied at each step.
     *
     * Key rules:
     * - Roll doubles: move, then roll again (up to 3 times)
     * - Three doubles in a row: go directly to jail (don't move on 3rd roll)
     * - Landing on Go-to-Jail square or drawing Go-to-Jail card: go to jail, turn ends
     *
     * IMPORTANT: For a roll sum like 6, there are multiple ways to achieve it:
     * - 1+5, 2+4, 3+3, 4+2, 5+1 (5 ways total, probability 5/36)
     * - Only 3+3 is doubles (probability 1/36)
     * - Non-doubles ways have probability 4/36
     *
     * We must handle doubles and non-doubles SEPARATELY because they have
     * different consequences (doubles = roll again, non-doubles = turn ends).
     *
     * @returns {number[][]} 40x51 transition matrix (columns 0-39 for board, 50 for IN_JAIL marker)
     */
    function buildDiceTransitions() {
        // Need 51 columns to hold IN_JAIL marker at index 50
        const T = createMatrix(BOARD_SIZE, 51);

        // Helper to add probability to a destination
        function addProb(from, dest, prob) {
            T[from][dest] += prob;
        }

        // Helper to process landing on a square and distribute to final destinations
        // Returns array of {dest, prob} after card effects
        function processLanding(landedSquare) {
            const effects = applySquareEffect(landedSquare);
            return Object.entries(effects).map(([dest, prob]) => ({
                dest: parseInt(dest),
                prob: prob
            }));
        }

        // Helper to process a landing and add to transition matrix
        // Returns: array of {pos, prob} for positions that allow further rolling
        function processAndAdd(from, landedSquare, pathProb, canRollAgain) {
            const outcomes = processLanding(landedSquare);
            const continuingPositions = [];

            for (const outcome of outcomes) {
                const dest = outcome.dest;
                const totalProb = pathProb * outcome.prob;

                if (dest === SQUARES.IN_JAIL) {
                    // Sent to jail - turn ends, no more rolling
                    addProb(from, SQUARES.IN_JAIL, totalProb);
                } else if (!canRollAgain) {
                    // Turn ends normally on this square
                    addProb(from, dest, totalProb);
                } else {
                    // Can roll again from this position
                    continuingPositions.push({ pos: dest, prob: totalProb });
                }
            }

            return continuingPositions;
        }

        for (let from = 0; from < BOARD_SIZE; from++) {

            // ============================================
            // PATH A: First roll is NOT doubles (prob = 5/6)
            // Turn ends after this roll
            // ============================================
            for (let roll1 = 2; roll1 <= 12; roll1++) {
                const probNonDoubles1 = DICE_PROB[roll1] - DICE_DOUBLES_PROB[roll1];
                if (probNonDoubles1 <= 0) continue;

                const landed1 = wrapPosition(from + roll1);
                processAndAdd(from, landed1, probNonDoubles1, false);
            }

            // ============================================
            // PATH B: First roll IS doubles (prob = 1/6)
            // Get to roll again
            // ============================================
            for (let roll1 = 2; roll1 <= 12; roll1 += 2) {  // Only even rolls can be doubles
                const probDoubles1 = DICE_DOUBLES_PROB[roll1];
                if (probDoubles1 <= 0) continue;

                const landed1 = wrapPosition(from + roll1);
                const continuing1 = processAndAdd(from, landed1, probDoubles1, true);

                // For each position we can continue from after first doubles...
                for (const c1 of continuing1) {
                    const pos1 = c1.pos;
                    const prob1 = c1.prob;

                    // ============================================
                    // PATH B1: Second roll is NOT doubles (prob = 5/6)
                    // Turn ends after this roll
                    // ============================================
                    for (let roll2 = 2; roll2 <= 12; roll2++) {
                        const probNonDoubles2 = DICE_PROB[roll2] - DICE_DOUBLES_PROB[roll2];
                        if (probNonDoubles2 <= 0) continue;

                        const landed2 = wrapPosition(pos1 + roll2);
                        processAndAdd(from, landed2, prob1 * probNonDoubles2, false);
                    }

                    // ============================================
                    // PATH B2: Second roll IS doubles (prob = 1/6)
                    // Get to roll a third time
                    // ============================================
                    for (let roll2 = 2; roll2 <= 12; roll2 += 2) {
                        const probDoubles2 = DICE_DOUBLES_PROB[roll2];
                        if (probDoubles2 <= 0) continue;

                        const landed2 = wrapPosition(pos1 + roll2);
                        const continuing2 = processAndAdd(from, landed2, prob1 * probDoubles2, true);

                        // For each position we can continue from after second doubles...
                        for (const c2 of continuing2) {
                            const pos2 = c2.pos;
                            const prob2 = c2.prob;

                            // ============================================
                            // PATH B2a: Third roll is NOT doubles (prob = 5/6)
                            // Turn ends normally
                            // ============================================
                            for (let roll3 = 2; roll3 <= 12; roll3++) {
                                const probNonDoubles3 = DICE_PROB[roll3] - DICE_DOUBLES_PROB[roll3];
                                if (probNonDoubles3 <= 0) continue;

                                const landed3 = wrapPosition(pos2 + roll3);
                                processAndAdd(from, landed3, prob2 * probNonDoubles3, false);
                            }

                            // ============================================
                            // PATH B2b: Third roll IS doubles (prob = 1/6)
                            // TRIPLE DOUBLES = Go to jail!
                            // ============================================
                            for (let roll3 = 2; roll3 <= 12; roll3 += 2) {
                                const probDoubles3 = DICE_DOUBLES_PROB[roll3];
                                if (probDoubles3 <= 0) continue;

                                // Triple doubles - go directly to jail, do not pass go
                                addProb(from, SQUARES.IN_JAIL, prob2 * probDoubles3);
                            }
                        }
                    }
                }
            }
        }

        return T;
    }

    /**
     * Builds the complete transition matrix.
     * All effects (doubles, cards, Go-to-Jail) are now handled in buildDiceTransitions().
     *
     * @returns {number[][]} Complete 40x40 transition matrix
     */
    function buildTransitionMatrix() {
        return buildDiceTransitions();
    }

    // ==========================================================================
    // STEADY STATE CALCULATION
    // ==========================================================================

    /**
     * Computes the steady-state probability distribution using power iteration.
     * The steady-state vector π satisfies: π = π * T
     *
     * @param {number[][]} T - Transition matrix
     * @param {number} maxIterations - Maximum iterations for convergence
     * @param {number} tolerance - Convergence tolerance
     * @returns {number[]} Steady-state probability vector
     */
    function computeSteadyState(T, maxIterations = 1000, tolerance = 1e-10) {
        const n = T.length;

        // Start with uniform distribution
        let pi = createVector(n);
        for (let i = 0; i < n; i++) {
            pi[i] = 1 / n;
        }

        for (let iter = 0; iter < maxIterations; iter++) {
            // Compute pi_new = pi * T
            const piNew = createVector(n);

            for (let j = 0; j < n; j++) {
                for (let i = 0; i < n; i++) {
                    piNew[j] += pi[i] * T[i][j];
                }
            }

            // Check convergence
            let maxDiff = 0;
            for (let i = 0; i < n; i++) {
                maxDiff = Math.max(maxDiff, Math.abs(piNew[i] - pi[i]));
            }

            pi = piNew;

            if (maxDiff < tolerance) {
                console.log(`Converged after ${iter + 1} iterations`);
                break;
            }
        }

        // Normalize to ensure sum = 1
        const sum = pi.reduce((a, b) => a + b, 0);
        return pi.map(p => p / sum);
    }

    // ==========================================================================
    // EXTENDED MODEL: JAIL STRATEGIES & DOUBLES
    // ==========================================================================

    /**
     * Extended state space for accurate jail modeling.
     *
     * KEY INSIGHT: In Monopoly, square 10 represents TWO distinct states:
     * - "Just Visiting": A regular board square, you can move normally
     * - "In Jail": You're trapped and must roll doubles or pay/use card to leave
     *
     * To model this correctly, we use an extended state space:
     *
     * States 0-39: Normal board positions (including square 10 as "Just Visiting")
     * State 40: In jail, turn 1 (just arrived)
     * State 41: In jail, turn 2 (failed to roll doubles once)
     * State 42: In jail, turn 3 (must leave this turn)
     *
     * When you "go to jail" (via card, square 30, or triple doubles), you enter state 40.
     * When you're "just visiting" (landed on square 10 normally), you're in state 10.
     *
     * The basic transition matrix uses:
     * - Column 10 for "just visiting" (normal landing)
     * - Column 50 (IN_JAIL marker) for "sent to jail" events
     *
     * For "leave early" strategy: from state 40, you pay $50 and roll normally
     * For "stay" strategy: must roll doubles or wait 3 turns
     */
    function buildExtendedTransitionMatrix(jailStrategy = 'stay') {
        const EXTENDED_SIZE = 43; // 40 board + 3 jail states
        const T = createMatrix(EXTENDED_SIZE, EXTENDED_SIZE);

        // Build basic board transitions
        // Note: basicT is 40x51 (or sparse), column 50 = IN_JAIL marker
        const basicT = buildTransitionMatrix();

        // Copy basic transitions, remapping IN_JAIL (50) to jail state (40)
        for (let from = 0; from < BOARD_SIZE; from++) {
            for (let to = 0; to < BOARD_SIZE; to++) {
                // Normal board transitions (including square 10 = "just visiting")
                T[from][to] = basicT[from][to];
            }
            // Map IN_JAIL marker (column 50) to jail state 40
            if (basicT[from][SQUARES.IN_JAIL]) {
                T[from][40] = basicT[from][SQUARES.IN_JAIL];
            }
        }

        // Handle jail states based on strategy
        if (jailStrategy === 'leave') {
            // "SHORT STAY" - Leave jail immediately by paying $50
            //
            // IMPORTANT: When you PAY to leave jail, you get FULL doubles mechanics!
            // You roll normally from square 10, and if you roll doubles, you roll again.
            // This is different from rolling doubles TO ESCAPE jail (where you just move once).
            //
            // So for "leave" strategy, jail state 40 transitions exactly like square 10
            // would in the basic matrix (with full doubles).

            // Copy transitions from square 10 (Just Visiting) in basic matrix
            // This includes all the doubles mechanics
            for (let to = 0; to < BOARD_SIZE; to++) {
                T[40][to] = basicT[SQUARES.JUST_VISITING][to];
            }
            // If basic matrix sends to IN_JAIL, redirect to jail state 40
            if (basicT[SQUARES.JUST_VISITING][SQUARES.IN_JAIL]) {
                T[40][40] = basicT[SQUARES.JUST_VISITING][SQUARES.IN_JAIL];
            }

            // States 41 and 42 shouldn't be reached in "leave early" strategy
            // (you always pay on turn 1), but set them up for completeness
            for (let to = 0; to < BOARD_SIZE; to++) {
                T[41][to] = basicT[SQUARES.JUST_VISITING][to];
                T[42][to] = basicT[SQUARES.JUST_VISITING][to];
            }
            if (basicT[SQUARES.JUST_VISITING][SQUARES.IN_JAIL]) {
                T[41][40] = basicT[SQUARES.JUST_VISITING][SQUARES.IN_JAIL];
                T[42][40] = basicT[SQUARES.JUST_VISITING][SQUARES.IN_JAIL];
            }

        } else {
            // "LONG STAY" - Stay in jail, try to roll doubles each turn
            //
            // Rules:
            // - Turn 1-2: Roll doubles → move that many spaces, turn ENDS (no extra roll!)
            //             No doubles → stay in jail
            // - Turn 3:   Roll doubles → move that many spaces (free)
            //             No doubles → pay $50 and move that many spaces
            //
            // IMPORTANT: When you roll doubles to ESCAPE jail, you do NOT get another roll!
            // This is different from paying to leave (where doubles = roll again).

            // From jail state 40 (turn 1 in jail)
            T[40][41] = NON_DOUBLES_PROB; // Don't roll doubles → advance to turn 2

            // Roll doubles → get out and move (NO second roll after escaping via doubles)
            for (let roll = 2; roll <= 12; roll += 2) {  // Only even sums can be doubles
                const probDoubles = DICE_DOUBLES_PROB[roll];
                if (probDoubles === 0) continue;

                const landed = wrapPosition(SQUARES.JUST_VISITING + roll);
                const effects = applySquareEffect(landed);

                for (const [dest, prob] of Object.entries(effects)) {
                    const destInt = parseInt(dest);
                    if (destInt === SQUARES.IN_JAIL) {
                        T[40][40] += probDoubles * prob;  // Back to jail
                    } else {
                        T[40][destInt] += probDoubles * prob;
                    }
                }
            }

            // From jail state 41 (turn 2)
            T[41][42] = NON_DOUBLES_PROB; // Don't roll doubles, advance to turn 3
            for (let roll = 2; roll <= 12; roll += 2) {
                const probDoubles = DICE_DOUBLES_PROB[roll];
                if (probDoubles === 0) continue;

                const landed = wrapPosition(SQUARES.JUST_VISITING + roll);
                const effects = applySquareEffect(landed);

                for (const [dest, prob] of Object.entries(effects)) {
                    const destInt = parseInt(dest);
                    if (destInt === SQUARES.IN_JAIL) {
                        T[41][40] += probDoubles * prob;
                    } else {
                        T[41][destInt] += probDoubles * prob;
                    }
                }
            }

            // From jail state 42 (turn 3) - MUST leave this turn
            // - Roll doubles → move free, turn ends (no extra roll)
            // - No doubles → pay $50, move, turn ends (no extra roll)
            // Either way, it's a single move with no doubles bonus
            for (let roll = 2; roll <= 12; roll++) {
                const landed = wrapPosition(SQUARES.JUST_VISITING + roll);
                const effects = applySquareEffect(landed);

                for (const [dest, prob] of Object.entries(effects)) {
                    const destInt = parseInt(dest);
                    if (destInt === SQUARES.IN_JAIL) {
                        T[42][40] += DICE_PROB[roll] * prob;
                    } else {
                        T[42][destInt] += DICE_PROB[roll] * prob;
                    }
                }
            }
        }

        return T;
    }

    /**
     * Computes steady-state with extended jail model.
     * Returns LANDING probabilities for the 40 board squares.
     *
     * Published Monopoly landing probabilities represent:
     * "Given that a turn involves a landing event, what's the probability
     * of landing on each square?"
     *
     * A "landing event" is when you move to a new square. This includes:
     * - Normal movement and landing on any square 0-39
     * - Being SENT to jail (ends at square 10)
     * - Rolling doubles in jail and landing somewhere
     * - Paying to leave jail and landing somewhere
     *
     * A "non-landing turn" is when you're in jail, fail to roll doubles,
     * and stay in jail (for "stay" strategy only).
     *
     * @param {string} jailStrategy - 'stay' or 'leave'
     * @returns {number[]} 40-element LANDING probability vector
     */
    function computeSteadyStateExtended(jailStrategy = 'stay') {
        const T = buildExtendedTransitionMatrix(jailStrategy);
        const pi = computeSteadyState(T);

        // The extended steady state tells us the probability of being in each
        // extended state at the START of a turn.
        //
        // For landing probabilities, we need to compute where we END UP after
        // each turn, weighted by how often we start in each state.
        //
        // From state i, the landing probability at square j is T[i][j].
        // For jail state 40->41 or 41->42 transitions, that's "no landing".

        const result = createVector(BOARD_SIZE);

        // Compute expected landing at each square from all starting states
        for (let from = 0; from < 43; from++) {
            for (let to = 0; to < BOARD_SIZE; to++) {
                result[to] += pi[from] * T[from][to];
            }
            // If we go to jail (state 40) from a BOARD state (0-39), count that as landing on square 10
            // Don't count jail->jail transitions (when you draw jail card while escaping)
            // as those aren't new landing events
            if (from < BOARD_SIZE && T[from][40]) {
                result[SQUARES.JUST_VISITING] += pi[from] * T[from][40];
            }
        }

        // Note: Transitions to states 41, 42 (staying in jail) are NOT landing events
        // Note: Transitions from jail states (40, 41, 42) back to jail state 40 are also
        //       NOT new landing events (you're already at the jail location)

        // Normalize so landing probabilities sum to 1
        const total = result.reduce((a, b) => a + b, 0);
        for (let i = 0; i < BOARD_SIZE; i++) {
            result[i] /= total;
        }

        return result;
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================

    /**
     * Main class for Monopoly probability calculations.
     */
    class MarkovEngine {
        constructor() {
            this._basicMatrix = null;
            this._steadyState = {};
            this._initialized = false;
        }

        /**
         * Initialize the engine and pre-compute probabilities.
         */
        initialize() {
            console.log('MarkovEngine: Computing transition matrices...');

            this._basicMatrix = buildTransitionMatrix();

            // Compute steady states for both strategies
            console.log('MarkovEngine: Computing steady state (stay in jail)...');
            this._steadyState['stay'] = computeSteadyStateExtended('stay');

            console.log('MarkovEngine: Computing steady state (leave jail early)...');
            this._steadyState['leave'] = computeSteadyStateExtended('leave');

            this._initialized = true;
            console.log('MarkovEngine: Initialization complete.');
        }

        /**
         * Get the landing probability for a specific square.
         *
         * @param {number} square - Square index (0-39)
         * @param {string} jailStrategy - 'stay' or 'leave'
         * @returns {number} Probability of landing on that square
         */
        getLandingProbability(square, jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();
            return this._steadyState[jailStrategy][square];
        }

        /**
         * Get all landing probabilities.
         *
         * @param {string} jailStrategy - 'stay' or 'leave'
         * @returns {number[]} Array of 40 probabilities
         */
        getAllProbabilities(jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();
            return [...this._steadyState[jailStrategy]];
        }

        /**
         * Get probabilities sorted by frequency (highest first).
         *
         * @param {string} jailStrategy - 'stay' or 'leave'
         * @returns {Array<{square: number, probability: number, name: string}>}
         */
        getProbabilitiesSorted(jailStrategy = 'stay') {
            if (!this._initialized) this.initialize();

            const probs = this._steadyState[jailStrategy];
            const results = [];

            for (let i = 0; i < BOARD_SIZE; i++) {
                results.push({
                    square: i,
                    probability: probs[i],
                    name: getSquareName(i)
                });
            }

            return results.sort((a, b) => b.probability - a.probability);
        }

        /**
         * Get the transition matrix for analysis.
         * Returns a 40x41 matrix where column 40 is "sent to jail" probability.
         *
         * @returns {number[][]} 40x41 transition matrix
         */
        getTransitionMatrix() {
            if (!this._initialized) this.initialize();
            // Return matrix with columns 0-39 (board) and column 40 = IN_JAIL probability
            return this._basicMatrix.map(row => {
                const result = row.slice(0, BOARD_SIZE);
                result.push(row[SQUARES.IN_JAIL] || 0);  // Add jail probability as column 40
                return result;
            });
        }

        /**
         * Verify that the matrix is stochastic (rows sum to 1).
         * Note: Matrix has 51 columns (0-39 for board, 50 for IN_JAIL marker)
         */
        verifyMatrix() {
            if (!this._initialized) this.initialize();

            let valid = true;
            for (let i = 0; i < BOARD_SIZE; i++) {
                // Sum columns 0-39 and column 50 (IN_JAIL)
                let sum = 0;
                for (let j = 0; j < BOARD_SIZE; j++) {
                    sum += this._basicMatrix[i][j];
                }
                sum += this._basicMatrix[i][SQUARES.IN_JAIL] || 0;  // Add IN_JAIL column
                if (Math.abs(sum - 1) > 1e-10) {
                    console.warn(`Row ${i} sums to ${sum}`);
                    valid = false;
                }
            }
            return valid;
        }
    }

    // ==========================================================================
    // UTILITY: Square Names
    // ==========================================================================

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

    function getSquareName(index) {
        return SQUARE_NAMES[index] || `Square ${index}`;
    }

    // ==========================================================================
    // EXPORTS
    // ==========================================================================

    return {
        MarkovEngine,
        SQUARES,
        SQUARE_NAMES,
        getSquareName,

        // Expose constants for testing
        DICE_PROB,
        CHANCE_SQUARES,
        COMMUNITY_CHEST_SQUARES,

        // Expose internals for advanced use
        buildTransitionMatrix,
        computeSteadyState
    };

})();

// Export for Node.js / testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MonopolyMarkov;
}
