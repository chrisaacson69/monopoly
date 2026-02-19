/**
 * Comparative Test: Variance-Aware AI Variants
 *
 * Tests each factor in isolation and combination to measure impact:
 * 1. Baseline: RelativeGrowthAI
 * 2. TimingAwareAI: Position-based build timing only
 * 3. RiskAwareAI: Beta-adjusted valuation only
 * 4. ReserveAwareAI: Dynamic cash reserves only
 * 5. TimingReserveAI: Timing + Reserve (no risk)
 * 6. FullVarianceAI: All three factors
 *
 * Each AI plays against the baseline to measure improvement.
 */

'use strict';

const { SimulationRunner } = require('./simulation-runner.js');
const { InstrumentedGameEngine, GameAnalytics } = require('./self-play-analytics.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

// Import variant AIs
let TimingAwareAI, RiskAwareAI, ReserveAwareAI, FullVarianceAI, TimingReserveAI;
try {
    const variants = require('./variant-ais.js');
    TimingAwareAI = variants.TimingAwareAI;
    RiskAwareAI = variants.RiskAwareAI;
    ReserveAwareAI = variants.ReserveAwareAI;
    FullVarianceAI = variants.FullVarianceAI;
    TimingReserveAI = variants.TimingReserveAI;
} catch (e) {
    console.error('Failed to load variant AIs:', e.message);
    process.exit(1);
}

// =============================================================================
// COMPARATIVE TESTING
// =============================================================================

class VariantComparison {
    constructor(options = {}) {
        this.options = {
            gamesPerMatchup: options.gamesPerMatchup || 100,
            maxTurns: options.maxTurns || 500,
            verbose: options.verbose || false,
            ...options
        };

        this.runner = new SimulationRunner({
            games: this.options.gamesPerMatchup,
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose,
            progressInterval: 25
        });

        this.results = {};
    }

    /**
     * Run head-to-head comparison: 2 of each AI type
     */
    runHeadToHead(aiType1, aiType2, numGames) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`HEAD-TO-HEAD: ${aiType1} vs ${aiType2}`);
        console.log(`${'─'.repeat(60)}`);

        // Run games with 2 of each AI (positions 0,2 vs 1,3 for fairness)
        const results = this.runner.runSimulation(
            [aiType1, aiType2, aiType1, aiType2],
            numGames
        );

        // Aggregate wins by AI type
        const type1Wins = results.wins[0] + results.wins[2];
        const type2Wins = results.wins[1] + results.wins[3];

        console.log(`\n  RESULT: ${aiType1} ${type1Wins} - ${type2Wins} ${aiType2}`);

        const winRate1 = type1Wins / numGames;
        const winRate2 = type2Wins / numGames;

        return {
            aiType1,
            aiType2,
            wins1: type1Wins,
            wins2: type2Wins,
            winRate1,
            winRate2,
            avgTurns: results.avgTurns,
            stats: results
        };
    }

    /**
     * Run full comparison against baseline
     */
    runFullComparison() {
        const numGames = this.options.gamesPerMatchup;

        console.log('\n' + '═'.repeat(70));
        console.log('VARIANT AI COMPARISON');
        console.log('═'.repeat(70));
        console.log(`Running ${numGames} games per matchup`);
        console.log(`Baseline: RelativeGrowthAI (relative)`);
        console.log(`Testing isolated factors and combinations\n`);

        const baseline = 'relative';
        const variants = [
            { name: 'timing', description: 'Position-based build timing' },
            { name: 'reserve', description: 'Dynamic cash reserves' },
            { name: 'risk', description: 'Beta-adjusted valuation' },
            { name: 'timingreserve', description: 'Timing + Reserve' },
            { name: 'full', description: 'All three factors' }
        ];

        const results = [];

        for (const variant of variants) {
            console.log(`\nTesting: ${variant.name} (${variant.description})`);
            const result = this.runHeadToHead(variant.name, baseline, numGames);
            result.description = variant.description;
            results.push(result);
        }

        // Print summary
        this.printSummary(results, baseline);

        return results;
    }

    /**
     * Run self-play comparison (same AI against itself)
     * This tests if the AI is "fair" - all positions should win equally
     */
    runSelfPlayTest(aiType, numGames) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`SELF-PLAY TEST: ${aiType}`);
        console.log(`${'─'.repeat(60)}`);

        const results = this.runner.runSimulation(
            [aiType, aiType, aiType, aiType],
            numGames
        );

        // Check for position bias
        const expectedWinRate = 0.25;
        const actualRates = results.wins.map(w => w / numGames);
        const maxDeviation = Math.max(...actualRates.map(r => Math.abs(r - expectedWinRate)));

        console.log(`\n  Position win rates: ${actualRates.map(r => (r * 100).toFixed(1) + '%').join(', ')}`);
        console.log(`  Max deviation from 25%: ${(maxDeviation * 100).toFixed(1)}%`);
        console.log(`  Status: ${maxDeviation < 0.10 ? 'FAIR' : 'POTENTIAL BIAS'}`);

        return {
            aiType,
            winRates: actualRates,
            maxDeviation,
            fair: maxDeviation < 0.10
        };
    }

    /**
     * Run tournament between all variants
     */
    runTournament(variants, gamesPerMatchup) {
        console.log('\n' + '═'.repeat(70));
        console.log('ROUND-ROBIN TOURNAMENT');
        console.log('═'.repeat(70));
        console.log(`${variants.length} AI types, ${gamesPerMatchup} games per matchup`);

        const scores = {};
        for (const v of variants) {
            scores[v] = { wins: 0, games: 0, opponents: {} };
        }

        // Round-robin
        for (let i = 0; i < variants.length; i++) {
            for (let j = i + 1; j < variants.length; j++) {
                const result = this.runHeadToHead(variants[i], variants[j], gamesPerMatchup);

                scores[variants[i]].wins += result.wins1;
                scores[variants[i]].games += gamesPerMatchup;
                scores[variants[i]].opponents[variants[j]] = result.wins1;

                scores[variants[j]].wins += result.wins2;
                scores[variants[j]].games += gamesPerMatchup;
                scores[variants[j]].opponents[variants[i]] = result.wins2;
            }
        }

        // Print tournament results
        console.log('\n' + '═'.repeat(70));
        console.log('TOURNAMENT RESULTS');
        console.log('═'.repeat(70));

        const rankings = Object.entries(scores)
            .map(([ai, data]) => ({
                ai,
                wins: data.wins,
                games: data.games,
                winRate: data.wins / data.games,
                opponents: data.opponents
            }))
            .sort((a, b) => b.winRate - a.winRate);

        console.log('\nRANKINGS:');
        console.log('─'.repeat(50));

        for (let i = 0; i < rankings.length; i++) {
            const r = rankings[i];
            console.log(`  ${i + 1}. ${r.ai.padEnd(15)} ${r.wins}/${r.games} wins (${(r.winRate * 100).toFixed(1)}%)`);
        }

        // Head-to-head matrix
        console.log('\nHEAD-TO-HEAD MATRIX (row beat column N times):');
        console.log('─'.repeat(60));

        const header = '              ' + variants.map(v => v.slice(0, 6).padStart(7)).join('');
        console.log(header);

        for (const v of variants) {
            const row = variants.map(opp => {
                if (v === opp) return '   -  ';
                return String(scores[v].opponents[opp] || 0).padStart(7);
            }).join('');
            console.log(`  ${v.padEnd(12)}${row}`);
        }

        return rankings;
    }

    /**
     * Print comparison summary
     */
    printSummary(results, baseline) {
        console.log('\n' + '═'.repeat(70));
        console.log('COMPARISON SUMMARY');
        console.log('═'.repeat(70));

        console.log('\nVariant vs Baseline (RelativeGrowthAI):');
        console.log('─'.repeat(60));
        console.log('Variant           Win Rate  vs Baseline  Improvement');
        console.log('─'.repeat(60));

        for (const r of results) {
            const improvement = ((r.winRate1 - 0.5) * 100).toFixed(1);
            const sign = r.winRate1 > 0.5 ? '+' : '';
            console.log(
                `${r.aiType1.padEnd(17)} ` +
                `${(r.winRate1 * 100).toFixed(1)}%     ` +
                `${r.wins1}-${r.wins2}        ` +
                `${sign}${improvement}%`
            );
        }

        // Identify best performer
        const best = results.reduce((a, b) => a.winRate1 > b.winRate1 ? a : b);
        console.log('\n' + '─'.repeat(60));
        console.log(`BEST PERFORMER: ${best.aiType1} (${best.description})`);
        console.log(`Win rate: ${(best.winRate1 * 100).toFixed(1)}% vs baseline`);

        // Analysis
        console.log('\n' + '─'.repeat(60));
        console.log('ANALYSIS:');

        // Check if timing alone helps
        const timing = results.find(r => r.aiType1 === 'timing');
        if (timing) {
            if (timing.winRate1 > 0.52) {
                console.log('  ✓ Timing-aware building provides measurable improvement');
            } else if (timing.winRate1 < 0.48) {
                console.log('  ✗ Timing-aware building hurts performance (too conservative?)');
            } else {
                console.log('  ~ Timing-aware building has minimal impact alone');
            }
        }

        // Check if reserve alone helps
        const reserve = results.find(r => r.aiType1 === 'reserve');
        if (reserve) {
            if (reserve.winRate1 > 0.52) {
                console.log('  ✓ Dynamic reserves provide measurable improvement');
            } else if (reserve.winRate1 < 0.48) {
                console.log('  ✗ Dynamic reserves hurt performance (too conservative?)');
            } else {
                console.log('  ~ Dynamic reserves have minimal impact alone');
            }
        }

        // Check if risk alone helps
        const risk = results.find(r => r.aiType1 === 'risk');
        if (risk) {
            if (risk.winRate1 > 0.52) {
                console.log('  ✓ Risk-adjusted valuation provides measurable improvement');
            } else if (risk.winRate1 < 0.48) {
                console.log('  ✗ Risk-adjusted valuation hurts performance');
            } else {
                console.log('  ~ Risk-adjusted valuation has minimal impact alone');
            }
        }

        // Check for synergy
        const combined = results.find(r => r.aiType1 === 'timingreserve');
        const full = results.find(r => r.aiType1 === 'full');

        if (combined && timing && reserve) {
            const expectedCombined = (timing.winRate1 - 0.5) + (reserve.winRate1 - 0.5) + 0.5;
            if (combined.winRate1 > expectedCombined + 0.02) {
                console.log('  ✓ SYNERGY: Timing + Reserve together better than sum of parts!');
            } else if (combined.winRate1 < expectedCombined - 0.02) {
                console.log('  ✗ INTERFERENCE: Timing + Reserve together worse than expected');
            }
        }

        console.log('\n' + '═'.repeat(70));
    }
}

