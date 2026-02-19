/**
 * Dynamic Trade Valuator
 *
 * Trade valuations that adapt to game state:
 * - Cash positions (yours and opponents')
 * - Game phase (turns played, properties remaining)
 * - Existing development levels
 * - Liquidity requirements
 *
 * Key insight: The "right" trade depends heavily on context.
 * A simulation-based approach can tune the weightings.
 */

const MonopolyMarkov = require('./markov-engine.js');
const PropertyValuator = require('./property-valuator.js');

// Initialize engines
console.log('================================================================================');
console.log('DYNAMIC TRADE VALUATOR: Game-State Aware Valuations');
console.log('================================================================================\n');

const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

const probs = markov.getAllProbabilities('stay');

// =============================================================================
// GAME STATE MODEL
// =============================================================================

/**
 * Represents current game state for valuation purposes
 */
class GameState {
    constructor(options = {}) {
        // Game phase indicators
        this.turnsPlayed = options.turnsPlayed || 0;
        this.propertiesRemaining = options.propertiesRemaining || 28;  // Unpurchased properties

        // Player state (for the player considering the trade)
        this.myCash = options.myCash || 1500;
        this.myProperties = options.myProperties || [];  // Array of square indices
        this.myHouses = options.myHouses || 0;
        this.myHotels = options.myHotels || 0;

        // Opponent state (aggregate or individual)
        this.opponentCash = options.opponentCash || 1500;  // Average opponent cash
        this.opponentMonopolies = options.opponentMonopolies || 0;
        this.opponentHouses = options.opponentHouses || 0;

        // Number of players still in game
        this.playerCount = options.playerCount || 4;
    }

    /**
     * Estimate game phase: 'early', 'mid', 'late'
     */
    getPhase() {
        if (this.turnsPlayed < 15 || this.propertiesRemaining > 20) {
            return 'early';
        } else if (this.turnsPlayed < 40 || this.propertiesRemaining > 10) {
            return 'mid';
        } else {
            return 'late';
        }
    }

    /**
     * Estimate urgency level (0-1)
     * Higher urgency = need income NOW, favor ROI over EPT ceiling
     */
    getUrgency() {
        // Factors that increase urgency:
        // - Low cash relative to opponents
        // - Opponents have developed monopolies
        // - Late game with no income

        const cashRatio = this.myCash / (this.opponentCash + 100);  // +100 to avoid division by zero
        const threatLevel = this.opponentMonopolies * 0.2 + this.opponentHouses * 0.02;
        const myIncome = this.myHouses * 0.1 + this.myHotels * 0.15;

        // Urgency increases when cash is low and threats are high
        let urgency = 0.5;  // Base urgency

        if (cashRatio < 0.5) urgency += 0.3;
        else if (cashRatio < 1.0) urgency += 0.1;
        else if (cashRatio > 2.0) urgency -= 0.2;

        urgency += threatLevel * 0.5;
        urgency -= myIncome * 0.3;

        return Math.max(0, Math.min(1, urgency));
    }

    /**
     * Estimate development potential (how many houses can be afforded)
     */
    getDevelopmentPotential() {
        // Rough estimate: each house costs ~$100-200
        const avgHouseCost = 125;
        const liquidCash = Math.max(0, this.myCash - 200);  // Keep $200 reserve
        return Math.floor(liquidCash / avgHouseCost);
    }
}

// =============================================================================
// GROUP DATA
// =============================================================================

const groups = {
    brown: { name: 'Brown', squares: [1, 3], housePrice: 50 },
    lightBlue: { name: 'Light Blue', squares: [6, 8, 9], housePrice: 50 },
    pink: { name: 'Pink', squares: [11, 13, 14], housePrice: 100 },
    orange: { name: 'Orange', squares: [16, 18, 19], housePrice: 100 },
    red: { name: 'Red', squares: [21, 23, 24], housePrice: 150 },
    yellow: { name: 'Yellow', squares: [26, 27, 29], housePrice: 150 },
    green: { name: 'Green', squares: [31, 32, 34], housePrice: 200 },
    darkBlue: { name: 'Dark Blue', squares: [37, 39], housePrice: 200 }
};

