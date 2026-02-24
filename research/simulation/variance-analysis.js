/**
 * Variance Analysis Module
 *
 * Computes detailed variance statistics for income sources and
 * provides risk-adjusted decision making for housing timing.
 *
 * Key insight: Early game variance comes from dice income (GO passes, cards).
 * Late game variance comes from rent (high variance when few opponents land).
 *
 * The goal is to understand:
 * 1. How much variance exists in each income source?
 * 2. What's the risk of needing to liquidate houses?
 * 3. When is the optimal time to build?
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

// Try to load Markov engine
let MarkovEngine;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
} catch (e) {
    console.log('Note: Markov engine not available');
}

// =============================================================================
// VARIANCE CALCULATIONS
// =============================================================================

/**
 * Calculate variance statistics for dice-based income (GO, cards)
 *
 * Per turn, a player:
 * - Has P(pass GO) ≈ 0.10 per turn (expect to pass ~every 10 turns)
 * - GO salary = $200
 * - Average card income ≈ $3/turn (from Chance/CC)
 *
 * Expected dice EPT ≈ $38/turn
 * But actual variance is HIGH because GO is lumpy ($200 every ~10 turns)
 */
function calculateDiceIncomeVariance() {
    // Probability of passing GO on any given turn
    // Average roll is 7, board is 40 squares
    // P(pass GO) ≈ 1 - (1 - 7/40)^1 ≈ 0.175 per roll
    // But with doubles, average moves per turn ≈ 8.17
    // So P(pass GO) ≈ 8.17/40 ≈ 0.20 per turn

    const pPassGo = 0.20;
    const goSalary = 200;

    // Expected value per turn
    const expectedGoIncome = pPassGo * goSalary;  // $40

    // Variance of GO income (Bernoulli)
    // Var = p(1-p) * amount^2
    const varianceGo = pPassGo * (1 - pPassGo) * goSalary * goSalary;
    const stdDevGo = Math.sqrt(varianceGo);

    // Card income is more complex but roughly:
    // P(Chance) ≈ 3/40 = 0.075, P(CC) ≈ 3/40 = 0.075
    // Average card value ≈ +$20 (mix of gains and losses)
    const expectedCardIncome = 0.15 * 20;  // ~$3/turn
    const varianceCard = 0.15 * 0.85 * 50 * 50;  // Rough estimate
    const stdDevCard = Math.sqrt(varianceCard);

    return {
        expectedPerTurn: expectedGoIncome + expectedCardIncome,
        variancePerTurn: varianceGo + varianceCard,
        stdDevPerTurn: Math.sqrt(varianceGo + varianceCard),
        components: {
            go: { expected: expectedGoIncome, stdDev: stdDevGo },
            cards: { expected: expectedCardIncome, stdDev: stdDevCard }
        },
        // 95% confidence interval for dice income over N turns
        confidenceInterval: (turns) => {
            const expected = (expectedGoIncome + expectedCardIncome) * turns;
            const stdDev = Math.sqrt((varianceGo + varianceCard) * turns);
            return {
                expected,
                low: expected - 1.96 * stdDev,
                high: expected + 1.96 * stdDev
            };
        }
    };
}

/**
 * Calculate variance statistics for rent income from a monopoly
 *
 * Rent income is highly variable because:
 * - Each opponent has small P(landing) ≈ 2.5-3% per square
 * - With 3 squares and 3 opponents, E[landings/turn] ≈ 0.27
 * - So most turns = $0 rent, occasional big payoff
 */
