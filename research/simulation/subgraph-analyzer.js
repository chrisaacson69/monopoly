/**
 * Subgraph Analyzer
 *
 * Classifies a player's property holdings into a subgraph structure:
 * complete sets (buildable), partial sets (tradeable), and isolated nodes.
 * Computes the build frontier and determines whether the player should
 * build, trade, or hold.
 *
 * This is the foundation of the subgraph trade engine — the data structure
 * that drives both build decisions and proactive trade generation.
 *
 * See vault: projects/monopoly/subgraph-trade-engine-spec.md
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES, RAILROADS, UTILITIES } = require('./game-engine.js');
const { precomputeStaticGraph, filterToSubgraph, getSetCompletionValue } = require('./subgraph-static-data.js');

// Landing probabilities (from Markov steady-state, long-stay jail strategy)
// These are fallback values — prefer live MarkovEngine when available
const DEFAULT_LANDING_PROBS = {
    1: 0.0215, 3: 0.0186,   // Brown
    6: 0.0227, 8: 0.0232, 9: 0.0240,  // Light Blue
    11: 0.0271, 13: 0.0231, 14: 0.0253, // Pink
    16: 0.0280, 18: 0.0296, 19: 0.0310, // Orange
    21: 0.0288, 23: 0.0275, 24: 0.0316, // Red
    26: 0.0268, 27: 0.0267, 29: 0.0259, // Yellow
    31: 0.0266, 32: 0.0270, 34: 0.0257, // Green
    37: 0.0230, 39: 0.0265   // Dark Blue
};

// Singleton: precomputed once, reused everywhere
let _staticData = null;

/**
 * Get or create the static graph data (singleton)
 */
function getStaticData(markovEngine) {
    if (!_staticData) {
        const probs = markovEngine
            ? markovEngine.getAllProbabilities('stay')
            : DEFAULT_LANDING_PROBS;
        _staticData = precomputeStaticGraph(probs);
    }
    return _staticData;
}

/**
 * Analyze a player's property subgraph
 *
 * @param {number} playerId - The player to analyze
 * @param {Object} state - GameState object with propertyStates, players
 * @param {Object} [markovEngine] - Optional MarkovEngine for precise landing probs
 * @returns {PlayerSubgraph}
 */
function analyzeSubgraph(playerId, state, markovEngine) {
    const probs = markovEngine
        ? markovEngine.getAllProbabilities('stay')
        : DEFAULT_LANDING_PROBS;

    const player = state.players[playerId];

    // Classify all properties this player owns
    const ownedProperties = [];
    for (const [sqStr, propState] of Object.entries(state.propertyStates)) {
        if (propState.owner === playerId) {
            ownedProperties.push(parseInt(sqStr));
        }
    }

    // Classify by color group
    const completeSets = [];
    const partialSets = [];
    const isolatedNodes = [];

    for (const [groupName, groupData] of Object.entries(COLOR_GROUPS)) {
        const groupSquares = groupData.squares;
        const myOwned = groupSquares.filter(sq =>
            state.propertyStates[sq] && state.propertyStates[sq].owner === playerId
        );

        if (myOwned.length === 0) continue;

        if (myOwned.length === groupSquares.length) {
            // Complete set — can build
            const totalHouses = groupSquares.reduce((sum, sq) =>
                sum + (state.propertyStates[sq].houses || 0), 0
            );
            completeSets.push({
                group: groupName,
                squares: groupSquares,
                housePrice: groupData.housePrice,
                totalHouses,
                maxHouses: groupSquares.length * 5,
                fullyDeveloped: totalHouses >= groupSquares.length * 5
            });
        } else {
            // Partial — find who holds the missing pieces
            const needed = groupSquares.filter(sq =>
                state.propertyStates[sq] && state.propertyStates[sq].owner !== playerId
            );
            const heldBy = {};
            let anyUnowned = false;

            for (const sq of needed) {
                const owner = state.propertyStates[sq].owner;
                if (owner === null) {
                    anyUnowned = true;
                } else {
                    if (!heldBy[owner]) heldBy[owner] = [];
                    heldBy[owner].push(sq);
                }
            }

            // Is completion possible through trade?
            // Isolated = all missing pieces split across 2+ opponents, or unowned remain
            const holders = Object.keys(heldBy);
            const canCompleteViaTrade = !anyUnowned && holders.length === 1;
            const canPartialTrade = !anyUnowned && holders.length >= 1;

            if (canPartialTrade) {
                partialSets.push({
                    group: groupName,
                    owned: myOwned,
                    needed,
                    heldBy,
                    singleHolder: canCompleteViaTrade,
                    holders: holders.map(id => parseInt(id))
                });
            } else {
                // Isolated — can't complete via trade (unowned pieces still on board)
                for (const sq of myOwned) {
                    isolatedNodes.push({
                        square: sq,
                        group: groupName,
                        reason: anyUnowned ? 'unowned_pieces_remain' : 'split_holders'
                    });
                }
            }
        }
    }

    // Compute build frontier — use static data if available
    const staticData = getStaticData(markovEngine);
    const buildFrontier = computeBuildFrontierFromStatic(
        staticData, completeSets, player.money, state, playerId
    );

    // Assess position
    const positionState = assessPosition(buildFrontier, completeSets, partialSets);

    // Precompute trade values: what is each incomplete set worth if completed?
    const tradeValues = {};
    for (const ps of partialSets) {
        tradeValues[ps.group] = getSetCompletionValue(staticData, ps.group, player.money);
    }

    return {
        playerId,
        cash: player.money,
        ownedProperties,
        completeSets,
        partialSets,
        isolatedNodes,
        buildFrontier,
        positionState,
        tradeValues,  // Precomputed: what each partial set is worth if completed

        // Convenience: all properties available for trade (partials + isolated)
        tradeableProperties: [
            ...partialSets.flatMap(ps => ps.owned),
            ...isolatedNodes.map(n => n.square)
        ]
    };
}