function getGroupEPT(color, houseLevel) {
    const group = groups[color];
    if (!group) return 0;
    let ept = 0;
    for (const sq of group.squares) {
        ept += PropertyValuator.calculatePropertyEPT(sq, probs[sq], houseLevel, true);
    }
    return ept;
}

function getBuildingCost(color, houseLevel) {
    const group = groups[color];
    if (!group) return 0;
    return group.squares.length * group.housePrice * houseLevel;
}

function getPropertyCost(color) {
    const group = groups[color];
    if (!group) return 0;
    let cost = 0;
    for (const sq of group.squares) {
        cost += PropertyValuator.PROPERTIES[sq].price;
    }
    return cost;
}

// =============================================================================
// DYNAMIC VALUATION
// =============================================================================

/**
 * Calculate the "effective value" of a monopoly given game state.
 *
 * This blends:
 * - ROI value (favored when cash is tight or urgency is high)
 * - EPT ceiling value (favored when cash is abundant)
 * - Liquidity value (having cash reserves)
 *
 * @param {string} color - Color group
 * @param {GameState} gameState - Current game state
 * @returns {Object} Valuation breakdown
 */
function calculateDynamicValue(color, gameState) {
    const urgency = gameState.getUrgency();
    const phase = gameState.getPhase();
    const devPotential = gameState.getDevelopmentPotential();

    // Calculate achievable EPT given cash constraints
    const housesAffordable = Math.min(5, Math.floor(gameState.myCash / getBuildingCost(color, 1)) || 0);
    const targetLevel = Math.min(housesAffordable, 3);  // Usually aim for 3 houses

    const achievableEPT = getGroupEPT(color, targetLevel);
    const achievableCost = getBuildingCost(color, targetLevel);
    const achievableROI = achievableCost > 0 ? achievableEPT / achievableCost : 0;

    // Maximum potential EPT (at hotels)
    const maxEPT = getGroupEPT(color, 5);
    const maxCost = getBuildingCost(color, 5);

    // Calculate weighted value
    // High urgency → weight ROI more
    // Low urgency (cash rich) → weight EPT ceiling more

    const roiWeight = 0.3 + urgency * 0.4;  // 0.3 to 0.7
    const eptWeight = 0.4 - urgency * 0.2;  // 0.4 to 0.2
    const ceilingWeight = 0.3 - urgency * 0.2;  // 0.3 to 0.1

    // Normalize EPT and ROI to comparable scales
    // EPT: $0-100/turn → normalize to 0-100
    // ROI: 0-10% → normalize to 0-100

    const normalizedAchievableEPT = achievableEPT;  // Already in good range
    const normalizedROI = achievableROI * 1000;  // 5% → 50
    const normalizedCeiling = maxEPT;  // Max EPT potential

    const weightedValue =
        roiWeight * normalizedROI +
        eptWeight * normalizedAchievableEPT +
        ceilingWeight * normalizedCeiling;

    return {
        color,
        name: groups[color].name,
        gamePhase: phase,
        urgency: urgency.toFixed(2),

        // Achievable metrics
        targetLevel,
        achievableEPT,
        achievableCost,
        achievableROI,

        // Potential metrics
        maxEPT,
        maxCost,

        // Weighted value
        weights: { roi: roiWeight.toFixed(2), ept: eptWeight.toFixed(2), ceiling: ceilingWeight.toFixed(2) },
        weightedValue
    };
}

/**
 * Calculate fair trade value between two monopolies given game state.
 *
 * @param {string} giving - Color being given away
 * @param {string} receiving - Color being received
 * @param {GameState} gameState - Current game state
 * @returns {Object} Trade analysis with recommended cash adjustment
 */
function calculateDynamicTrade(giving, receiving, gameState) {
    const givingValue = calculateDynamicValue(giving, gameState);
    const receivingValue = calculateDynamicValue(receiving, gameState);

    // Value difference determines cash adjustment
    const valueDiff = givingValue.weightedValue - receivingValue.weightedValue;

    // Convert value difference to cash
    // This scaling factor could be tuned via simulation
    const cashPerValuePoint = 10;  // $10 per point of value difference
    const recommendedCash = Math.round(valueDiff * cashPerValuePoint);

    return {
        giving: givingValue,
        receiving: receivingValue,
        valueDifference: valueDiff,
        recommendedCashAdjustment: recommendedCash,
        interpretation: recommendedCash > 0
            ? `Demand $${recommendedCash} cash with ${groups[receiving].name}`
            : recommendedCash < 0
                ? `Pay $${Math.abs(recommendedCash)} cash for ${groups[receiving].name}`
                : 'Even trade'
    };
}

