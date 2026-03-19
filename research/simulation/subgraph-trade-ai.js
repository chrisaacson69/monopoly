/**
 * Subgraph Trade AI
 *
 * Extends StrategicTradeAI with subgraph-driven trade search.
 * This AI can both EVALUATE incoming trades (inherited) and
 * GENERATE proactive trade proposals using the subgraph framework.
 *
 * Decision flow:
 * 1. Analyze own subgraph (complete sets, partials, isolated)
 * 2. If GROWING (high build ROI): just build, skip trade search
 * 3. If CAPPED or LOSING: run trade search engine
 * 4. If trade found: propose to opponent
 * 5. If no trade or rejected: build best available
 *
 * See vault: projects/monopoly/subgraph-trade-engine-spec.md
 */

'use strict';

const { BOARD, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');
const { analyzeSubgraph, printSubgraph } = require('./subgraph-analyzer.js');
const { searchTrades, printTradeSearch } = require('./trade-search-engine.js');

class SubgraphTradeAI extends StrategicTradeAI {
    constructor(player, engine, markovEngine, valuator, options = {}) {
        super(player, engine, markovEngine, valuator, options);
        this.name = 'SubgraphTradeAI';

        this.config = {
            // Skip trade search if build ROI exceeds this
            minROIToSkipTrade: options.minROIToSkipTrade || 0.02,

            // Max fraction of cash to offer in a trade
            maxCashOffer: options.maxCashOffer || 0.5,

            // Min cash reserve after trade
            minReserveAfterTrade: options.minReserveAfterTrade || 150,

            // Cooldown: turns before re-proposing to same player
            proposalCooldown: options.proposalCooldown || 5,

            // Enable debug logging
            verbose: options.verbose || false,

            ...options
        };

        // Track proposals to avoid spamming
        this.proposalHistory = new Map();  // `${myId}-${theirId}` -> lastTurn
        this.tradesProposed = 0;
        this.tradesAccepted = 0;
        this.tradesRejected = 0;
    }

    /**
     * Override preTurn: analyze subgraph, search for trades, then build
     */
    preTurn(state) {
        // Step 1: Attempt subgraph-driven trade
        this.attemptSubgraphTrade(state);

        // Step 2: Build houses (inherited from parent chain)
        // The parent's preTurn handles building + unmortgaging
        super.preTurn(state);
    }

    /**
     * Run the subgraph trade search and attempt to execute the best trade
     */
    attemptSubgraphTrade(state) {
        // Check cooldowns
        this.cleanupCooldowns(state.turn);

        // Run trade search
        const result = searchTrades(this.player.id, state, this.markovEngine, {
            minROIThreshold: this.config.minROIToSkipTrade,
            maxCashOffer: this.config.maxCashOffer,
            verbose: this.config.verbose
        });

        if (!result) return;

        if (this.config.verbose) {
            printTradeSearch(result, this.player.id);
        }

        if (result.type === 'bilateral') {
            this.executeBilateralProposal(result, state);
        } else if (result.type === 'three_way') {
            // 3-way trades need both opponents to agree
            // For now, attempt the first leg as a bilateral
            // Full 3-way negotiation is future work (negotiator module)
            if (result.legs && result.legs.length > 0) {
                const firstLeg = result.legs.find(l => l.from === this.player.id);
                if (firstLeg) {
                    this.executeThreeWayFirstLeg(firstLeg, result, state);
                }
            }
        }
    }

    /**
     * Propose a bilateral trade to an opponent
     */
    executeBilateralProposal(tradeResult, state) {
        const opponentId = tradeResult.to;
        const opponent = state.players[opponentId];

        if (!opponent || opponent.bankrupt) return;

        // Check proposal cooldown
        const cooldownKey = `${this.player.id}-${opponentId}`;
        const lastProposal = this.proposalHistory.get(cooldownKey);
        if (lastProposal && state.turn - lastProposal < this.config.proposalCooldown) {
            return;
        }

        // Check cash reserve
        const cashOffered = tradeResult.cashDelta < 0 ? Math.abs(tradeResult.cashDelta) : 0;
        if (cashOffered > 0 && this.player.money - cashOffered < this.config.minReserveAfterTrade) {
            // Reduce cash offer to maintain reserve
            const maxCash = Math.max(0, this.player.money - this.config.minReserveAfterTrade);
            if (maxCash <= 0) return;
            tradeResult.cashDelta = -maxCash;
        }

        // Build the trade object in the game engine's format
        const trade = {
            from: this.player,
            to: opponent,
            fromProperties: new Set(tradeResult.give || []),
            toProperties: new Set(tradeResult.receive || []),
            fromCash: tradeResult.cashDelta < 0 ? Math.abs(tradeResult.cashDelta) : 0
        };

        // If we're receiving cash (selling), flip the perspective
        if (tradeResult.cashDelta > 0) {
            trade.fromCash = -tradeResult.cashDelta;  // Negative = they pay us
        }

        // Propose to opponent's AI
        if (opponent.ai && opponent.ai.evaluateTrade) {
            this.tradesProposed++;
            const accepted = opponent.ai.evaluateTrade(trade, state);

            if (accepted) {
                this.tradesAccepted++;
                this.engine.executeTrade(trade);

                // Record cooldown
                this.proposalHistory.set(cooldownKey, state.turn);

                if (this.config.verbose) {
                    console.log(`P${this.player.id}: Trade ACCEPTED by P${opponentId}`);
                }
            } else {
                this.tradesRejected++;
                // Record cooldown even on rejection to avoid spamming
                this.proposalHistory.set(cooldownKey, state.turn);

                if (this.config.verbose) {
                    console.log(`P${this.player.id}: Trade REJECTED by P${opponentId}`);
                }
            }
        }
    }

    /**
     * Attempt the first leg of a 3-way trade as a bilateral proposal.
     * Full 3-way negotiation is future work.
     */
    executeThreeWayFirstLeg(leg, fullCycle, state) {
        // For now, just try to buy the piece we need from whoever has it
        // This is a degraded version of the 3-way trade
        if (this.config.verbose) {
            console.log(`P${this.player.id}: 3-way cycle found but executing as bilateral`);
            console.log(`  Full cycle: ${fullCycle.description}`);
        }

        // Find the leg where we RECEIVE something
        const receiveLeg = fullCycle.legs.find(l => l.to === this.player.id);
        if (!receiveLeg) return;

        // Try to buy it directly
        const bilateralResult = {
            from: this.player.id,
            to: receiveLeg.from,
            give: [],
            receive: [receiveLeg.square],
            cashDelta: -Math.round(receiveLeg.receiverGain * 3),  // Rough pricing
            myEPTGain: receiveLeg.receiverGain,
            reason: `3-way fallback: buy ${PROPERTIES[receiveLeg.square]?.name}`
        };

        this.executeBilateralProposal(bilateralResult, state);
    }

    /**
     * Override evaluateTrade: use subgraph analysis for incoming offers
     */
    evaluateTrade(offer, state) {
        const { from, to, fromProperties, toProperties, fromCash } = offer;

        if (to.id !== this.player.id) return false;

        // Get parent's decision first
        const parentAccepts = super.evaluateTrade(offer, state);

        // Additionally, check subgraph impact
        const mySubgraph = analyzeSubgraph(this.player.id, state, this.markovEngine);

        // If we're LOSING, be more willing to accept trades
        if (mySubgraph.positionState.startsWith('LOSING')) {
            // Accept any trade that gives us a set completion piece
            const propsGained = fromProperties instanceof Set
                ? [...fromProperties] : (fromProperties || []);

            for (const sq of propsGained) {
                for (const partial of mySubgraph.partialSets) {
                    if (partial.needed.includes(sq)) {
                        // This gives us a piece we need — accept even if parent rejects
                        return true;
                    }
                }
            }
        }

        return parentAccepts;
    }

    /**
     * Clean up expired cooldowns
     */
    cleanupCooldowns(currentTurn) {
        for (const [key, lastTurn] of this.proposalHistory.entries()) {
            if (currentTurn - lastTurn >= this.config.proposalCooldown) {
                this.proposalHistory.delete(key);
            }
        }
    }

    /**
     * Get trade statistics for analysis
     */
    getTradeStats() {
        return {
            proposed: this.tradesProposed,
            accepted: this.tradesAccepted,
            rejected: this.tradesRejected,
            acceptRate: this.tradesProposed > 0
                ? (this.tradesAccepted / this.tradesProposed * 100).toFixed(1) + '%'
                : 'N/A'
        };
    }
}

// =============================================================================
// PRESET VARIANTS
// =============================================================================

class SubgraphVerbose extends SubgraphTradeAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator, { verbose: true });
        this.name = 'SubgraphVerbose';
    }
}

class SubgraphAggressive extends SubgraphTradeAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator, {
            maxCashOffer: 0.7,
            minReserveAfterTrade: 100,
            proposalCooldown: 3
        });
        this.name = 'SubgraphAggressive';
    }
}

class SubgraphConservative extends SubgraphTradeAI {
    constructor(player, engine, markovEngine, valuator) {
        super(player, engine, markovEngine, valuator, {
            maxCashOffer: 0.3,
            minReserveAfterTrade: 300,
            minROIToSkipTrade: 0.03,
            proposalCooldown: 8
        });
        this.name = 'SubgraphConservative';
    }
}

module.exports = {
    SubgraphTradeAI,
    SubgraphVerbose,
    SubgraphAggressive,
    SubgraphConservative
};