// =============================================================================
// MAIN
// =============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);

    let gamesPerMatchup = 100;
    let mode = 'compare';  // 'compare', 'tournament', 'selfplay'

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--games' || args[i] === '-g') {
            gamesPerMatchup = parseInt(args[++i]) || 100;
        } else if (args[i] === '--quick') {
            gamesPerMatchup = 50;
        } else if (args[i] === '--full') {
            gamesPerMatchup = 200;
        } else if (args[i] === '--tournament') {
            mode = 'tournament';
        } else if (args[i] === '--selfplay') {
            mode = 'selfplay';
        }
    }

    console.log('Variant AI Comparison Tool');
    console.log('Usage: node compare-variants.js [options]');
    console.log('  --games N     Games per matchup (default: 100)');
    console.log('  --quick       Run 50 games per matchup');
    console.log('  --full        Run 200 games per matchup');
    console.log('  --tournament  Run round-robin tournament');
    console.log('  --selfplay    Run self-play fairness tests');
    console.log('');

    const comparison = new VariantComparison({
        gamesPerMatchup
    });

    if (mode === 'tournament') {
        comparison.runTournament([
            'relative', 'timing', 'reserve', 'risk', 'timingreserve', 'full'
        ], gamesPerMatchup);
    } else if (mode === 'selfplay') {
        console.log('\nRunning self-play fairness tests...\n');
        comparison.runSelfPlayTest('relative', gamesPerMatchup);
        comparison.runSelfPlayTest('timing', gamesPerMatchup);
        comparison.runSelfPlayTest('full', gamesPerMatchup);
    } else {
        comparison.runFullComparison();
    }
}

module.exports = { VariantComparison };
