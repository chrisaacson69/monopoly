/**
 * Investment Map Generator
 *
 * Calculates the optimal property investments at each capital level.
 * This creates a theoretical framework to understand:
 * 1. What's the best EPT/$1 at any given capital level?
 * 2. When does upgrading from one monopoly to another make sense?
 * 3. How does time preference affect property valuations?
 *
 * Key Concepts:
 * - Dice EPT: Money entering the game each turn (~$35-45 from Go + cards)
 * - Property EPT: Wealth transfer between players (per opponent turn)
 * - Capital progression: $1500 + diceEPT * turn
 *
 * NOTE: All EPT values are PER OPPONENT TURN (raw values from Markov analysis)
 * Multiply by number of opponents for total EPT in a game
 */

'use strict';

const { MarkovEngine } = require('../markov-engine.js');
const PropertyValuator = require('../property-valuator.js');

class InvestmentMapGenerator {
    constructor() {
        this.markov = null;
        this.valuator = null;
        this.probabilities = null;
    }

    initialize() {
        console.log('Initializing Markov engine and valuator...');
        this.markov = new MarkovEngine();
        this.markov.initialize();

        this.valuator = new PropertyValuator.Valuator(this.markov);
        this.valuator.initialize();

        this.probabilities = this.markov.getAllProbabilities('stay');
        console.log('Initialization complete.\n');
    }

    /**
     * Calculate dice EPT - money entering the game from the bank each turn
     */
    calculateDiceEPT() {
        // Average move distance with doubles mechanics:
        const avgMoveNoDoubles = 7;
        const avgMoveOneDouble = 14;
        const avgMoveTwoDoubles = 21;

        const probNoDoubles = 5/6;
        const probOneDouble = 5/36;
        const probTwoDoubles = 5/216;
        const probTripleDoubles = 1/216;

        const avgMovePerTurn =
            probNoDoubles * avgMoveNoDoubles +
            probOneDouble * avgMoveOneDouble +
            probTwoDoubles * avgMoveTwoDoubles +
            probTripleDoubles * 0;

        console.log(`Average squares moved per turn: ${avgMovePerTurn.toFixed(2)}`);

        // Expected passes of Go per turn
        const passGoFromMovement = avgMovePerTurn / 40;

        // Cards that send you to Go
        const probChance = this.probabilities[7] + this.probabilities[22] + this.probabilities[36];
        const probCC = this.probabilities[2] + this.probabilities[17] + this.probabilities[33];

        const probGoFromChance = probChance * (1/16);
        const probGoFromCC = probCC * (1/16);

        const totalGoPassesPerTurn = passGoFromMovement + probGoFromChance + probGoFromCC;
        const goSalary = 200;
        const goEPT = totalGoPassesPerTurn * goSalary;

        // Other cash-giving cards
        const chanceMoneyPerLanding = (50 + 150) / 16;
        const chanceMoneyEPT = probChance * chanceMoneyPerLanding;

        const ccSimpleCash = 200 + 25 + 20 + 100 + 50 + 100 + 100 + 10;
        const ccMoneyPerLanding = ccSimpleCash / 16;
        const ccMoneyEPT = probCC * ccMoneyPerLanding;

        const totalDiceEPT = goEPT + chanceMoneyEPT + ccMoneyEPT;

        console.log(`\nDICE EPT BREAKDOWN:`);
        console.log(`  Go salary: $${goEPT.toFixed(2)}/turn (${(totalGoPassesPerTurn * 100).toFixed(2)}% pass rate)`);
        console.log(`  Chance cards: $${chanceMoneyEPT.toFixed(2)}/turn`);
        console.log(`  CC cards: $${ccMoneyEPT.toFixed(2)}/turn`);
        console.log(`  TOTAL: $${totalDiceEPT.toFixed(2)}/turn`);

        return {
            avgMovePerTurn,
            goPassesPerTurn: totalGoPassesPerTurn,
            goEPT,
            chanceMoneyEPT,
            ccMoneyEPT,
            totalDiceEPT
        };
    }

