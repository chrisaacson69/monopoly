/**
 * Trade Search Engine
 *
 * Generates, prunes, and evaluates candidate trades using subgraph analysis.
 * This is the proactive trade generation layer — it identifies WHAT to trade
 * based on subgraph topology, not just whether to accept an incoming offer.
 *
 * See vault: projects/monopoly/subgraph-trade-engine-spec.md
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');
const { analyzeSubgraph, getStaticData, valuePropertyForPlayer } = require('./subgraph-analyzer.js');
const { getSetCompletionValue } = require('./subgraph-static-data.js');

// Try to load RelativeGrowthAI for bilateral trajectory simulation
let RelativeGrowthAI;
try {
    RelativeGrowthAI = require('./relative-growth-ai.js').RelativeGrowthAI;
} catch (e) {}

/**
 * Compute bilateral Nash pricing for a trade.
 * Uses the trajectory simulation from RelativeGrowthAI to find the cash
 * amount where both players' convergence points are equalized.
 *
 * Returns { nashPrice, minPrice, maxPrice } — the Nash optimal and the
 * full range of mutually acceptable prices.
 *
 * @param {number} myId - Our player ID
 * @param {number} theirId - Opponent player ID
 * @param {Array} propsWeGet - Properties we receive
 * @param {Array} propsWeGive - Properties we give
 * @param {Object} state - Current GameState
 * @param {Object} bilateralSim - An object with simulateBilateralGrowth method
 * @returns {Object} { nashPrice, minPrice, maxPrice, valid }
 */
function computeBilateralPrice(myId, theirId, propsWeGet, propsWeGive, state, bilateralSim) {
    if (!bilateralSim || !bilateralSim.simulateBilateralGrowth) {
        // Fallback: rough pricing
        const weGetValue = propsWeGet.reduce((s, sq) => s + (BOARD[sq]?.price || 0), 0);
        const weGiveValue = propsWeGive.reduce((s, sq) => s + (BOARD[sq]?.price || 0), 0);
        return {
            nashPrice: weGetValue - weGiveValue,
            minPrice: Math.floor((weGetValue - weGiveValue) * 0.5),
            maxPrice: Math.floor((weGetValue - weGiveValue) * 2.0),
            valid: true,
            method: 'fallback'
        };
    }

    const myCash = state.players[myId].money;
    const theirCash = state.players[theirId].money;
    const activePlayers = state.players.filter(p => !p.bankrupt);
    const numOtherOpponents = activePlayers.length - 2;

    // Build post-trade property states
    const postTradePS = {};
    for (const [sq, ps] of Object.entries(state.propertyStates)) {
        postTradePS[sq] = { ...ps };
    }
    for (const sq of propsWeGet) {
        postTradePS[sq] = { ...postTradePS[sq], owner: myId };
    }
    for (const sq of propsWeGive) {
        postTradePS[sq] = { ...postTradePS[sq], owner: theirId };
    }

    // Get post-trade monopoly groups for both players
    const getGroups = (playerId, ps) => {
        const groups = [];
        for (const [gName, gData] of Object.entries(COLOR_GROUPS)) {
            if (gData.squares.every(sq => ps[sq]?.owner === playerId)) {
                groups.push(gName);
            }
        }
        return groups;
    };

    const myGroups = getGroups(myId, postTradePS);
    const theirGroups = getGroups(theirId, postTradePS);

    // Sweep cash to find Nash price and acceptable range
    const maxCashSearch = Math.min(Math.floor(myCash * 0.7), 800);
    const step = 25;
    let nashPrice = 0;
    let minGapAtNash = Infinity;

    // Track: at each cash level, does the trade improve both?
    const results = [];

    for (let cash = -200; cash <= maxCashSearch; cash += step) {
        const myCashAfter = myCash - cash;
        const theirCashAfter = theirCash + cash;
        if (myCashAfter < 50 || theirCashAfter < 0) continue;

        const { myTrajectory, theirTrajectory } =
            bilateralSim.simulateBilateralGrowth(
                { groups: myGroups, cash: myCashAfter, id: myId },
                { groups: theirGroups, cash: theirCashAfter, id: theirId },
                postTradePS, numOtherOpponents
            );

        // Find convergence point (where trajectories are closest)
        let minGap = Infinity;
        let convergenceGap = 0;
        for (let t = 0; t < myTrajectory.length; t++) {
            const gap = Math.abs(myTrajectory[t] - theirTrajectory[t]);
            if (gap < minGap) {
                minGap = gap;
                convergenceGap = myTrajectory[t] - theirTrajectory[t];
            }
        }

        // Compute trajectory area improvement for both
        // (vs a baseline of no-trade, which we approximate as cash=0)
        const myArea = myTrajectory.reduce((s, v) => s + v, 0);
        const theirArea = theirTrajectory.reduce((s, v) => s + v, 0);

        results.push({ cash, convergenceGap: Math.abs(convergenceGap), myArea, theirArea });

        if (Math.abs(convergenceGap) < minGapAtNash) {
            minGapAtNash = Math.abs(convergenceGap);
            nashPrice = cash;
        }
    }

    // Find the range where both players benefit
    // (both have positive trajectory area vs no-trade)
    // For now, use the Nash price and compute min/max as 70%/150% of Nash
    const minPrice = Math.floor(nashPrice * 0.5);
    const maxPrice = Math.floor(nashPrice * 1.8);

    return {
        nashPrice,
        minPrice: Math.max(0, minPrice),
        maxPrice: Math.min(maxCashSearch, maxPrice),
        valid: true,
        method: 'bilateral_trajectory'
    };
}

