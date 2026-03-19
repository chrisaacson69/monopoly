/**
 * Static Property Graph — Precomputed Data
 *
 * The full Monopoly property graph is STATIC:
 * - Landing probabilities are fixed (Markov steady-state)
 * - Rent tables are fixed
 * - House prices are fixed
 * - ROI rankings are fixed
 *
 * This module precomputes everything that doesn't change during a game,
 * so the SubgraphAnalyzer only needs to filter, not recompute.
 *
 * Future: a "Negotiator" module will handle the HOW of trading
 * (proposing, counter-offering, bluffing). Out of scope for now —
 * the current work identifies WHAT to trade.
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');

/**
 * Precompute the full investment table for all properties at all house levels.
 *
 * This is the ABSOLUTE ranking — independent of who owns what.
 * Each entry: { square, group, fromLevel, toLevel, cost, marginalEPT, roi }
 *
 * @param {Object} probs - Landing probabilities by square index
 * @returns {Object} StaticGraphData
 */
function precomputeStaticGraph(probs) {
    // === 1. Full investment table (all 140 possible house builds) ===
    const allInvestments = [];

    for (const [groupName, groupData] of Object.entries(COLOR_GROUPS)) {
        for (const sq of groupData.squares) {
            const prop = PROPERTIES[sq];
            if (!prop) continue;

            const landingProb = probs[sq] || 0;

            for (let level = 0; level < 5; level++) {
                // Rent at current level (with monopoly for level 0)
                const currentRent = level === 0
                    ? prop.rent[0] * 2  // monopoly doubles base rent
                    : prop.rent[level];
                const nextRent = prop.rent[level + 1];

                const marginalEPT = landingProb * (nextRent - currentRent);
                const cost = groupData.housePrice;
                const roi = marginalEPT / cost;

                allInvestments.push({
                    square: sq,
                    property: prop.name,
                    group: groupName,
                    fromLevel: level,
                    toLevel: level + 1,
                    cost,
                    marginalEPT,
                    roi,
                    paybackTurns: marginalEPT > 0 ? cost / marginalEPT : Infinity
                });
            }
        }
    }

    // Sort by ROI descending — this is the absolute ranking
    allInvestments.sort((a, b) => b.roi - a.roi);

    // === 2. Per-set totals: value of completing each color set ===
    // "If you complete this set, what's the total EPT available from building?"
    const setValues = {};

    for (const [groupName, groupData] of Object.entries(COLOR_GROUPS)) {
        const setInvestments = allInvestments.filter(inv => inv.group === groupName);

        // Total EPT from building all 5 levels on all properties in this set
        const totalEPT = setInvestments.reduce((sum, inv) => sum + inv.marginalEPT, 0);

        // Total cost to fully develop
        const totalCost = setInvestments.reduce((sum, inv) => sum + inv.cost, 0);

        // Best ROI in this set (first house that's most efficient)
        const bestROI = setInvestments.length > 0 ? setInvestments[0].roi : 0;

        // Cost to reach 3 houses on all properties (the "sweet spot")
        const threehouseInvestments = setInvestments.filter(inv => inv.toLevel <= 3);
        const costTo3Houses = threehouseInvestments.reduce((sum, inv) => sum + inv.cost, 0);
        const eptAt3Houses = threehouseInvestments.reduce((sum, inv) => sum + inv.marginalEPT, 0);

        // Investments ranked by ROI within this set
        const rankedInvestments = [...setInvestments].sort((a, b) => b.roi - a.roi);

        setValues[groupName] = {
            group: groupName,
            name: groupData.name,
            squares: groupData.squares,
            housePrice: groupData.housePrice,
            totalEPT,
            totalCost,
            bestROI,
            costTo3Houses,
            eptAt3Houses,
            investments: rankedInvestments,
            // Precomputed: EPT gain at each cash threshold
            frontierCurve: computeSetFrontierCurve(rankedInvestments)
        };
    }

    // === 3. Absolute set ranking (which set is most valuable to complete?) ===
    const setRanking = Object.values(setValues)
        .sort((a, b) => b.bestROI - a.bestROI);

    // === 4. Cross-set investment ranking ===
    // If you own multiple sets, what's the global build order?
    // This is the frontier trade theory's marginal EPT/dollar ranking
    // but precomputed for all possible sets.
    const crossSetRankings = {};
    const groupNames = Object.keys(COLOR_GROUPS);

    // For each pair of sets, precompute the interleaved build order
    for (let i = 0; i < groupNames.length; i++) {
        for (let j = i + 1; j < groupNames.length; j++) {
            const g1 = groupNames[i];
            const g2 = groupNames[j];
            const combined = [
                ...setValues[g1].investments,
                ...setValues[g2].investments
            ].sort((a, b) => b.roi - a.roi);

            crossSetRankings[`${g1}+${g2}`] = combined;
        }
    }

    return {
        allInvestments,       // Full 140-entry table, sorted by ROI
        setValues,            // Per-set precomputed totals
        setRanking,           // Sets ranked by best ROI
        crossSetRankings,     // Pairwise interleaved build orders
        probs                 // Landing probs used (for reference)
    };
}