function calculateRentVariance(group, houses, numOpponents, markovProbs) {
    const groupInfo = COLOR_GROUPS[group];
    if (!groupInfo) return null;

    const squares = groupInfo.squares;

    // Calculate per-square landing probability and rent
    let totalExpectedRent = 0;
    let rentValues = [];  // For variance calculation

    for (const sq of squares) {
        const prob = markovProbs ? markovProbs[sq] : 0.025;
        const rent = houses === 0
            ? BOARD[sq].rent[0] * 2  // Monopoly bonus
            : BOARD[sq].rent[Math.min(houses, 5)];

        // Each opponent independently has prob of landing
        // Expected rent from this square = prob * rent * numOpponents
        totalExpectedRent += prob * rent * numOpponents;

        rentValues.push({ prob, rent });
    }

    // Calculate variance
    // For each opponent, for each square: variance = p(1-p) * rent^2
    // Total variance = sum over all (opponent, square) pairs
    let totalVariance = 0;
    for (const { prob, rent } of rentValues) {
        // Each opponent contributes independently
        const squareVariance = prob * (1 - prob) * rent * rent;
        totalVariance += squareVariance * numOpponents;
    }

    const stdDev = Math.sqrt(totalVariance);

    // Coefficient of variation (CV) = stdDev / mean
    // Higher CV = more variable relative to expected value
    const cv = totalExpectedRent > 0 ? stdDev / totalExpectedRent : Infinity;

    return {
        group,
        houses,
        numOpponents,
        expectedPerTurn: totalExpectedRent,
        variancePerTurn: totalVariance,
        stdDevPerTurn: stdDev,
        coefficientOfVariation: cv,
        // Probability of getting $0 rent this turn
        pZeroRent: Math.pow(1 - rentValues.reduce((sum, v) => sum + v.prob, 0), numOpponents),
        // 95% CI over N turns
        confidenceInterval: (turns) => {
            const expected = totalExpectedRent * turns;
            const stdDev = Math.sqrt(totalVariance * turns);
            return {
                expected,
                low: Math.max(0, expected - 1.96 * stdDev),
                high: expected + 1.96 * stdDev
            };
        }
    };
}

/**
 * Calculate the risk of needing to liquidate (sell houses/mortgage)
 *
 * This happens when:
 * 1. Opponent has developed property
 * 2. You land on it
 * 3. Rent > your cash
 *
 * We can compute this using Markov probabilities!
 */
function calculateLiquidationRisk(player, state, markovProbs) {
    const opponents = state.players.filter(p => p.id !== player.id && !p.bankrupt);
    const playerCash = player.money;

    let totalLiquidationProb = 0;
    let expectedLiquidationCost = 0;
    let maxPossibleRent = 0;

    // For each opponent's developed property
    for (const opponent of opponents) {
        for (const propIdx of opponent.properties) {
            const propState = state.propertyStates[propIdx];
            if (propState.mortgaged) continue;

            const square = BOARD[propIdx];
            let rent = 0;

            // Calculate rent
            if (square.rent) {
                if (propState.houses > 0) {
                    rent = square.rent[propState.houses];
                } else if (square.group && opponent.hasMonopoly(square.group, state)) {
                    rent = square.rent[0] * 2;
                } else {
                    rent = square.rent[0];
                }
            } else if (square.type === 'railroad') {
                const rrCount = opponent.getRailroadCount();
                rent = [0, 25, 50, 100, 200][rrCount];
            } else if (square.type === 'utility') {
                const utilCount = opponent.getUtilityCount();
                rent = utilCount === 2 ? 70 : 28;  // Average dice roll * multiplier
            }

            if (rent === 0) continue;

            const landingProb = markovProbs ? markovProbs[propIdx] : 0.025;

            if (rent > playerCash) {
                // This would force liquidation
                totalLiquidationProb += landingProb;
                expectedLiquidationCost += landingProb * (rent - playerCash);
            }

            maxPossibleRent = Math.max(maxPossibleRent, rent);
        }
    }

    // Also consider taxes and cards
    // Income tax = $200, luxury tax = $100
    const taxRisk = 0.05 * (playerCash < 200 ? 1 : 0);  // Rough estimate

    return {
        totalLiquidationProb: Math.min(1, totalLiquidationProb + taxRisk),
        expectedLiquidationCost,
        maxPossibleRent,
        safetyMargin: playerCash - maxPossibleRent,
        recommendation: playerCash > maxPossibleRent * 1.5 ? 'safe_to_build' :
            playerCash > maxPossibleRent ? 'caution' : 'hold_cash'
    };
}