/**
 * Search for the best trade a player can propose.
 *
 * @param {number} playerId - The player searching for trades
 * @param {Object} state - Current GameState
 * @param {Object} [markovEngine] - Optional MarkovEngine
 * @param {Object} [options] - Search options
 * @returns {Object|null} Best trade to propose, or null if none found
 */
function searchTrades(playerId, state, markovEngine, options = {}) {
    const {
        minROIThreshold = 0.02,     // Don't search if build ROI exceeds this
        includeThreeWay = true,      // Search for 3-way cycles
        maxCashOffer = 0.5,          // Max fraction of cash to offer
        pricingMode = 'bilateral',   // 'bilateral' | 'fallback'
        verbose = false
    } = options;

    const staticData = getStaticData(markovEngine);
    const mySubgraph = analyzeSubgraph(playerId, state, markovEngine);

    // Phase 1: Should we even search?
    if (mySubgraph.positionState === 'GROWING' &&
        mySubgraph.buildFrontier.bestROI > minROIThreshold) {
        if (verbose) console.log(`P${playerId}: GROWING at ${(mySubgraph.buildFrontier.bestROI * 100).toFixed(1)}% ROI — skip trade search`);
        return null;
    }

    // Create bilateral simulator for pricing (if available)
    let bilateralSim = null;
    if (pricingMode === 'bilateral' && RelativeGrowthAI && markovEngine) {
        // Create a temporary instance just for the simulation method
        const tempPlayer = state.players[playerId];
        bilateralSim = new RelativeGrowthAI(tempPlayer, null, markovEngine, null);
    }

    // Analyze all opponents
    const opponents = [];
    for (let i = 0; i < state.players.length; i++) {
        if (i === playerId || state.players[i].bankrupt) continue;
        opponents.push({
            id: i,
            subgraph: analyzeSubgraph(i, state, markovEngine)
        });
    }

    // Phase 2: Generate and evaluate bilateral candidates
    let allCandidates = [];

    for (const opp of opponents) {
        const candidates = generateBilateralCandidates(
            mySubgraph, opp.subgraph, state, staticData, maxCashOffer, bilateralSim
        );
        if (verbose) console.log(`P${playerId} vs P${opp.id}: ${candidates.length} candidates after pruning`);
        allCandidates.push(...candidates);
    }

    // Sort by our EPT gain descending
    allCandidates.sort((a, b) => b.myEPTGain - a.myEPTGain);

    // Phase 2d: Third-party check on top candidates
    const checkedCandidates = [];
    for (const trade of allCandidates.slice(0, 10)) { // Check top 10
        const thirdParty = checkThirdPartyImpact(trade, playerId, state, opponents, markovEngine);
        checkedCandidates.push({ ...trade, thirdParty });
    }

    // Filter to balanced trades (no single player dominates)
    const balanced = checkedCandidates.filter(t =>
        t.thirdParty.balanced || !t.thirdParty.checked
    );

    // Phase 3: 3-way search if no bilateral works
    if (balanced.length === 0 && includeThreeWay && opponents.length >= 2) {
        if (verbose) console.log(`P${playerId}: No bilateral trades — searching 3-way cycles`);
        const cycles = searchThreeWayCycles(mySubgraph, opponents, state, staticData);
        if (cycles.length > 0) {
            return { type: 'three_way', ...cycles[0] };
        }
    }

    if (balanced.length === 0) {
        if (verbose) console.log(`P${playerId}: No viable trades found`);
        return null;
    }

    return { type: 'bilateral', ...balanced[0] };
}

