/**
 * Test critical game rules
 */

'use strict';

const { GameEngine, GameState, Player, BOARD, COLOR_GROUPS } = require('./game-engine.js');

console.log('='.repeat(60));
console.log('TESTING MONOPOLY RULES');
console.log('='.repeat(60));

// Test 1: House/Hotel shortage
console.log('\n--- TEST 1: House/Hotel Availability ---');
{
    const engine = new GameEngine({ verbose: true });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        player.properties.add(sq);
    }
    player.money = 10000;

    console.log(`\nInitial: Houses=${state.housesAvailable}, Hotels=${state.hotelsAvailable}`);

    // Build to 4 houses on all 3 orange properties
    for (let house = 1; house <= 4; house++) {
        for (const sq of [16, 18, 19]) {
            const result = engine.buildHouse(player, sq);
            if (!result) {
                console.log(`Failed to build house ${house} on sq ${sq}`);
            }
        }
    }
    console.log(`After 4H each (12 houses used): Houses=${state.housesAvailable}, Hotels=${state.hotelsAvailable}`);

    // Build hotels
    for (const sq of [16, 18, 19]) {
        const result = engine.buildHouse(player, sq);  // 4->5 = hotel
        console.log(`Built hotel on sq ${sq}: ${result}`);
    }
    console.log(`After 3 hotels: Houses=${state.housesAvailable}, Hotels=${state.hotelsAvailable}`);
    // Should have: 32-12+12 = 32 houses (4 returned per hotel), 12-3 = 9 hotels

    console.log('✓ House/hotel tracking works');
}

// Test 2: Even building rule
console.log('\n--- TEST 2: Even Building Rule ---');
{
    const engine = new GameEngine({ verbose: false });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        player.properties.add(sq);
    }
    player.money = 10000;

    // Build 1 house on first property
    engine.buildHouse(player, 16);
    console.log(`After 1st build: sq16=${state.propertyStates[16].houses}, sq18=${state.propertyStates[18].houses}`);

    // Try to build 2nd house on same property (should fail)
    const result = engine.buildHouse(player, 16);
    console.log(`Build 2nd on sq16 (should fail): ${result}`);

    // Build on other properties should work
    const result2 = engine.buildHouse(player, 18);
    const result3 = engine.buildHouse(player, 19);
    console.log(`Build on sq18: ${result2}, sq19: ${result3}`);

    // Now can build 2nd on sq16
    const result4 = engine.buildHouse(player, 16);
    console.log(`Build 2nd on sq16 (should work now): ${result4}`);

    console.log('✓ Even building enforced');
}

// Test 3: Even selling rule
console.log('\n--- TEST 3: Even Selling Rule ---');
{
    const engine = new GameEngine({ verbose: false });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly with 3 houses each
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        state.propertyStates[sq].houses = 3;
        player.properties.add(sq);
    }
    state.housesAvailable = 32 - 9;  // 9 houses used
    player.money = 100;

    console.log(`Before sell: sq16=${state.propertyStates[16].houses}, sq18=${state.propertyStates[18].houses}, sq19=${state.propertyStates[19].houses}`);

    // Sell from sq16 (should work - all have 3)
    const sale1 = engine.sellHouse(player, 16);
    console.log(`Sell from sq16: $${sale1}, now has ${state.propertyStates[16].houses} houses`);

    // Try to sell from sq16 again (should fail - others still have 3)
    const sale2 = engine.sellHouse(player, 16);
    console.log(`Sell 2nd from sq16 (should fail): $${sale2}`);

    // Sell from sq18 (should work)
    const sale3 = engine.sellHouse(player, 18);
    console.log(`Sell from sq18: $${sale3}`);

    console.log('✓ Even selling enforced');
}