/**
 * Compute the frontier curve for a single set:
 * At each cumulative cash spent, what's the cumulative EPT gained?
 *
 * @param {Array} investments - Set investments sorted by ROI
 * @returns {Array} [{cash, ept, investment}] — the curve
 */
function computeSetFrontierCurve(investments) {
    const curve = [{ cash: 0, ept: 0, investment: null }];
    let cumCash = 0;
    let cumEPT = 0;

    for (const inv of investments) {
        cumCash += inv.cost;
        cumEPT += inv.marginalEPT;
        curve.push({
            cash: cumCash,
            ept: cumEPT,
            investment: inv
        });
    }

    return curve;
}

/**
 * Filter the static graph to a player's subgraph
 *
 * Given the precomputed static data and a player's complete sets,
 * return only the investments available to that player, already ranked.
 *
 * @param {Object} staticData - From precomputeStaticGraph()
 * @param {Array} completeSets - Player's complete set group names
 * @param {Object} state - GameState (for current house levels)
 * @param {number} playerId - Player to filter for
 * @returns {Array} Available investments, sorted by ROI
 */
function filterToSubgraph(staticData, completeSets, state, playerId) {
    const completeGroupNames = new Set(completeSets.map(s =>
        typeof s === 'string' ? s : s.group
    ));

    return staticData.allInvestments.filter(inv => {
        // Must be in a set this player completed
        if (!completeGroupNames.has(inv.group)) return false;

        // Must match current house level
        const currentHouses = state.propertyStates[inv.square]?.houses || 0;
        if (inv.fromLevel !== currentHouses) return false;

        return true;
    });
}

/**
 * Get the precomputed value of completing a specific set,
 * given the player's current cash.
 *
 * @param {Object} staticData - From precomputeStaticGraph()
 * @param {string} groupName - Color group to evaluate
 * @param {number} availableCash - Cash available for development
 * @returns {Object} { totalEPT, investmentsAffordable, cashNeeded }
 */
function getSetCompletionValue(staticData, groupName, availableCash) {
    const setData = staticData.setValues[groupName];
    if (!setData) return { totalEPT: 0, investmentsAffordable: 0, cashNeeded: 0 };

    let cash = availableCash;
    let eptGain = 0;
    let count = 0;

    for (const inv of setData.investments) {
        if (cash >= inv.cost) {
            cash -= inv.cost;
            eptGain += inv.marginalEPT;
            count++;
        }
    }

    return {
        totalEPT: eptGain,
        investmentsAffordable: count,
        totalInvestments: setData.investments.length,
        cashNeeded: setData.costTo3Houses,
        eptAt3Houses: setData.eptAt3Houses
    };
}

/**
 * Debug: Print the static graph summary
 */
function printStaticGraph(staticData) {
    console.log('\n=== STATIC GRAPH — ABSOLUTE RANKINGS ===\n');

    console.log('Set Rankings (by best ROI):');
    for (const set of staticData.setRanking) {
        console.log(`  ${set.name.padEnd(12)} best ROI: ${(set.bestROI * 100).toFixed(3)}%  |  ` +
            `3h cost: $${set.costTo3Houses}  |  3h EPT: $${set.eptAt3Houses.toFixed(2)}  |  ` +
            `full EPT: $${set.totalEPT.toFixed(2)}  |  full cost: $${set.totalCost}`);
    }

    console.log('\nTop 15 Investments (absolute):');
    for (const inv of staticData.allInvestments.slice(0, 15)) {
        console.log(`  ${inv.property.padEnd(24)} ${inv.fromLevel}h→${inv.toLevel}h  ` +
            `$${inv.cost.toString().padStart(3)}  ` +
            `+$${inv.marginalEPT.toFixed(2).padStart(6)} EPT  ` +
            `ROI: ${(inv.roi * 100).toFixed(3)}%`);
    }

    console.log('\n================================\n');
}

module.exports = {
    precomputeStaticGraph,
    computeSetFrontierCurve,
    filterToSubgraph,
    getSetCompletionValue,
    printStaticGraph
};