/**
 * Calculate optimal building timing based on opponent positions
 *
 * Key insight: If an opponent is N squares away, they have a specific
 * probability distribution of landing on your monopoly THIS TURN.
 *
 * The SWEET SPOT is 6-8 squares away - that's where dice probability peaks!
 * - 7 is most common roll (6 ways to roll it)
 * - 6 and 8 are second most common (5 ways each)
 *
 * Build when opponents are in the sweet spot AND you have cash buffer.
 * DON'T build right after they pass (they're 30+ squares away).
 */
function calculateBuildTiming(player, state, group, markovEngine) {
    const opponents = state.players.filter(p => p.id !== player.id && !p.bankrupt);
    const groupInfo = COLOR_GROUPS[group];
    if (!groupInfo) return null;

    const groupSquares = groupInfo.squares;
    const housePrice = BOARD[groupSquares[0]].housePrice;
    const minGroupPos = Math.min(...groupSquares);
    const maxGroupPos = Math.max(...groupSquares);

    // Single-roll probability distribution (ignoring doubles for simplicity)
    // P(roll N) = (6 - |N-7|) / 36 for N in [2,12]
    const rollProb = (n) => n >= 2 && n <= 12 ? (6 - Math.abs(n - 7)) / 36 : 0;

    const results = [];

    for (const opponent of opponents) {
        const oppPos = opponent.position;

        // Calculate distance to each property in the group (accounting for board wrap)
        let pLandOnGroup = 0;
        let bestDistance = Infinity;

        for (const targetSq of groupSquares) {
            // Distance on a circular board
            let distance = (targetSq - oppPos + 40) % 40;
            if (distance === 0) distance = 40;  // Already on it means full lap

            bestDistance = Math.min(bestDistance, distance);

            // P(landing on this square this roll)
            // Simplified: just use dice probability for that distance
            // Real calculation would include doubles chains, but this is close enough
            if (distance >= 2 && distance <= 12) {
                pLandOnGroup += rollProb(distance);
            }
        }

        // Classify position based on distance to nearest group property
        let positionStatus;
        let urgency = 0;

        if (bestDistance >= 5 && bestDistance <= 9) {
            // SWEET SPOT! High probability of landing
            positionStatus = 'sweet_spot';
            urgency = 3;
        } else if (bestDistance >= 2 && bestDistance <= 12) {
            // In range but not optimal
            positionStatus = 'in_range';
            urgency = 2;
        } else if (bestDistance >= 13 && bestDistance <= 20) {
            // Could land with doubles
            positionStatus = 'approaching';
            urgency = 1;
        } else {
            // Far away - just passed or other side of board
            positionStatus = 'distant';
            urgency = 0;
        }

        results.push({
            opponentId: opponent.id,
            opponentPosition: oppPos,
            distanceToGroup: bestDistance,
            pLandOnGroup,
            positionStatus,
            urgency,
            expectedRentIfBuilt: pLandOnGroup * BOARD[groupSquares[0]].rent[3]  // Assume 3 houses
        });
    }

    // Calculate aggregate metrics
    const totalPLand = results.reduce((sum, r) => sum + r.pLandOnGroup, 0);
    const sweetSpotCount = results.filter(r => r.positionStatus === 'sweet_spot').length;
    const inRangeCount = results.filter(r => r.urgency >= 2).length;
    const maxUrgency = Math.max(...results.map(r => r.urgency));

    // Check our liquidation risk
    const liquidationRisk = calculateLiquidationRisk(player, state, null);

    let recommendation;
    let reasoning;

    // TUNED: Be more aggressive about building
    // The old logic was too conservative, causing games to drag on

    if (liquidationRisk.recommendation === 'hold_cash' && player.money < housePrice) {
        // Only wait if we literally can't afford to pay AND can't buy
        recommendation = 'wait';
        reasoning = 'Very high liquidation risk - hold cash for safety';
    } else if (sweetSpotCount >= 1) {
        // Even 1 opponent in sweet spot is enough to build aggressively
        recommendation = 'build_now';
        reasoning = `${sweetSpotCount} opponent(s) in sweet spot (5-9 squares away) - BUILD!`;
    } else if (totalPLand > 0.10) {
        // Lower threshold - 10% combined chance is good enough
        recommendation = 'build_now';
        reasoning = `Good combined landing probability (${(totalPLand * 100).toFixed(1)}%)`;
    } else if (maxUrgency >= 1 || player.money > housePrice * 2) {
        // If ANY opponent is approaching OR we have buffer - build cautiously
        recommendation = 'build_cautiously';
        reasoning = 'Some opponents approaching or have buffer - build moderately';
    } else {
        // Default to cautious building instead of waiting
        recommendation = 'build_cautiously';
        reasoning = 'Default: better to build than hoard cash';
    }

    return {
        group,
        currentCash: player.money,
        housePrice,
        opponentAnalysis: results,
        totalLandingProbability: totalPLand,
        sweetSpotOpponents: sweetSpotCount,
        inRangeOpponents: inRangeCount,
        liquidationRisk: liquidationRisk.recommendation,
        recommendation,
        reasoning
    };
}

