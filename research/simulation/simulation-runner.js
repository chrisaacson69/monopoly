/**
 * Simulation Runner
 *
 * Runs multiple Monopoly games for AI evaluation and parameter tuning.
 */

'use strict';

const { GameEngine } = require('./game-engine.js');
const { SimpleAI, StrategicAI, RandomAI } = require('./base-ai.js');
const { TradingAI, AggressiveTradingAI, NoTradeAI } = require('./trading-ai.js');
const { DynamicTradingAI } = require('./dynamic-trading-ai.js');
const { NPVTradingAI } = require('./npv-trading-ai.js');
const { CompetitiveTradingAI } = require('./competitive-trading-ai.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');
const { LeaderAwareAI } = require('./leader-aware-ai.js');
const { RelativeGrowthAI } = require('./relative-growth-ai.js');

// Enhanced Relative AI variants (auction improvements)
let EnhancedRelativeAI, EnhancedRelativeOptimal, EnhancedRelative5, EnhancedRelative10, EnhancedRelative15, EnhancedRelativeNoDebt, EnhancedRelativeSmartBlock;
try {
    const enhancedModule = require('./enhanced-relative-ai.js');
    EnhancedRelativeAI = enhancedModule.EnhancedRelativeAI;
    EnhancedRelativeOptimal = enhancedModule.EnhancedRelativeOptimal;
    EnhancedRelative5 = enhancedModule.EnhancedRelative5;
    EnhancedRelative10 = enhancedModule.EnhancedRelative10;
    EnhancedRelative15 = enhancedModule.EnhancedRelative15;
    EnhancedRelativeNoDebt = enhancedModule.EnhancedRelativeNoDebt;
    EnhancedRelativeSmartBlock = enhancedModule.EnhancedRelativeSmartBlock;
} catch (e) {
    console.log('Note: Enhanced Relative AIs not available');
}

// Strategic Trade AI variants (trade quality filtering)
let StrategicTradeAI, StrategicBalanced, StrategicStrict, StrategicLenient, STRATEGIC_PRESETS;
try {
    const strategicModule = require('./strategic-trade-ai.js');
    StrategicTradeAI = strategicModule.StrategicTradeAI;
    StrategicBalanced = strategicModule.StrategicBalanced;
    StrategicStrict = strategicModule.StrategicStrict;
    StrategicLenient = strategicModule.StrategicLenient;
    STRATEGIC_PRESETS = strategicModule.STRATEGIC_PRESETS;
} catch (e) {
    console.log('Note: Strategic Trade AI not available');
}

// Premium trading AI variants
let PremiumTrader5, PremiumTrader10, PremiumTrader20;
try {
    const premiumModule = require('./premium-trading-ai.js');
    PremiumTrader5 = premiumModule.PremiumTrader5;
    PremiumTrader10 = premiumModule.PremiumTrader10;
    PremiumTrader20 = premiumModule.PremiumTrader20;
} catch (e) {
    console.log('Note: Premium trading AIs not available');
}

// Variance-aware AI variants
let TimingAwareAI, RiskAwareAI, ReserveAwareAI, FullVarianceAI, TimingReserveAI;
try {
    const variants = require('./variant-ais.js');
    TimingAwareAI = variants.TimingAwareAI;
    RiskAwareAI = variants.RiskAwareAI;
    ReserveAwareAI = variants.ReserveAwareAI;
    FullVarianceAI = variants.FullVarianceAI;
    TimingReserveAI = variants.TimingReserveAI;
} catch (e) {
    console.log('Note: Variant AIs not available');
}

// Try to load Markov engine for strategic AI
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.log('Note: Markov engine not available, StrategicAI will use fallback');
}

// =============================================================================
// SIMULATION RUNNER
// =============================================================================

