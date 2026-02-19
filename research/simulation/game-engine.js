/**
 * Headless Monopoly Game Engine
 *
 * A complete Monopoly game engine that runs without a UI,
 * designed for AI self-play and strategy optimization.
 */

'use strict';

// =============================================================================
// GAME CONSTANTS
// =============================================================================

const BOARD_SIZE = 40;
const STARTING_MONEY = 1500;
const GO_SALARY = 200;
const JAIL_POSITION = 10;
const GO_TO_JAIL_POSITION = 30;

// Square types
const SQUARE_TYPES = {
    GO: 'go',
    PROPERTY: 'property',
    RAILROAD: 'railroad',
    UTILITY: 'utility',
    TAX: 'tax',
    CHANCE: 'chance',
    COMMUNITY_CHEST: 'community_chest',
    JAIL: 'jail',
    FREE_PARKING: 'free_parking',
    GO_TO_JAIL: 'go_to_jail'
};

// Color groups
const COLOR_GROUPS = {
    brown: { name: 'Brown', squares: [1, 3], housePrice: 50 },
    lightBlue: { name: 'Light Blue', squares: [6, 8, 9], housePrice: 50 },
    pink: { name: 'Pink', squares: [11, 13, 14], housePrice: 100 },
    orange: { name: 'Orange', squares: [16, 18, 19], housePrice: 100 },
    red: { name: 'Red', squares: [21, 23, 24], housePrice: 150 },
    yellow: { name: 'Yellow', squares: [26, 27, 29], housePrice: 150 },
    green: { name: 'Green', squares: [31, 32, 34], housePrice: 200 },
    darkBlue: { name: 'Dark Blue', squares: [37, 39], housePrice: 200 }
};

// Property data (US Edition)
const PROPERTIES = {
    1: { name: 'Mediterranean Avenue', group: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], housePrice: 50 },
    3: { name: 'Baltic Avenue', group: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], housePrice: 50 },
    6: { name: 'Oriental Avenue', group: 'lightBlue', price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
    8: { name: 'Vermont Avenue', group: 'lightBlue', price: 100, rent: [6, 30, 90, 270, 400, 550], housePrice: 50 },
    9: { name: 'Connecticut Avenue', group: 'lightBlue', price: 120, rent: [8, 40, 100, 300, 450, 600], housePrice: 50 },
    11: { name: 'St. Charles Place', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
    13: { name: 'States Avenue', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], housePrice: 100 },
    14: { name: 'Virginia Avenue', group: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900], housePrice: 100 },
    16: { name: 'St. James Place', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
    18: { name: 'Tennessee Avenue', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], housePrice: 100 },
    19: { name: 'New York Avenue', group: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000], housePrice: 100 },
    21: { name: 'Kentucky Avenue', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
    23: { name: 'Indiana Avenue', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], housePrice: 150 },
    24: { name: 'Illinois Avenue', group: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100], housePrice: 150 },
    26: { name: 'Atlantic Avenue', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
    27: { name: 'Ventnor Avenue', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], housePrice: 150 },
    29: { name: 'Marvin Gardens', group: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200], housePrice: 150 },
    31: { name: 'Pacific Avenue', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
    32: { name: 'North Carolina Avenue', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], housePrice: 200 },
    34: { name: 'Pennsylvania Avenue', group: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], housePrice: 200 },
    37: { name: 'Park Place', group: 'darkBlue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], housePrice: 200 },
    39: { name: 'Boardwalk', group: 'darkBlue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], housePrice: 200 }
};

const RAILROADS = {
    5: { name: 'Reading Railroad', price: 200 },
    15: { name: 'Pennsylvania Railroad', price: 200 },
    25: { name: 'B&O Railroad', price: 200 },
    35: { name: 'Short Line Railroad', price: 200 }
};

const UTILITIES = {
    12: { name: 'Electric Company', price: 150 },
    28: { name: 'Water Works', price: 150 }
};

const RAILROAD_RENT = [0, 25, 50, 100, 200];
const UTILITY_MULTIPLIER = [0, 4, 10];

// Board layout
const BOARD = [
    { type: SQUARE_TYPES.GO, name: 'GO' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[1] },
    { type: SQUARE_TYPES.COMMUNITY_CHEST, name: 'Community Chest' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[3] },
    { type: SQUARE_TYPES.TAX, name: 'Income Tax', amount: 200 },
    { type: SQUARE_TYPES.RAILROAD, ...RAILROADS[5] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[6] },
    { type: SQUARE_TYPES.CHANCE, name: 'Chance' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[8] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[9] },
    { type: SQUARE_TYPES.JAIL, name: 'Jail / Just Visiting' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[11] },
    { type: SQUARE_TYPES.UTILITY, ...UTILITIES[12] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[13] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[14] },
    { type: SQUARE_TYPES.RAILROAD, ...RAILROADS[15] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[16] },
    { type: SQUARE_TYPES.COMMUNITY_CHEST, name: 'Community Chest' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[18] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[19] },
    { type: SQUARE_TYPES.FREE_PARKING, name: 'Free Parking' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[21] },
    { type: SQUARE_TYPES.CHANCE, name: 'Chance' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[23] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[24] },
    { type: SQUARE_TYPES.RAILROAD, ...RAILROADS[25] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[26] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[27] },
    { type: SQUARE_TYPES.UTILITY, ...UTILITIES[28] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[29] },
    { type: SQUARE_TYPES.GO_TO_JAIL, name: 'Go To Jail' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[31] },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[32] },
    { type: SQUARE_TYPES.COMMUNITY_CHEST, name: 'Community Chest' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[34] },
    { type: SQUARE_TYPES.RAILROAD, ...RAILROADS[35] },
    { type: SQUARE_TYPES.CHANCE, name: 'Chance' },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[37] },
    { type: SQUARE_TYPES.TAX, name: 'Luxury Tax', amount: 100 },
    { type: SQUARE_TYPES.PROPERTY, ...PROPERTIES[39] }
];