    /**
     * Calculate investment details for a color group at a given house level
     * Returns: cost to acquire, EPT, and liquidation value
     */
    calculateGroupInvestment(groupName, houses) {
        const squares = PropertyValuator.COLOR_GROUPS[groupName];
        const numProperties = squares.length;

        // Get property and house prices
        const firstProp = PropertyValuator.PROPERTIES[squares[0]];
        const housePrice = firstProp.housePrice;

        // Calculate property costs
        let propertyCost = 0;
        for (const sq of squares) {
            propertyCost += PropertyValuator.PROPERTIES[sq].price;
        }

        // Total houses needed (evenly distributed)
        const totalHouses = houses * numProperties;
        const houseCost = totalHouses * housePrice;

        // Total investment
        const totalInvestment = propertyCost + houseCost;

        // Liquidation values
        const mortgageValue = propertyCost * 0.5;  // 50% of property cost
        const houseSellback = totalHouses * housePrice * 0.5;  // 50% of house cost
        const totalLiquidation = mortgageValue + houseSellback;

        // EPT (per opponent turn)
        const eptPerOpponent = PropertyValuator.calculateGroupEPT(groupName, this.probabilities, houses);

        return {
            groupName,
            houses,
            numProperties,
            propertyCost,
            houseCost,
            totalInvestment,
            mortgageValue,
            houseSellback,
            totalLiquidation,
            eptPerOpponent,
            eptPer1000: (eptPerOpponent / totalInvestment) * 1000
        };
    }

    /**
     * Generate complete investment map with all variables
     */
    generateInvestmentMap() {
        console.log('\n' + '='.repeat(90));
        console.log('COMPLETE INVESTMENT MAP');
        console.log('All EPT values are PER OPPONENT TURN');
        console.log('='.repeat(90));

        const investments = [];

        // Color group monopolies at different house levels
        for (const groupName of Object.keys(PropertyValuator.COLOR_GROUPS)) {
            for (let houses = 0; houses <= 5; houses++) {
                const data = this.calculateGroupInvestment(groupName, houses);
                investments.push(data);
            }
        }

        // Sort by total investment
        investments.sort((a, b) => a.totalInvestment - b.totalInvestment);

        // Print header
        console.log('\n' + '-'.repeat(120));
        console.log(
            'Group'.padEnd(12) +
            'Houses'.padStart(7) +
            'PropCost'.padStart(10) +
            'HouseCost'.padStart(10) +
            'TOTAL'.padStart(10) +
            'EPT'.padStart(10) +
            'EPT/$1000'.padStart(12) +
            'Mortgage'.padStart(10) +
            'HouseSell'.padStart(10) +
            'Liquidate'.padStart(10)
        );
        console.log('-'.repeat(120));

        for (const inv of investments) {
            const housesStr = inv.houses === 5 ? 'Hotel' : inv.houses === 0 ? 'Mono' : `${inv.houses}H`;
            console.log(
                inv.groupName.padEnd(12) +
                housesStr.padStart(7) +
                `$${inv.propertyCost}`.padStart(10) +
                `$${inv.houseCost}`.padStart(10) +
                `$${inv.totalInvestment}`.padStart(10) +
                `$${inv.eptPerOpponent.toFixed(3)}`.padStart(10) +
                `$${inv.eptPer1000.toFixed(3)}`.padStart(12) +
                `$${inv.mortgageValue}`.padStart(10) +
                `$${inv.houseSellback}`.padStart(10) +
                `$${inv.totalLiquidation}`.padStart(10)
            );
        }

        return investments;
    }