// =============================================================================
// SCENARIO ANALYSIS
// =============================================================================

console.log('SCENARIO ANALYSIS: How Game State Affects Trade Values');
console.log('================================================================================\n');

// Scenario 1: Early game, both players cash-rich
const scenario1 = new GameState({
    turnsPlayed: 10,
    propertiesRemaining: 24,
    myCash: 1200,
    opponentCash: 1200,
    opponentMonopolies: 0,
    playerCount: 4
});

console.log('SCENARIO 1: Early Game, Cash Rich');
console.log('─'.repeat(60));
console.log(`  Turns: ${scenario1.turnsPlayed}, Cash: $${scenario1.myCash}, Phase: ${scenario1.getPhase()}`);
console.log(`  Urgency: ${scenario1.getUrgency().toFixed(2)} (low = favor EPT ceiling)\n`);

const trade1 = calculateDynamicTrade('orange', 'green', scenario1);
console.log(`  Orange → Green Trade:`);
console.log(`    Orange weighted value: ${trade1.giving.weightedValue.toFixed(1)}`);
console.log(`    Green weighted value:  ${trade1.receiving.weightedValue.toFixed(1)}`);
console.log(`    Recommendation: ${trade1.interpretation}\n`);

// Scenario 2: Mid game, player is cash-poor
const scenario2 = new GameState({
    turnsPlayed: 30,
    propertiesRemaining: 8,
    myCash: 400,
    opponentCash: 1000,
    opponentMonopolies: 1,
    opponentHouses: 6,
    playerCount: 4
});

console.log('\nSCENARIO 2: Mid Game, Cash Poor, Under Threat');
console.log('─'.repeat(60));
console.log(`  Turns: ${scenario2.turnsPlayed}, Cash: $${scenario2.myCash}, Phase: ${scenario2.getPhase()}`);
console.log(`  Urgency: ${scenario2.getUrgency().toFixed(2)} (high = favor ROI)\n`);

const trade2 = calculateDynamicTrade('orange', 'green', scenario2);
console.log(`  Orange → Green Trade:`);
console.log(`    Orange weighted value: ${trade2.giving.weightedValue.toFixed(1)}`);
console.log(`    Green weighted value:  ${trade2.receiving.weightedValue.toFixed(1)}`);
console.log(`    Recommendation: ${trade2.interpretation}\n`);

// Scenario 3: Late game, player is cash-rich
const scenario3 = new GameState({
    turnsPlayed: 50,
    propertiesRemaining: 2,
    myCash: 2500,
    opponentCash: 800,
    opponentMonopolies: 1,
    opponentHouses: 9,
    playerCount: 3
});

console.log('\nSCENARIO 3: Late Game, Cash Rich, Can Develop Fully');
console.log('─'.repeat(60));
console.log(`  Turns: ${scenario3.turnsPlayed}, Cash: $${scenario3.myCash}, Phase: ${scenario3.getPhase()}`);
console.log(`  Urgency: ${scenario3.getUrgency().toFixed(2)} (moderate)\n`);

const trade3 = calculateDynamicTrade('orange', 'green', scenario3);
console.log(`  Orange → Green Trade:`);
console.log(`    Orange weighted value: ${trade3.giving.weightedValue.toFixed(1)}`);
console.log(`    Green weighted value:  ${trade3.receiving.weightedValue.toFixed(1)}`);
console.log(`    Recommendation: ${trade3.interpretation}\n`);

// =============================================================================
// VALUATION SENSITIVITY
// =============================================================================

console.log('\n================================================================================');
console.log('VALUATION SENSITIVITY: Orange vs Green at Different Cash Levels');
console.log('================================================================================\n');

console.log('How trade recommendation changes with available cash:\n');

console.log('My Cash'.padEnd(10) + 'Urgency'.padStart(10) + 'Orange Val'.padStart(12) +
            'Green Val'.padStart(12) + 'Recommendation'.padStart(20));
console.log('─'.repeat(64));