// =============================================================================
// PLAYER CLASS
// =============================================================================

class Player {
    constructor(id, name, ai = null) {
        this.id = id;
        this.name = name;
        this.ai = ai;

        this.money = STARTING_MONEY;
        this.position = 0;
        this.inJail = false;
        this.jailTurns = 0;
        this.properties = new Set();
        this.getOutOfJailCards = 0;
        this.bankrupt = false;
    }

    /**
     * Get net worth (cash + unmortgaged property value + house value)
     */
    getNetWorth(gameState) {
        let worth = this.money;

        for (const propIdx of this.properties) {
            const propState = gameState.propertyStates[propIdx];
            if (!propState.mortgaged) {
                worth += BOARD[propIdx].price;
                if (propState.houses > 0) {
                    worth += propState.houses * BOARD[propIdx].housePrice;
                }
            } else {
                worth += BOARD[propIdx].price * 0.5;  // Mortgaged value
            }
        }

        return worth;
    }

    /**
     * Count railroads owned
     */
    getRailroadCount() {
        let count = 0;
        for (const pos of [5, 15, 25, 35]) {
            if (this.properties.has(pos)) count++;
        }
        return count;
    }

    /**
     * Count utilities owned
     */
    getUtilityCount() {
        let count = 0;
        for (const pos of [12, 28]) {
            if (this.properties.has(pos)) count++;
        }
        return count;
    }

    /**
     * Check if player has monopoly on a color group
     */
    hasMonopoly(group, gameState) {
        const groupSquares = COLOR_GROUPS[group].squares;
        return groupSquares.every(sq => this.properties.has(sq));
    }

    /**
     * Get all monopolies owned
     */
    getMonopolies(gameState) {
        const monopolies = [];
        for (const [group, info] of Object.entries(COLOR_GROUPS)) {
            if (this.hasMonopoly(group, gameState)) {
                monopolies.push(group);
            }
        }
        return monopolies;
    }
}

// =============================================================================
// GAME STATE CLASS
// =============================================================================

class GameState {
    constructor(playerCount = 4) {
        this.players = [];
        this.currentPlayerIndex = 0;
        this.turn = 0;
        this.phase = 'early';  // early, mid, late

        // Property states (owner, houses, mortgaged)
        this.propertyStates = {};
        for (let i = 0; i < BOARD_SIZE; i++) {
            if (BOARD[i].price) {
                this.propertyStates[i] = {
                    owner: null,
                    houses: 0,
                    mortgaged: false
                };
            }
        }

        // Card decks (simplified - just track if jail card is out)
        this.chanceJailCardOut = false;
        this.ccJailCardOut = false;

        // House/hotel bank
        this.housesAvailable = 32;
        this.hotelsAvailable = 12;

        // Initialize players
        for (let i = 0; i < playerCount; i++) {
            this.players.push(new Player(i, `Player ${i + 1}`));
        }

        // Statistics
        this.stats = {
            totalTurns: 0,
            rentPaid: new Array(playerCount).fill(0),
            rentCollected: new Array(playerCount).fill(0),
            propertiesBought: new Array(playerCount).fill(0),
            housesBought: new Array(playerCount).fill(0)
        };
    }

    /**
     * Get current player
     */
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    /**
     * Get active (non-bankrupt) players
     */
    getActivePlayers() {
        return this.players.filter(p => !p.bankrupt);
    }

    /**
     * Check if game is over
     */
    isGameOver() {
        return this.getActivePlayers().length <= 1;
    }

    /**
     * Get winner (if game is over)
     */
    getWinner() {
        const active = this.getActivePlayers();
        if (active.length === 1) {
            return active[0];
        }
        return null;
    }

    /**
     * Update game phase based on state
     */
    updatePhase() {
        const ownedCount = Object.values(this.propertyStates)
            .filter(p => p.owner !== null).length;

        const totalDevelopment = Object.values(this.propertyStates)
            .reduce((sum, p) => sum + p.houses, 0);

        if (ownedCount < 14) {
            this.phase = 'early';
        } else if (totalDevelopment < 10) {
            this.phase = 'mid';
        } else {
            this.phase = 'late';
        }
    }

    /**
     * Clone the game state (for simulation lookahead)
     */
    clone() {
        const newState = new GameState(0);
        newState.players = this.players.map(p => {
            const newPlayer = new Player(p.id, p.name, p.ai);
            newPlayer.money = p.money;
            newPlayer.position = p.position;
            newPlayer.inJail = p.inJail;
            newPlayer.jailTurns = p.jailTurns;
            newPlayer.properties = new Set(p.properties);
            newPlayer.getOutOfJailCards = p.getOutOfJailCards;
            newPlayer.bankrupt = p.bankrupt;
            return newPlayer;
        });
        newState.currentPlayerIndex = this.currentPlayerIndex;
        newState.turn = this.turn;
        newState.phase = this.phase;
        newState.propertyStates = JSON.parse(JSON.stringify(this.propertyStates));
        newState.chanceJailCardOut = this.chanceJailCardOut;
        newState.ccJailCardOut = this.ccJailCardOut;
        newState.housesAvailable = this.housesAvailable;
        newState.hotelsAvailable = this.hotelsAvailable;
        return newState;
    }
}