    /**
     * Generate upgrade analysis: What happens if you sell one monopoly to get another?
     */
    generateUpgradeAnalysis() {
        console.log('\n' + '='.repeat(90));
        console.log('MONOPOLY UPGRADE ANALYSIS');
        console.log('What if you liquidate one monopoly to fund another?');
        console.log('='.repeat(90));

        const groups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

        // Start with Brown @ 3 houses (the typical early monopoly)
        const source = this.calculateGroupInvestment('brown', 3);

        console.log(`\nSOURCE: Brown @ 3 houses`);
        console.log(`  Investment: $${source.totalInvestment}`);
        console.log(`  EPT: $${source.eptPerOpponent.toFixed(3)}/opponent/turn`);
        console.log(`  Liquidation value: $${source.totalLiquidation}`);
        console.log(`  (Mortgage: $${source.mortgageValue}, House sellback: $${source.houseSellback})`);

        console.log('\n' + '-'.repeat(100));
        console.log(
            'Target'.padEnd(12) +
            'Houses'.padStart(8) +
            'Cost'.padStart(10) +
            'CashNeeded'.padStart(12) +
            'NewEPT'.padStart(10) +
            'EPTChange'.padStart(12) +
            'EPT/$1000'.padStart(12) +
            'Worth It?'.padStart(12)
        );
        console.log('-'.repeat(100));

        for (const targetGroup of groups) {
            if (targetGroup === 'brown') continue;

            // Try different house levels for the target
            for (let targetHouses = 0; targetHouses <= 3; targetHouses++) {
                const target = this.calculateGroupInvestment(targetGroup, targetHouses);

                // Cash needed = target cost - liquidation from source
                const cashNeeded = target.totalInvestment - source.totalLiquidation;

                // EPT change
                const eptChange = target.eptPerOpponent - source.eptPerOpponent;

                // Is it worth it? (more EPT AND reasonable cash requirement)
                const worthIt = eptChange > 0 && cashNeeded < 500;

                const housesStr = targetHouses === 0 ? 'Mono' : `${targetHouses}H`;

                console.log(
                    targetGroup.padEnd(12) +
                    housesStr.padStart(8) +
                    `$${target.totalInvestment}`.padStart(10) +
                    `$${cashNeeded}`.padStart(12) +
                    `$${target.eptPerOpponent.toFixed(3)}`.padStart(10) +
                    `${eptChange >= 0 ? '+' : ''}$${eptChange.toFixed(3)}`.padStart(12) +
                    `$${target.eptPer1000.toFixed(3)}`.padStart(12) +
                    (worthIt ? 'YES' : 'no').padStart(12)
                );
            }
            console.log('');  // Blank line between groups
        }

        // Now show analysis from Light Blue @ 3 houses
        const sourceLB = this.calculateGroupInvestment('lightBlue', 3);

        console.log('\n' + '='.repeat(90));
        console.log(`\nSOURCE: Light Blue @ 3 houses`);
        console.log(`  Investment: $${sourceLB.totalInvestment}`);
        console.log(`  EPT: $${sourceLB.eptPerOpponent.toFixed(3)}/opponent/turn`);
        console.log(`  Liquidation value: $${sourceLB.totalLiquidation}`);

        console.log('\n' + '-'.repeat(100));
        console.log(
            'Target'.padEnd(12) +
            'Houses'.padStart(8) +
            'Cost'.padStart(10) +
            'CashNeeded'.padStart(12) +
            'NewEPT'.padStart(10) +
            'EPTChange'.padStart(12) +
            'EPT/$1000'.padStart(12) +
            'Worth It?'.padStart(12)
        );
        console.log('-'.repeat(100));

        for (const targetGroup of groups) {
            if (targetGroup === 'brown' || targetGroup === 'lightBlue') continue;

            for (let targetHouses = 0; targetHouses <= 3; targetHouses++) {
                const target = this.calculateGroupInvestment(targetGroup, targetHouses);
                const cashNeeded = target.totalInvestment - sourceLB.totalLiquidation;
                const eptChange = target.eptPerOpponent - sourceLB.eptPerOpponent;
                const worthIt = eptChange > 0 && cashNeeded < 500;

                const housesStr = targetHouses === 0 ? 'Mono' : `${targetHouses}H`;

                console.log(
                    targetGroup.padEnd(12) +
                    housesStr.padStart(8) +
                    `$${target.totalInvestment}`.padStart(10) +
                    `$${cashNeeded}`.padStart(12) +
                    `$${target.eptPerOpponent.toFixed(3)}`.padStart(10) +
                    `${eptChange >= 0 ? '+' : ''}$${eptChange.toFixed(3)}`.padStart(12) +
                    `$${target.eptPer1000.toFixed(3)}`.padStart(12) +
                    (worthIt ? 'YES' : 'no').padStart(12)
                );
            }
            console.log('');
        }
    }