/**
 * Generate bilateral trade candidates between two players.
 * Only generates trades where BOTH players' subgraphs improve.
 *
 * @param {Object} mySubgraph - Our subgraph analysis
 * @param {Object} theirSubgraph - Opponent's subgraph analysis
 * @param {Object} state - GameState
 * @param {Object} staticData - Precomputed static graph
 * @param {number} maxCashFraction - Max fraction of cash to offer
 * @returns {Array} Candidate trades, pruned and scored
 */
function generateBilateralCandidates(mySubgraph, theirSubgraph, state, staticData, maxCashFraction, bilateralSim) {
    const candidates = [];
    const myId = mySubgraph.playerId;
    const theirId = theirSubgraph.playerId;

    // Strategy 1: I need pieces from them to complete MY sets
    for (const myPartial of mySubgraph.partialSets) {
        // Do they hold any pieces I need?
        const theirPieces = myPartial.heldBy[theirId];
        if (!theirPieces || theirPieces.length === 0) continue;

        // What is completing this set worth to me?
        const mySetValue = getSetCompletionValue(staticData, myPartial.group, mySubgraph.cash);

        // For each piece they hold that I need:
        for (const neededSquare of theirPieces) {
            // What's this property worth to them? (what do they lose by giving it up?)
            const theirLossValue = valuePropertyForPlayer(neededSquare, theirId, state);

            // What can I offer in return?
            const offers = generateOffers(
                mySubgraph, theirSubgraph, neededSquare,
                mySetValue, theirLossValue, state, staticData, maxCashFraction, bilateralSim
            );

            for (const offer of offers) {
                candidates.push(offer);
            }
        }
    }

    // Strategy 2: They need pieces from me — can I sell at a premium?
    for (const theirPartial of theirSubgraph.partialSets) {
        const myPieces = theirPartial.heldBy[myId];
        if (!myPieces || myPieces.length === 0) continue;

        // What is this set worth to them?
        const theirSetValue = getSetCompletionValue(staticData, theirPartial.group, theirSubgraph.cash);

        for (const sellSquare of myPieces) {
            // What's this worth to me? (what do I lose?)
            const myLossValue = valuePropertyForPlayer(sellSquare, myId, state);

            // Can I sell it for enough to improve my position?
            const sellOffers = generateSellOffers(
                mySubgraph, theirSubgraph, sellSquare,
                myLossValue, theirSetValue, state, staticData, bilateralSim
            );

            for (const offer of sellOffers) {
                candidates.push(offer);
            }
        }
    }

    // Prune dominated candidates
    return pruneCandidates(candidates);
}

/**
 * Generate offer variations for acquiring a specific property.
 */