class SimulationRunner {
    constructor(options = {}) {
        this.options = {
            games: options.games || 100,
            maxTurns: options.maxTurns || 500,
            verbose: options.verbose || false,
            progressInterval: options.progressInterval || 10,
            ...options
        };

        // Initialize shared Markov engine if available
        this.markovEngine = null;
        this.valuator = null;

        if (MarkovEngine) {
            console.log('Initializing Markov engine...');
            this.markovEngine = new MarkovEngine();
            this.markovEngine.initialize();

            if (PropertyValuator) {
                this.valuator = new PropertyValuator.Valuator(this.markovEngine);
                this.valuator.initialize();
            }
        }
    }

    /**
     * Create an AI factory function
     */
    createAIFactory(aiType, config = {}) {
        const self = this;

        return (player, engine) => {
            switch (aiType) {
                case 'simple':
                    return new SimpleAI(player, engine);
                case 'strategic-base':  // Renamed to avoid conflict with StrategicTradeAI
                case 'strategicbase':
                    return new StrategicAI(player, engine, self.markovEngine, self.valuator);
                case 'random':
                    return new RandomAI(player, engine);
                case 'trading':
                    return new TradingAI(player, engine, self.markovEngine, self.valuator);
                case 'aggressive':
                    return new AggressiveTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'notrade':
                    return new NoTradeAI(player, engine, self.markovEngine, self.valuator);
                case 'dynamic':
                    return new DynamicTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'npv':
                    return new NPVTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'competitive':
                    return new CompetitiveTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'growth':
                    return new GrowthTradingAI(player, engine, self.markovEngine, self.valuator);
                case 'leader':
                case 'leaderaware':
                    return new LeaderAwareAI(player, engine, self.markovEngine, self.valuator);
                case 'relative':
                case 'relativegrowth':
                    return new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                // Variance-aware AI variants
                case 'timing':
                case 'timingaware':
                    return TimingAwareAI ?
                        new TimingAwareAI(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'risk':
                case 'riskaware':
                    return RiskAwareAI ?
                        new RiskAwareAI(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'reserve':
                case 'reserveaware':
                    return ReserveAwareAI ?
                        new ReserveAwareAI(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'full':
                case 'fullvariance':
                    return FullVarianceAI ?
                        new FullVarianceAI(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'timingreserve':
                    return TimingReserveAI ?
                        new TimingReserveAI(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                // Premium trading AI variants
                case 'premium5':
                    return PremiumTrader5 ?
                        new PremiumTrader5(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'premium10':
                    return PremiumTrader10 ?
                        new PremiumTrader10(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'premium20':
                    return PremiumTrader20 ?
                        new PremiumTrader20(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                // Enhanced Relative AI variants (auction improvements)
                case 'enhanced':
                case 'optimal':
                    return EnhancedRelativeOptimal ?
                        new EnhancedRelativeOptimal(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced5':
                    return EnhancedRelative5 ?
                        new EnhancedRelative5(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced10':
                    return EnhancedRelative10 ?
                        new EnhancedRelative10(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'enhanced15':
                    return EnhancedRelative15 ?
                        new EnhancedRelative15(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'enhancednodebt':
                    return EnhancedRelativeNoDebt ?
                        new EnhancedRelativeNoDebt(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'smartblock':
                case 'smart':
                    return EnhancedRelativeSmartBlock ?
                        new EnhancedRelativeSmartBlock(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                // Strategic Trade AI variants (trade quality filtering)
                case 'strategic':
                case 'strategic-trade':
                case 'strategictrade':
                    return StrategicBalanced ?
                        new StrategicBalanced(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'strategic-strict':
                case 'strategicstrict':
                    return StrategicStrict ?
                        new StrategicStrict(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                case 'strategic-lenient':
                case 'strategiclenient':
                    return StrategicLenient ?
                        new StrategicLenient(player, engine, self.markovEngine, self.valuator) :
                        new RelativeGrowthAI(player, engine, self.markovEngine, self.valuator);
                default:
                    return new SimpleAI(player, engine);
            }
        };
    }

    /**
     * Run a single game
     */
    runSingleGame(aiTypes, gameOptions = {}) {
        const engine = new GameEngine({
            maxTurns: this.options.maxTurns,
            verbose: this.options.verbose,
            ...gameOptions
        });

        const factories = aiTypes.map(type => this.createAIFactory(type));
        engine.newGame(aiTypes.length, factories);

        return engine.runGame();
    }

    /**
     * Run multiple games and collect statistics
     */
    runSimulation(aiTypes, numGames = null) {
        numGames = numGames || this.options.games;

        console.log(`\nRunning ${numGames} games with AI types: ${aiTypes.join(', ')}`);
        console.log('='.repeat(60));

        const results = {
            games: numGames,
            aiTypes,
            wins: new Array(aiTypes.length).fill(0),
            totalTurns: 0,
            avgTurns: 0,
            timeouts: 0,
            gameResults: []
        };

        const startTime = Date.now();

        for (let i = 0; i < numGames; i++) {
            const gameResult = this.runSingleGame(aiTypes);

            if (gameResult.winner !== null) {
                results.wins[gameResult.winner]++;
            } else {
                results.timeouts++;
            }

            results.totalTurns += gameResult.turns;
            results.gameResults.push(gameResult);

            // Progress update
            if ((i + 1) % this.options.progressInterval === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = (i + 1) / elapsed;
                console.log(`  Game ${i + 1}/${numGames} (${rate.toFixed(1)} games/sec)`);
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;
        results.avgTurns = results.totalTurns / numGames;
        results.timeSeconds = totalTime;

        this.printResults(results);

        return results;
    }

    /**
     * Print simulation results
     */
    printResults(results) {
        console.log('\n' + '='.repeat(60));
        console.log('SIMULATION RESULTS');
        console.log('='.repeat(60));

        console.log(`\nGames played: ${results.games}`);
        console.log(`Time: ${results.timeSeconds.toFixed(1)} seconds`);
        console.log(`Average turns per game: ${results.avgTurns.toFixed(1)}`);
        console.log(`Timeouts (no winner): ${results.timeouts}`);

        // Game length distribution
        const gameLengths = results.gameResults.map(r => r.turns).sort((a, b) => a - b);
        if (gameLengths.length > 0) {
            const min = gameLengths[0];
            const max = gameLengths[gameLengths.length - 1];
            const median = gameLengths[Math.floor(gameLengths.length / 2)];
            const p25 = gameLengths[Math.floor(gameLengths.length * 0.25)];
            const p75 = gameLengths[Math.floor(gameLengths.length * 0.75)];
            const stdDev = Math.sqrt(gameLengths.reduce((sum, x) => sum + Math.pow(x - results.avgTurns, 2), 0) / gameLengths.length);
            console.log(`Game length: min=${min}, p25=${p25}, median=${median}, p75=${p75}, max=${max}`);
            console.log(`Std deviation: ${stdDev.toFixed(1)} turns`);
        }

        console.log('\nWIN RATES:');
        console.log('-'.repeat(40));

        for (let i = 0; i < results.aiTypes.length; i++) {
            const winRate = (results.wins[i] / results.games * 100).toFixed(1);
            console.log(`  Player ${i + 1} (${results.aiTypes[i]}): ${results.wins[i]} wins (${winRate}%)`);
        }

        // Additional statistics
        console.log('\nADDITIONAL STATS:');
        console.log('-'.repeat(40));

        const avgRentPaid = results.gameResults.reduce((sum, r) =>
            sum + r.stats.rentPaid.reduce((a, b) => a + b, 0) / results.aiTypes.length, 0
        ) / results.games;

        const avgPropertiesBought = results.gameResults.reduce((sum, r) =>
            sum + r.stats.propertiesBought.reduce((a, b) => a + b, 0), 0
        ) / results.games;

        const avgHousesBought = results.gameResults.reduce((sum, r) =>
            sum + r.stats.housesBought.reduce((a, b) => a + b, 0), 0
        ) / results.games;

        console.log(`  Avg rent paid per player: $${avgRentPaid.toFixed(0)}`);
        console.log(`  Avg properties bought total: ${avgPropertiesBought.toFixed(1)}`);
        console.log(`  Avg houses built total: ${avgHousesBought.toFixed(1)}`);
    }

    /**
     * Compare two AI strategies head-to-head
     */
    compareStrategies(ai1, ai2, numGames = null) {
        numGames = numGames || this.options.games;

        console.log(`\nHEAD-TO-HEAD: ${ai1} vs ${ai2}`);
        console.log('='.repeat(60));

        // 4-player games with 2 of each
        const results = this.runSimulation([ai1, ai2, ai1, ai2], numGames);

        // Aggregate by AI type
        const ai1Wins = results.wins[0] + results.wins[2];
        const ai2Wins = results.wins[1] + results.wins[3];

        console.log('\nAGGREGATE BY AI TYPE:');
        console.log('-'.repeat(40));
        console.log(`  ${ai1}: ${ai1Wins} wins (${(ai1Wins / numGames * 100).toFixed(1)}%)`);
        console.log(`  ${ai2}: ${ai2Wins} wins (${(ai2Wins / numGames * 100).toFixed(1)}%)`);

        return { ai1Wins, ai2Wins, results };
    }

    /**
     * Run tournament between multiple AI types
     */
    runTournament(aiTypes, gamesPerMatchup = null) {
        gamesPerMatchup = gamesPerMatchup || Math.floor(this.options.games / 10);

        console.log('\n' + '='.repeat(60));
        console.log('AI TOURNAMENT');
        console.log('='.repeat(60));
        console.log(`AIs: ${aiTypes.join(', ')}`);
        console.log(`Games per matchup: ${gamesPerMatchup}`);

        const scores = {};
        for (const ai of aiTypes) {
            scores[ai] = { wins: 0, games: 0 };
        }

        // Round-robin: each AI type plays against each other
        for (let i = 0; i < aiTypes.length; i++) {
            for (let j = i + 1; j < aiTypes.length; j++) {
                const ai1 = aiTypes[i];
                const ai2 = aiTypes[j];

                console.log(`\nMatchup: ${ai1} vs ${ai2}`);

                // Run games with 2 of each AI
                const results = this.runSimulation([ai1, ai2, ai1, ai2], gamesPerMatchup);

                const ai1Wins = results.wins[0] + results.wins[2];
                const ai2Wins = results.wins[1] + results.wins[3];

                scores[ai1].wins += ai1Wins;
                scores[ai1].games += gamesPerMatchup;
                scores[ai2].wins += ai2Wins;
                scores[ai2].games += gamesPerMatchup;
            }
        }

        // Print tournament results
        console.log('\n' + '='.repeat(60));
        console.log('TOURNAMENT RESULTS');
        console.log('='.repeat(60));

        const rankings = Object.entries(scores)
            .map(([ai, data]) => ({
                ai,
                wins: data.wins,
                games: data.games,
                winRate: data.wins / data.games
            }))
            .sort((a, b) => b.winRate - a.winRate);

        console.log('\nRANKINGS:');
        console.log('-'.repeat(50));

        for (let i = 0; i < rankings.length; i++) {
            const r = rankings[i];
            console.log(`  ${i + 1}. ${r.ai.padEnd(15)} ${r.wins}/${r.games} wins (${(r.winRate * 100).toFixed(1)}%)`);
        }

        return rankings;
    }
}

// =============================================================================
// MAIN - RUN SIMULATIONS
// =============================================================================

if (require.main === module) {
    const runner = new SimulationRunner({
        games: 100,
        maxTurns: 500,
        verbose: false,
        progressInterval: 20
    });

    // Run tournament
    console.log('\nStarting AI Tournament...\n');

    const aiTypes = ['simple', 'random'];
    if (runner.markovEngine) {
        aiTypes.push('strategic');
    }

    runner.runTournament(aiTypes, 50);

    console.log('\n' + '='.repeat(60));
    console.log('SIMULATION COMPLETE');
    console.log('='.repeat(60));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { SimulationRunner };