    /**
     * Generate capital progression timeline
     */
    generateCapitalProgression(diceEPT, maxTurns = 60) {
        console.log('\n' + '='.repeat(90));
        console.log('CAPITAL PROGRESSION TIMELINE');
        console.log(`Starting capital: $1500, Dice EPT: $${diceEPT.toFixed(2)}/turn`);
        console.log('='.repeat(90));

        const startingCapital = 1500;

        // Key investment thresholds
        const milestones = [
            { capital: 120, desc: 'Brown monopoly (undeveloped)' },
            { capital: 320, desc: 'Light Blue monopoly OR Brown @ 2H' },
            { capital: 420, desc: 'Brown @ 3H' },
            { capital: 440, desc: 'Pink monopoly' },
            { capital: 560, desc: 'Orange monopoly' },
            { capital: 620, desc: 'Brown @ Hotel OR LB @ 2H' },
            { capital: 680, desc: 'Red monopoly' },
            { capital: 750, desc: 'Dark Blue monopoly' },
            { capital: 770, desc: 'Light Blue @ 3H' },
            { capital: 800, desc: 'Yellow monopoly' },
            { capital: 920, desc: 'Green monopoly OR LB @ 4H' },
            { capital: 1070, desc: 'Light Blue @ Hotel' },
            { capital: 1340, desc: 'Pink @ 3H' },
            { capital: 1460, desc: 'Orange @ 3H' },
            { capital: 1950, desc: 'Dark Blue @ 3H' },
            { capital: 2030, desc: 'Red @ 3H' },
            { capital: 2150, desc: 'Yellow @ 3H' },
            { capital: 2720, desc: 'Green @ 3H' },
        ];

        console.log('\nTurn | Capital  | New milestone unlocked');
        console.log('-'.repeat(70));

        let lastMilestoneIdx = -1;

        for (let turn = 0; turn <= maxTurns; turn += 5) {
            const capital = startingCapital + (diceEPT * turn);

            // Find highest achievable milestone
            let currentMilestoneIdx = -1;
            for (let i = 0; i < milestones.length; i++) {
                if (milestones[i].capital <= capital) {
                    currentMilestoneIdx = i;
                }
            }

            // Only print if we've reached a new milestone or at key intervals
            if (currentMilestoneIdx > lastMilestoneIdx || turn === 0 || turn % 20 === 0) {
                const milestone = currentMilestoneIdx >= 0 ? milestones[currentMilestoneIdx].desc : 'Single properties only';
                const isNew = currentMilestoneIdx > lastMilestoneIdx;

                console.log(
                    `${turn.toString().padStart(4)} | ` +
                    `$${capital.toFixed(0).padStart(6)} | ` +
                    `${isNew ? '>> ' : '   '}${milestone}`
                );

                lastMilestoneIdx = currentMilestoneIdx;
            }
        }
    }

