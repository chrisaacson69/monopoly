# Richup.io AI Integration

This module adapts our StrategicTradeAI to play on richup.io against real human opponents.

## Architecture Overview

### Current State (shadazls/Monopoly-Bot-Richup.io)
The existing bot is a "farm bot" - it:
- Rolls dice and ends turns
- Makes NO strategic decisions
- Used to farm in-game currency by having 2 players take turns

### What We Need to Add

#### 1. Game State Extraction
Extract from the DOM:
- **Our cash balance** - displayed in player panel
- **Our properties** - shown as owned tiles
- **Our position** - current square on board
- **Opponent data** - their cash, properties, positions
- **Available actions** - buy, auction, trade, build, mortgage, end turn
- **Trade offers** - incoming proposals from other players

#### 2. Decision Points to Implement

| Action | Our AI Method | Notes |
|--------|--------------|-------|
| Buy property? | `shouldBuyProperty()` | Consider blocking value, EPT, cash reserves |
| Auction bid? | `getAuctionBid()` | Premium bidding from EnhancedRelativeAI |
| Accept trade? | `evaluateTrade()` | Trade quality filter from StrategicTradeAI |
| Propose trade? | `generateTradeOffer()` | Find monopoly-completing trades |
| Build houses? | `shouldBuildHouse()` | ROI-based building priority |
| Mortgage? | `getMortgageDecision()` | Debt management from EnhancedRelativeAI |
| Pay jail fee? | `shouldPayJailFee()` | Based on game phase |

#### 3. Mapping Richup.io to Our Model

**Board Mapping**:
Richup.io uses real-world locations instead of classic Monopoly names.
Need to map their property groups to our color groups for EPT calculations.

**Property Groups (to be confirmed)**:
- Brown equivalent: ~2 cheapest properties
- Light Blue equivalent: ~3 cheap properties
- etc.

### File Structure

```
richup-integration/
├── README.md                 # This file
├── requirements.txt          # Python dependencies
├── config.py                 # Configuration (credentials, timing)
├── locators.py              # CSS/XPath selectors (extended from original)
├── game_state.py            # Extract game state from DOM
├── board_mapping.py         # Map richup.io properties to our model
├── ai_adapter.py            # Bridge between our JS AI and Python
├── strategic_bot.py         # Main bot using our AI
└── main.py                  # Entry point
```

### Technical Approach

#### Option A: Python Port of AI
Port our JavaScript AI logic to Python directly.
- Pros: Clean integration, no inter-process communication
- Cons: Maintain two codebases, risk of divergence

#### Option B: Node.js Child Process
Call our JS AI from Python via subprocess.
- Pros: Reuse exact AI code
- Cons: IPC overhead, complexity

#### Option C: HTTP API
Wrap our AI in a simple Express server, call from Python.
- Pros: Clean separation, could support multiple bots
- Cons: More infrastructure

**Recommendation**: Start with Option A (Python port) for the core logic, keeping it simple. The key algorithms are straightforward to port.

### Key Selectors Identified

From the original bot's `locators.py`:

```python
# Actions
ROLL_DICES_BUTTON = ".zrAsGo65 > div:nth-child(1) > button:nth-child(1)"
BUY_PROPERTY_BUTTON = "div._YZ7dkIA:nth-child(2) > div > div > button"
AUCTION_BUTTON = "div._YZ7dkIA:nth-child(1) > div > div > button"
END_TURN_BUTTON = "div._YZ7dkIA:nth-child(1) > div > div > div > button"

# Auction
AUCTION_CURRENT_BID = ".LJ72TaNX > span:nth-child(2)"
AUCTION_BID_2_BUTTON = ...
AUCTION_BID_10_BUTTON = ...
AUCTION_BID_100_BUTTON = ...

# Trading
CREATE_TRADE_BUTTON = ".yCokhJwL"
LIST_PLAYER_TRADE_DIV = ".qS3VjzBC"
```

### Completed Steps

1. [x] Analyzed richup.io existing bot framework
2. [x] Documented CSS selectors for game elements
3. [x] Created board_mapping.py with property group assignments
4. [x] Ported core AI algorithms to Python (strategic_ai.py)
5. [x] Implemented game_state_extractor.py
6. [x] Built strategic_bot.py main loop
7. [x] Created test suite (test_ai.py) - all tests passing

### Next Steps (Manual Work Required)

1. [ ] **Play richup.io manually** to verify/update CSS selectors
2. [ ] **Map richup.io property names** to our position indices
3. [ ] **Test in practice mode** against bots first
4. [ ] **Fine-tune delays** for human-like behavior
5. [ ] **Test against humans** in public games

### How to Run

```bash
# Install dependencies
cd richup-integration
pip install -r requirements.txt

# Run AI tests (verify port is correct)
python test_ai.py

# Run bot on a game (you'll need to join a game first)
python strategic_bot.py "https://richup.io/room/YOUR_GAME_ID" [optional_firefox_profile]
```

## Alternative Platforms Evaluated

| Platform | Type | Status | Notes |
|----------|------|--------|-------|
| **[Richup.io](https://richup.io/)** | Online client | **CHOSEN** | Free browser Monopoly, has existing bot framework |
| **[Monopoly-Bot-Richup.io](https://github.com/shadazls/Monopoly-Bot-Richup.io)** | Selenium framework | **CHOSEN** | Bot framework for Richup.io automation |
| [intrepidcoder/monopoly](https://github.com/intrepidcoder/monopoly) | Standalone JS game | Future option | Has AI for practice - good for quick testing without online play |
| [BOT-OPOLY](https://jonzia.github.io/Monopoly/) | MATLAB RL framework | Future option | Advanced ML approach - revisit if we try neural nets or hybrid |
| [MonopolySimulator](https://github.com/giogix2/MonopolySimulator) | Python simulator | Not ready | No trading implemented - missing critical feature |
| [Rento Fortune](https://rento.com) | Commercial game | Too complex | Multi-platform but would require screen automation |
| [boardgame.io](https://boardgame.io/) | Game dev framework | N/A | Framework for building games, no Monopoly client exists |

### Future Directions

1. **Neural Net Approach**: BOT-OPOLY uses ensemble regression trees for value functions. Could compare our heuristic approach vs ML-trained approach.

2. **Hybrid Approach**: Use our Markov chain probabilities + EPT calculations as features for a neural network, combining mathematical rigor with learned weights.

3. **Quick Testing**: intrepidcoder/monopoly could be used for rapid iteration without needing to connect to online servers.

## Risk Assessment

### Legal/ToS Considerations
- Richup.io ToS should be reviewed
- Bot should play at human-like speed (not instant)
- Don't spam games or disrupt service

### Technical Risks
- CSS selectors may change with site updates
- Game may have anti-bot measures
- WebSocket communication might be needed for real-time events

### Mitigation
- Add configurable delays between actions
- Implement robust error handling
- Log extensively for debugging
- Be prepared to update selectors
