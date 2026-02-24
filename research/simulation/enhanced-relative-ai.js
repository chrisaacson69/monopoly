/**
 * Enhanced Relative Growth AI
 *
 * Builds on RelativeGrowthAI with auction insights:
 * 1. Parameterized bid premium (properties are undervalued at face price)
 * 2. Parameterized debt tolerance (moderate debt helps, excessive hurts)
 * 3. Proactive unmortgaging when cash allows
 *
 * Key findings from auction experiments:
 * - Winners avg peak debt: ~$510, Losers: ~$718 (+41%)
 * - 5% premium: 46% win rate (best)
 * - 10% premium: 41-46% win rate (good)
 * - 20% premium: 16-17% win rate (over-leverages)
 *
 * Insight: Moderate debt is fine, excessive debt kills you.
 */

'use strict';

const { BOARD, COLOR_GROUPS, SQUARE_TYPES, RAILROAD_RENT } = require('./game-engine.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

// =============================================================================
// ENHANCED RELATIVE GROWTH AI
// =============================================================================

class EnhancedRelativeAI extends RelativeGrowthAI {
    constructor(player, engine, markovEngine = null, valuator = null, config = {}) {
        super(player, engine, markovEngine, valuator);

        // Auction/bidding parameters
        this.auctionConfig = {
            // Base premium above face value for normal properties (0.05 = 5%)
            baseBidPremium: config.baseBidPremium ?? 0.05,

            // Premium multiplier when completing monopoly (1.5 = 50% above face)
            monopolyCompletionMultiplier: config.monopolyCompletionMultiplier ?? 1.5,

            // Premium multiplier when blocking opponent monopoly
            blockingMultiplier: config.blockingMultiplier ?? 1.3,

            // Whether to use smart blocking (only pay premium if sole blocker)
            smartBlocking: config.smartBlocking ?? false,

            // Absolute minimum cash to keep (floor)
            absoluteMinCash: config.absoluteMinCash ?? 75,

            // Debt tolerance parameters
            // Max debt as fraction of total property value
            maxDebtRatio: config.maxDebtRatio ?? 0.3,

            // Max absolute debt willing to take on
            maxAbsoluteDebt: config.maxAbsoluteDebt ?? 600,

            // Whether to mortgage to fund bids
            mortgageForBids: config.mortgageForBids ?? true,

            // Whether to mortgage singletons to fund house building
            mortgageForBuilds: config.mortgageForBuilds ?? false,

            // Cash threshold to trigger unmortgaging (as multiple of unmortgage cost)
            unmortgageThreshold: config.unmortgageThreshold ?? 2.0,
        };

        // Track current debt (mortgaged value)
        this.currentDebt = 0;

        this.name = `EnhancedRelative(+${(this.auctionConfig.baseBidPremium * 100).toFixed(0)}%,debt${(this.auctionConfig.maxDebtRatio * 100).toFixed(0)}%)`;
    }

    /**
     * Calculate current mortgaged value (debt)
     */
    calculateCurrentDebt(state) {
        let debt = 0;
        for (const propIdx of this.player.properties) {
            if (state.propertyStates[propIdx].mortgaged) {
                const square = BOARD[propIdx];
                debt += Math.floor(square.price / 2);
            }
        }
        this.currentDebt = debt;
        return debt;
    }

    /**
     * Calculate total property value (for debt ratio)
     */
    calculateTotalPropertyValue(state) {
        let value = 0;
        for (const propIdx of this.player.properties) {
            const square = BOARD[propIdx];
            value += square.price || 0;

            const houses = state.propertyStates[propIdx].houses || 0;
            if (houses > 0 && square.housePrice) {
                value += houses * square.housePrice;
            }
        }
        return value;
    }

    /**
     * Calculate how much additional debt we're willing to take on
     */
    getAvailableDebtCapacity(state) {
        const currentDebt = this.calculateCurrentDebt(state);
        const totalPropValue = this.calculateTotalPropertyValue(state);

        // Two constraints: ratio-based and absolute
        const ratioLimit = Math.floor(totalPropValue * this.auctionConfig.maxDebtRatio);
        const absoluteLimit = this.auctionConfig.maxAbsoluteDebt;

        const maxAllowedDebt = Math.min(ratioLimit, absoluteLimit);
        const availableCapacity = Math.max(0, maxAllowedDebt - currentDebt);

        return availableCapacity;
    }

    /**
     * Dynamic cash reserve based on opponent threat vs development opportunity.
     *
     * Optimal reserve minimizes the sum of:
     *   1. Expected liquidation cost: P(landing) × max(0, rent - R) × 1.0
     *   2. Opportunity cost: R dollars held = houses not built = EPT foregone
     *
     * The 1.0x liquidation multiplier is empirically calibrated. The textbook
     * 2.0x (50% house sell penalty) is too conservative — it ignores that
     * mortgage buffers absorb most shortfalls cheaply. Attempting to derive
     * the multiplier from asset composition (mortgage buffer × 0.1 + house
     * selling × 2.0) underperforms because it underestimates mortgage costs
     * (lost rent, strategic blocking value, sequential exposure). The flat
     * 1.0x captures the weighted average without decomposition errors.
     *
     * Tournament results (2000 games each, 1 new vs 3 control):
     *   Flat 1.0x:      26.8% (Z=1.81-2.38 across runs)
     *   Asset-mix derived: 24.8% (Z=-0.21, neutral — too aggressive)
     *   Flat 2.0x:      25.2% (Z=0.15, neutral — too conservative)
     *   Static baseline: 25.0% (expected)
     */
    getMinReserve(state) {
        // Only apply theory when we have a monopoly (development tradeoff)
        const myMonopolies = this.getMyMonopolies(state);
        if (myMonopolies.length === 0) return super.getMinReserve(state);

        const opponents = state.players.filter(p => !p.bankrupt && p.id !== this.player.id);
        if (opponents.length === 0) return 50;

        // Use Markov probabilities if available, else fallback 0.025
        const getProb = (idx) => (this.probs && this.probs[idx]) || 0.025;

        // 1. Build rent exposure from all opponent properties
        const exposures = [];
        let maxRent = 0;

        for (const opp of opponents) {
            // Count opponent's unmortgaged railroads
            let rrCount = 0;
            for (const propIdx of opp.properties) {
                if ([5, 15, 25, 35].includes(propIdx) && !state.propertyStates[propIdx].mortgaged) {
                    rrCount++;
                }
            }

            for (const propIdx of opp.properties) {
                const ps = state.propertyStates[propIdx];
                if (ps.mortgaged) continue;

                const sq = BOARD[propIdx];
                const prob = getProb(propIdx);
                let rent = 0;

                if (sq.rent) {
                    // Street property
                    if (ps.houses > 0) {
                        rent = sq.rent[ps.houses];
                    } else if (sq.group && COLOR_GROUPS[sq.group] &&
                        COLOR_GROUPS[sq.group].squares.every(s =>
                            state.propertyStates[s].owner === opp.id)) {
                        rent = sq.rent[0] * 2;  // Monopoly, no houses
                    } else {
                        rent = sq.rent[0];
                    }
                } else if ([5, 15, 25, 35].includes(propIdx)) {
                    rent = RAILROAD_RENT[rrCount];
                }

                if (rent > 0) {
                    exposures.push({ p: prob, rent });
                    if (rent > maxRent) maxRent = rent;
                }
            }
        }

        // Minimal threat — aggressive development
        if (maxRent <= 50) return 50;

        // 2. Find best buildable monopoly for opportunity cost
        let bestMarginalEPT = 0;
        let bestCostPerLevel = 300;

        for (const group of myMonopolies) {
            if (!COLOR_GROUPS[group]) continue;
            const squares = COLOR_GROUPS[group].squares;
            const sq0 = BOARD[squares[0]];
            if (!sq0.rent || !sq0.housePrice) continue;

            // Can we still build?
            if (!squares.some(s => (state.propertyStates[s].houses || 0) < 5)) continue;

            let marginalEPT = 0;
            for (const s of squares) {
                const r = BOARD[s].rent;
                const avgMarginal = (r[3] - r[2] + r[2] - r[1] + r[1] - r[0] * 2) / 3;
                marginalEPT += getProb(s) *
                    Math.max(avgMarginal, r[1] - r[0]) * opponents.length;
            }

            if (marginalEPT > bestMarginalEPT) {
                bestMarginalEPT = marginalEPT;
                bestCostPerLevel = sq0.housePrice * squares.length;
            }
        }

        // All monopolies maxed — use reduced opportunity cost (defense mode)
        if (bestMarginalEPT === 0) {
            bestMarginalEPT = 10;
            bestCostPerLevel = 300;
        }

        // 3. Search for optimal reserve: minimize liqCost(R) + oppCost(R)
        let bestR = 0;
        let minCost = Infinity;
        const step = 25;

        for (let R = 0; R <= maxRent; R += step) {
            let liqCost = 0;
            for (const { p, rent } of exposures) {
                liqCost += p * Math.max(0, rent - R);
            }

            const oppCost = (R / bestCostPerLevel) * bestMarginalEPT;

            const total = liqCost + oppCost;
            if (total < minCost) {
                minCost = total;
                bestR = R;
            }
        }

        return Math.max(50, bestR);
    }

    /**
     * Get properties that can be mortgaged (not already mortgaged, no houses)
     */
    getMortgageableProperties(state) {
        const mortgageable = [];

        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (!propState.mortgaged && propState.houses === 0) {
                const square = BOARD[propIdx];
                mortgageable.push({
                    position: propIdx,
                    value: square.price,
                    mortgageValue: Math.floor(square.price / 2),
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        // Sort: non-monopoly first, then by value (lowest first)
        // This prioritizes keeping monopoly properties unmortgaged
        mortgageable.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? 1 : -1;
            }
            return a.value - b.value;
        });

        return mortgageable;
    }

    /**
     * Calculate potential cash including what we could raise through mortgaging
     * Respects debt capacity limits
     */
    getPotentialCash(state) {
        let potential = this.player.money;

        if (!this.auctionConfig.mortgageForBids) {
            return potential;
        }

        const debtCapacity = this.getAvailableDebtCapacity(state);
        const mortgageable = this.getMortgageableProperties(state);

        let addedDebt = 0;
        for (const prop of mortgageable) {
            if (addedDebt + prop.mortgageValue <= debtCapacity) {
                potential += prop.mortgageValue;
                addedDebt += prop.mortgageValue;
            }
        }

        return potential;
    }

    /**
     * Analyze blocking context for a property
     * Returns: { shouldBlock, isRedundant, leaderInGroup, otherBlockers }
     */
    analyzeBlockingContext(position, state) {
        const square = BOARD[position];
        if (!square.group) {
            return { shouldBlock: false, isRedundant: false, leaderInGroup: null, otherBlockers: [] };
        }

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Count ownership by player
        const ownership = {};
        for (const sq of groupSquares) {
            const owner = state.propertyStates[sq].owner;
            if (owner !== null) {
                ownership[owner] = (ownership[owner] || 0) + 1;
            }
        }

        // Find if any opponent has N-1 (one away from monopoly)
        let leaderInGroup = null;
        let leaderCount = 0;

        for (const player of state.players) {
            if (player.id === this.player.id || player.bankrupt) continue;

            const theirCount = ownership[player.id] || 0;
            if (theirCount === groupSquares.length - 1) {
                leaderInGroup = player.id;
                leaderCount = theirCount;
                break;  // Found someone one away from monopoly
            }
        }

        if (leaderInGroup === null) {
            // No one is close to monopoly - no blocking needed
            return { shouldBlock: false, isRedundant: false, leaderInGroup: null, otherBlockers: [] };
        }

        // Find other blockers (anyone else who owns property in this group, besides leader and self)
        const otherBlockers = [];
        for (const [ownerId, count] of Object.entries(ownership)) {
            const id = parseInt(ownerId);
            if (id !== this.player.id && id !== leaderInGroup && count > 0) {
                otherBlockers.push(id);
            }
        }

        // Also check if I already own something in this group
        const myCount = ownership[this.player.id] || 0;

        // Blocking is redundant if:
        // 1. Someone else is already blocking (otherBlockers.length > 0), OR
        // 2. I already own property in this group (myCount > 0)
        const isRedundant = otherBlockers.length > 0 || myCount > 0;

        return {
            shouldBlock: true,
            isRedundant,
            leaderInGroup,
            otherBlockers,
            myCurrentCount: myCount
        };
    }

    /**
     * Calculate maximum bid for a property using bilateral trajectory.
     *
     * For monopoly-completing or blocking scenarios, computes the
     * indifference price: the cash C where I'm equally well off
     * owning the property (at cost C) vs the most threatening
     * opponent owning it.
     *
     * This replaces the static multipliers (1.05x base, 1.5x completion,
     * 1.3x blocking) with a trajectory-derived number that captures
     * the competitive dynamics. The bilateral model naturally handles
     * the competitive edge — if the opponent would complete a monopoly,
     * "they get it" is catastrophic for us, driving up our willingness
     * to bid.
     */
    getMaxBid(position, state) {
        // Cache: max bid doesn't change during an auction (same position,
        // same game state). Avoids recomputing 12-16x per auction.
        if (this._maxBidCache &&
            this._maxBidCache.position === position &&
            this._maxBidCache.turn === state.turn) {
            return this._maxBidCache.maxBid;
        }

        const square = BOARD[position];

        // Non-street properties: base premium only
        if (!square.group || !COLOR_GROUPS[square.group]) {
            const result = Math.floor(square.price * (1 + this.auctionConfig.baseBidPremium));
            this._maxBidCache = { position, turn: state.turn, maxBid: result };
            return result;
        }

        const activePlayers = state.players.filter(p => !p.bankrupt);
        const opponents = activePlayers.filter(p => p.id !== this.player.id);
        if (opponents.length === 0) return square.price;

        const group = square.group;
        const groupSquares = COLOR_GROUPS[group].squares;

        // Check if a monopoly is at stake for me
        const myOwnedInGroup = groupSquares.filter(sq =>
            state.propertyStates[sq]?.owner === this.player.id
        ).length;
        const iWouldComplete = (myOwnedInGroup === groupSquares.length - 1);

        // Find the opponent who benefits most from this property
        let threatOpponent = null;
        let threatCompletes = false;
        let maxOppOwned = 0;

        for (const opp of opponents) {
            const oppOwned = groupSquares.filter(sq =>
                state.propertyStates[sq]?.owner === opp.id
            ).length;
            if (oppOwned > maxOppOwned) {
                maxOppOwned = oppOwned;
                threatOpponent = opp;
            }
        }
        if (threatOpponent && maxOppOwned === groupSquares.length - 1) {
            threatCompletes = true;
        }

        // No monopoly at stake for anyone: base premium
        if (!iWouldComplete && !threatCompletes) {
            const result = Math.floor(square.price * (1 + this.auctionConfig.baseBidPremium));
            this._maxBidCache = { position, turn: state.turn, maxBid: result };
            return result;
        }

        // Pure blocking: don't overpay when others have stake in blocking.
        // Use analyzeBlockingContext — only defer if another player already
        // owns property in this group (they have real blocking incentive,
        // not just the ability to afford a bid).
        if (!iWouldComplete && threatCompletes) {
            const ctx = this.analyzeBlockingContext(position, state);
            if (ctx.isRedundant) {
                // Someone else already owns property in this group —
                // they'll naturally outbid to protect their investment.
                const result = Math.floor(square.price * (1 + this.auctionConfig.baseBidPremium));
                this._maxBidCache = { position, turn: state.turn, maxBid: result };
                return result;
            }
            // We're the sole blocker — compute full indifference price below
        }

        // If no threat opponent found, use strongest by net worth
        if (!threatOpponent) {
            threatOpponent = opponents.reduce((best, opp) => {
                const oppWorth = opp.money + [...(opp.properties || [])].reduce(
                    (s, p) => s + BOARD[p].price, 0);
                const bestWorth = best.money + [...(best.properties || [])].reduce(
                    (s, p) => s + BOARD[p].price, 0);
                return oppWorth > bestWorth ? opp : best;
            });
        }

        const numOtherOpponents = opponents.length - 1;

        // Build property states for two scenarios:
        // A: I own the property
        const psIfIOwn = { ...state.propertyStates };
        psIfIOwn[position] = { ...psIfIOwn[position], owner: this.player.id };

        // B: Threat opponent owns the property
        const psIfTheyOwn = { ...state.propertyStates };
        psIfTheyOwn[position] = { ...psIfTheyOwn[position], owner: threatOpponent.id };

        // Get monopoly groups for each scenario
        const myGroupsIfIOwn = this.getPlayerMonopolyGroups(this.player.id, psIfIOwn);
        const theirGroupsIfIOwn = this.getPlayerMonopolyGroups(threatOpponent.id, psIfIOwn);
        const myGroupsIfTheyOwn = this.getPlayerMonopolyGroups(this.player.id, psIfTheyOwn);
        const theirGroupsIfTheyOwn = this.getPlayerMonopolyGroups(threatOpponent.id, psIfTheyOwn);

        // Baseline: my trajectory area if THEY get the property
        const simTheyGet = this.simulateBilateralGrowth(
            { groups: myGroupsIfTheyOwn, cash: this.player.money, id: this.player.id },
            { groups: theirGroupsIfTheyOwn, cash: threatOpponent.money, id: threatOpponent.id },
            psIfTheyOwn, numOtherOpponents
        );
        const myAreaIfTheyGet = simTheyGet.myTrajectory.reduce((s, v) => s + v, 0);

        // Binary search for indifference price (much faster than linear).
        // Find max C where owning at cost C still beats them owning it.
        let trajectoryBid = 0;
        const maxSearch = this.player.money;

        // Helper: compute my trajectory area at cost c
        const myAreaAtCost = (c) => {
            const sim = this.simulateBilateralGrowth(
                { groups: myGroupsIfIOwn, cash: this.player.money - c, id: this.player.id },
                { groups: theirGroupsIfIOwn, cash: threatOpponent.money, id: threatOpponent.id },
                psIfIOwn, numOtherOpponents
            );
            return sim.myTrajectory.reduce((s, v) => s + v, 0);
        };

        // Check endpoints first
        const myAreaAtZero = myAreaAtCost(0);
        if (myAreaAtZero <= myAreaIfTheyGet) {
            // Even free, I don't benefit from owning
            trajectoryBid = 0;
        } else {
            const myAreaAtMax = myAreaAtCost(maxSearch);
            if (myAreaAtMax > myAreaIfTheyGet) {
                // Worth all our cash
                trajectoryBid = maxSearch;
            } else {
                // Binary search: ~10 iterations instead of 60+
                let lo = 0, hi = maxSearch;
                while (hi - lo > 25) {
                    const mid = Math.floor((lo + hi) / 2);
                    if (myAreaAtCost(mid) > myAreaIfTheyGet) {
                        lo = mid;  // Still better to own — can pay more
                    } else {
                        hi = mid;  // Too expensive — pay less
                    }
                }
                trajectoryBid = lo;
            }
        }

        // Floor at face value (property always worth at least face)
        const result = Math.floor(Math.max(square.price, trajectoryBid));
        this._maxBidCache = { position, turn: state.turn, maxBid: result };
        return result;
    }

    /**
     * Mortgage properties to raise cash for a bid
     * Respects debt limits
     */
    mortgageForBid(targetAmount, state) {
        if (!this.auctionConfig.mortgageForBids) return;

        const debtCapacity = this.getAvailableDebtCapacity(state);
        if (debtCapacity <= 0) return;

        const mortgageable = this.getMortgageableProperties(state);
        let addedDebt = 0;

        for (const prop of mortgageable) {
            if (this.player.money >= targetAmount) break;
            if (addedDebt + prop.mortgageValue > debtCapacity) continue;

            const result = this.engine.mortgageProperty(this.player, prop.position);
            if (result > 0) {
                addedDebt += prop.mortgageValue;
            }
        }
    }

    /**
     * Override: Enhanced bidding strategy with premium and debt tolerance
     */
    decideBid(position, currentBid, state) {
        const square = BOARD[position];
        const maxWilling = this.getMaxBid(position, state);

        // Calculate what we can afford (including potential mortgages)
        const potentialCash = this.getPotentialCash(state);
        const maxAfford = potentialCash - this.auctionConfig.absoluteMinCash;

        if (maxAfford <= currentBid) return 0;

        // Cap at what we're willing to pay
        const bidCap = Math.min(maxWilling, maxAfford);

        if (currentBid >= bidCap) return 0;

        // Calculate the bid
        const bidAmount = Math.min(currentBid + 10, bidCap);

        // If we need to mortgage to make this bid, do it
        if (bidAmount > this.player.money - this.auctionConfig.absoluteMinCash) {
            this.mortgageForBid(bidAmount + this.auctionConfig.absoluteMinCash, state);
        }

        // Final check - can we afford the bid?
        if (this.player.money - bidAmount < this.auctionConfig.absoluteMinCash) {
            return 0;
        }

        return bidAmount;
    }

    /**
     * Override: first-principles jail strategy.
     * Leave jail while purchasable properties remain unowned (opportunity to acquire).
     * Stay in jail once all properties are owned (avoid paying rent, no upside to moving).
     * A/B tested: Z=1.14 (neutral), adopted for theoretical correctness.
     */
    decideJail(state) {
        for (const [pos, propState] of Object.entries(state.propertyStates)) {
            if (propState.owner === null) return true;  // unowned property exists — leave
        }
        return false;  // all owned — stay in jail
    }

    /**
     * Override: after normal ROI-based building, attempt mortgage-funded builds.
     * Mortgages singletons to fund profitable house construction on monopolies.
     */
    buildOptimalHouses(state) {
        // Phase 1: Normal building (exhausts cash down to reserve)
        super.buildOptimalHouses(state);

        // Phase 2: Mortgage-funded building
        if (!this.auctionConfig.mortgageForBuilds) return;
        this.mortgageFundedBuilds(state);
    }

    /**
     * Mortgage singletons to fund house building when net EPT is positive.
     *
     * Safety: respects getAvailableDebtCapacity (30% ratio, $600 cap),
     * absoluteMinCash ($75), and requires gainedEPT > lostEPT.
     */
    mortgageFundedBuilds(state) {
        const monopolies = this.getMyMonopolies(state);
        if (monopolies.length === 0) return;

        const opponents = state.players.filter(p =>
            p.id !== this.player.id && !p.bankrupt
        ).length;
        if (opponents === 0) return;

        let keepGoing = true;
        while (keepGoing) {
            keepGoing = false;

            // Find best available build by marginal ROI
            const reserve = this.getMinReserve(state);
            let bestROI = 0;
            let bestTarget = null;
            let bestEPTGain = 0;
            let bestHousePrice = 0;

            for (const group of monopolies) {
                const groupSquares = COLOR_GROUPS[group].squares;
                const housePrice = BOARD[groupSquares[0]].housePrice;

                for (const sq of groupSquares) {
                    const houses = state.propertyStates[sq].houses || 0;
                    if (houses >= 5) continue;

                    // Even building rule
                    const minInGroup = Math.min(...groupSquares.map(s =>
                        state.propertyStates[s].houses || 0
                    ));
                    if (houses > minInGroup) continue;

                    // House availability
                    if (houses < 4 && state.housesAvailable <= 0) continue;
                    if (houses === 4 && state.hotelsAvailable <= 0) continue;

                    const marginalROI = this.calculateMarginalROI(sq, houses, state);
                    if (marginalROI > bestROI) {
                        bestROI = marginalROI;
                        bestTarget = sq;
                        bestHousePrice = housePrice;

                        // Compute EPT gain for this build
                        const prob = this.probs[sq];
                        const currentRent = houses === 0
                            ? BOARD[sq].rent[0] * 2
                            : BOARD[sq].rent[houses];
                        const newRent = BOARD[sq].rent[houses + 1];
                        bestEPTGain = prob * (newRent - currentRent) * opponents;
                    }
                }
            }

            // No profitable build found
            if (bestTarget === null || bestROI <= 0.001) break;

            // Can already afford it normally? Let normal loop handle it (shouldn't happen
            // since super.buildOptimalHouses already ran, but guard anyway)
            if (this.player.money - bestHousePrice >= reserve) break;

            // Check debt capacity
            const debtCapacity = this.getAvailableDebtCapacity(state);
            if (debtCapacity <= 0) break;

            // Find cheapest mortgageable property
            const mortgageable = this.getMortgageableProperties(state);
            if (mortgageable.length === 0) break;

            const bestMortgage = mortgageable[0];  // Already sorted: non-monopoly first, lowest value

            // Would mortgaging exceed debt capacity?
            if (bestMortgage.mortgageValue > debtCapacity) break;

            // Compute EPT lost from mortgaging
            let lostEPT = 0;
            if (this.probs) {
                const mSq = BOARD[bestMortgage.position];
                const prob = this.probs[bestMortgage.position];

                if (mSq.rent) {
                    // Street property — base rent only (no houses since mortgageable)
                    lostEPT = prob * mSq.rent[0] * opponents;
                } else if ([5, 15, 25, 35].includes(bestMortgage.position)) {
                    // Railroad — losing one drops rent tier
                    const rrCount = this.player.getRailroadCount
                        ? this.player.getRailroadCount() : 1;
                    const currentRent = RAILROAD_RENT[rrCount] || 25;
                    const newRent = RAILROAD_RENT[Math.max(1, rrCount - 1)] || 25;
                    lostEPT = prob * (currentRent - newRent) * opponents;
                }
                // Utilities: negligible, skip
            }

            // Net EPT must be positive
            if (bestEPTGain <= lostEPT) break;

            // Check we'll maintain minimum cash after mortgage + build
            const cashAfter = this.player.money + bestMortgage.mortgageValue - bestHousePrice;
            if (cashAfter < this.auctionConfig.absoluteMinCash) break;

            // Execute: mortgage then build
            const mortgageResult = this.engine.mortgageProperty(this.player, bestMortgage.position);
            if (mortgageResult > 0) {
                if (this.engine.buildHouse(this.player, bestTarget)) {
                    keepGoing = true;  // Try another
                }
            }
        }
    }

    /**
     * Override preTurn to add unmortgaging
     */
    preTurn(state) {
        // First, unmortgage properties if we have spare cash
        this.unmortgageProperties(state);

        // Then do normal preTurn (trades, building)
        super.preTurn(state);
    }

    /**
     * Unmortgage properties when we have excess cash
     */
    unmortgageProperties(state) {
        const reserve = this.getMinReserve(state);

        // Find mortgaged properties
        const mortgaged = [];
        for (const propIdx of this.player.properties) {
            const propState = state.propertyStates[propIdx];
            if (propState.mortgaged) {
                const square = BOARD[propIdx];
                const mortgageValue = Math.floor(square.price / 2);
                const unmortgageCost = Math.floor(mortgageValue * 1.1);

                mortgaged.push({
                    position: propIdx,
                    cost: unmortgageCost,
                    mortgageValue: mortgageValue,
                    isMonopoly: this.hasMonopoly(square.group, state),
                    group: square.group
                });
            }
        }

        if (mortgaged.length === 0) return;

        // Sort: monopoly properties first (unmortgage these first), then by cost
        mortgaged.sort((a, b) => {
            if (a.isMonopoly !== b.isMonopoly) {
                return a.isMonopoly ? -1 : 1;
            }
            return a.cost - b.cost;
        });

        // Unmortgage if we have enough excess cash
        for (const prop of mortgaged) {
            // Use threshold to ensure we have comfortable buffer
            const threshold = prop.cost * this.auctionConfig.unmortgageThreshold;

            if (this.player.money - prop.cost >= reserve + threshold) {
                this.engine.unmortgageProperty(this.player, prop.position);
            }
        }
    }

    /**
     * Helper: Check if we have a monopoly on a color group
     */
    hasMonopoly(group, state) {
        if (!group || !COLOR_GROUPS[group]) return false;

        const groupSquares = COLOR_GROUPS[group].squares;
        return groupSquares.every(pos =>
            state.propertyStates[pos].owner === this.player.id
        );
    }
}

// =============================================================================
// PRESET VARIANTS
// =============================================================================

/**
 * OPTIMAL CONFIGURATION (Tournament Winner)
 *
 * Based on extensive testing (1000+ games):
 * - 5% bid premium: captures undervalued properties without overextending
 * - 15% max debt ratio: moderate leverage helps, but conservative wins
 * - $400 max absolute debt: prevents over-leveraging
 * - $75 min cash: maintains liquidity
 * - Smart blocking: only pay blocking premium when sole blocker (saves ~6pp vs naive)
 *
 * Performance:
 * - vs RelativeGrowthAI: 61.7% vs 37.0% (head-to-head)
 * - vs naive blocking: 52.7% vs 46.3% (head-to-head)
 */
class EnhancedRelativeOptimal extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true
        });
        this.name = 'EnhancedRelativeOptimal';
    }
}