// =============================================================================
// GAME ENGINE CLASS
// =============================================================================

class GameEngine {
    constructor(options = {}) {
        this.options = {
            maxTurns: options.maxTurns || 1000,
            verbose: options.verbose || false,
            ...options
        };

        this.state = null;
        this.eventLog = [];
    }

    /**
     * Initialize a new game
     */
    newGame(playerCount = 4, aiFactories = []) {
        this.state = new GameState(playerCount);
        this.eventLog = [];

        // Assign AIs to players
        for (let i = 0; i < playerCount; i++) {
            if (aiFactories[i]) {
                this.state.players[i].ai = aiFactories[i](this.state.players[i], this);
            }
        }

        this.log('Game started with ' + playerCount + ' players');
    }

    /**
     * Log event
     */
    log(message) {
        if (this.options.verbose) {
            console.log(`[Turn ${this.state.turn}] ${message}`);
        }
        this.eventLog.push({ turn: this.state.turn, message });
    }

    /**
     * Roll two dice
     */
    rollDice() {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        return { d1, d2, sum: d1 + d2, isDoubles: d1 === d2 };
    }

    /**
     * Move player and handle passing GO
     */
    movePlayer(player, spaces, collectGo = true) {
        const oldPos = player.position;
        player.position = (player.position + spaces) % BOARD_SIZE;

        // Check if passed GO
        if (collectGo && player.position < oldPos && player.position !== JAIL_POSITION) {
            player.money += GO_SALARY;
            this.log(`${player.name} passed GO and collected $${GO_SALARY}`);
        }

        return player.position;
    }

    /**
     * Send player to jail
     */
    sendToJail(player) {
        player.position = JAIL_POSITION;
        player.inJail = true;
        player.jailTurns = 0;
        this.log(`${player.name} was sent to jail`);
    }

    /**
     * Calculate rent for a property
     */
    calculateRent(position, diceRoll = 7) {
        const propState = this.state.propertyStates[position];
        if (!propState || propState.owner === null || propState.mortgaged) {
            return 0;
        }

        const square = BOARD[position];
        const owner = this.state.players[propState.owner];

        // Railroad
        if (square.type === SQUARE_TYPES.RAILROAD) {
            const rrCount = owner.getRailroadCount();
            return RAILROAD_RENT[rrCount];
        }

        // Utility
        if (square.type === SQUARE_TYPES.UTILITY) {
            const utilCount = owner.getUtilityCount();
            return UTILITY_MULTIPLIER[utilCount] * diceRoll;
        }

        // Property
        if (square.type === SQUARE_TYPES.PROPERTY) {
            if (propState.houses > 0) {
                return square.rent[propState.houses];
            }

            // Check for monopoly (double rent)
            if (owner.hasMonopoly(square.group, this.state)) {
                return square.rent[0] * 2;
            }

            return square.rent[0];
        }

        return 0;
    }

    /**
     * Handle player landing on a square
     */
    handleLanding(player, position, diceRoll) {
        const square = BOARD[position];

        switch (square.type) {
            case SQUARE_TYPES.GO:
                // Already handled in movePlayer
                break;

            case SQUARE_TYPES.PROPERTY:
            case SQUARE_TYPES.RAILROAD:
            case SQUARE_TYPES.UTILITY:
                this.handlePropertyLanding(player, position, diceRoll);
                break;

            case SQUARE_TYPES.TAX:
                // Raise cash if needed before paying tax
                if (player.money < square.amount) {
                    this.raiseCash(player, square.amount);
                }
                player.money -= square.amount;
                this.log(`${player.name} paid $${square.amount} tax`);
                // Check for bankruptcy (owe to bank)
                if (player.money < 0) {
                    this.handleBankruptcyToBank(player);
                }
                break;

            case SQUARE_TYPES.CHANCE:
                return this.drawChance(player, position);

            case SQUARE_TYPES.COMMUNITY_CHEST:
                return this.drawCommunityChest(player, position);

            case SQUARE_TYPES.GO_TO_JAIL:
                this.sendToJail(player);
                return { endTurn: true };

            case SQUARE_TYPES.JAIL:
            case SQUARE_TYPES.FREE_PARKING:
                // Nothing happens
                break;
        }

        return { endTurn: false };
    }

    /**
     * Handle landing on a property square
     */
    handlePropertyLanding(player, position, diceRoll) {
        const propState = this.state.propertyStates[position];
        const square = BOARD[position];

        if (propState.owner === null) {
            // Unowned - offer to buy
            this.handlePropertyPurchase(player, position);
        } else if (propState.owner !== player.id && !propState.mortgaged) {
            // Pay rent
            const rent = this.calculateRent(position, diceRoll);
            if (rent > 0) {
                const owner = this.state.players[propState.owner];
                this.transferMoney(player, owner, rent);
                this.log(`${player.name} paid $${rent} rent to ${owner.name}`);

                this.state.stats.rentPaid[player.id] += rent;
                this.state.stats.rentCollected[owner.id] += rent;
            }
        }
    }