// =============================================================================
// VARIANCE TRACKING FOR ANALYTICS
// =============================================================================

/**
 * Track actual vs expected income each turn for variance analysis
 */
class VarianceTracker {
    constructor(numPlayers) {
        this.numPlayers = numPlayers;

        // Per-player tracking
        this.playerData = [];
        for (let i = 0; i < numPlayers; i++) {
            this.playerData.push({
                // Cumulative expected vs actual
                expectedDiceIncome: 0,
                actualDiceIncome: 0,
                expectedRentIncome: 0,
                actualRentIncome: 0,

                // Per-turn samples for variance calculation
                diceIncomeSamples: [],
                rentIncomeSamples: [],

                // Track GO passes
                goPasses: 0,

                // Track rent events
                rentEvents: [],  // { turn, amount, from }

                // Track forced sales
                forcedSales: [],  // { turn, housesLost, valueLost }
            });
        }

        this.currentTurn = 0;
    }

    /**
     * Record a GO salary collection
     */
    recordGoPass(playerId) {
        this.playerData[playerId].goPasses++;
        this.playerData[playerId].actualDiceIncome += 200;
    }

    /**
     * Record rent collection
     */
    recordRent(toPlayerId, fromPlayerId, amount) {
        this.playerData[toPlayerId].actualRentIncome += amount;
        this.playerData[toPlayerId].rentEvents.push({
            turn: this.currentTurn,
            amount,
            from: fromPlayerId
        });
    }

    /**
     * Record a forced house sale
     */
    recordForcedSale(playerId, housesLost, valueLost) {
        this.playerData[playerId].forcedSales.push({
            turn: this.currentTurn,
            housesLost,
            valueLost
        });
    }

    /**
     * Record expected income for this turn (called at turn start)
     */
    recordExpectedIncome(playerId, expectedDice, expectedRent) {
        this.playerData[playerId].expectedDiceIncome += expectedDice;
        this.playerData[playerId].expectedRentIncome += expectedRent;
    }

    /**
     * End of turn - record samples
     */
    endTurn(playerId, actualDiceThisTurn, actualRentThisTurn) {
        this.playerData[playerId].diceIncomeSamples.push(actualDiceThisTurn);
        this.playerData[playerId].rentIncomeSamples.push(actualRentThisTurn);
    }

    /**
     * Calculate variance statistics
     */
    getVarianceStats(playerId) {
        const data = this.playerData[playerId];

        const calcVariance = (samples) => {
            if (samples.length < 2) return 0;
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            const squaredDiffs = samples.map(x => Math.pow(x - mean, 2));
            return squaredDiffs.reduce((a, b) => a + b, 0) / (samples.length - 1);
        };

        const diceVariance = calcVariance(data.diceIncomeSamples);
        const rentVariance = calcVariance(data.rentIncomeSamples);

        return {
            diceIncome: {
                expected: data.expectedDiceIncome,
                actual: data.actualDiceIncome,
                variance: diceVariance,
                stdDev: Math.sqrt(diceVariance),
                goPasses: data.goPasses
            },
            rentIncome: {
                expected: data.expectedRentIncome,
                actual: data.actualRentIncome,
                variance: rentVariance,
                stdDev: Math.sqrt(rentVariance),
                events: data.rentEvents.length
            },
            forcedSales: {
                count: data.forcedSales.length,
                totalHousesLost: data.forcedSales.reduce((sum, s) => sum + s.housesLost, 0),
                totalValueLost: data.forcedSales.reduce((sum, s) => sum + s.valueLost, 0)
            }
        };
    }
}

