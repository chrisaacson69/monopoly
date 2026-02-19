# Growth-Based Trading AI Summary

## Performance Results (2000-game round-robin)

| AI Type | Win Rate |
|---------|----------|
| **Growth** | **30.9%** |
| NPV | 27.6% |
| Trading | 24.9% |
| NoTrade | 9.2% |

## Key Insights

### 1. Cash-After-Trade Determines Monopoly Value

The fundamental insight: a monopoly's value depends not just on its rent schedule, but on **how quickly you can develop it**, which depends on **cash remaining after the trade**.

```
Orange monopoly NPV at different post-trade cash levels:
  $0 remaining:   NPV = $307   (can't develop!)
  $500 remaining: NPV = $5,557 (slow development)
  $1000 remaining: NPV = $7,675 (fast development)
```

### 2. The EPT Growth Curve

Instead of assuming instant 3-house development, the Growth AI models the actual development timeline:

1. Start with monopoly at 0 houses (2x rent)
2. Each turn: earn EPT, accumulate cash
3. When cash >= house cost × properties, buy next level
4. EPT increases → faster accumulation → compound growth

This creates an S-curve where early development is slow, then accelerates.

### 3. Conservative Trade Evaluation Wins

The most important finding: **being conservative about trades outperforms being aggressive**.

- Demanding 35% of opponent's monopoly value as compensation
- Not accepting "cheap" trades that enable opponent monopolies
- Using NPV calculations that account for cash-after-trade

### 4. The Trade Evaluation Logic

When selling property that completes opponent's monopoly:

```javascript
// Calculate opponent's monopoly value given their remaining cash
const opponentCashAfter = opponent.money - cashTheyPay;
const theirMonopolyNPV = calculateGrowthNPV(group, opponentCashAfter);

// Their net value = monopoly NPV - cash they pay
const theirValue = theirMonopolyNPV - cashTheyPay;

// Demand 35% of their net gain
return cashReceived >= theirValue * 0.35;
```

This creates an elegant feedback loop:
- Higher offers → less cash for opponent → lower monopoly NPV → lower minimum required
- The threshold automatically adjusts based on how much the trade benefits them

### 5. Offer Calculation

When making offers to complete our monopoly:

1. Sample different offer amounts
2. For each, calculate monopoly NPV given remaining cash
3. Find offer that maximizes profit (NPV - offer)
4. Match Standard Trading offers if still profitable

## Files

- `growth-trading-ai.js` - Main implementation
- `ept-growth-model.js` - Growth curve analysis
- `test-growth-ai.js` - Tournament tests
- `compare-trade-eval.js` - Trade evaluation comparison

## The Financial Principle

EPT acts as an "interest rate" on your position. The discount rate (velocity of money) should be factored into trade valuations. But critically, this discount rate is **endogenous** - it depends on your cash position, which changes based on the trade itself.

This recursive relationship (trade affects cash → cash affects NPV → NPV determines acceptable trades) is what makes the Growth AI more sophisticated than simpler approaches.
