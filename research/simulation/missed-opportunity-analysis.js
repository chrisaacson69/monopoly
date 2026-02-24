/**
 * Missed Opportunity Analysis
 *
 * Quantifies how often the AI leaves +EV investments on the table because
 * of cash constraints that mortgage could solve.
 *
 * Tracks two types of missed opportunities:
 *   1. Missed purchases — player can't afford a property but mortgaging would cover it
 *   2. Missed builds — profitable houses available but cash < reserve + housePrice
 *
 * For each, computes marginal EPT gain vs marginal EPT cost of mortgaging,
 * to determine whether the opportunity was genuinely +EV.
 *
 * Usage: node missed-opportunity-analysis.js [games]
 */

'use strict';

const { GameEngine, BOARD, COLOR_GROUPS, PROPERTIES } = require('./game-engine.js');
const { StrategicTradeAI } = require('./strategic-trade-ai.js');
const { getCachedEngines } = require('./cached-engines.js');

const { markovEngine, valuator } = getCachedEngines();

const RAILROAD_RENT = { 1: 25, 2: 50, 3: 100, 4: 200 };
const UTILITY_MULTIPLIER = { 1: 4, 2: 10 };

// =============================================================================
// INSTRUMENTED GAME ENGINE
// =============================================================================

class OpportunityTrackingEngine extends GameEngine {
    constructor(options = {}) {
        super(options);
        this.missedPurchases = [];
        this.missedBuilds = [];
    }

    runGame() {
        while (!this.state.isGameOver() && this.state.turn < this.options.maxTurns) {
            this.executeTurn();
        }

        const winner = this.state.getWinner();
        return {
            winner: winner ? winner.id : null,
            turns: this.state.turn,
            stats: this.state.stats,
            missedPurchases: this.missedPurchases,
            missedBuilds: this.missedBuilds
        };
    }

    /**
     * Override: detect cash-constrained purchase failures
     */
    handlePropertyPurchase(player, position) {
        const square = BOARD[position];
        const ai = player.ai;
        const cantAfford = player.money < square.price;

        if (cantAfford && ai && !player.bankrupt) {
            // Would the AI have wanted to buy?
            // For strategic decisions, the AI says yes regardless of money.
            // We need to check the logic without the affordability gate.
            const wouldComplete = ai.wouldCompleteMonopoly(position, this.state);
            const wouldBlock = ai.wouldBlockMonopoly(position, this.state);

            // In StrategicAI.decideBuy: strategic properties → buy if can afford
            // Non-strategic: buy if early game, or payback < 50 turns
            let wouldWant = false;
            if (wouldComplete || wouldBlock) {
                wouldWant = true;  // AI always wants strategic properties
            } else if (this.state.phase === 'early') {
                wouldWant = true;  // AI buys everything early
            } else if (ai.probs) {
                const diffValue = ai.calculateDifferentialValue(position, this.state);
                const payback = square.price / Math.max(diffValue, 0.01);
                wouldWant = payback < 50;
            }

            if (wouldWant) {
                // Compute mortgage capacity
                const mortgageInfo = this.computeMortgageCapacity(ai, position, this.state);

                this.missedPurchases.push({
                    turn: this.state.turn,
                    playerId: player.id,
                    position,
                    propertyName: square.name,
                    group: square.group || null,
                    price: square.price,
                    playerCash: player.money,
                    shortfall: square.price - player.money,
                    wouldComplete,
                    wouldBlock,
                    isStrategic: wouldComplete || wouldBlock,
                    // Mortgage analysis
                    mortgageCapacity: mortgageInfo.capacity,
                    couldAffordWithMortgage: mortgageInfo.couldAfford,
                    lostEPT: mortgageInfo.lostEPT,
                    gainedEPT: this.computePropertyEPT(ai, position, wouldComplete),
                    netEPT: null  // filled below
                });

                const rec = this.missedPurchases[this.missedPurchases.length - 1];
                rec.netEPT = rec.gainedEPT - rec.lostEPT;
            }
        }

        // Call parent — handles normal buy or auction
        super.handlePropertyPurchase(player, position);
    }