function generateOffers(mySubgraph, theirSubgraph, neededSquare, mySetValue, theirLossValue, state, staticData, maxCashFraction, bilateralSim) {
    const offers = [];
    const myId = mySubgraph.playerId;
    const theirId = theirSubgraph.playerId;

    // Offer type 1: Cash only — use bilateral trajectory pricing
    const pricing = computeBilateralPrice(
        myId, theirId, [neededSquare], [], state, bilateralSim
    );

    if (pricing.valid && pricing.nashPrice > 0) {
        const cashOffer = Math.min(
            pricing.nashPrice,
            Math.floor(mySubgraph.cash * maxCashFraction)
        );

        if (cashOffer > 0) {
            const groupName = mySubgraph.partialSets.find(p => p.needed.includes(neededSquare))?.group;
            offers.push({
                from: myId,
                to: theirId,
                give: [],
                receive: [neededSquare],
                cashDelta: -cashOffer,  // We pay
                myEPTGain: mySetValue.totalEPT,
                theirEPTGain: 0,
                theirCashGain: cashOffer,
                pricingMethod: pricing.method,
                nashPrice: pricing.nashPrice,
                priceRange: [pricing.minPrice, pricing.maxPrice],
                reason: `Buy ${PROPERTIES[neededSquare]?.name} for $${cashOffer} (Nash: $${pricing.nashPrice}) to complete ${groupName}`
            });
        }
    }

    // Offer type 2: Property swap (give tradeable property + optional cash)
    for (const giveSquare of mySubgraph.tradeableProperties) {
        // Don't give them something that completes THEIR set (unless we're also completing)
        const giveProp = PROPERTIES[giveSquare];
        if (!giveProp) continue;

        const theirGainValue = valuePropertyForPlayer(giveSquare, theirId, state);

        // Only offer if it's worth something to them
        if (theirGainValue.hypotheticalValue <= 0 && !theirGainValue.completesSet) continue;

        // Calculate net benefit
        const myGain = mySetValue.totalEPT;
        const myLoss = valuePropertyForPlayer(giveSquare, myId, state).hypotheticalValue;
        const theirGain = theirGainValue.hypotheticalValue;

        // Both must benefit (Nash bargaining zone)
        if (myGain - myLoss <= 0) continue;
        if (theirGain <= 0 && theirGainValue.completesSet === false) continue;

        // Check: does giving this complete an opponent's set?
        const givesThemMonopoly = theirGainValue.completesSet;

        // Allow mutual completion (both get a monopoly)
        const iGetMonopoly = mySubgraph.partialSets.some(p =>
            p.needed.includes(neededSquare) && p.needed.length === 1
        );

        // Skip if we give them a monopoly without getting one
        if (givesThemMonopoly && !iGetMonopoly) continue;

        offers.push({
            from: myId,
            to: theirId,
            give: [giveSquare],
            receive: [neededSquare],
            cashDelta: 0,
            myEPTGain: myGain - myLoss,
            theirEPTGain: theirGain,
            mutualCompletion: givesThemMonopoly && iGetMonopoly,
            reason: `Swap ${PROPERTIES[giveSquare]?.name} for ${PROPERTIES[neededSquare]?.name}`
        });
    }

    return offers;
}

/**
 * Generate sell offers for properties opponents need.
 */
function generateSellOffers(mySubgraph, theirSubgraph, sellSquare, myLossValue, theirSetValue, state, staticData, bilateralSim) {
    const offers = [];
    const myId = mySubgraph.playerId;
    const theirId = theirSubgraph.playerId;

    // Use bilateral pricing — from THEIR perspective (they're buying from us)
    const pricing = computeBilateralPrice(
        theirId, myId, [sellSquare], [], state, bilateralSim
    );

    if (pricing.valid && pricing.nashPrice > 0) {
        // We're selling — push toward the high end of the range
        // Nash price is what's fair; maxPrice is what they might pay if desperate
        const price = Math.min(
            Math.round(pricing.nashPrice * 1.2),  // 20% above Nash (seller's premium)
            Math.floor(theirSubgraph.cash * 0.6)   // They can afford it
        );

        if (price > 0) {
            const groupName = theirSubgraph.partialSets.find(p => p.needed.includes(sellSquare))?.group;
            offers.push({
                from: myId,
                to: theirId,
                give: [sellSquare],
                receive: [],
                cashDelta: price,  // We receive cash
                myEPTGain: 0,
                myCashGain: price,
                theirEPTGain: theirSetValue.totalEPT,
                pricingMethod: pricing.method,
                nashPrice: pricing.nashPrice,
                priceRange: [pricing.minPrice, pricing.maxPrice],
                reason: `Sell ${PROPERTIES[sellSquare]?.name} to P${theirId} for $${price} (Nash: $${pricing.nashPrice}, they complete ${groupName})`
            });
        }
    }

    return offers;
}