for (const cash of [300, 500, 800, 1000, 1500, 2000, 3000]) {
    const state = new GameState({
        turnsPlayed: 25,
        propertiesRemaining: 12,
        myCash: cash,
        opponentCash: 1000,
        opponentMonopolies: 1,
        playerCount: 4
    });

    const trade = calculateDynamicTrade('orange', 'green', state);

    console.log(
        (`$${cash}`).padEnd(10) +
        state.getUrgency().toFixed(2).padStart(10) +
        trade.giving.weightedValue.toFixed(1).padStart(12) +
        trade.receiving.weightedValue.toFixed(1).padStart(12) +
        trade.interpretation.padStart(20)
    );
}

// =============================================================================
// FULL TRADE MATRIX
// =============================================================================

console.log('\n\n================================================================================');
console.log('FULL TRADE MATRIX: All Color Group Combinations');
console.log('================================================================================\n');

const midGameState = new GameState({
    turnsPlayed: 25,
    propertiesRemaining: 12,
    myCash: 1200,
    opponentCash: 1000,
    playerCount: 4
});

console.log(`Game State: Turn ${midGameState.turnsPlayed}, Cash $${midGameState.myCash}, ` +
            `Urgency ${midGameState.getUrgency().toFixed(2)}\n`);

const colors = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

// Print header
process.stdout.write('Give \\ Get'.padEnd(12));
for (const c of colors) {
    process.stdout.write(groups[c].name.substring(0, 8).padStart(10));
}
console.log('');
console.log('─'.repeat(92));

// Print matrix
for (const giving of colors) {
    process.stdout.write(groups[giving].name.substring(0, 10).padEnd(12));

    for (const receiving of colors) {
        if (giving === receiving) {
            process.stdout.write('---'.padStart(10));
        } else {
            const trade = calculateDynamicTrade(giving, receiving, midGameState);
            const cash = trade.recommendedCashAdjustment;
            const display = cash > 0 ? `+$${cash}` : cash < 0 ? `-$${Math.abs(cash)}` : '$0';
            process.stdout.write(display.padStart(10));
        }
    }
    console.log('');
}

console.log('\n(Positive = demand cash, Negative = pay cash)\n');

// =============================================================================
// SIMULATION HOOKS
// =============================================================================

console.log('\n================================================================================');
console.log('TUNING PARAMETERS (For Simulation Optimization)');
console.log('================================================================================\n');

console.log('The following parameters could be tuned via simulation:\n');

console.log('1. URGENCY CALCULATION:');
console.log('   - cashRatio thresholds: [0.5, 1.0, 2.0]');
console.log('   - threatLevel weighting: opponentMonopolies × 0.2 + houses × 0.02');
console.log('   - incomeEffect weighting: myHouses × 0.1 + hotels × 0.15');
console.log('');

console.log('2. VALUE WEIGHTING:');
console.log('   - roiWeight range: [0.3 + urgency × 0.4]');
console.log('   - eptWeight range: [0.4 - urgency × 0.2]');
console.log('   - ceilingWeight range: [0.3 - urgency × 0.2]');
console.log('');

console.log('3. CASH CONVERSION:');
console.log('   - cashPerValuePoint: $10 (how much cash per point of value difference)');
console.log('');

console.log('4. LIQUIDITY PREMIUM:');
console.log('   - reserveCash: $200 (minimum cash to keep in reserve)');
console.log('   - liquidityDiscount: how much to discount properties that require');
console.log('     more cash to develop');
console.log('');

console.log('SIMULATION APPROACH:');
console.log('─'.repeat(60));
console.log('1. Generate game states at various phases');
console.log('2. For each state, simulate N games with different trade decisions');
console.log('3. Measure win rate / final position for each trade choice');
console.log('4. Use results to adjust weighting parameters');
console.log('5. Iterate until parameters stabilize');

// =============================================================================
// EXPORT FOR USE IN SIMULATIONS
// =============================================================================

console.log('\n\n================================================================================');
console.log('DYNAMIC VALUATION COMPLETE');
console.log('================================================================================\n');

// Export classes and functions for simulation use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GameState,
        calculateDynamicValue,
        calculateDynamicTrade,
        groups,
        getGroupEPT,
        getBuildingCost,
        getPropertyCost
    };
}