    /**
     * Override: detect missed builds after preTurn completes
     */
    executeTurn() {
        const player = this.state.getCurrentPlayer();

        if (player.bankrupt) {
            this.advanceToNextPlayer();
            return;
        }

        this.log(`${player.name}'s turn (money: $${player.money})`);

        // Pre-turn: AI builds houses, proposes trades
        if (player.ai && player.ai.preTurn) {
            player.ai.preTurn(this.state);
        }

        // After building is done, check for missed build opportunities
        this.checkMissedBuilds(player);

        // Handle jail or normal turn
        if (player.inJail) {
            this.handleJailTurn(player);
        } else {
            this.handleNormalTurn(player);
        }

        // Post-turn
        if (player.ai && player.ai.postTurn) {
            player.ai.postTurn(this.state);
        }

        this.advanceToNextPlayer();
    }

    /**
     * After building completes, check if profitable builds remain that
     * the player couldn't afford but could have with mortgage
     */
    checkMissedBuilds(player) {
        const ai = player.ai;
        if (!ai || !ai.probs) return;

        const monopolies = player.getMonopolies(this.state);
        if (monopolies.length === 0) return;

        const reserve = ai.getMinReserve(this.state);
        const opponents = this.state.players.filter(p =>
            p.id !== player.id && !p.bankrupt
        ).length;
        if (opponents === 0) return;

        // Find best unbought house (same logic as buildOptimalHouses)
        let bestROI = 0;
        let bestTarget = null;
        let bestEPTGain = 0;
        let bestHouseLevel = 0;
        let bestHousePrice = 0;
        let bestGroup = null;

        for (const group of monopolies) {
            const groupSquares = COLOR_GROUPS[group].squares;
            const housePrice = BOARD[groupSquares[0]].housePrice;

            for (const sq of groupSquares) {
                const houses = this.state.propertyStates[sq].houses || 0;
                if (houses >= 5) continue;

                // Check even building rule
                const minInGroup = Math.min(...groupSquares.map(s =>
                    this.state.propertyStates[s].houses || 0
                ));
                if (houses > minInGroup) continue;

                // Check house availability
                if (houses < 4 && this.state.housesAvailable <= 0) continue;
                if (houses === 4 && this.state.hotelsAvailable <= 0) continue;

                const prob = ai.probs[sq];
                const currentRent = houses === 0
                    ? BOARD[sq].rent[0] * 2
                    : BOARD[sq].rent[houses];
                const newRent = BOARD[sq].rent[houses + 1];
                const eptIncrease = prob * (newRent - currentRent) * opponents;
                const marginalROI = eptIncrease / housePrice;

                if (marginalROI > bestROI) {
                    bestROI = marginalROI;
                    bestTarget = sq;
                    bestEPTGain = eptIncrease;
                    bestHouseLevel = houses;
                    bestHousePrice = housePrice;
                    bestGroup = group;
                }
            }
        }

        // If there's a profitable build but player can't afford it
        if (bestTarget !== null && bestROI > 0.001) {
            const canAffordBuild = player.money - bestHousePrice >= reserve;
            if (!canAffordBuild) {
                // Cash-constrained — compute mortgage capacity
                const needed = (reserve + bestHousePrice) - player.money;
                const mortgageInfo = this.computeMortgageCapacity(ai, null, this.state);
                const couldAfford = player.money + mortgageInfo.capacity >= reserve + bestHousePrice;

                this.missedBuilds.push({
                    turn: this.state.turn,
                    playerId: player.id,
                    group: bestGroup,
                    position: bestTarget,
                    propertyName: BOARD[bestTarget].name,
                    houseLevel: `${bestHouseLevel}→${bestHouseLevel + 1}`,
                    housePrice: bestHousePrice,
                    playerCash: player.money,
                    reserve,
                    shortfall: needed,
                    marginalROI: bestROI,
                    gainedEPT: bestEPTGain,
                    // Mortgage analysis
                    mortgageCapacity: mortgageInfo.capacity,
                    couldAffordWithMortgage: couldAfford,
                    lostEPT: mortgageInfo.lostEPT,
                    netEPT: bestEPTGain - mortgageInfo.lostEPT
                });
            }
        }
    }

