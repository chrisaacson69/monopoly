# Trade Valuation: What Simulation Needs to Tune

## Current Model Gaps

### 1. Denial Value
The current model values properties based on what YOU can do with them.
It doesn't account for preventing OPPONENTS from having them.

**Example:** Orange monopoly early game
- Your valuation: "I have $800, can only build 2 houses, achievable EPT is $18.55"
- Reality: If opponent gets Orange with $1000, they build 3 houses → $50.86 EPT against YOU
- Denial value of Orange = opponent's potential EPT × probability they can develop it

### 2. Time-to-Impact
Properties that can be developed QUICKLY are worth more than their steady-state EPT suggests.

**Example:** Dark Blue vs Orange early game
- Dark Blue: needs $2000+ to be dangerous, won't happen for 20+ turns
- Orange: can be dangerous at $900, could happen in 5-10 turns
- The "present value" of Orange income exceeds Dark Blue because it arrives sooner

**Discount Rate Concept:**
```
Present Value = Future EPT / (1 + r)^turns_until_developed
```
Where `r` is a discount rate (maybe 5-10% per turn?) and `turns_until_developed` depends on:
- Current cash
- Expected income from existing properties
- Expected GO passes

### 3. Knockout Probability
The model treats EPT as if the game goes on forever. But Monopoly ends when players go bankrupt.

**Key Questions:**
- Given opponent's cash and my EPT, what's P(knockout in next N turns)?
- A $1000 rent on Boardwalk has different value vs a $500 cash opponent vs a $2000 cash opponent
- Against cash-poor opponents, moderate EPT may be sufficient
- Against cash-rich opponents, you need higher EPT ceiling to eventually knock them out

### 4. Development Race Dynamics
The current model is static. Real games have development races.

**Scenario:** Both players have monopolies, $1000 each
- If I build 3 houses on Orange ($900), I have $100 left, earning $50.86/turn
- If opponent builds 2 houses on Green ($1200), they're broke but earning $32.13/turn
- I'm winning the race because my ROI is better
- My $50.86 will grow to more houses faster than their $32.13

## Parameters to Tune via Simulation

### Urgency Weights
```javascript
// Current: fixed thresholds
if (cashRatio < 0.5) urgency += 0.3;

// Tunable: parameterized
if (cashRatio < URGENCY_THRESHOLD_LOW) urgency += URGENCY_BOOST_HIGH;
else if (cashRatio < URGENCY_THRESHOLD_MID) urgency += URGENCY_BOOST_MID;
```

### Value Component Weights
```javascript
// Current: linear interpolation
const roiWeight = 0.3 + urgency * 0.4;
const eptWeight = 0.4 - urgency * 0.2;
const ceilingWeight = 0.3 - urgency * 0.2;

// Tunable: separate parameters for each game phase
const weights = PHASE_WEIGHTS[phase];  // early/mid/late
const roiWeight = weights.roiBase + urgency * weights.roiUrgencyFactor;
```

### Denial Value Multiplier
```javascript
// NEW parameter: how much to weight preventing opponent development
const denialValue = opponentAchievableEPT * DENIAL_MULTIPLIER;
```

### Time Discount Rate
```javascript
// NEW parameter: discount future income
const turnsToDevelope = estimateTurnsToDevelop(color, myCash, myIncome);
const presentValue = achievableEPT / Math.pow(1 + TIME_DISCOUNT_RATE, turnsToDevelope);
```

### Knockout Threshold
```javascript
// NEW parameter: when is EPT "enough" vs needing more ceiling?
const knockoutTurns = opponentCash / myEPT;
if (knockoutTurns < KNOCKOUT_THRESHOLD) {
    // Don't need more EPT ceiling, current EPT is sufficient
    ceilingWeight *= 0.5;
}
```

## Simulation Design

### Game State Sampling
1. Generate states at turn 10, 20, 30, 40, 50
2. Vary: cash levels, monopoly ownership, development levels
3. Create "trade decision points" with 2-3 options each

### Metrics to Measure
- Win rate from each trade choice
- Average turns to victory/defeat
- Final cash position (for ties/long games)

### Optimization Approach
1. **Grid Search**: Try combinations of parameter values
2. **Gradient Descent**: Adjust parameters toward higher win rates
3. **Genetic Algorithm**: Evolve parameter sets that beat others

### Validation
- Parameters should be "reasonable" (not extreme values)
- Should generalize across different opponent strategies
- Should show intuitive behavior (e.g., Orange more valuable early, Green late)

## Expected Outcomes

After tuning, we'd expect:

1. **Early Game:**
   - Orange/Red valued highly (quick ROI, denial value)
   - Dark Blue/Green valued lower (can't develop yet)
   - Cash premiums are smaller (everyone cash-tight)

2. **Mid Game:**
   - Undeveloped monopolies surge in value (both sides can develop)
   - Cash premiums increase (liquidity matters more)
   - Denial value peaks (opponent development is imminent threat)

3. **Late Game:**
   - EPT ceiling matters more (need to knock out remaining players)
   - Green/Dark Blue rise in relative value
   - Partially developed properties worth less than cash to finish development

## Implementation Priority

1. **Add denial value** to trade calculations
2. **Add time-to-impact** discount for slow-to-develop properties
3. **Run basic simulations** to validate the model directionally
4. **Parameter sweep** to find reasonable ranges
5. **Fine-tune** with more sophisticated optimization