/**
 * Prune dominated trade candidates.
 * A trade is dominated if another trade gives strictly better results on all dimensions.
 */
function pruneCandidates(candidates) {
    if (candidates.length <= 1) return candidates;

    const dominated = new Set();

    for (let i = 0; i < candidates.length; i++) {
        if (dominated.has(i)) continue;
        for (let j = i + 1; j < candidates.length; j++) {
            if (dominated.has(j)) continue;

            const a = candidates[i];
            const b = candidates[j];

            // A dominates B if A is better in all dimensions
            if (a.myEPTGain >= b.myEPTGain &&
                (a.cashDelta || 0) >= (b.cashDelta || 0) &&
                a.give.length <= b.give.length &&
                (a.myEPTGain > b.myEPTGain || (a.cashDelta || 0) > (b.cashDelta || 0))) {
                dominated.add(j);
            } else if (b.myEPTGain >= a.myEPTGain &&
                       (b.cashDelta || 0) >= (a.cashDelta || 0) &&
                       b.give.length <= a.give.length &&
                       (b.myEPTGain > a.myEPTGain || (b.cashDelta || 0) > (a.cashDelta || 0))) {
                dominated.add(i);
            }
        }
    }

    return candidates.filter((_, idx) => !dominated.has(idx));
}

/**
 * Check whether a bilateral trade creates an unbalanced state
 * that non-trading players can't answer.
 */
function checkThirdPartyImpact(trade, playerId, state, opponents, markovEngine) {
    // Simple heuristic for now: if the trade gives either trader
    // 2+ complete sets while no one else has any, it's unbalanced.
    // Full trajectory sim would be more accurate but expensive.

    const traders = [trade.from, trade.to];
    const nonTraders = opponents.filter(o => !traders.includes(o.id));

    if (nonTraders.length === 0) return { balanced: true, checked: false };

    // Check if trade creates mutual completion (both get monopolies)
    // This is usually fine — balanced between traders
    if (trade.mutualCompletion) {
        return { balanced: true, checked: true, reason: 'mutual_completion' };
    }

    // If only one side gets a monopoly from this trade, check if non-traders have one
    const nonTraderHasMonopoly = nonTraders.some(nt => nt.subgraph.completeSets.length > 0);

    if (!nonTraderHasMonopoly && trade.myEPTGain > 30) {
        // We'd get a big advantage and no one else has monopolies
        return { balanced: false, checked: true, reason: 'dominant_position' };
    }

    return { balanced: true, checked: true };
}

/**
 * Search for 3-way trade cycles.
 * A→B, B→C, C→A where all three improve.
 */
function searchThreeWayCycles(mySubgraph, opponents, state, staticData) {
    const cycles = [];

    if (opponents.length < 2) return cycles;

    // For each pair of opponents
    for (let i = 0; i < opponents.length; i++) {
        for (let j = i + 1; j < opponents.length; j++) {
            const oppB = opponents[i];
            const oppC = opponents[j];

            // Can we find: I need from C, B needs from me, C needs from B?
            // Or: I need from B, C needs from me, B needs from C?

            // Try all rotations
            const rotations = [
                { giver1: mySubgraph, receiver1: oppB.subgraph,
                  giver2: oppB.subgraph, receiver2: oppC.subgraph,
                  giver3: oppC.subgraph, receiver3: mySubgraph },
                { giver1: mySubgraph, receiver1: oppC.subgraph,
                  giver2: oppC.subgraph, receiver2: oppB.subgraph,
                  giver3: oppB.subgraph, receiver3: mySubgraph }
            ];

            for (const rot of rotations) {
                const cycle = findCycleMatch(rot, state, staticData);
                if (cycle) {
                    cycles.push(cycle);
                }
            }
        }
    }

    // Sort by our gain
    cycles.sort((a, b) => b.myGain - a.myGain);
    return cycles;
}