    /**
     * Compute how much cash a player could raise by mortgaging,
     * and what EPT they'd lose.
     *
     * Uses the AI's own mortgage infrastructure (getMortgageableProperties,
     * getAvailableDebtCapacity) for realistic debt limits.
     */
    computeMortgageCapacity(ai, targetPosition, state) {
        // Get mortgageable properties (sorted: non-monopoly first, lowest value first)
        let mortgageable;
        if (ai.getMortgageableProperties) {
            mortgageable = ai.getMortgageableProperties(state);
        } else {
            // Fallback for AIs without the method
            mortgageable = [];
            for (const propIdx of ai.player.properties) {
                const propState = state.propertyStates[propIdx];
                if (!propState.mortgaged && propState.houses === 0) {
                    mortgageable.push({
                        position: propIdx,
                        value: BOARD[propIdx].price,
                        mortgageValue: Math.floor(BOARD[propIdx].price / 2)
                    });
                }
            }
        }

        // Don't mortgage the property we're trying to buy
        if (targetPosition !== null) {
            mortgageable = mortgageable.filter(p => p.position !== targetPosition);
        }

        // Get debt capacity
        let debtCapacity = Infinity;
        if (ai.getAvailableDebtCapacity) {
            debtCapacity = ai.getAvailableDebtCapacity(state);
        }

        // Compute total mortgage capacity and lost EPT
        let capacity = 0;
        let lostEPT = 0;
        let addedDebt = 0;
        const opponents = state.players.filter(p =>
            p.id !== ai.player.id && !p.bankrupt
        ).length;

        for (const prop of mortgageable) {
            if (addedDebt + prop.mortgageValue > debtCapacity) continue;

            capacity += prop.mortgageValue;
            addedDebt += prop.mortgageValue;

            // EPT lost from mortgaging this property
            const sq = BOARD[prop.position];
            if (ai.probs) {
                const prob = ai.probs[prop.position];

                if (PROPERTIES[prop.position]) {
                    // Street property — currently earning base rent (no houses since mortgageable)
                    const rent = sq.rent[0];  // No monopoly bonus since we're mortgaging
                    lostEPT += prob * rent * opponents;
                } else if ([5, 15, 25, 35].includes(prop.position)) {
                    // Railroad — losing one drops rent tier
                    const currentRRCount = ai.player.getRailroadCount
                        ? ai.player.getRailroadCount() : 1;
                    const currentRent = RAILROAD_RENT[currentRRCount] || 25;
                    const newRent = RAILROAD_RENT[Math.max(1, currentRRCount - 1)] || 25;
                    lostEPT += prob * (currentRent - newRent) * opponents;
                } else if ([12, 28].includes(prop.position)) {
                    // Utility
                    const utilCount = ai.player.getUtilityCount
                        ? ai.player.getUtilityCount() : 1;
                    const currentMult = UTILITY_MULTIPLIER[utilCount] || 4;
                    const newMult = UTILITY_MULTIPLIER[Math.max(1, utilCount - 1)] || 4;
                    lostEPT += prob * (currentMult - newMult) * 7 * opponents;
                }
            }
        }

        return {
            capacity,
            couldAfford: false,  // Caller sets this based on context
            lostEPT,
            propertiesAvailable: mortgageable.length
        };
    }

    /**
     * Compute the EPT gain from acquiring a property
     */
    computePropertyEPT(ai, position, wouldComplete) {
        if (!ai.probs) return 0;

        const prob = ai.probs[position];
        const square = BOARD[position];
        const opponents = this.state.players.filter(p =>
            p.id !== ai.player.id && !p.bankrupt
        ).length;

        if (PROPERTIES[position]) {
            // If completing monopoly, value at 3-house rent (development potential)
            // Otherwise, base rent
            if (wouldComplete) {
                return prob * square.rent[3] * opponents;
            }
            return prob * square.rent[0] * opponents;
        }

        if ([5, 15, 25, 35].includes(position)) {
            const currentRRCount = ai.player.getRailroadCount
                ? ai.player.getRailroadCount() : 0;
            const newRent = RAILROAD_RENT[currentRRCount + 1] || 25;
            const currentRent = RAILROAD_RENT[currentRRCount] || 0;
            return prob * (newRent - currentRent) * opponents;
        }

        if ([12, 28].includes(position)) {
            const utilCount = ai.player.getUtilityCount
                ? ai.player.getUtilityCount() : 0;
            const newMult = UTILITY_MULTIPLIER[utilCount + 1] || 4;
            const currentMult = UTILITY_MULTIPLIER[utilCount] || 0;
            return prob * (newMult - currentMult) * 7 * opponents;
        }

        return 0;
    }
}

// =============================================================================
// ANALYSIS RUNNER
// =============================================================================

