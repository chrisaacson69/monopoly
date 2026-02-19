/**
 * Trade Analytics Module
 *
 * Tracks trade patterns to understand N>2 blocking dynamics:
 * 1. Trade chains: When A-B trade enables A-C or B-C trade
 * 2. Color group distributions: How contested groups evolve
 * 3. Enabler trades: Trades that indirectly create monopolies for 3rd parties
 * 4. Blocking effectiveness: When blocking valuations matter vs redundant
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

class TradeAnalytics {
    constructor() {
        this.reset();
    }

    reset() {
        this.trades = [];               // All trades executed
        this.tradeChains = [];          // Sequences of related trades
        this.groupSnapshots = [];       // Color group ownership over time
        this.enablerTrades = [];        // Trades that enabled 3rd party monopolies
        this.blockingDecisions = [];    // When blocking was considered
        this.monopolyFormations = [];   // When monopolies were completed
    }

    /**
     * Take a snapshot of color group ownership
     */
    snapshotGroups(state, turn) {
        const snapshot = { turn, groups: {} };

        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const owners = {};
            let contested = false;
            let blockedBy = [];

            for (const sq of group.squares) {
                const owner = state.propertyStates[sq].owner;
                if (owner !== null) {
                    owners[owner] = (owners[owner] || 0) + 1;
                }
            }

            const ownerIds = Object.keys(owners).map(Number);

            // Contested if 2+ players own pieces
            if (ownerIds.length >= 2) {
                contested = true;

                // Find who is closest to monopoly and who is blocking
                const sortedOwners = ownerIds
                    .map(id => ({ id, count: owners[id] }))
                    .sort((a, b) => b.count - a.count);

                if (sortedOwners.length >= 2) {
                    // Everyone except the leader is blocking
                    blockedBy = sortedOwners.slice(1).map(o => o.id);
                }
            }

            snapshot.groups[groupName] = {
                owners,
                contested,
                blockedBy,
                complete: ownerIds.length === 1 && owners[ownerIds[0]] === group.squares.length
            };
        }

        this.groupSnapshots.push(snapshot);
        return snapshot;
    }

    /**
     * Record a trade execution
     */
    recordTrade(trade, state, turn) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        // Snapshot groups before
        const beforeSnapshot = this.getLatestSnapshot(turn - 1) || this.snapshotGroups(state, turn);

        const tradeRecord = {
            turn,
            fromPlayerId: from.id,
            toPlayerId: to.id,
            fromProperties: Array.from(fromProperties),
            toProperties: Array.from(toProperties),
            fromCash,
            // Track which groups were affected
            affectedGroups: this.getAffectedGroups(fromProperties, toProperties),
            // Track if this completed any monopolies
            completedMonopolies: [],
            // Track state before trade for analysis
            beforeState: {
                contestedGroups: Object.entries(beforeSnapshot.groups)
                    .filter(([_, g]) => g.contested)
                    .map(([name, _]) => name)
            }
        };

        this.trades.push(tradeRecord);
        return tradeRecord;
    }

    /**
     * Record when a monopoly is formed
     */
    recordMonopolyFormation(playerId, group, turn, viaType) {
        this.monopolyFormations.push({
            turn,
            playerId,
            group,
            viaType,  // 'trade', 'purchase', 'auction'
            precedingTrade: this.trades.length > 0 ? this.trades[this.trades.length - 1] : null
        });
    }

    /**
     * Check for trade chains (A-B trade followed by A-C or B-C trade)
     */
    checkForTradeChain(newTrade, windowTurns = 5) {
        const recentTrades = this.trades.filter(t =>
            t.turn >= newTrade.turn - windowTurns &&
            t !== newTrade
        );

        for (const prevTrade of recentTrades) {
            // Check if same player involved
            const prevPlayers = new Set([prevTrade.fromPlayerId, prevTrade.toPlayerId]);
            const newPlayers = new Set([newTrade.fromPlayerId, newTrade.toPlayerId]);

            const overlap = [...prevPlayers].filter(p => newPlayers.has(p));

            if (overlap.length === 1) {
                // One player in common - potential chain
                const chainPlayer = overlap[0];
                const prevPartner = prevTrade.fromPlayerId === chainPlayer ?
                    prevTrade.toPlayerId : prevTrade.fromPlayerId;
                const newPartner = newTrade.fromPlayerId === chainPlayer ?
                    newTrade.toPlayerId : newTrade.fromPlayerId;

                // Check if same color group involved
                const prevGroups = new Set(prevTrade.affectedGroups);
                const newGroups = new Set(newTrade.affectedGroups);
                const commonGroups = [...prevGroups].filter(g => newGroups.has(g));

                if (commonGroups.length > 0) {
                    this.tradeChains.push({
                        firstTrade: prevTrade,
                        secondTrade: newTrade,
                        chainPlayer,
                        prevPartner,
                        newPartner,
                        commonGroups,
                        turnGap: newTrade.turn - prevTrade.turn
                    });
                }
            }
        }
    }

    /**
     * Analyze if a trade enabled a 3rd party monopoly
     */
    analyzeEnablerEffect(trade, stateAfter) {
        // Check all color groups
        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            // Was this group contested before?
            const beforeSnapshot = this.groupSnapshots[this.groupSnapshots.length - 2];
            if (!beforeSnapshot) continue;

            const beforeGroup = beforeSnapshot.groups[groupName];
            if (!beforeGroup || !beforeGroup.contested) continue;

            // Get current ownership
            const currentOwners = {};
            for (const sq of group.squares) {
                const owner = stateAfter.propertyStates[sq].owner;
                if (owner !== null) {
                    currentOwners[owner] = (currentOwners[owner] || 0) + 1;
                }
            }

            // Check if a 3rd party (not in trade) now has easier path to monopoly
            const tradeParties = new Set([trade.fromPlayerId, trade.toPlayerId]);

            for (const [ownerId, count] of Object.entries(currentOwners)) {
                const id = parseInt(ownerId);
                if (tradeParties.has(id)) continue;

                // Check if their position improved
                const beforeCount = beforeGroup.owners[id] || 0;
                if (count > beforeCount) {
                    // 3rd party gained in this group - shouldn't happen from trade
                    // But their relative position could improve if blockers traded away
                }

                // More importantly: check if they now have clearer path
                // (fewer blockers in this group)
                const beforeBlockers = Object.keys(beforeGroup.owners).length;
                const afterBlockers = Object.keys(currentOwners).length;

                if (afterBlockers < beforeBlockers && count > 0) {
                    this.enablerTrades.push({
                        trade,
                        beneficiary: id,
                        group: groupName,
                        beforeBlockers,
                        afterBlockers,
                        theirCount: count,
                        groupSize: group.squares.length
                    });
                }
            }
        }
    }

    /**
     * Record a blocking decision
     */
    recordBlockingDecision(context) {
        const {
            playerId,
            decisionType,  // 'auction_bid', 'trade_accept', 'trade_reject', 'purchase'
            targetGroup,
            opponentId,
            wasAlreadyBlocked,  // Was this group already blocked by someone else?
            otherBlockers,      // Who else is blocking?
            valueAssigned,      // How much blocking value was assigned
            turn
        } = context;

        this.blockingDecisions.push({
            turn,
            playerId,
            decisionType,
            targetGroup,
            opponentId,
            wasAlreadyBlocked,
            otherBlockers: otherBlockers || [],
            valueAssigned: valueAssigned || 0,
            redundant: wasAlreadyBlocked && otherBlockers && otherBlockers.length > 0
        });
    }

    /**
     * Get groups affected by a set of properties
     */
    getAffectedGroups(props1, props2) {
        const groups = new Set();

        const allProps = [...(props1 || []), ...(props2 || [])];
        for (const prop of allProps) {
            const square = BOARD[prop];
            if (square && square.group) {
                groups.add(square.group);
            }
        }

        return Array.from(groups);
    }

    /**
     * Get latest snapshot before a given turn
     */
    getLatestSnapshot(turn) {
        for (let i = this.groupSnapshots.length - 1; i >= 0; i--) {
            if (this.groupSnapshots[i].turn <= turn) {
                return this.groupSnapshots[i];
            }
        }
        return null;
    }

    /**
     * Generate summary report
     */
    generateReport() {
        const report = {
            totalTrades: this.trades.length,
            tradeChains: this.tradeChains.length,
            enablerTrades: this.enablerTrades.length,
            monopolyFormations: this.monopolyFormations.length,
            blockingDecisions: {
                total: this.blockingDecisions.length,
                redundant: this.blockingDecisions.filter(d => d.redundant).length,
                byType: {}
            }
        };

        // Breakdown blocking by type
        for (const d of this.blockingDecisions) {
            if (!report.blockingDecisions.byType[d.decisionType]) {
                report.blockingDecisions.byType[d.decisionType] = { total: 0, redundant: 0 };
            }
            report.blockingDecisions.byType[d.decisionType].total++;
            if (d.redundant) {
                report.blockingDecisions.byType[d.decisionType].redundant++;
            }
        }

        // Trade chain analysis
        if (this.tradeChains.length > 0) {
            report.tradeChainDetails = {
                avgTurnGap: this.tradeChains.reduce((s, c) => s + c.turnGap, 0) / this.tradeChains.length,
                commonGroups: {}
            };

            for (const chain of this.tradeChains) {
                for (const group of chain.commonGroups) {
                    report.tradeChainDetails.commonGroups[group] =
                        (report.tradeChainDetails.commonGroups[group] || 0) + 1;
                }
            }
        }

        // Enabler trade analysis
        if (this.enablerTrades.length > 0) {
            report.enablerDetails = {
                byGroup: {}
            };

            for (const e of this.enablerTrades) {
                report.enablerDetails.byGroup[e.group] =
                    (report.enablerDetails.byGroup[e.group] || 0) + 1;
            }
        }

        // Monopoly formation analysis
        if (this.monopolyFormations.length > 0) {
            report.monopolyDetails = {
                byType: {},
                byGroup: {}
            };

            for (const m of this.monopolyFormations) {
                report.monopolyDetails.byType[m.viaType] =
                    (report.monopolyDetails.byType[m.viaType] || 0) + 1;
                report.monopolyDetails.byGroup[m.group] =
                    (report.monopolyDetails.byGroup[m.group] || 0) + 1;
            }
        }

        return report;
    }

    /**
     * Print detailed report
     */
    printReport() {
        const report = this.generateReport();

        console.log('\n' + '='.repeat(70));
        console.log('TRADE ANALYTICS REPORT');
        console.log('='.repeat(70));

        console.log(`\nTotal trades executed: ${report.totalTrades}`);
        console.log(`Trade chains detected: ${report.tradeChains}`);
        console.log(`Enabler trades (helped 3rd party): ${report.enablerTrades}`);
        console.log(`Monopolies formed: ${report.monopolyFormations}`);

        console.log('\n--- BLOCKING DECISIONS ---');
        console.log(`Total blocking considerations: ${report.blockingDecisions.total}`);
        console.log(`Redundant blocks (already blocked): ${report.blockingDecisions.redundant}`);
        if (report.blockingDecisions.total > 0) {
            const redundantPct = (report.blockingDecisions.redundant / report.blockingDecisions.total * 100).toFixed(1);
            console.log(`Redundant block rate: ${redundantPct}%`);
        }

        console.log('\nBy decision type:');
        for (const [type, data] of Object.entries(report.blockingDecisions.byType)) {
            const pct = data.total > 0 ? (data.redundant / data.total * 100).toFixed(0) : 0;
            console.log(`  ${type}: ${data.total} total, ${data.redundant} redundant (${pct}%)`);
        }

        if (report.tradeChainDetails) {
            console.log('\n--- TRADE CHAINS ---');
            console.log(`Average turn gap: ${report.tradeChainDetails.avgTurnGap.toFixed(1)}`);
            console.log('Most common groups in chains:');
            for (const [group, count] of Object.entries(report.tradeChainDetails.commonGroups)) {
                console.log(`  ${group}: ${count}`);
            }
        }

        if (report.monopolyDetails) {
            console.log('\n--- MONOPOLY FORMATIONS ---');
            console.log('By type:');
            for (const [type, count] of Object.entries(report.monopolyDetails.byType)) {
                console.log(`  ${type}: ${count}`);
            }
            console.log('By group:');
            for (const [group, count] of Object.entries(report.monopolyDetails.byGroup)) {
                console.log(`  ${group}: ${count}`);
            }
        }
    }
}

module.exports = { TradeAnalytics };