/**
 * Compute the build frontier using precomputed static data.
 * Just filters the static investment table to what this player can build.
 *
 * @param {Object} staticData - From precomputeStaticGraph()
 * @param {Array} completeSets - Player's complete color sets
 * @param {number} cash - Available cash
 * @param {Object} state - GameState for current house levels
 * @param {number} playerId - Player ID
 * @returns {BuildFrontier}
 */
function computeBuildFrontierFromStatic(staticData, completeSets, cash, state, playerId) {
    // Filter the precomputed table to this player's available builds
    const investments = filterToSubgraph(staticData, completeSets, state, playerId);

    // Compute cumulative frontier — how much EPT can we buy with available cash
    let remainingCash = cash;
    let totalEPTGain = 0;
    const buildPlan = [];

    for (const inv of investments) {
        if (remainingCash < inv.cost) continue;
        remainingCash -= inv.cost;
        totalEPTGain += inv.marginalEPT;
        buildPlan.push(inv);
    }

    return {
        investments,           // Available investments, sorted by ROI (from static)
        buildPlan,             // What we'd actually build given cash constraints
        totalEPTGain,          // Total EPT improvement from building
        bestROI: investments.length > 0 ? investments[0].roi : 0,
        cashAfterBuild: remainingCash,
        isEmpty: investments.length === 0,
        isCapped: investments.length === 0 ||
                  (investments[0].roi < 0.01)  // Threshold for "not worth building"
    };
}

/**
 * Assess the player's competitive position
 *
 * @param {BuildFrontier} frontier - The player's build frontier
 * @param {Array} completeSets - Complete color sets
 * @param {Array} partialSets - Partial color sets
 * @returns {string} GROWING | CAPPED | LOSING
 */
function assessPosition(frontier, completeSets, partialSets) {
    // GROWING: has good build investments available
    if (!frontier.isCapped && frontier.bestROI > 0.02) {
        return 'GROWING';
    }

    // CAPPED: has complete sets but fully developed or low ROI remaining
    if (completeSets.length > 0 && frontier.isCapped) {
        return 'CAPPED';
    }

    // LOSING: no complete sets, only partials and isolated nodes
    if (completeSets.length === 0) {
        return partialSets.length > 0 ? 'LOSING_WITH_PARTIALS' : 'LOSING_NO_PATH';
    }

    // Default: capped
    return 'CAPPED';
}

/**
 * Compute the value of a specific property TO a specific player.
 *
 * Fast path: if the property would complete a set, use precomputed set values.
 * Slow path: full hypothetical subgraph re-analysis (for non-completing properties).
 *
 * @param {number} square - The property square index
 * @param {number} playerId - The player to evaluate for
 * @param {Object} state - Current GameState
 * @param {Object} [markovEngine] - Optional MarkovEngine
 * @returns {Object} Valuation details
 */