    /**
     * Handle property purchase decision
     */
    handlePropertyPurchase(player, position) {
        const square = BOARD[position];

        // Ask AI if it wants to buy
        let wantsToBuy = false;

        if (player.ai && player.ai.decideBuy) {
            wantsToBuy = player.ai.decideBuy(position, this.state);
        } else {
            // Default: buy if can afford
            wantsToBuy = player.money >= square.price;
        }

        if (wantsToBuy && player.money >= square.price) {
            player.money -= square.price;
            player.properties.add(position);
            this.state.propertyStates[position].owner = player.id;
            this.log(`${player.name} bought ${square.name} for $${square.price}`);
            this.state.stats.propertiesBought[player.id]++;
        } else {
            // Auction
            this.runAuction(position);
        }
    }

    /**
     * Run a property auction
     * Uses proper round-robin bidding until all but one player passes
     */
    runAuction(position) {
        const square = BOARD[position];
        let highBid = 0;
        let highBidder = null;

        // Get active players and randomize starting order to avoid seat bias
        const bidders = [...this.state.getActivePlayers()];

        // Shuffle bidders to remove seat position advantage
        for (let i = bidders.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bidders[i], bidders[j]] = [bidders[j], bidders[i]];
        }

        // Track who is still in the auction
        const stillBidding = new Set(bidders.map(p => p.id));

        // Round-robin until only one bidder remains or all pass
        let rounds = 0;
        const maxRounds = 100;  // Prevent infinite loops

        while (stillBidding.size > 1 && rounds < maxRounds) {
            rounds++;
            let anyBidThisRound = false;

            for (const player of bidders) {
                if (!stillBidding.has(player.id)) continue;

                let bid = 0;

                if (player.ai && player.ai.decideBid) {
                    bid = player.ai.decideBid(position, highBid, this.state);
                } else {
                    // Default: bid up to property price if can afford
                    const maxBid = Math.min(player.money - 50, square.price);
                    if (maxBid > highBid) {
                        bid = highBid + 10;
                    }
                }

                if (bid > highBid && bid <= player.money) {
                    highBid = bid;
                    highBidder = player;
                    anyBidThisRound = true;
                } else {
                    // Player passes - remove from auction
                    stillBidding.delete(player.id);
                }
            }

            // If no one bid this round and we have a high bidder, they win
            if (!anyBidThisRound && highBidder) {
                break;
            }
        }

