/**
 * Cached Markov/EPT Engine Loader
 *
 * MarkovEngine and PropertyValuator produce deterministic outputs
 * (pure functions of board layout + dice probabilities). No need
 * to recompute every run.
 *
 * First run: computes and saves to .markov-cache.json
 * Subsequent runs: loads from cache (~10-20x faster startup)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '.markov-cache.json');

function getCachedEngines() {
    const MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
    const PropertyValuator = require('../../ai/property-valuator.js');

    // Try loading from cache
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

            const markov = new MarkovEngine();
            markov._basicMatrix = data.basicMatrix;
            markov._steadyState = data.steadyState;
            markov._initialized = true;

            const valuator = new PropertyValuator.Valuator(markov);
            valuator._tables = data.tables;
            valuator._initialized = true;

            console.log('Loaded Markov/EPT from cache.');
            return { markovEngine: markov, valuator };
        }
    } catch (e) {
        console.log('Cache load failed, recomputing:', e.message);
    }

    // Compute from scratch
    console.log('Computing Markov/EPT tables (first run)...');
    const markov = new MarkovEngine();
    markov.initialize();
    const valuator = new PropertyValuator.Valuator(markov);
    valuator.initialize();

    // Save cache
    try {
        const data = {
            basicMatrix: markov._basicMatrix,
            steadyState: markov._steadyState,
            tables: valuator._tables
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
        const sizeKB = (fs.statSync(CACHE_FILE).size / 1024).toFixed(0);
        console.log('Saved cache (' + sizeKB + ' KB).');
    } catch (e) {
        console.log('Cache save failed:', e.message);
    }

    return { markovEngine: markov, valuator };
}

module.exports = { getCachedEngines };