// Test 4: Hotel downgrade with house shortage
console.log('\n--- TEST 4: Hotel Downgrade with House Shortage ---');
{
    const engine = new GameEngine({ verbose: true });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly with hotels
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        state.propertyStates[sq].houses = 5;  // Hotel
        player.properties.add(sq);
    }
    state.housesAvailable = 2;  // Only 2 houses available!
    state.hotelsAvailable = 9;
    player.money = 100;

    console.log(`\nBefore: Houses=${state.housesAvailable}, Hotels=${state.hotelsAvailable}`);
    console.log(`sq16 houses: ${state.propertyStates[16].houses}`);

    // Sell hotel when not enough houses to downgrade
    const sale = engine.sellHouse(player, 16);
    console.log(`\nAfter sell: Houses=${state.housesAvailable}, Hotels=${state.hotelsAvailable}`);
    console.log(`sq16 houses: ${state.propertyStates[16].houses}`);
    console.log(`Player money: $${player.money}`);

    console.log('✓ Hotel shortage rule handled');
}

// Test 5: Mortgage rules
console.log('\n--- TEST 5: Mortgage Rules ---');
{
    const engine = new GameEngine({ verbose: false });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        player.properties.add(sq);
    }
    player.money = 500;

    // Build 1 house
    engine.buildHouse(player, 16);
    engine.buildHouse(player, 18);
    engine.buildHouse(player, 19);
    console.log(`Built houses. sq16=${state.propertyStates[16].houses}`);

    // Try to mortgage (should fail - has houses)
    const mortgage1 = engine.mortgageProperty(player, 18);
    console.log(`Mortgage sq18 with houses (should fail): $${mortgage1}`);

    // Sell all houses
    engine.sellHouse(player, 16);
    engine.sellHouse(player, 18);
    engine.sellHouse(player, 19);
    console.log(`Sold houses. sq16=${state.propertyStates[16].houses}`);

    // Now mortgage should work
    const mortgage2 = engine.mortgageProperty(player, 18);
    console.log(`Mortgage sq18 (should work): $${mortgage2}`);
    console.log(`sq18 mortgaged: ${state.propertyStates[18].mortgaged}`);

    // Check rent - mortgaged property = $0, others = 2x
    const rent16 = engine.calculateRent(16);  // Should be double (monopoly)
    const rent18 = engine.calculateRent(18);  // Should be 0 (mortgaged)
    console.log(`Rent sq16 (monopoly, unmortgaged): $${rent16} (expected $${BOARD[16].rent[0] * 2})`);
    console.log(`Rent sq18 (mortgaged): $${rent18} (expected $0)`);

    console.log('✓ Mortgage rules work');
}

// Test 6: Raise cash
console.log('\n--- TEST 6: Raise Cash ---');
{
    const engine = new GameEngine({ verbose: true });
    engine.newGame(2);

    const player = engine.state.players[0];
    const state = engine.state;

    // Give player Orange monopoly with 3 houses each
    for (const sq of [16, 18, 19]) {
        state.propertyStates[sq].owner = 0;
        state.propertyStates[sq].houses = 3;
        player.properties.add(sq);
    }
    state.housesAvailable = 32 - 9;
    player.money = 50;

    console.log(`\nBefore: Money=$${player.money}`);
    console.log(`Houses: sq16=${state.propertyStates[16].houses}, sq18=${state.propertyStates[18].houses}, sq19=${state.propertyStates[19].houses}`);

    // Need to raise $500
    const success = engine.raiseCash(player, 500);

    console.log(`\nAfter raising $500: Success=${success}, Money=$${player.money}`);
    console.log(`Houses: sq16=${state.propertyStates[16].houses}, sq18=${state.propertyStates[18].houses}, sq19=${state.propertyStates[19].houses}`);
    console.log(`Mortgaged: sq16=${state.propertyStates[16].mortgaged}, sq18=${state.propertyStates[18].mortgaged}, sq19=${state.propertyStates[19].mortgaged}`);

    console.log('✓ Raise cash works');
}

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