/**
 * Try to find a matching 3-way cycle for a given rotation.
 */
function findCycleMatch(rotation, state, staticData) {
    const { giver1, receiver1, giver2, receiver2, giver3, receiver3 } = rotation;

    // Each leg: what does the receiver need that the giver has as tradeable?
    const leg1 = findLegMatch(giver1, receiver1, state, staticData);
    const leg2 = findLegMatch(giver2, receiver2, state, staticData);
    const leg3 = findLegMatch(giver3, receiver3, state, staticData);

    if (!leg1 || !leg2 || !leg3) return null;

    return {
        legs: [leg1, leg2, leg3],
        myGain: leg3.receiverGain,  // Our gain is from leg3 (we're the receiver)
        description: `P${giver1.playerId}→P${receiver1.playerId}: ${PROPERTIES[leg1.square]?.name}, ` +
                     `P${giver2.playerId}→P${receiver2.playerId}: ${PROPERTIES[leg2.square]?.name}, ` +
                     `P${giver3.playerId}→P${receiver3.playerId}: ${PROPERTIES[leg3.square]?.name}`
    };
}

/**
 * Find a single leg of a 3-way trade: does the giver have something
 * the receiver needs (from their partial sets)?
 */
function findLegMatch(giver, receiver, state, staticData) {
    for (const partial of receiver.partialSets) {
        for (const neededSq of partial.needed) {
            if (giver.tradeableProperties.includes(neededSq)) {
                const receiverGain = getSetCompletionValue(
                    staticData, partial.group, receiver.cash
                ).totalEPT;

                return {
                    square: neededSq,
                    from: giver.playerId,
                    to: receiver.playerId,
                    group: partial.group,
                    receiverGain
                };
            }
        }
    }
    return null;
}

/**
 * Debug: Print trade search results
 */
function printTradeSearch(result, playerId) {
    if (!result) {
        console.log(`\nP${playerId}: No trades found.\n`);
        return;
    }

    console.log(`\n=== TRADE SEARCH RESULT: Player ${playerId} ===`);
    console.log(`Type: ${result.type}`);
    console.log(`Reason: ${result.reason || result.description || 'N/A'}`);

    if (result.type === 'bilateral') {
        console.log(`From: P${result.from} → To: P${result.to}`);
        const giveNames = result.give.map(sq => PROPERTIES[sq]?.name || sq).join(', ') || '(none)';
        const receiveNames = result.receive.map(sq => PROPERTIES[sq]?.name || sq).join(', ') || '(none)';
        console.log(`Give: ${giveNames}`);
        console.log(`Receive: ${receiveNames}`);
        console.log(`Cash: $${result.cashDelta || 0}`);
        console.log(`Our EPT gain: $${(result.myEPTGain || 0).toFixed(2)}`);
        console.log(`Their EPT gain: $${(result.theirEPTGain || 0).toFixed(2)}`);
        if (result.thirdParty) {
            console.log(`Third-party: ${result.thirdParty.balanced ? 'balanced' : 'UNBALANCED'} (${result.thirdParty.reason || ''})`);
        }
    } else if (result.type === 'three_way') {
        console.log(`Cycle: ${result.description}`);
        console.log(`Our gain: $${result.myGain.toFixed(2)}`);
    }

    console.log('================================\n');
}

module.exports = {
    searchTrades,
    computeBilateralPrice,
    generateBilateralCandidates,
    pruneCandidates,
    checkThirdPartyImpact,
    searchThreeWayCycles,
    printTradeSearch
};