        if (highBidder) {
            highBidder.money -= highBid;
            highBidder.properties.add(position);
            this.state.propertyStates[position].owner = highBidder.id;
            this.log(`${highBidder.name} won auction for ${square.name} at $${highBid}`);
        }
    }

    /**
     * Transfer money between players (or from bank)
     */
    transferMoney(from, to, amount) {
        // First, try to raise cash if needed
        if (from.money < amount) {
            this.raiseCash(from, amount);
        }

        from.money -= amount;
        to.money += amount;

        // Check bankruptcy - if still negative after raising cash
        if (from.money < 0) {
            this.handleBankruptcy(from, to);
        }
    }

    /**
     * Handle player bankruptcy (to another player)
     */
    handleBankruptcy(player, creditor) {
        this.log(`${player.name} is bankrupt! Assets go to ${creditor.name}`);
        player.bankrupt = true;

        // Transfer all assets to creditor
        for (const propIdx of player.properties) {
            this.state.propertyStates[propIdx].owner = creditor.id;
            creditor.properties.add(propIdx);

            // Sell all houses back to bank
            const houses = this.state.propertyStates[propIdx].houses;
            if (houses > 0) {
                this.state.propertyStates[propIdx].houses = 0;
                if (houses === 5) {
                    this.state.hotelsAvailable++;
                    this.state.housesAvailable += 4;
                } else {
                    this.state.housesAvailable += houses;
                }
            }

            // Mortgaged properties stay mortgaged but transfer to creditor
            // (In real rules, creditor must pay 10% or unmortgage)
        }

        player.properties.clear();
        creditor.getOutOfJailCards += player.getOutOfJailCards;
        player.getOutOfJailCards = 0;
    }

    /**
     * Handle player bankruptcy to the bank (tax, card payment)
     * Properties go back to bank (unowned) and are auctioned
     */
    handleBankruptcyToBank(player) {
        this.log(`${player.name} is bankrupt to the bank!`);
        player.bankrupt = true;

        // Return all properties to bank
        for (const propIdx of player.properties) {
            this.state.propertyStates[propIdx].owner = null;
            this.state.propertyStates[propIdx].mortgaged = false;

            // Return all houses to bank
            const houses = this.state.propertyStates[propIdx].houses;
            if (houses > 0) {
                this.state.propertyStates[propIdx].houses = 0;
                if (houses === 5) {
                    this.state.hotelsAvailable++;
                    this.state.housesAvailable += 4;
                } else {
                    this.state.housesAvailable += houses;
                }
            }
        }

        player.properties.clear();
        player.getOutOfJailCards = 0;
        player.money = 0;
    }

    /**
     * Draw a Chance card
     */
    drawChance(player, fromPosition) {
        const card = Math.floor(Math.random() * 16);
        let result = { endTurn: false };

        switch (card) {
            case 0:  // Advance to Boardwalk
                player.position = 39;
                this.handleLanding(player, 39, 7);
                break;
            case 1:  // Advance to GO
                player.position = 0;
                player.money += GO_SALARY;
                break;
            case 2:  // Advance to Illinois
                if (player.position > 24) player.money += GO_SALARY;
                player.position = 24;
                this.handleLanding(player, 24, 7);
                break;
            case 3:  // Advance to St. Charles
                if (player.position > 11) player.money += GO_SALARY;
                player.position = 11;
                this.handleLanding(player, 11, 7);
                break;
            case 4:  // Advance to Reading Railroad
                if (player.position > 5) player.money += GO_SALARY;
                player.position = 5;
                this.handleLanding(player, 5, 7);
                break;
            case 5:  // Go to Jail
                this.sendToJail(player);
                result.endTurn = true;
                break;
            case 6:
            case 7:  // Advance to nearest Railroad (2 cards)
                const rr = this.nearestRailroad(fromPosition);
                if (rr < player.position) player.money += GO_SALARY;
                player.position = rr;
                this.handleLanding(player, rr, 7);
                break;
            case 8:  // Advance to nearest Utility
                const util = this.nearestUtility(fromPosition);
                if (util < player.position) player.money += GO_SALARY;
                player.position = util;
                // Utility rent is 10x dice for this card
                const propState = this.state.propertyStates[util];
                if (propState.owner !== null && propState.owner !== player.id) {
                    const rent = 10 * this.rollDice().sum;
                    this.transferMoney(player, this.state.players[propState.owner], rent);
                }
                break;
            case 9:  // Go back 3 spaces
                player.position = (fromPosition - 3 + BOARD_SIZE) % BOARD_SIZE;
                const backResult = this.handleLanding(player, player.position, 7);
                if (backResult.endTurn) result.endTurn = true;
                break;
            case 10: // Bank pays $50
                player.money += 50;
                break;
            case 11: // Get out of jail free
                player.getOutOfJailCards++;
                break;
            case 12: // Pay poor tax $15
                player.money -= 15;
                break;
            case 13: // Pay each player $50
                for (const other of this.state.getActivePlayers()) {
                    if (other.id !== player.id) {
                        this.transferMoney(player, other, 50);
                    }
                }
                break;
            case 14: // Collect $150
                player.money += 150;
                break;
            case 15: // Street repairs
                let repairCost = 0;
                for (const propIdx of player.properties) {
                    const houses = this.state.propertyStates[propIdx].houses;
                    if (houses === 5) repairCost += 100;  // Hotel
                    else repairCost += houses * 25;
                }
                player.money -= repairCost;
                break;
        }

        return result;
    }

    /**
     * Draw a Community Chest card
     */
    drawCommunityChest(player, fromPosition) {
        const card = Math.floor(Math.random() * 16);
        let result = { endTurn: false };

        switch (card) {
            case 0:  // Advance to GO
                player.position = 0;
                player.money += GO_SALARY;
                break;
            case 1:  // Go to Jail
                this.sendToJail(player);
                result.endTurn = true;
                break;
            case 2:  // Bank error $200
                player.money += 200;
                break;
            case 3:  // Doctor's fee $50
                player.money -= 50;
                break;
            case 4:  // Sale of stock $50
                player.money += 50;
                break;
            case 5:  // Get out of jail free
                player.getOutOfJailCards++;
                break;
            case 6:  // Holiday fund $100
                player.money += 100;
                break;
            case 7:  // Income tax refund $20
                player.money += 20;
                break;
            case 8:  // Birthday $10 from each
                for (const other of this.state.getActivePlayers()) {
                    if (other.id !== player.id) {
                        this.transferMoney(other, player, 10);
                    }
                }
                break;
            case 9:  // Life insurance $100
                player.money += 100;
                break;
            case 10: // Hospital fee $100
                player.money -= 100;
                break;
            case 11: // School fee $50
                player.money -= 50;
                break;
            case 12: // Consultancy fee $25
                player.money += 25;
                break;
            case 13: // Street repairs
                let repairCost = 0;
                for (const propIdx of player.properties) {
                    const houses = this.state.propertyStates[propIdx].houses;
                    if (houses === 5) repairCost += 115;  // Hotel
                    else repairCost += houses * 40;
                }
                player.money -= repairCost;
                break;
            case 14: // Beauty contest $10
                player.money += 10;
                break;
            case 15: // Inherit $100
                player.money += 100;
                break;
        }

        return result;
    }

    /**
     * Find nearest railroad
     */
    nearestRailroad(from) {
        for (const rr of [5, 15, 25, 35]) {
            if (rr > from) return rr;
        }
        return 5;  // Wrap to Reading
    }

    /**
     * Find nearest utility
     */
    nearestUtility(from) {
        if (from < 12 || from >= 28) return 12;
        return 28;
    }

    /**
     * Execute one player's turn
     */
    executeTurn() {
        const player = this.state.getCurrentPlayer();

        if (player.bankrupt) {
            this.advanceToNextPlayer();
            return;
        }

        this.log(`${player.name}'s turn (money: $${player.money})`);

        // Pre-turn: AI can build houses, propose trades
        if (player.ai && player.ai.preTurn) {
            player.ai.preTurn(this.state);
        }

        // Handle jail
        if (player.inJail) {
            this.handleJailTurn(player);
        } else {
            this.handleNormalTurn(player);
        }

        // Post-turn: AI can do cleanup
        if (player.ai && player.ai.postTurn) {
            player.ai.postTurn(this.state);
        }

        this.advanceToNextPlayer();
    }

    /**
     * Handle a turn when player is in jail
     */
    handleJailTurn(player) {
        // Ask AI for jail strategy
        let postBail = false;

        if (player.ai && player.ai.decideJail) {
            postBail = player.ai.decideJail(this.state);
        }

        // Use get out of jail card if available and want to leave
        if (postBail && player.getOutOfJailCards > 0) {
            player.getOutOfJailCards--;
            player.inJail = false;
            player.jailTurns = 0;
            this.log(`${player.name} used a Get Out of Jail Free card`);
            this.handleNormalTurn(player);
            return;
        }

        // Pay $50 to leave
        if (postBail && player.money >= 50) {
            player.money -= 50;
            player.inJail = false;
            player.jailTurns = 0;
            this.log(`${player.name} paid $50 to leave jail`);
            this.handleNormalTurn(player);
            return;
        }

        // Try to roll doubles
        const roll = this.rollDice();
        this.log(`${player.name} rolled ${roll.d1} + ${roll.d2} = ${roll.sum}`);

        if (roll.isDoubles) {
            player.inJail = false;
            player.jailTurns = 0;
            this.log(`${player.name} rolled doubles and escaped jail`);

            // Move but no extra roll
            this.movePlayer(player, roll.sum, false);
            this.handleLanding(player, player.position, roll.sum);
        } else {
            player.jailTurns++;

            if (player.jailTurns >= 3) {
                // Must leave on 3rd turn
                player.money -= 50;
                player.inJail = false;
                player.jailTurns = 0;
                this.log(`${player.name} paid $50 after 3 turns in jail`);

                this.movePlayer(player, roll.sum, false);
                this.handleLanding(player, player.position, roll.sum);
            } else {
                this.log(`${player.name} stays in jail (turn ${player.jailTurns})`);
            }
        }
    }

    /**
     * Handle a normal turn (not in jail)
     */
    handleNormalTurn(player) {
        let doublesCount = 0;

        while (true) {
            const roll = this.rollDice();
            this.log(`${player.name} rolled ${roll.d1} + ${roll.d2} = ${roll.sum}`);

            if (roll.isDoubles) {
                doublesCount++;

                if (doublesCount === 3) {
                    this.sendToJail(player);
                    return;
                }
            }

            // Move player
            this.movePlayer(player, roll.sum);

            // Handle landing
            const result = this.handleLanding(player, player.position, roll.sum);

            // Check bankruptcy
            if (player.bankrupt) return;

            // If sent to jail or not doubles, turn ends
            if (result.endTurn || !roll.isDoubles) {
                return;
            }

            // Doubles - roll again
        }
    }

    /**
     * Advance to next active player
     */
    advanceToNextPlayer() {
        do {
            this.state.currentPlayerIndex =
                (this.state.currentPlayerIndex + 1) % this.state.players.length;

            if (this.state.currentPlayerIndex === 0) {
                this.state.turn++;
                this.state.stats.totalTurns++;
                this.state.updatePhase();
            }
        } while (
            this.state.players[this.state.currentPlayerIndex].bankrupt &&
            !this.state.isGameOver()
        );
    }

    /**
     * Run the game until completion or max turns
     */
    runGame() {
        while (!this.state.isGameOver() && this.state.turn < this.options.maxTurns) {
            this.executeTurn();
        }

        const winner = this.state.getWinner();
        if (winner) {
            this.log(`Game over! ${winner.name} wins!`);
        } else {
            this.log(`Game ended at turn limit (${this.options.maxTurns})`);
        }

        return {
            winner: winner ? winner.id : null,
            turns: this.state.turn,
            stats: this.state.stats,
            finalState: this.state
        };
    }

    /**
     * Build houses for a player (used by AI)
     */
    buildHouse(player, position) {
        const propState = this.state.propertyStates[position];
        const square = BOARD[position];

        if (!square.housePrice) return false;
        if (propState.owner !== player.id) return false;
        if (propState.mortgaged) return false;
        if (propState.houses >= 5) return false;
        if (!player.hasMonopoly(square.group, this.state)) return false;

        // Check even building rule
        const groupSquares = COLOR_GROUPS[square.group].squares;
        const minHouses = Math.min(...groupSquares.map(sq =>
            this.state.propertyStates[sq].houses
        ));
        if (propState.houses > minHouses) return false;

        // Check house availability
        if (propState.houses === 4) {
            if (this.state.hotelsAvailable < 1) return false;
        } else {
            if (this.state.housesAvailable < 1) return false;
        }

        // Check affordability
        if (player.money < square.housePrice) return false;

        // Build!
        player.money -= square.housePrice;
        propState.houses++;

        if (propState.houses === 5) {
            this.state.hotelsAvailable--;
            this.state.housesAvailable += 4;  // Return 4 houses
        } else {
            this.state.housesAvailable--;
        }

        this.log(`${player.name} built on ${square.name} (now ${propState.houses} houses)`);
        this.state.stats.housesBought[player.id]++;
        return true;
    }

    /**
     * Sell a house from a property (used by AI to raise cash)
     * Returns the sale price (half of house cost)
     *
     * IMPORTANT RULES:
     * - Must sell evenly (can only sell from property with most houses)
     * - If selling a hotel (5 houses), need 4 houses available to downgrade
     * - If no houses available, must sell ALL houses on the property
     */
    sellHouse(player, position) {
        const propState = this.state.propertyStates[position];
        const square = BOARD[position];

        if (!square.housePrice) return 0;
        if (propState.owner !== player.id) return 0;
        if (propState.houses <= 0) return 0;

        const groupSquares = COLOR_GROUPS[square.group].squares;

        // Check even selling rule - can only sell from property with most houses
        const maxHouses = Math.max(...groupSquares.map(sq =>
            this.state.propertyStates[sq].houses
        ));
        if (propState.houses < maxHouses) return 0;

        const salePrice = Math.floor(square.housePrice / 2);

        // Selling a hotel
        if (propState.houses === 5) {
            // Need 4 houses available to downgrade hotel to 4 houses
            if (this.state.housesAvailable >= 4) {
                // Normal downgrade: hotel → 4 houses
                this.state.hotelsAvailable++;
                this.state.housesAvailable -= 4;
                propState.houses = 4;
                player.money += salePrice;
                this.log(`${player.name} sold hotel on ${square.name} (now 4 houses) for $${salePrice}`);
                return salePrice;
            } else {
                // CRITICAL RULE: No houses available, must sell ALL houses!
                // This is a brutal penalty - you lose the hotel AND get nothing for the "missing" houses
                const housesCanReturn = this.state.housesAvailable;
                this.state.hotelsAvailable++;
                // We can only physically place back what's available
                // The rest are "lost" - player only gets paid for what they can sell
                propState.houses = 0;
                const totalSale = salePrice * 5;  // Still get paid for all 5 levels
                player.money += totalSale;
                this.log(`${player.name} FORCED to sell ALL development on ${square.name} (no houses available) for $${totalSale}`);
                return totalSale;
            }
        }

        // Selling a regular house
        propState.houses--;
        this.state.housesAvailable++;
        player.money += salePrice;
        this.log(`${player.name} sold house on ${square.name} (now ${propState.houses} houses) for $${salePrice}`);
        return salePrice;
    }

    /**
     * Mortgage a property
     * Returns mortgage value (50% of property price)
     *
     * RULES:
     * - Cannot mortgage if there are ANY houses on ANY property in the monopoly
     * - Other properties in monopoly still collect 2x rent if unmortgaged
     */
    mortgageProperty(player, position) {
        const propState = this.state.propertyStates[position];
        const square = BOARD[position];

        if (!square.price) return 0;
        if (propState.owner !== player.id) return 0;
        if (propState.mortgaged) return 0;

        // Cannot mortgage if any property in the color group has houses
        if (square.group && COLOR_GROUPS[square.group]) {
            const groupSquares = COLOR_GROUPS[square.group].squares;
            const hasHouses = groupSquares.some(sq =>
                this.state.propertyStates[sq].houses > 0
            );
            if (hasHouses) {
                this.log(`Cannot mortgage ${square.name} - must sell all houses in ${square.group} first`);
                return 0;
            }
        }

        const mortgageValue = Math.floor(square.price / 2);
        propState.mortgaged = true;
        player.money += mortgageValue;

        this.log(`${player.name} mortgaged ${square.name} for $${mortgageValue}`);
        return mortgageValue;
    }

    /**
     * Unmortgage a property
     * Costs mortgage value + 10% interest
     */
    unmortgageProperty(player, position) {
        const propState = this.state.propertyStates[position];
        const square = BOARD[position];

        if (!square.price) return false;
        if (propState.owner !== player.id) return false;
        if (!propState.mortgaged) return false;

        const mortgageValue = Math.floor(square.price / 2);
        const unmortgageCost = Math.floor(mortgageValue * 1.1);  // 10% interest

        if (player.money < unmortgageCost) return false;

        player.money -= unmortgageCost;
        propState.mortgaged = false;

        this.log(`${player.name} unmortgaged ${square.name} for $${unmortgageCost}`);
        return true;
    }

    /**
     * Raise cash by selling houses and mortgaging properties
     * Used when player needs to pay rent/tax but doesn't have enough
     *
     * @param {Player} player - Player who needs cash
     * @param {number} amountNeeded - How much cash is needed
     * @returns {boolean} true if enough cash was raised
     */
    raiseCash(player, amountNeeded) {
        if (player.money >= amountNeeded) return true;

        // Strategy: sell houses first (highest to lowest value), then mortgage

        // Phase 1: Sell houses, starting with most developed properties
        while (player.money < amountNeeded) {
            // Find property with most houses that we can sell from
            let bestTarget = null;
            let bestHouses = 0;

            for (const propIdx of player.properties) {
                const propState = this.state.propertyStates[propIdx];
                const square = BOARD[propIdx];

                if (propState.houses <= 0) continue;
                if (!square.group) continue;

                // Check even selling - must have max houses in group
                const groupSquares = COLOR_GROUPS[square.group].squares;
                const maxInGroup = Math.max(...groupSquares.map(sq =>
                    this.state.propertyStates[sq].houses
                ));

                if (propState.houses === maxInGroup && propState.houses > bestHouses) {
                    bestHouses = propState.houses;
                    bestTarget = propIdx;
                }
            }

            if (bestTarget !== null) {
                this.sellHouse(player, bestTarget);
            } else {
                break;  // No more houses to sell
            }
        }

        // Phase 2: Mortgage properties (lowest value first)
        if (player.money < amountNeeded) {
            const mortgageable = Array.from(player.properties)
                .filter(propIdx => {
                    const propState = this.state.propertyStates[propIdx];
                    const square = BOARD[propIdx];
                    if (propState.mortgaged) return false;
                    if (propState.houses > 0) return false;
                    return true;
                })
                .sort((a, b) => BOARD[a].price - BOARD[b].price);

            for (const propIdx of mortgageable) {
                if (player.money >= amountNeeded) break;
                this.mortgageProperty(player, propIdx);
            }
        }

        return player.money >= amountNeeded;
    }

    /**
     * Check if any property in a monopoly has houses
     * (Used to determine if mortgaging is allowed)
     */
    monopolyHasHouses(group) {
        if (!COLOR_GROUPS[group]) return false;

        const groupSquares = COLOR_GROUPS[group].squares;
        return groupSquares.some(sq =>
            this.state.propertyStates[sq].houses > 0
        );
    }

    // =========================================================================
    // TRADING
    // =========================================================================

    /**
     * Execute a trade between two players
     *
     * @param {Object} trade - Trade details:
     *   - from: Player offering the trade
     *   - to: Player receiving the offer
     *   - fromProperties: Set of property indices from offering player
     *   - toProperties: Set of property indices from receiving player
     *   - fromCash: Cash from offering player (can be negative if receiving)
     * @returns {boolean} true if trade was executed
     */
    executeTrade(trade) {
        const { from, to, fromProperties, toProperties, fromCash } = trade;

        // Validate trade
        // 1. Check all properties are owned by correct players
        for (const prop of fromProperties) {
            if (this.state.propertyStates[prop].owner !== from.id) {
                this.log(`Trade invalid: ${from.name} doesn't own property ${prop}`);
                return false;
            }
            // Cannot trade properties with houses
            if (this.state.propertyStates[prop].houses > 0) {
                this.log(`Trade invalid: Property ${prop} has houses`);
                return false;
            }
        }

        for (const prop of toProperties) {
            if (this.state.propertyStates[prop].owner !== to.id) {
                this.log(`Trade invalid: ${to.name} doesn't own property ${prop}`);
                return false;
            }
            if (this.state.propertyStates[prop].houses > 0) {
                this.log(`Trade invalid: Property ${prop} has houses`);
                return false;
            }
        }

        // 2. Check cash amounts are valid
        if (fromCash > 0 && from.money < fromCash) {
            this.log(`Trade invalid: ${from.name} can't afford $${fromCash}`);
            return false;
        }
        if (fromCash < 0 && to.money < -fromCash) {
            this.log(`Trade invalid: ${to.name} can't afford $${-fromCash}`);
            return false;
        }

        // Execute trade
        // Transfer properties from -> to
        for (const prop of fromProperties) {
            this.state.propertyStates[prop].owner = to.id;
            from.properties.delete(prop);
            to.properties.add(prop);
        }

        // Transfer properties to -> from
        for (const prop of toProperties) {
            this.state.propertyStates[prop].owner = from.id;
            to.properties.delete(prop);
            from.properties.add(prop);
        }

        // Transfer cash
        from.money -= fromCash;
        to.money += fromCash;

        // Log the trade
        const fromPropNames = Array.from(fromProperties).map(p => BOARD[p].name).join(', ');
        const toPropNames = Array.from(toProperties).map(p => BOARD[p].name).join(', ');
        let tradeDesc = `${from.name} traded`;
        if (fromProperties.size > 0) tradeDesc += ` [${fromPropNames}]`;
        if (fromCash > 0) tradeDesc += ` + $${fromCash}`;
        tradeDesc += ` to ${to.name} for`;
        if (toProperties.size > 0) tradeDesc += ` [${toPropNames}]`;
        if (fromCash < 0) tradeDesc += ` + $${-fromCash}`;

        this.log(tradeDesc);

        return true;
    }

    /**
     * Find potential trades that could create monopolies
     * Returns array of trade opportunities
     */
    findTradeOpportunities(player) {
        const opportunities = [];

        // For each color group
        for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
            const groupSquares = group.squares;

            // Count ownership
            const myOwned = groupSquares.filter(sq =>
                this.state.propertyStates[sq].owner === player.id
            );
            const unowned = groupSquares.filter(sq =>
                this.state.propertyStates[sq].owner === null
            );

            // Skip if I already have monopoly or no ownership
            if (myOwned.length === groupSquares.length) continue;
            if (myOwned.length === 0) continue;
            if (unowned.length > 0) continue;  // Can still buy, don't trade

            // Find who owns the rest
            const othersOwned = groupSquares.filter(sq =>
                this.state.propertyStates[sq].owner !== player.id &&
                this.state.propertyStates[sq].owner !== null
            );

            // Group by owner
            const byOwner = {};
            for (const sq of othersOwned) {
                const owner = this.state.propertyStates[sq].owner;
                if (!byOwner[owner]) byOwner[owner] = [];
                byOwner[owner].push(sq);
            }

            // Check if single player owns rest (simpler trade)
            for (const [ownerId, props] of Object.entries(byOwner)) {
                const otherPlayer = this.state.players[parseInt(ownerId)];
                if (otherPlayer.bankrupt) continue;

                opportunities.push({
                    type: 'complete_monopoly',
                    group: groupName,
                    myOwned,
                    needed: props,
                    from: otherPlayer,
                    priority: groupSquares.length - myOwned.length  // Fewer needed = higher priority
                });
            }
        }

        return opportunities;
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    GameEngine,
    GameState,
    Player,
    BOARD,
    BOARD_SIZE,
    PROPERTIES,
    RAILROADS,
    UTILITIES,
    COLOR_GROUPS,
    RAILROAD_RENT,
    UTILITY_MULTIPLIER,
    SQUARE_TYPES
};
