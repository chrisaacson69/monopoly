# Session Summary: Monopoly AI Development

## Objective
Create a Monopoly AI based on sound financial principles using Markov chain probability analysis and Earnings Per Turn (EPT) calculations, NOT machine learning.

## Files Created/Modified

### New Files
1. **markov-engine.js** - Markov chain probability calculator
   - 43-state extended model (40 board + 3 jail states)
   - Full doubles mechanic with proper probability separation
   - Chance/CC card effects with position-dependent destinations
   - "Just Visiting" vs "In Jail" state distinction
   - Both jail strategies (long stay vs short stay)

2. **property-valuator.js** - EPT and ROI calculations
   - EPT for all properties at all development levels
   - Marginal ROI for house investments
   - Group rankings by ROI
   - Railroad and utility valuations

3. **monte-carlo-sim.js** - Monte Carlo simulation
   - Validates Markov chain implementation
   - Same rule set for comparison

4. **strategic-ai.js** - AI player implementation
   - Drop-in replacement for existing AI
   - Uses EPT-based decision making

5. **ept-analysis.js** - Comprehensive EPT report generator
   - All properties × all development levels × both jail strategies

6. **compare-markov-montecarlo.js** - Validation tool
   - Side-by-side comparison of both methods

7. **test-markov.js** - Test suite for Markov engine

### Modified Files
- **CLAUDE.md** - Updated with comprehensive documentation

## Key Technical Challenges Solved

### 1. Doubles Mechanic Bug (Critical Fix)
**Problem**: Original code treated ALL even roll sums as "doubles"
```javascript
// WRONG: This is true for all even sums
const isDoubles = (roll % 2 === 0) && DICE_DOUBLES_PROB[roll] > 0;
```
**Solution**: Separate doubles and non-doubles paths explicitly
- Roll of 6: 5/36 total, but only 1/36 is doubles (3+3)
- Must handle each path separately in transition matrix

### 2. "Just Visiting" vs "In Jail" Distinction
**Problem**: Square 10 represents two different states
**Solution**:
- Use virtual state 50 (IN_JAIL marker) for "sent to jail" events
- State 10 remains "just visiting" (normal landing)
- Extended matrix maps state 50 → jail state 40

### 3. Jail Strategy Differences
**Long Stay** (try to roll doubles):
- Roll doubles → move, turn ENDS (no extra roll!)
- No doubles → stay in jail
- Turn 3: must leave

**Short Stay** (pay $50):
- Pay → roll normally with FULL doubles mechanics
- Different landing probability distribution

### 4. Landing Probability vs Occupancy
**Problem**: Raw steady-state gives occupancy (time spent), not landing probability
**Solution**:
- Compute expected landings from each starting state
- Normalize by total landing events
- Don't count jail→jail as new landing

## Validation Results

### Markov vs Monte Carlo (2M turns)
| Metric | Value |
|--------|-------|
| Average difference | 0.05% |
| Max difference | 0.6% (Jail) |
| Squares within 0.1% | 38/40 |

### Markov vs Published Values
| Metric | Value |
|--------|-------|
| Average difference | 0.09% |
| Max difference | 0.92% (Jail) |
| Squares within 0.2% | 38/40 |

## Key Insights

1. **Orange properties have best ROI** (3.48% at 3 houses)
2. **3rd house provides best marginal return** (~10% ROI)
3. **Illinois Avenue is most-landed property** (3.16%)
4. **Jail strategy affects probabilities** - squares 12-20 favored by long stay
5. **Utilities are poor investments** (1.29% ROI)
6. **4 Railroads are decent** (2.78% ROI, better than utilities)

## Remaining Work

1. Complete strategic AI integration testing
2. Add trading logic based on EPT differential
3. Implement auction bidding strategy
4. Consider game phase (early/mid/late) for tactical adjustments
5. Add opponent modeling for rent avoidance

## Commands to Run

```bash
# Full EPT analysis
node ept-analysis.js

# Validate Markov vs Monte Carlo
node compare-markov-montecarlo.js

# Test Markov probabilities
node test-markov.js
```
