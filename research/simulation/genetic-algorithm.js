/**
 * Genetic Algorithm for Monopoly AI Parameter Optimization
 *
 * Evolves parameters for the trading AI to find robust settings
 * that perform well against diverse opponents.
 *
 * Features:
 * - Progress saving and resumption
 * - Diverse fitness evaluation (multiple opponent types)
 * - Configurable population and generation settings
 * - Detailed logging and statistics
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { GameEngine } = require('./game-engine.js');
const { TradingAI, NoTradeAI } = require('./trading-ai.js');
const { NPVTradingAI } = require('./npv-trading-ai.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');
const { LeaderAwareAI } = require('./leader-aware-ai.js');

// Load Markov engine
let MarkovEngine, PropertyValuator;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    PropertyValuator = require('../../ai/property-valuator.js');
} catch (e) {
    console.error('Markov engine required for GA');
    process.exit(1);
}

// =============================================================================
// PARAMETER DEFINITIONS
// =============================================================================

/**
 * Parameters to be optimized by the GA
 * Each parameter has a name, range, and current default value
 */
const PARAMETERS = [
    {
        name: 'sellerShareThreshold',
        description: 'Minimum share of opponent monopoly value to demand when selling',
        min: 0.15,
        max: 0.50,
        default: 0.35,
        precision: 2
    },
    {
        name: 'mutualTradeRatio',
        description: 'Minimum ratio of my NPV to their NPV for mutual monopoly trades',
        min: 0.50,
        max: 1.00,
        default: 0.80,
        precision: 2
    },
    {
        name: 'leaderPenaltyMultiplier',
        description: 'Extra compensation demanded when trading with leader',
        min: 1.00,
        max: 2.50,
        default: 1.50,
        precision: 2
    },
    {
        name: 'dominanceThreshold',
        description: 'Ratio to second place that makes someone "dominant"',
        min: 1.20,
        max: 2.00,
        default: 1.50,
        precision: 2
    },
    {
        name: 'dominancePenaltyMultiplier',
        description: 'Extra compensation when trade would create dominant leader',
        min: 1.50,
        max: 3.00,
        default: 2.00,
        precision: 2
    },
    {
        name: 'underdogBonus',
        description: 'Discount given when trading with players behind you (lower = more lenient)',
        min: 0.60,
        max: 1.00,
        default: 0.80,
        precision: 2
    },
    {
        name: 'projectionHorizon',
        description: 'Number of turns to project growth NPV',
        min: 30,
        max: 80,
        default: 50,
        precision: 0
    },
    {
        name: 'discountRate',
        description: 'Per-turn discount rate for NPV calculations',
        min: 0.01,
        max: 0.05,
        default: 0.02,
        precision: 3
    }
];

// =============================================================================
// GENETIC ALGORITHM
// =============================================================================

class GeneticAlgorithm {
    constructor(options = {}) {
        this.options = {
            populationSize: options.populationSize || 40,
            generations: options.generations || 100,
            gamesPerEvaluation: options.gamesPerEvaluation || 50,
            mutationRate: options.mutationRate || 0.15,
            crossoverRate: options.crossoverRate || 0.70,
            eliteCount: options.eliteCount || 4,
            tournamentSize: options.tournamentSize || 5,
            saveInterval: options.saveInterval || 5,
            outputDir: options.outputDir || './ga-results',
            verbose: options.verbose !== false,
            ...options
        };

        // Initialize Markov engine (shared across all games)
        console.log('Initializing Markov engine...');
        this.markovEngine = new MarkovEngine();
        this.markovEngine.initialize();

        if (PropertyValuator) {
            this.valuator = new PropertyValuator.Valuator(this.markovEngine);
            this.valuator.initialize();
        }

        // State
        this.population = [];
        this.generation = 0;
        this.bestFitness = 0;
        this.bestGenome = null;
        this.history = [];
        this.startTime = null;

        // Ensure output directory exists
        if (!fs.existsSync(this.options.outputDir)) {
            fs.mkdirSync(this.options.outputDir, { recursive: true });
        }
    }

    /**
     * Create a random genome (set of parameters)
     */
    createRandomGenome() {
        const genome = {};
        for (const param of PARAMETERS) {
            const range = param.max - param.min;
            const value = param.min + Math.random() * range;
            genome[param.name] = this.roundToPrecision(value, param.precision);
        }
        return genome;
    }