function valuePropertyForPlayer(square, playerId, state, markovEngine) {
    const staticData = getStaticData(markovEngine);
    const prop = PROPERTIES[square];
    if (!prop) return { square, hypotheticalValue: 0, completesSet: false };

    const groupName = prop.group;
    const groupSquares = COLOR_GROUPS[groupName].squares;
    const cash = state.players[playerId].money;

    // Check: does this player own all OTHER properties in this group?
    const otherSquares = groupSquares.filter(sq => sq !== square);
    const ownsAllOthers = otherSquares.every(sq =>
        state.propertyStates[sq]?.owner === playerId
    );

    if (ownsAllOthers) {
        // FAST PATH: this property completes a set — use precomputed value
        const setVal = getSetCompletionValue(staticData, groupName, cash);
        const currentSubgraph = analyzeSubgraph(playerId, state, markovEngine);

        return {
            square,
            property: prop.name,
            currentValue: 0,
            hypotheticalValue: setVal.totalEPT,
            completesSet: true,
            newSetGroup: groupName,
            eptAt3Houses: setVal.eptAt3Houses,
            cashNeeded: setVal.cashNeeded,
            positionChange: `${currentSubgraph.positionState} → GROWING`
        };
    }

    // SLOW PATH: doesn't complete a set — do full hypothetical analysis
    const currentSubgraph = analyzeSubgraph(playerId, state, markovEngine);

    const hypotheticalState = {
        ...state,
        propertyStates: { ...state.propertyStates }
    };
    hypotheticalState.propertyStates[square] = {
        ...state.propertyStates[square],
        owner: playerId
    };

    const hypotheticalSubgraph = analyzeSubgraph(playerId, hypotheticalState, markovEngine);

    const completesSet = hypotheticalSubgraph.completeSets.length > currentSubgraph.completeSets.length;
    const newSet = completesSet
        ? hypotheticalSubgraph.completeSets.find(s =>
            !currentSubgraph.completeSets.some(cs => cs.group === s.group)
          )
        : null;

    const frontierDelta = hypotheticalSubgraph.buildFrontier.totalEPTGain -
                          currentSubgraph.buildFrontier.totalEPTGain;

    return {
        square,
        property: PROPERTIES[square]?.name || BOARD[square]?.name,
        currentValue: 0,
        hypotheticalValue: frontierDelta,
        completesSet,
        newSetGroup: newSet?.group || null,
        positionChange: `${currentSubgraph.positionState} → ${hypotheticalSubgraph.positionState}`
    };
}

/**
 * Debug: Print a subgraph analysis
 */
function printSubgraph(subgraph) {
    console.log(`\n=== SUBGRAPH ANALYSIS: Player ${subgraph.playerId} ===`);
    console.log(`Cash: $${subgraph.cash}`);
    console.log(`Position: ${subgraph.positionState}`);

    console.log(`\nComplete Sets (${subgraph.completeSets.length}):`);
    for (const set of subgraph.completeSets) {
        const names = set.squares.map(sq => PROPERTIES[sq]?.name || sq).join(', ');
        console.log(`  ${set.group}: [${names}] — ${set.totalHouses}/${set.maxHouses} houses`);
    }

    console.log(`\nPartial Sets (${subgraph.partialSets.length}):`);
    for (const ps of subgraph.partialSets) {
        const ownedNames = ps.owned.map(sq => PROPERTIES[sq]?.name || sq).join(', ');
        const neededNames = ps.needed.map(sq => PROPERTIES[sq]?.name || sq).join(', ');
        const holderStr = Object.entries(ps.heldBy)
            .map(([id, sqs]) => `P${id}: ${sqs.map(sq => PROPERTIES[sq]?.name || sq).join(', ')}`)
            .join('; ');
        console.log(`  ${ps.group}: own [${ownedNames}], need [${neededNames}] from ${holderStr}`);
    }

    console.log(`\nIsolated Nodes (${subgraph.isolatedNodes.length}):`);
    for (const node of subgraph.isolatedNodes) {
        console.log(`  ${PROPERTIES[node.square]?.name || node.square} (${node.group}) — ${node.reason}`);
    }

    console.log(`\nBuild Frontier:`);
    if (subgraph.buildFrontier.isEmpty) {
        console.log('  (empty — no buildable investments)');
    } else {
        console.log(`  Best ROI: ${(subgraph.buildFrontier.bestROI * 100).toFixed(3)}% EPT/dollar`);
        console.log(`  Total EPT gain from building: $${subgraph.buildFrontier.totalEPTGain.toFixed(2)}`);
        console.log(`  Top 5 investments:`);
        for (const inv of subgraph.buildFrontier.investments.slice(0, 5)) {
            const from = inv.currentHouses ?? inv.fromLevel ?? '?';
            const to = inv.nextLevel ?? inv.toLevel ?? '?';
            console.log(`    ${inv.property} ${from}h→${to}h: $${inv.cost}, +$${inv.marginalEPT.toFixed(2)} EPT, ROI ${(inv.roi * 100).toFixed(3)}%`);
        }
    }

    console.log(`\nTradeable Properties (${subgraph.tradeableProperties.length}):`);
    const tradeNames = subgraph.tradeableProperties
        .map(sq => PROPERTIES[sq]?.name || BOARD[sq]?.name || sq)
        .join(', ');
    console.log(`  ${tradeNames || '(none)'}`);
    console.log('================================\n');
}

module.exports = {
    analyzeSubgraph,
    computeBuildFrontierFromStatic,
    assessPosition,
    valuePropertyForPlayer,
    getStaticData,
    printSubgraph,
    DEFAULT_LANDING_PROBS
};