function runAnalysis(numGames) {
    console.log('='.repeat(80));
    console.log('MISSED OPPORTUNITY ANALYSIS');
    console.log(`${numGames} games, 4 StrategicTradeAI, normal game mode`);
    console.log('='.repeat(80));
    console.log();

    const allMissedPurchases = [];
    const allMissedBuilds = [];
    const winnerIds = [];
    const gameCount = numGames;
    const startTime = Date.now();

    function createFactory() {
        return (player, engine) => {
            return new StrategicTradeAI(player, engine, markovEngine, valuator);
        };
    }

    for (let i = 0; i < numGames; i++) {
        const engine = new OpportunityTrackingEngine({ maxTurns: 500 });
        const factories = [createFactory(), createFactory(), createFactory(), createFactory()];
        engine.newGame(4, factories);
        const result = engine.runGame();

        const winnerId = result.winner;
        winnerIds.push(winnerId);

        // Tag each record with winner/loser status
        for (const rec of result.missedPurchases) {
            rec.isWinner = rec.playerId === winnerId;
            allMissedPurchases.push(rec);
        }
        for (const rec of result.missedBuilds) {
            rec.isWinner = rec.playerId === winnerId;
            allMissedBuilds.push(rec);
        }

        if ((i + 1) % 100 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            console.log(`  Game ${i + 1}/${numGames}  ${elapsed.toFixed(0)}s`);
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\nCompleted in ${elapsed.toFixed(1)}s\n`);

    // =========================================================================
    // REPORT: MISSED PURCHASES
    // =========================================================================
    console.log('='.repeat(80));
    console.log('1. MISSED PURCHASES');
    console.log('   "Player wanted to buy but couldn\'t afford it"');
    console.log('='.repeat(80));
    console.log();

    const mp = allMissedPurchases;
    const mpPerGame = mp.length / gameCount;
    const mpCouldMortgage = mp.filter(r => r.couldAffordWithMortgage);
    const mpPositiveEV = mpCouldMortgage.filter(r => r.netEPT > 0);
    const mpStrategic = mp.filter(r => r.isStrategic);
    const mpWinners = mp.filter(r => r.isWinner);
    const mpLosers = mp.filter(r => !r.isWinner);

    console.log(`  Total: ${mp.length} (${mpPerGame.toFixed(2)} per game)`);
    console.log(`  Could mortgage to afford: ${mpCouldMortgage.length} (${pct(mpCouldMortgage.length, mp.length)})`);
    console.log(`  Of those, net +EV: ${mpPositiveEV.length} (${pct(mpPositiveEV.length, mpCouldMortgage.length)})`);

    if (mpPositiveEV.length > 0) {
        const avgNetEPT = mpPositiveEV.reduce((s, r) => s + r.netEPT, 0) / mpPositiveEV.length;
        const avgShortfall = mpPositiveEV.reduce((s, r) => s + r.shortfall, 0) / mpPositiveEV.length;
        console.log(`  Avg net EPT gain: $${avgNetEPT.toFixed(2)}/ply`);
        console.log(`  Avg cash shortfall: $${avgShortfall.toFixed(0)}`);
    }

    console.log(`  Strategic (monopoly/block): ${mpStrategic.length} (${pct(mpStrategic.length, mp.length)})`);
    const mpStratComplete = mp.filter(r => r.wouldComplete);
    const mpStratBlock = mp.filter(r => r.wouldBlock);
    console.log(`    Monopoly completion: ${mpStratComplete.length}`);
    console.log(`    Blocking: ${mpStratBlock.length}`);
    console.log(`  Winners missed: ${mpWinners.length} (${(mpWinners.length / Math.max(1, gameCount)).toFixed(2)}/game)`);
    console.log(`  Losers missed: ${mpLosers.length} (${(mpLosers.length / Math.max(1, gameCount * 3)).toFixed(2)}/game each)`);

    // By property group
    if (mp.length > 0) {
        console.log('\n  By group:');
        const byGroup = {};
        for (const r of mp) {
            const g = r.group || 'railroad/utility';
            if (!byGroup[g]) byGroup[g] = { total: 0, positiveEV: 0, strategic: 0 };
            byGroup[g].total++;
            if (r.couldAffordWithMortgage && r.netEPT > 0) byGroup[g].positiveEV++;
            if (r.isStrategic) byGroup[g].strategic++;
        }
        const sorted = Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total);
        console.log('    Group'.padEnd(20) + 'Total'.padEnd(8) + '+EV'.padEnd(8) + 'Strategic');
        console.log('    ' + '-'.repeat(44));
        for (const [group, data] of sorted) {
            console.log('    ' + group.padEnd(20) +
                String(data.total).padEnd(8) +
                String(data.positiveEV).padEnd(8) +
                String(data.strategic));
        }
    }

    // =========================================================================
    // REPORT: MISSED BUILDS
    // =========================================================================
    console.log();
    console.log('='.repeat(80));
    console.log('2. MISSED BUILDS');
    console.log('   "Profitable house available but cash-constrained"');
    console.log('='.repeat(80));
    console.log();

    const mb = allMissedBuilds;
    const mbPerGame = mb.length / gameCount;
    const mbCouldMortgage = mb.filter(r => r.couldAffordWithMortgage);
    const mbPositiveEV = mbCouldMortgage.filter(r => r.netEPT > 0);
    const mbWinners = mb.filter(r => r.isWinner);
    const mbLosers = mb.filter(r => !r.isWinner);

    console.log(`  Total: ${mb.length} (${mbPerGame.toFixed(2)} per game)`);
    console.log(`  Could mortgage to afford: ${mbCouldMortgage.length} (${pct(mbCouldMortgage.length, mb.length)})`);
    console.log(`  Of those, net +EV: ${mbPositiveEV.length} (${pct(mbPositiveEV.length, mbCouldMortgage.length)})`);

    if (mbPositiveEV.length > 0) {
        const avgROI = mbPositiveEV.reduce((s, r) => s + r.marginalROI, 0) / mbPositiveEV.length;
        const avgNetEPT = mbPositiveEV.reduce((s, r) => s + r.netEPT, 0) / mbPositiveEV.length;
        const avgShortfall = mbPositiveEV.reduce((s, r) => s + r.shortfall, 0) / mbPositiveEV.length;
        console.log(`  Avg marginal ROI of missed: ${(avgROI * 100).toFixed(2)}%`);
        console.log(`  Avg net EPT gain: $${avgNetEPT.toFixed(2)}/ply`);
        console.log(`  Avg cash shortfall: $${avgShortfall.toFixed(0)}`);
    }

    console.log(`  Winners missed: ${mbWinners.length} (${(mbWinners.length / Math.max(1, gameCount)).toFixed(2)}/game)`);
    console.log(`  Losers missed: ${mbLosers.length} (${(mbLosers.length / Math.max(1, gameCount * 3)).toFixed(2)}/game each)`);

    // By house level
    if (mb.length > 0) {
        console.log('\n  By house level:');
        const byLevel = {};
        for (const r of mb) {
            if (!byLevel[r.houseLevel]) byLevel[r.houseLevel] = { total: 0, positiveEV: 0 };
            byLevel[r.houseLevel].total++;
            if (r.couldAffordWithMortgage && r.netEPT > 0) byLevel[r.houseLevel].positiveEV++;
        }
        console.log('    Level'.padEnd(12) + 'Total'.padEnd(8) + '+EV');
        console.log('    ' + '-'.repeat(28));
        for (const [level, data] of Object.entries(byLevel).sort()) {
            console.log('    ' + level.padEnd(12) + String(data.total).padEnd(8) + String(data.positiveEV));
        }

        // By group
        console.log('\n  By group:');
        const byGroup = {};
        for (const r of mb) {
            if (!byGroup[r.group]) byGroup[r.group] = { total: 0, positiveEV: 0, avgROI: 0, roiSum: 0 };
            byGroup[r.group].total++;
            byGroup[r.group].roiSum += r.marginalROI;
            if (r.couldAffordWithMortgage && r.netEPT > 0) byGroup[r.group].positiveEV++;
        }
        const sortedGroups = Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total);
        console.log('    Group'.padEnd(16) + 'Total'.padEnd(8) + '+EV'.padEnd(8) + 'Avg ROI');
        console.log('    ' + '-'.repeat(40));
        for (const [group, data] of sortedGroups) {
            console.log('    ' + group.padEnd(16) +
                String(data.total).padEnd(8) +
                String(data.positiveEV).padEnd(8) +
                (data.roiSum / data.total * 100).toFixed(2) + '%');
        }
    }

    // =========================================================================
    // REPORT: BY GAME PHASE
    // =========================================================================
    console.log();
    console.log('='.repeat(80));
    console.log('3. BY GAME PHASE');
    console.log('='.repeat(80));
    console.log();

    const phases = [
        { label: 'Early (1-20)', min: 1, max: 20 },
        { label: 'Mid (21-50)', min: 21, max: 50 },
        { label: 'Late (51+)', min: 51, max: Infinity }
    ];

    console.log('    Phase'.padEnd(20) + 'Purchases'.padEnd(14) + '+EV'.padEnd(8) +
        'Builds'.padEnd(10) + '+EV');
    console.log('    ' + '-'.repeat(52));

    for (const phase of phases) {
        const pPurchases = mp.filter(r => r.turn >= phase.min && r.turn <= phase.max);
        const pPurchasesEV = pPurchases.filter(r => r.couldAffordWithMortgage && r.netEPT > 0);
        const pBuilds = mb.filter(r => r.turn >= phase.min && r.turn <= phase.max);
        const pBuildsEV = pBuilds.filter(r => r.couldAffordWithMortgage && r.netEPT > 0);

        console.log('    ' + phase.label.padEnd(20) +
            String(pPurchases.length).padEnd(14) +
            String(pPurchasesEV.length).padEnd(8) +
            String(pBuilds.length).padEnd(10) +
            String(pBuildsEV.length));
    }

    // =========================================================================
    // REPORT: SUMMARY
    // =========================================================================
    console.log();
    console.log('='.repeat(80));
    console.log('4. SUMMARY');
    console.log('='.repeat(80));
    console.log();

    const totalMissed = mp.length + mb.length;
    const totalEV = mpPositiveEV.length + mbPositiveEV.length;
    const allPositiveEV = [...mpPositiveEV, ...mbPositiveEV];
    const totalNetEPT = allPositiveEV.reduce((s, r) => s + r.netEPT, 0);

    console.log(`  Total missed opportunities: ${totalMissed} (${(totalMissed / gameCount).toFixed(2)}/game)`);
    console.log(`  Total +EV with mortgage: ${totalEV} (${(totalEV / gameCount).toFixed(2)}/game)`);

    if (totalEV > 0) {
        console.log(`  Avg net EPT per +EV opportunity: $${(totalNetEPT / totalEV).toFixed(2)}/ply`);
        console.log(`  Total EPT left on table per game: $${(totalNetEPT / gameCount).toFixed(2)}/ply`);
    }

    const purchaseBigger = mpPositiveEV.length > mbPositiveEV.length;
    console.log(`  Bigger opportunity: ${purchaseBigger ? 'PURCHASES' : 'BUILDS'}`);

    // Winner vs loser comparison
    const winnerTotal = mp.filter(r => r.isWinner).length + mb.filter(r => r.isWinner).length;
    const loserTotal = mp.filter(r => !r.isWinner).length + mb.filter(r => !r.isWinner).length;
    const winnerPerGame = winnerTotal / Math.max(1, gameCount);
    const loserPerGame = loserTotal / Math.max(1, gameCount * 3);

    console.log();
    console.log(`  Winners: ${winnerPerGame.toFixed(2)} missed/game`);
    console.log(`  Losers: ${loserPerGame.toFixed(2)} missed/game (each)`);

    if (loserPerGame > winnerPerGame) {
        console.log(`  Losers miss ${(loserPerGame / Math.max(0.01, winnerPerGame)).toFixed(1)}x more than winners`);
    }

    // Top examples
    if (allPositiveEV.length > 0) {
        console.log();
        console.log('  Top 5 +EV missed opportunities:');
        const topExamples = allPositiveEV.sort((a, b) => b.netEPT - a.netEPT).slice(0, 5);
        for (const ex of topExamples) {
            const type = ex.houseLevel ? `build ${ex.houseLevel}` : 'purchase';
            const name = ex.propertyName || ex.group;
            console.log(`    Turn ${ex.turn}: ${name} (${type}) — net +$${ex.netEPT.toFixed(2)}/ply, shortfall $${ex.shortfall}`);
        }
    }

    console.log();
    console.log('='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));
}

// =============================================================================
// HELPERS
// =============================================================================

function pct(num, denom) {
    if (denom === 0) return '0.0%';
    return (num / denom * 100).toFixed(1) + '%';
}

// =============================================================================
// MAIN
// =============================================================================

const numGames = parseInt(process.argv[2]) || 500;
runAnalysis(numGames);