/**
 * Conservative: 5% premium, 15% max debt ratio, smart blocking (same as Optimal)
 * Alias for backward compatibility
 */
class EnhancedRelative5 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true
        });
        this.name = 'EnhancedRelative5';
    }
}

/**
 * Moderate: 10% premium, 20% max debt ratio
 * Slightly more aggressive - good but not optimal
 */
class EnhancedRelative10 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.10,
            maxDebtRatio: 0.20,
            maxAbsoluteDebt: 500,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelative10';
    }
}

/**
 * Aggressive: 15% premium, 25% max debt ratio
 * Too aggressive - included for comparison only
 */
class EnhancedRelative15 extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.15,
            maxDebtRatio: 0.25,
            maxAbsoluteDebt: 600,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelative15';
    }
}

/**
 * No debt variant: premium bidding but no mortgaging for bids
 * Tests if the premium alone helps without debt
 */
class EnhancedRelativeNoDebt extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            mortgageForBids: false,
            maxDebtRatio: 0,
            maxAbsoluteDebt: 0,
            absoluteMinCash: 75
        });
        this.name = 'EnhancedRelativeNoDebt';
    }
}

/**
 * Smart Blocking variant: Only pays blocking premium when sole blocker
 *
 * Blocking analysis showed 24% of auction blocking decisions are redundant
 * (someone else is already blocking). This variant avoids overpaying in those cases.
 */
class EnhancedRelativeSmartBlock extends EnhancedRelativeAI {
    constructor(player, engine, markovEngine = null, valuator = null) {
        super(player, engine, markovEngine, valuator, {
            baseBidPremium: 0.05,
            maxDebtRatio: 0.15,
            maxAbsoluteDebt: 400,
            absoluteMinCash: 75,
            smartBlocking: true  // Only pay blocking premium if sole blocker
        });
        this.name = 'EnhancedRelativeSmartBlock';
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    EnhancedRelativeAI,
    EnhancedRelativeOptimal,
    EnhancedRelative5,
    EnhancedRelative10,
    EnhancedRelative15,
    EnhancedRelativeNoDebt,
    EnhancedRelativeSmartBlock
};