// =============================================================================
// RISK-ADJUSTED VALUATION
// =============================================================================

/**
 * Calculate risk-adjusted value (beta-adjusted) for a monopoly
 *
 * Beta represents systematic risk - how much the asset's returns
 * vary with overall "market" (game state) conditions.
 *
 * High beta = high variance = should demand higher return
 */
function calculateBetaAdjustedValue(group, state, markovProbs) {
    const numOpponents = state.players.filter(p => !p.bankrupt).length - 1;
    if (numOpponents === 0) return { value: 0, beta: 1 };

    // Get rent variance for this group
    const rentStats = calculateRentVariance(group, 3, numOpponents, markovProbs);
    if (!rentStats) return { value: 0, beta: 1 };

    // Base EPT value
    const baseEPT = rentStats.expectedPerTurn;

    // Calculate beta based on coefficient of variation
    // CV > 2 is very high variance, CV < 1 is low variance
    // Map to beta: beta = 0.5 + CV * 0.5 (so beta ranges from ~0.5 to ~2.0)
    const beta = 0.5 + Math.min(rentStats.coefficientOfVariation, 3) * 0.5;

    // Risk-adjusted EPT: EPT / beta
    // Higher beta = lower risk-adjusted value
    const riskAdjustedEPT = baseEPT / beta;

    // Calculate NPV with risk adjustment
    const discountRate = 0.015 * beta;  // Higher discount for higher risk
    const horizon = 62;
    let npv = 0;
    for (let t = 1; t <= horizon; t++) {
        npv += riskAdjustedEPT / Math.pow(1 + discountRate, t);
    }

    return {
        group,
        baseEPT,
        coefficientOfVariation: rentStats.coefficientOfVariation,
        beta,
        riskAdjustedEPT,
        npv,
        pZeroRent: rentStats.pZeroRent,
        recommendation: beta > 1.5 ? 'high_risk' : beta > 1.0 ? 'medium_risk' : 'low_risk'
    };
}

/**
 * Compare all monopoly groups by risk-adjusted value
 */
function compareGroupsByRisk(numOpponents = 3, markovProbs = null) {
    const results = [];

    for (const [group, info] of Object.entries(COLOR_GROUPS)) {
        // Create mock state for calculation
        const mockState = {
            players: Array(numOpponents + 1).fill({ bankrupt: false })
        };

        const analysis = calculateBetaAdjustedValue(group, mockState, markovProbs);
        if (analysis.baseEPT > 0) {
            results.push(analysis);
        }
    }

    // Sort by risk-adjusted NPV (best first)
    results.sort((a, b) => b.npv - a.npv);

    return results;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    calculateDiceIncomeVariance,
    calculateRentVariance,
    calculateLiquidationRisk,
    calculateBuildTiming,
    calculateBetaAdjustedValue,
    compareGroupsByRisk,
    VarianceTracker
};

// =============================================================================
// TEST / DEMO
// =============================================================================

/**
 * Visualize landing probability by distance
 * Shows the "sweet spot" for building timing
 */