    /**
     * Generate EPT per $1000 comparison table (sorted by efficiency)
     */
    generateEfficiencyRankings() {
        console.log('\n' + '='.repeat(90));
        console.log('EFFICIENCY RANKINGS: EPT per $1000 invested');
        console.log('(Higher = better return per dollar)');
        console.log('='.repeat(90));

        const investments = [];

        for (const groupName of Object.keys(PropertyValuator.COLOR_GROUPS)) {
            for (let houses = 0; houses <= 5; houses++) {
                const data = this.calculateGroupInvestment(groupName, houses);
                investments.push(data);
            }
        }

        // Sort by EPT per $1000 (descending)
        investments.sort((a, b) => b.eptPer1000 - a.eptPer1000);

        console.log('\n' + '-'.repeat(80));
        console.log(
            'Rank'.padStart(5) +
            'Group'.padEnd(14) +
            'Level'.padStart(8) +
            'Cost'.padStart(10) +
            'EPT'.padStart(10) +
            'EPT/$1000'.padStart(12) +
            'Payback'.padStart(12)
        );
        console.log('-'.repeat(80));

        investments.forEach((inv, idx) => {
            const housesStr = inv.houses === 5 ? 'Hotel' : inv.houses === 0 ? 'Monopoly' : `${inv.houses} Houses`;
            const payback = inv.totalInvestment / (inv.eptPerOpponent * 3);  // Assuming 3 opponents

            console.log(
                `${(idx + 1).toString().padStart(5)} ` +
                inv.groupName.padEnd(14) +
                housesStr.padStart(8) +
                `$${inv.totalInvestment}`.padStart(10) +
                `$${inv.eptPerOpponent.toFixed(3)}`.padStart(10) +
                `$${inv.eptPer1000.toFixed(3)}`.padStart(12) +
                `${payback.toFixed(1)} turns`.padStart(12)
            );
        });
    }

    /**
     * Run complete analysis
     */
    runAnalysis() {
        this.initialize();

        // 1. Calculate dice EPT
        const diceEPT = this.calculateDiceEPT();

        // 2. Generate complete investment map
        this.generateInvestmentMap();

        // 3. Generate efficiency rankings
        this.generateEfficiencyRankings();

        // 4. Show capital progression
        this.generateCapitalProgression(diceEPT.totalDiceEPT);

        // 5. Analyze upgrade scenarios
        this.generateUpgradeAnalysis();

        // Summary
        console.log('\n' + '='.repeat(90));
        console.log('KEY INSIGHTS');
        console.log('='.repeat(90));

        console.log(`
1. DICE EPT: $${diceEPT.totalDiceEPT.toFixed(2)}/turn enters the game from bank

2. BROWN @ 3 HOUSES:
   - Cost: $420, EPT: $5.593/opponent/turn
   - EPT per $1000: $13.317
   - Liquidation: $210 (mortgage) + $150 (houses) = $360

3. KEY COMPARISON (at 3 houses, sorted by EPT/$1000):
   - Orange @ 3H: $${this.calculateGroupInvestment('orange', 3).eptPer1000.toFixed(3)} per $1000
   - Red @ 3H: $${this.calculateGroupInvestment('red', 3).eptPer1000.toFixed(3)} per $1000
   - Dark Blue @ 3H: $${this.calculateGroupInvestment('darkBlue', 3).eptPer1000.toFixed(3)} per $1000
   - Yellow @ 3H: $${this.calculateGroupInvestment('yellow', 3).eptPer1000.toFixed(3)} per $1000
   - Green @ 3H: $${this.calculateGroupInvestment('green', 3).eptPer1000.toFixed(3)} per $1000
   - Pink @ 3H: $${this.calculateGroupInvestment('pink', 3).eptPer1000.toFixed(3)} per $1000
   - Light Blue @ 3H: $${this.calculateGroupInvestment('lightBlue', 3).eptPer1000.toFixed(3)} per $1000
   - Brown @ 3H: $${this.calculateGroupInvestment('brown', 3).eptPer1000.toFixed(3)} per $1000

4. UPGRADE FROM BROWN @ 3H:
   - Liquidation gives you $360
   - Light Blue @ 2H costs $620 (need $260 extra) -> EPT $6.427 (+$0.834)
   - Pink @ 0 costs $440 (need $80 extra) -> EPT $1.620 (-$3.973) NO
   - Orange @ 1H costs $860 (need $500 extra) -> EPT $6.585 (+$0.992)

5. THE BROWN PARADOX EXPLAINED:
   - Brown has WORST EPT/$1000 at 3 houses ($13.317)
   - But browns are buyable at turn 0 ($420 << $1500 starting cash)
   - The "accessibility premium" drives overbidding
   - Optimal: Pay face value for browns, never more
`);

        return {
            diceEPT,
        };
    }
}

// CLI entry point
if (require.main === module) {
    const generator = new InvestmentMapGenerator();
    generator.runAnalysis();
}

module.exports = { InvestmentMapGenerator };