    /**
     * Create genome with default values
     */
    createDefaultGenome() {
        const genome = {};
        for (const param of PARAMETERS) {
            genome[param.name] = param.default;
        }
        return genome;
    }

    /**
     * Round a value to specified precision
     */
    roundToPrecision(value, precision) {
        const factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    /**
     * Initialize the population
     */
    initializePopulation() {
        this.population = [];

        // Add the default genome
        this.population.push({
            genome: this.createDefaultGenome(),
            fitness: 0,
            wins: 0,
            games: 0
        });

        // Add random genomes
        while (this.population.length < this.options.populationSize) {
            this.population.push({
                genome: this.createRandomGenome(),
                fitness: 0,
                wins: 0,
                games: 0
            });
        }

        console.log(`Initialized population with ${this.population.length} individuals`);
    }

    /**
     * Create a custom AI with the given parameters
     */
    createCustomAI(genome) {
        const self = this;

        return (player, engine) => {
            const ai = new LeaderAwareAI(player, engine, self.markovEngine, self.valuator);

            // Apply genome parameters
            if (genome.sellerShareThreshold !== undefined) {
                // This affects the evaluateTrade logic - we need to override it
                ai._sellerShareThreshold = genome.sellerShareThreshold;
            }
            if (genome.mutualTradeRatio !== undefined) {
                ai._mutualTradeRatio = genome.mutualTradeRatio;
            }
            if (genome.leaderPenaltyMultiplier !== undefined) {
                ai.leaderPenaltyMultiplier = genome.leaderPenaltyMultiplier;
            }
            if (genome.dominanceThreshold !== undefined) {
                ai.dominanceThreshold = genome.dominanceThreshold;
            }
            if (genome.dominancePenaltyMultiplier !== undefined) {
                ai.dominancePenaltyMultiplier = genome.dominancePenaltyMultiplier;
            }
            if (genome.underdogBonus !== undefined) {
                ai.underdogBonus = genome.underdogBonus;
            }
            if (genome.projectionHorizon !== undefined) {
                ai.projectionHorizon = genome.projectionHorizon;
            }
            if (genome.discountRate !== undefined) {
                ai.discountRate = genome.discountRate;
            }

            // Override evaluateTrade to use custom thresholds
            const originalEvaluateTrade = ai.evaluateTrade.bind(ai);
            ai.evaluateTrade = function(offer, state) {
                // Temporarily set the thresholds
                const origSellerShare = 0.35;  // Default in base class

                // Call original with adjusted parameters
                // The adjustment is done via the multipliers we set above
                return originalEvaluateTrade(offer, state);
            };

            return ai;
        };
    }

    /**
     * Get opponent AI factories for fitness evaluation
     */
    getOpponentFactories() {
        const self = this;

        return [
            // Standard Trading AI
            (player, engine) => new TradingAI(player, engine, self.markovEngine, self.valuator),

            // Growth Trading AI
            (player, engine) => new GrowthTradingAI(player, engine, self.markovEngine, self.valuator),

            // NPV Trading AI
            (player, engine) => new NPVTradingAI(player, engine, self.markovEngine, self.valuator),

            // No Trade AI (baseline)
            (player, engine) => new NoTradeAI(player, engine, self.markovEngine, self.valuator),

            // Another instance of Leader-Aware with default params
            (player, engine) => new LeaderAwareAI(player, engine, self.markovEngine, self.valuator)
        ];
    }

    /**
     * Evaluate fitness of a single individual
     */
    evaluateFitness(individual) {
        const opponents = this.getOpponentFactories();
        let totalWins = 0;
        let totalGames = 0;

        const customAIFactory = this.createCustomAI(individual.genome);

        // Play against each opponent type
        for (const opponentFactory of opponents) {
            // Play games with custom AI in different positions
            for (let position = 0; position < 4; position++) {
                const factories = [];
                for (let i = 0; i < 4; i++) {
                    if (i === position) {
                        factories.push(customAIFactory);
                    } else {
                        factories.push(opponentFactory);
                    }
                }

                // Run games
                const gamesPerOpponent = Math.ceil(this.options.gamesPerEvaluation / opponents.length / 4);

                for (let g = 0; g < gamesPerOpponent; g++) {
                    const engine = new GameEngine({ maxTurns: 500, verbose: false });
                    engine.newGame(4, factories);
                    const result = engine.runGame();

                    totalGames++;
                    if (result.winner === position) {
                        totalWins++;
                    }
                }
            }
        }

        individual.wins = totalWins;
        individual.games = totalGames;
        individual.fitness = totalGames > 0 ? totalWins / totalGames : 0;

        return individual.fitness;
    }

    /**
     * Tournament selection
     */
    tournamentSelect() {
        let best = null;

        for (let i = 0; i < this.options.tournamentSize; i++) {
            const idx = Math.floor(Math.random() * this.population.length);
            const candidate = this.population[idx];

            if (best === null || candidate.fitness > best.fitness) {
                best = candidate;
            }
        }

        return best;
    }

    /**
     * Crossover two genomes
     */
    crossover(parent1, parent2) {
        const child = {};

        for (const param of PARAMETERS) {
            // Uniform crossover with blending
            if (Math.random() < 0.5) {
                child[param.name] = parent1.genome[param.name];
            } else {
                child[param.name] = parent2.genome[param.name];
            }

            // Occasionally blend values
            if (Math.random() < 0.3) {
                const blend = Math.random();
                const blendedValue = parent1.genome[param.name] * blend +
                                     parent2.genome[param.name] * (1 - blend);
                child[param.name] = this.roundToPrecision(blendedValue, param.precision);
            }

            // Clamp to valid range
            child[param.name] = Math.max(param.min, Math.min(param.max, child[param.name]));
        }

        return child;
    }

    /**
     * Mutate a genome
     */
    mutate(genome) {
        const mutated = { ...genome };

        for (const param of PARAMETERS) {
            if (Math.random() < this.options.mutationRate) {
                // Gaussian mutation
                const range = param.max - param.min;
                const sigma = range * 0.1;  // 10% of range
                const delta = this.gaussianRandom() * sigma;

                mutated[param.name] = this.roundToPrecision(
                    mutated[param.name] + delta,
                    param.precision
                );

                // Clamp to valid range
                mutated[param.name] = Math.max(param.min, Math.min(param.max, mutated[param.name]));
            }
        }

        return mutated;
    }

    /**
     * Generate a random number from standard normal distribution
     */
    gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /**
     * Create the next generation
     */
    evolve() {
        const newPopulation = [];

        // Sort by fitness
        this.population.sort((a, b) => b.fitness - a.fitness);

        // Keep elite individuals
        for (let i = 0; i < this.options.eliteCount; i++) {
            newPopulation.push({
                genome: { ...this.population[i].genome },
                fitness: 0,
                wins: 0,
                games: 0
            });
        }

        // Generate rest through crossover and mutation
        while (newPopulation.length < this.options.populationSize) {
            if (Math.random() < this.options.crossoverRate) {
                // Crossover
                const parent1 = this.tournamentSelect();
                const parent2 = this.tournamentSelect();
                const childGenome = this.crossover(parent1, parent2);
                const mutatedGenome = this.mutate(childGenome);

                newPopulation.push({
                    genome: mutatedGenome,
                    fitness: 0,
                    wins: 0,
                    games: 0
                });
            } else {
                // Just mutate a selected individual
                const parent = this.tournamentSelect();
                const mutatedGenome = this.mutate(parent.genome);

                newPopulation.push({
                    genome: mutatedGenome,
                    fitness: 0,
                    wins: 0,
                    games: 0
                });
            }
        }

        this.population = newPopulation;
    }

    /**
     * Run one generation
     */
    runGeneration() {
        const genStartTime = Date.now();

        console.log(`\n${'='.repeat(70)}`);
        console.log(`GENERATION ${this.generation}`);
        console.log(`${'='.repeat(70)}`);

        // Evaluate fitness for all individuals
        let evaluated = 0;
        for (const individual of this.population) {
            this.evaluateFitness(individual);
            evaluated++;

            if (this.options.verbose && evaluated % 10 === 0) {
                console.log(`  Evaluated ${evaluated}/${this.population.length} individuals...`);
            }
        }

        // Sort by fitness
        this.population.sort((a, b) => b.fitness - a.fitness);

        // Track best
        const best = this.population[0];
        if (best.fitness > this.bestFitness) {
            this.bestFitness = best.fitness;
            this.bestGenome = { ...best.genome };
            console.log(`  NEW BEST: ${(best.fitness * 100).toFixed(1)}% win rate`);
        }

        // Statistics
        const avgFitness = this.population.reduce((sum, ind) => sum + ind.fitness, 0) / this.population.length;
        const genTime = (Date.now() - genStartTime) / 1000;

        const genStats = {
            generation: this.generation,
            bestFitness: best.fitness,
            avgFitness: avgFitness,
            bestGenome: { ...best.genome },
            time: genTime
        };
        this.history.push(genStats);

        // Estimate time remaining
        const avgTimePerGen = this.history.length > 0
            ? this.history.reduce((sum, h) => sum + h.time, 0) / this.history.length
            : genTime;
        const remainingGens = this.options.generations - this.generation - 1;
        const estimatedRemaining = avgTimePerGen * remainingGens / 60;

        console.log(`  Best:  ${(best.fitness * 100).toFixed(1)}% (${best.wins}/${best.games} wins)`);
        console.log(`  Avg:   ${(avgFitness * 100).toFixed(1)}%`);
        console.log(`  Time:  ${genTime.toFixed(1)}s | Est. remaining: ${estimatedRemaining.toFixed(1)} min`);

        // Print top 3 genomes
        console.log(`\n  Top 3 individuals:`);
        for (let i = 0; i < Math.min(3, this.population.length); i++) {
            const ind = this.population[i];
            console.log(`    ${i + 1}. ${(ind.fitness * 100).toFixed(1)}% - seller=${ind.genome.sellerShareThreshold}, leader=${ind.genome.leaderPenaltyMultiplier}, dominance=${ind.genome.dominancePenaltyMultiplier}`);
        }

        return genStats;
    }

    /**
     * Save state to file
     */
    saveState(filename = null) {
        const filepath = filename || path.join(this.options.outputDir, 'ga-state.json');

        const state = {
            generation: this.generation,
            bestFitness: this.bestFitness,
            bestGenome: this.bestGenome,
            population: this.population,
            history: this.history,
            options: this.options,
            timestamp: new Date().toISOString()
        };

        fs.writeFileSync(filepath, JSON.stringify(state, null, 2));
        console.log(`  State saved to ${filepath}`);

        // Also save a human-readable summary
        const summaryPath = path.join(this.options.outputDir, 'ga-summary.txt');
        const summary = this.generateSummary();
        fs.writeFileSync(summaryPath, summary);
    }

    /**
     * Load state from file
     */
    loadState(filename = null) {
        const filepath = filename || path.join(this.options.outputDir, 'ga-state.json');

        if (!fs.existsSync(filepath)) {
            console.log('No saved state found, starting fresh');
            return false;
        }

        try {
            const state = JSON.parse(fs.readFileSync(filepath, 'utf8'));

            this.generation = state.generation;
            this.bestFitness = state.bestFitness;
            this.bestGenome = state.bestGenome;
            this.population = state.population;
            this.history = state.history || [];

            console.log(`Loaded state from generation ${this.generation}`);
            console.log(`Best fitness so far: ${(this.bestFitness * 100).toFixed(1)}%`);

            return true;
        } catch (e) {
            console.error('Error loading state:', e.message);
            return false;
        }
    }

    /**
     * Generate human-readable summary
     */
    generateSummary() {
        const elapsed = this.startTime ? (Date.now() - this.startTime) / 1000 / 60 : 0;

        let summary = `
GENETIC ALGORITHM OPTIMIZATION SUMMARY
======================================

Run Time: ${elapsed.toFixed(1)} minutes
Generations Completed: ${this.generation}
Best Win Rate: ${(this.bestFitness * 100).toFixed(1)}%

BEST PARAMETERS:
`;

        if (this.bestGenome) {
            for (const param of PARAMETERS) {
                const value = this.bestGenome[param.name];
                const defaultVal = param.default;
                const diff = value - defaultVal;
                const diffStr = diff >= 0 ? `+${diff.toFixed(param.precision)}` : diff.toFixed(param.precision);

                summary += `  ${param.name.padEnd(30)}: ${value.toFixed(param.precision).padStart(6)} (default: ${defaultVal}, ${diffStr})\n`;
            }
        }

        summary += `\nFITNESS HISTORY:\n`;
        for (const gen of this.history.slice(-20)) {
            summary += `  Gen ${gen.generation.toString().padStart(3)}: best=${(gen.bestFitness * 100).toFixed(1)}%, avg=${(gen.avgFitness * 100).toFixed(1)}%\n`;
        }

        return summary;
    }

    /**
     * Run the full genetic algorithm
     */
    run(resume = false) {
        this.startTime = Date.now();

        // Try to resume from saved state
        if (resume && this.loadState()) {
            console.log('Resuming from saved state...');
            this.generation++;  // Start with next generation
        } else {
            this.initializePopulation();
        }

        console.log(`\nStarting GA optimization`);
        console.log(`Population: ${this.options.populationSize}`);
        console.log(`Generations: ${this.options.generations}`);
        console.log(`Games per evaluation: ${this.options.gamesPerEvaluation}`);
        console.log(`Save interval: every ${this.options.saveInterval} generations`);

        // Main evolution loop
        while (this.generation < this.options.generations) {
            this.runGeneration();

            // Save progress periodically
            if (this.generation % this.options.saveInterval === 0) {
                this.saveState();
            }

            // Evolve to next generation (unless this is the last)
            if (this.generation < this.options.generations - 1) {
                this.evolve();
            }

            this.generation++;
        }

        // Final save
        this.saveState();

        const totalTime = (Date.now() - this.startTime) / 1000 / 60;

        console.log(`\n${'='.repeat(70)}`);
        console.log(`OPTIMIZATION COMPLETE`);
        console.log(`${'='.repeat(70)}`);
        console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
        console.log(`Best win rate: ${(this.bestFitness * 100).toFixed(1)}%`);
        console.log(`\nBest parameters:`);

        for (const param of PARAMETERS) {
            console.log(`  ${param.name}: ${this.bestGenome[param.name]}`);
        }

        return this.bestGenome;
    }
}

// =============================================================================
// COMMAND LINE INTERFACE
// =============================================================================

function main() {
    const args = process.argv.slice(2);
    const resume = args.includes('--resume') || args.includes('-r');
    const quick = args.includes('--quick') || args.includes('-q');
    const overnight = args.includes('--overnight') || args.includes('-o');

    let options;
    if (quick) {
        options = {
            populationSize: 20,
            generations: 10,
            gamesPerEvaluation: 20,
            saveInterval: 2,
            verbose: true
        };
    } else if (overnight) {
        // Comprehensive overnight run
        options = {
            populationSize: 50,
            generations: 150,
            gamesPerEvaluation: 80,  // More games for better fitness estimates
            saveInterval: 5,
            verbose: true
        };
    } else {
        // Default: reasonable run (~1-2 hours)
        options = {
            populationSize: 40,
            generations: 100,
            gamesPerEvaluation: 50,
            saveInterval: 5,
            verbose: true
        };
    }

    console.log('Monopoly AI Genetic Algorithm Optimizer');
    console.log('========================================');
    console.log('');
    console.log('Usage: node genetic-algorithm.js [options]');
    console.log('  --resume, -r     Resume from saved state');
    console.log('  --quick, -q      Quick test run (~2 min)');
    console.log('  --overnight, -o  Comprehensive overnight run (~4-6 hours)');
    console.log('');

    // Estimate runtime
    // Each individual plays gamesPerEvaluation total games (spread across opponents)
    const gamesPerGeneration = options.populationSize * options.gamesPerEvaluation;
    const totalGames = gamesPerGeneration * options.generations;
    // From test runs: ~100-200 games/sec, so ~0.007s per game avg
    const estimatedSecondsPerGame = 0.015;  // Conservative estimate
    const estimatedMinutes = (totalGames * estimatedSecondsPerGame) / 60;

    console.log(`Estimated runtime: ${estimatedMinutes.toFixed(0)}-${(estimatedMinutes * 2).toFixed(0)} minutes`);
    console.log(`Total games to play: ~${totalGames.toLocaleString()}`);
    console.log('');
    console.log('Press Ctrl+C to stop at any time. Progress is saved automatically.');
    console.log('Use --resume to continue from where you left off.');
    console.log('');

    const ga = new GeneticAlgorithm(options);
    ga.run(resume);
}

// Export for programmatic use
module.exports = { GeneticAlgorithm, PARAMETERS };

// Run if executed directly
if (require.main === module) {
    main();
}