function visualizeLandingProbability() {
    console.log('\n--- LANDING PROBABILITY BY DISTANCE ---');
    console.log('(Single roll, ignoring doubles)');
    console.log('');

    const rollProb = (n) => n >= 2 && n <= 12 ? (6 - Math.abs(n - 7)) / 36 : 0;

    console.log('Dist  Prob    Bar');
    console.log('-'.repeat(50));

    for (let d = 2; d <= 12; d++) {
        const prob = rollProb(d);
        const barLen = Math.round(prob * 100);
        const bar = '#'.repeat(barLen);
        const marker = (d >= 5 && d <= 9) ? ' <-- SWEET SPOT' : '';
        console.log(`${String(d).padStart(4)}  ${(prob * 100).toFixed(1)}%   ${bar}${marker}`);
    }

    console.log('');
    console.log('Key insight: Build when opponents are 5-9 squares away!');
    console.log('P(land) = 11-17% per opponent in sweet spot');
    console.log('With 3 opponents in sweet spot: ~40% someone lands!');
}

if (require.main === module) {
    console.log('='.repeat(70));
    console.log('VARIANCE ANALYSIS MODULE');
    console.log('='.repeat(70));

    // Initialize Markov engine if available
    let probs = null;
    if (MarkovEngine) {
        console.log('\nInitializing Markov engine...');
        const markov = new MarkovEngine();
        markov.initialize();
        probs = markov.getAllProbabilities('stay');
    }

    // Dice income variance
    console.log('\n--- DICE INCOME VARIANCE ---');
    const diceStats = calculateDiceIncomeVariance();
    console.log(`Expected dice income: $${diceStats.expectedPerTurn.toFixed(0)}/turn`);
    console.log(`Std deviation: $${diceStats.stdDevPerTurn.toFixed(0)}/turn`);
    console.log(`GO component: $${diceStats.components.go.expected.toFixed(0)} ± $${diceStats.components.go.stdDev.toFixed(0)}`);

    const ci10 = diceStats.confidenceInterval(10);
    console.log(`95% CI over 10 turns: $${ci10.low.toFixed(0)} - $${ci10.high.toFixed(0)} (expected $${ci10.expected.toFixed(0)})`);

    // Rent variance by group
    console.log('\n--- RENT VARIANCE BY MONOPOLY GROUP (3 houses, 3 opponents) ---');
    console.log('Group        EPT      StdDev   CV      P($0)   Risk');
    console.log('-'.repeat(60));

    const groups = ['orange', 'red', 'yellow', 'darkBlue', 'green', 'lightBlue', 'pink', 'brown'];
    for (const group of groups) {
        const stats = calculateRentVariance(group, 3, 3, probs);
        if (stats) {
            const riskLevel = stats.coefficientOfVariation > 2 ? 'HIGH' :
                stats.coefficientOfVariation > 1 ? 'MED' : 'LOW';
            console.log(
                `${group.padEnd(12)} $${stats.expectedPerTurn.toFixed(0).padStart(5)}   ` +
                `$${stats.stdDevPerTurn.toFixed(0).padStart(5)}   ` +
                `${stats.coefficientOfVariation.toFixed(2).padStart(5)}   ` +
                `${(stats.pZeroRent * 100).toFixed(0).padStart(4)}%   ${riskLevel}`
            );
        }
    }

    // Risk-adjusted comparison
    console.log('\n--- RISK-ADJUSTED VALUE COMPARISON ---');
    console.log('Group        BaseEPT  Beta   RiskAdj  NPV       Risk');
    console.log('-'.repeat(65));

    const comparison = compareGroupsByRisk(3, probs);
    for (const item of comparison) {
        console.log(
            `${item.group.padEnd(12)} $${item.baseEPT.toFixed(0).padStart(5)}   ` +
            `${item.beta.toFixed(2).padStart(4)}   ` +
            `$${item.riskAdjustedEPT.toFixed(0).padStart(5)}   ` +
            `$${item.npv.toFixed(0).padStart(6)}   ${item.recommendation}`
        );
    }

    console.log('\n--- KEY INSIGHTS ---');
    console.log('1. All monopolies have CV > 1, meaning rent is highly variable');
    console.log('2. P($0 rent) is 75-88% per turn - most turns you collect nothing!');
    console.log('3. Orange has lower variance (more consistent income) than DarkBlue');
    console.log('4. Risk-adjusted NPV may favor lower-variance groups over raw EPT');

    // Show landing probability visualization
    visualizeLandingProbability();

    console.log('\n' + '='.repeat(70));
}
