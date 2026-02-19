/**
 * Variant AIs for Comparative Testing
 *
 * These AIs isolate specific improvements to measure their individual impact:
 *
 * 1. TimingAwareAI - Position-based build timing (sweet spot detection)
 * 2. RiskAwareAI - Beta-adjusted valuation for trades
 * 3. ReserveAwareAI - Dynamic cash reserves based on opponent threat
 * 4. FullVarianceAI - All three factors combined
 *
 * Each extends RelativeGrowthAI to ensure fair comparison.
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');
const {
    calculateBuildTiming,
    calculateLiquidationRisk,
    calculateRentVariance,
    calculateBetaAdjustedValue
} = require('./variance-analysis.js');

// =============================================================================
// 1. TIMING-AWARE AI
// =============================================================================

/**
 * TimingAwareAI - Supplemental timing-based building
 *
 * NEW APPROACH: Don't replace the baseline building logic, SUPPLEMENT it!
 * - Use parent's buildOptimalHouses() as the default
 * - When opponents are in the "sweet spot" (5-9 squares away), build MORE aggressively
 *   by reducing the reserve requirement
 *
 * This should make us MORE aggressive when timing is good, not less aggressive overall.
 */
class TimingAwareAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'TimingAwareAI';
    }

    /**
     * Override getMinReserve to be timing-aware
     * When opponents are in sweet spot, reduce reserve to build more aggressively
     */
    getMinReserve(state) {
        const baseReserve = super.getMinReserve(state);

        // Check if any opponent is in sweet spot for any of our monopolies
        const monopolies = this.getMyMonopolies(state);
        if (monopolies.length === 0) return baseReserve;

        let sweetSpotCount = 0;
        for (const group of monopolies) {
            const timing = calculateBuildTiming(this.player, state, group, this.markovEngine);
            if (timing && timing.sweetSpotOpponents > 0) {
                sweetSpotCount += timing.sweetSpotOpponents;
            }
        }

        // If opponents are in sweet spot, reduce reserve to build more!
        if (sweetSpotCount >= 2) {
            return Math.max(50, baseReserve * 0.25);  // Very aggressive
        } else if (sweetSpotCount === 1) {
            return Math.max(75, baseReserve * 0.5);   // Moderately aggressive
        }

        return baseReserve;
    }
}

// =============================================================================
// 2. RISK-AWARE AI
// =============================================================================

/**
 * RiskAwareAI - Only change: beta-adjusted trade valuation
 *
 * When evaluating trades, applies a risk penalty to high-variance monopolies.
 * This should favor Orange over DarkBlue when they're close in raw EPT.
 */
class RiskAwareAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'RiskAwareAI';

        // Risk adjustment parameters
        this.riskPenaltyMultiplier = 0.15;  // How much to penalize high-variance groups
    }

    /**
     * Override: Calculate position with risk adjustment
     */
    calculatePosition(player, state) {
        // Get base position from parent
        let position = super.calculatePosition(player, state);

        // Apply risk adjustment based on monopoly variance
        // Find monopolies by checking property ownership
        const monopolies = [];
        for (const [group, info] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = info.squares.every(sq =>
                state.propertyStates[sq]?.owner === player.id
            );
            if (ownsAll) monopolies.push(group);
        }

        for (const group of monopolies) {
            const riskAnalysis = calculateBetaAdjustedValue(group, state, this.probs);
            if (riskAnalysis && riskAnalysis.beta > 1.0) {
                // Apply penalty proportional to beta
                // Higher beta = higher variance = lower adjusted value
                const penalty = (riskAnalysis.beta - 1.0) * riskAnalysis.baseEPT *
                    this.projectionHorizon * this.riskPenaltyMultiplier;
                position -= penalty;
            }
        }

        return position;
    }

    /**
     * Override: Evaluate trade with risk-adjusted values
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        // Check what monopolies would be created by this trade
        const myMonopoliesAfter = this.getMonopoliesAfterTrade(offer, state, this.player.id);
        const theirMonopoliesAfter = this.getMonopoliesAfterTrade(offer, state, from.id);

        // Calculate risk-adjusted value of monopolies
        let myRiskAdjustedGain = 0;
        let theirRiskAdjustedGain = 0;

        for (const group of myMonopoliesAfter) {
            const riskAnalysis = calculateBetaAdjustedValue(group, state, this.probs);
            if (riskAnalysis) {
                myRiskAdjustedGain += riskAnalysis.npv;
            }
        }

        for (const group of theirMonopoliesAfter) {
            const riskAnalysis = calculateBetaAdjustedValue(group, state, this.probs);
            if (riskAnalysis) {
                theirRiskAdjustedGain += riskAnalysis.npv;
            }
        }

        // Use parent's position-based evaluation but with risk-adjusted values
        // This is a simplified version - full implementation would override more
        return super.evaluateTrade(offer, state);
    }

    /**
     * Helper: Get monopolies that would exist after a trade
     */
    getMonopoliesAfterTrade(offer, state, playerId) {
        const { from, to, fromProperties, toProperties } = offer;

        // Simulate the trade
        const playerProps = new Set(state.players[playerId].properties);

        if (playerId === from.id) {
            // Giving away fromProperties, receiving toProperties
            for (const p of fromProperties) playerProps.delete(p);
            for (const p of toProperties) playerProps.add(p);
        } else if (playerId === to.id) {
            // Receiving fromProperties, giving away toProperties
            for (const p of fromProperties) playerProps.add(p);
            for (const p of toProperties) playerProps.delete(p);
        }

        // Check which monopolies would be complete
        const monopolies = [];
        for (const [group, info] of Object.entries(COLOR_GROUPS)) {
            if (info.squares.every(sq => playerProps.has(sq))) {
                monopolies.push(group);
            }
        }

        return monopolies;
    }
}

// =============================================================================
// 3. RESERVE-AWARE AI
// =============================================================================

/**
 * ReserveAwareAI - Dynamic cash reserves
 *
 * NEW APPROACH: Use dynamic reserves to REDUCE reserve when opponents
 * don't have much development (safe to build more) and INCREASE reserve
 * only when there's genuine liquidation risk.
 *
 * The baseline reserve ($150-200) is often too conservative early
 * and not conservative enough late. Let's be smarter about it.
 */
class ReserveAwareAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'ReserveAwareAI';
    }

    /**
     * Override getMinReserve with dynamic calculation
     */
    getMinReserve(state) {
        const liquidationRisk = calculateLiquidationRisk(this.player, state, this.probs);

        // If max possible rent is low, we can afford to build more aggressively
        if (liquidationRisk.maxPossibleRent < 200) {
            return 50;  // Very aggressive - opponents have little development
        } else if (liquidationRisk.maxPossibleRent < 500) {
            return 100; // Moderate risk
        } else if (liquidationRisk.maxPossibleRent < 1000) {
            return 200; // Higher risk
        } else {
            // Very high risk - cap at 300 to avoid being too conservative
            return Math.min(300, liquidationRisk.maxPossibleRent * 0.3);
        }
    }
}

// =============================================================================
// 4. FULL VARIANCE-AWARE AI (All factors combined)
// =============================================================================

/**
 * FullVarianceAI - Combines all three improvements via getMinReserve():
 * 1. Timing-aware: reduce reserve when opponents in sweet spot
 * 2. Risk-adjusted valuation in trades
 * 3. Dynamic cash reserves based on liquidation risk
 *
 * Uses parent's buildOptimalHouses() - just modifies the reserve calculation.
 */
class FullVarianceAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'FullVarianceAI';

        // Risk parameters for trade evaluation
        this.riskPenaltyMultiplier = 0.10;  // Reduced from 0.15
    }

    /**
     * Override getMinReserve with combined timing + liquidation awareness
     */
    getMinReserve(state) {
        // Start with liquidation-based reserve
        const liquidationRisk = calculateLiquidationRisk(this.player, state, this.probs);
        let baseReserve;

        if (liquidationRisk.maxPossibleRent < 200) {
            baseReserve = 50;
        } else if (liquidationRisk.maxPossibleRent < 500) {
            baseReserve = 100;
        } else if (liquidationRisk.maxPossibleRent < 1000) {
            baseReserve = 200;
        } else {
            baseReserve = Math.min(300, liquidationRisk.maxPossibleRent * 0.3);
        }

        // Now apply timing adjustment
        const monopolies = this.getMyMonopolies(state);
        if (monopolies.length === 0) return baseReserve;

        let sweetSpotCount = 0;
        for (const group of monopolies) {
            const timing = calculateBuildTiming(this.player, state, group, this.markovEngine);
            if (timing && timing.sweetSpotOpponents > 0) {
                sweetSpotCount += timing.sweetSpotOpponents;
            }
        }

        // If opponents are in sweet spot, reduce reserve further
        if (sweetSpotCount >= 2) {
            return Math.max(25, baseReserve * 0.5);
        } else if (sweetSpotCount === 1) {
            return Math.max(50, baseReserve * 0.75);
        }

        return baseReserve;
    }

    /**
     * Override position calculation with risk adjustment (for trades)
     */
    calculatePosition(player, state) {
        let position = super.calculatePosition(player, state);

        // Apply risk adjustment - find monopolies by checking property ownership
        const monopolies = [];
        for (const [group, info] of Object.entries(COLOR_GROUPS)) {
            const ownsAll = info.squares.every(sq =>
                state.propertyStates[sq]?.owner === player.id
            );
            if (ownsAll) monopolies.push(group);
        }

        for (const group of monopolies) {
            const riskAnalysis = calculateBetaAdjustedValue(group, state, this.probs);
            if (riskAnalysis && riskAnalysis.beta > 1.0) {
                const penalty = (riskAnalysis.beta - 1.0) * riskAnalysis.baseEPT *
                    this.projectionHorizon * this.riskPenaltyMultiplier;
                position -= penalty;
            }
        }

        return position;
    }
}

// =============================================================================
// 5. TIMING + RESERVE AI (No risk adjustment)
// =============================================================================

/**
 * TimingReserveAI - Combines timing and reserve awareness (no risk)
 * Uses parent's buildOptimalHouses() with modified getMinReserve()
 */
class TimingReserveAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator);
        this.name = 'TimingReserveAI';
    }

    /**
     * Override getMinReserve with combined timing + liquidation awareness
     * Same as FullVarianceAI but without risk adjustment in trades
     */
    getMinReserve(state) {
        // Start with liquidation-based reserve
        const liquidationRisk = calculateLiquidationRisk(this.player, state, this.probs);
        let baseReserve;

        if (liquidationRisk.maxPossibleRent < 200) {
            baseReserve = 50;
        } else if (liquidationRisk.maxPossibleRent < 500) {
            baseReserve = 100;
        } else if (liquidationRisk.maxPossibleRent < 1000) {
            baseReserve = 200;
        } else {
            baseReserve = Math.min(300, liquidationRisk.maxPossibleRent * 0.3);
        }

        // Apply timing adjustment
        const monopolies = this.getMyMonopolies(state);
        if (monopolies.length === 0) return baseReserve;

        let sweetSpotCount = 0;
        for (const group of monopolies) {
            const timing = calculateBuildTiming(this.player, state, group, this.markovEngine);
            if (timing && timing.sweetSpotOpponents > 0) {
                sweetSpotCount += timing.sweetSpotOpponents;
            }
        }

        // If opponents are in sweet spot, reduce reserve
        if (sweetSpotCount >= 2) {
            return Math.max(25, baseReserve * 0.5);
        } else if (sweetSpotCount === 1) {
            return Math.max(50, baseReserve * 0.75);
        }

        return baseReserve;
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    TimingAwareAI,
    RiskAwareAI,
    ReserveAwareAI,
    FullVarianceAI,
    TimingReserveAI
};
