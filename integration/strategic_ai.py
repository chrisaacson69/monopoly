"""
Strategic AI for Richup.io

Python port of our StrategicTradeAI - the best performing AI from self-play tournaments.

Key features:
1. Trade quality filtering based on empirical win rates
2. Premium auction bidding (5% above face value)
3. Conservative debt management (max 15% of net worth)
4. Smart blocking (only pay premium when sole blocker)

Tournament results (1000 games):
- Head-to-head vs EnhancedRelativeOptimal: 54.7% vs 45.3%
- Z-score: 2.95 (statistically significant, p<0.05)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set
from board_mapping import (
    BoardMapper, GROUP_QUALITY, GROUP_PROPERTIES,
    PROPERTY_PRICES, POSITION_TO_GROUP, HOUSE_COST
)


@dataclass
class PlayerState:
    """State of a single player."""
    player_id: str
    cash: int
    properties: Set[int] = field(default_factory=set)
    position: int = 0
    in_jail: bool = False
    mortgaged: Set[int] = field(default_factory=set)
    houses: Dict[int, int] = field(default_factory=dict)  # position -> house count


@dataclass
class GameState:
    """Full game state."""
    my_state: PlayerState
    opponents: List[PlayerState]
    current_turn: str  # player_id whose turn it is
    turn_number: int = 0
    available_houses: int = 32
    available_hotels: int = 12


@dataclass
class TradeOffer:
    """A trade proposal."""
    from_player: str
    to_player: str
    properties_offered: Set[int]
    properties_requested: Set[int]
    cash_offered: int
    cash_requested: int


class StrategicAI:
    """
    Strategic AI ported from JavaScript.

    Implements the key insight: Not all monopolies are equal.
    Trade quality filter based on empirical win rates.
    """

    def __init__(self):
        self.board = BoardMapper()

        # Parameters from EnhancedRelativeAI
        self.base_bid_premium = 0.05  # 5% above face value at auctions
        self.max_debt_ratio = 0.15    # Max 15% of net worth in mortgages
        self.max_absolute_debt = 400  # Hard cap on mortgage debt
        self.absolute_min_cash = 75   # Always keep this much cash
        self.smart_blocking = True    # Only block when sole blocker

        # Trade quality parameters from StrategicTradeAI
        self.min_quality_ratio = 0.85  # Accept if our quality >= 85% of theirs
        self.max_quality_ratio = 1.40  # Reject if they get >40% better

    def calculate_net_worth(self, player: PlayerState) -> int:
        """Calculate player's total net worth."""
        worth = player.cash

        for pos in player.properties:
            price = PROPERTY_PRICES.get(pos, 0)
            if pos in player.mortgaged:
                worth += price // 2  # Mortgaged = half value
            else:
                worth += price
                # Add house value
                houses = player.houses.get(pos, 0)
                group = POSITION_TO_GROUP.get(pos)
                if group and houses > 0:
                    house_cost = HOUSE_COST.get(group, 100)
                    worth += houses * house_cost

        return worth

    def calculate_property_ept(self, player: PlayerState, num_opponents: int = 3) -> float:
        """Calculate expected property earnings per turn."""
        return self.board.calculate_ept(player.properties, num_opponents)

    def calculate_relative_ept(self, state: GameState) -> float:
        """
        Calculate relative EPT - the key metric.

        relativeEPT = myPropertyEPT - (totalPropertyEPT / numPlayers)

        Positive = gaining ground on opponents
        Negative = losing ground
        """
        num_players = 1 + len(state.opponents)
        num_opponents = len(state.opponents)

        my_ept = self.calculate_property_ept(state.my_state, num_opponents)

        total_ept = my_ept
        for opp in state.opponents:
            total_ept += self.calculate_property_ept(opp, num_players - 1)

        average_ept = total_ept / num_players
        return my_ept - average_ept

    def get_monopoly_quality(self, properties: Set[int]) -> float:
        """
        Calculate quality of monopolies in a property set.
        Higher quality = higher win rate.
        """
        quality = 0

        for group, positions in GROUP_PROPERTIES.items():
            if all(pos in properties for pos in positions):
                # Has this monopoly
                quality += GROUP_QUALITY.get(group, 1.0)

        return quality

    # ============== PURCHASE DECISIONS ==============

    def should_buy_property(self, state: GameState, position: int, price: int) -> bool:
        """
        Decide whether to buy a property when landing on it.

        Consider:
        - Can we afford it while maintaining reserves?
        - Does it complete a monopoly?
        - Does it block an opponent's monopoly?
        - What's the EPT value?
        """
        player = state.my_state

        # Must have minimum cash after purchase
        if player.cash - price < self.absolute_min_cash:
            return False

        group = POSITION_TO_GROUP.get(position)
        if not group:
            return True  # Non-property square? Shouldn't happen

        # Always buy if it completes our monopoly
        props_after = player.properties | {position}
        if self.board.has_monopoly(props_after, group):
            return True

        # Check blocking value
        for opp in state.opponents:
            if self.board.has_monopoly(opp.properties | {position}, group):
                # This would complete opponent's monopoly - block it!
                # But only if we're the sole blocker (smart blocking)
                if self.smart_blocking:
                    other_blockers = sum(
                        1 for o in state.opponents
                        if o != opp and position not in o.properties
                        and any(p in o.properties for p in GROUP_PROPERTIES[group])
                    )
                    if other_blockers == 0:
                        return True  # We're the only one who can block
                else:
                    return True

        # Default: buy if we can afford with buffer
        return player.cash - price >= self.absolute_min_cash + 100

    # ============== AUCTION DECISIONS ==============

    def get_auction_bid(self, state: GameState, position: int, current_bid: int) -> int:
        """
        Decide auction bid amount.

        Key insight from our research: Properties are undervalued at face price.
        Paying 5% premium dominates, but 20% overextends.
        """
        player = state.my_state
        price = PROPERTY_PRICES.get(position, 100)
        group = POSITION_TO_GROUP.get(position)

        # Base max bid: face value + premium
        max_bid = int(price * (1 + self.base_bid_premium))

        # Adjust for monopoly completion
        props_after = player.properties | {position}
        if group and self.board.has_monopoly(props_after, group):
            max_bid = int(max_bid * 1.5)  # 50% more for monopoly completion

        # Adjust for blocking
        for opp in state.opponents:
            if self.board.has_monopoly(opp.properties | {position}, group):
                if self.smart_blocking:
                    # Check if we're sole blocker
                    other_blockers = sum(
                        1 for o in state.opponents
                        if o != opp and position not in o.properties
                        and any(p in o.properties for p in GROUP_PROPERTIES.get(group, []))
                    )
                    if other_blockers == 0:
                        max_bid = int(max_bid * 1.3)  # 30% more to block
                else:
                    max_bid = int(max_bid * 1.3)
                break

        # Debt constraint
        net_worth = self.calculate_net_worth(player)
        max_debt = min(self.max_absolute_debt, int(net_worth * self.max_debt_ratio))
        current_debt = sum(PROPERTY_PRICES.get(p, 0) // 2 for p in player.mortgaged)
        available_debt = max_debt - current_debt

        # Can't bid more than cash + available debt room
        affordable = player.cash + available_debt - self.absolute_min_cash
        max_bid = min(max_bid, affordable)

        # Only bid if we can beat current bid
        if max_bid <= current_bid:
            return 0  # Pass

        # Bid incrementally above current
        bid = current_bid + 10
        return min(bid, max_bid)

    # ============== TRADE DECISIONS ==============

    def evaluate_trade(self, state: GameState, offer: TradeOffer) -> bool:
        """
        Evaluate whether to accept a trade offer.

        Key insight from StrategicTradeAI: Not all monopolies are equal.
        Use trade quality filter based on empirical win rates.
        """
        player = state.my_state

        # Calculate what we'd have after trade
        my_props_after = (player.properties - offer.properties_requested) | offer.properties_offered
        my_cash_after = player.cash + offer.cash_offered - offer.cash_requested

        # Can't accept if we'd go broke
        if my_cash_after < self.absolute_min_cash:
            return False

        # Find the proposing opponent
        proposer = None
        for opp in state.opponents:
            if opp.player_id == offer.from_player:
                proposer = opp
                break

        if not proposer:
            return False

        # Calculate what they'd have after trade
        their_props_after = (proposer.properties - offer.properties_offered) | offer.properties_requested

        # Calculate monopoly quality for both sides
        our_quality = self.get_monopoly_quality(my_props_after)
        their_quality = self.get_monopoly_quality(their_props_after)

        our_quality_before = self.get_monopoly_quality(player.properties)
        their_quality_before = self.get_monopoly_quality(proposer.properties)

        # We gain a monopoly?
        we_gain_monopoly = our_quality > our_quality_before
        they_gain_monopoly = their_quality > their_quality_before

        # If neither gains monopoly, check EPT gain
        if not we_gain_monopoly and not they_gain_monopoly:
            # Simple EPT comparison
            ept_before = self.board.calculate_ept(player.properties, len(state.opponents))
            ept_after = self.board.calculate_ept(my_props_after, len(state.opponents))

            # Accept if we gain EPT or break even with cash
            net_cash = offer.cash_offered - offer.cash_requested
            return ept_after > ept_before or (ept_after == ept_before and net_cash > 0)

        # TRADE QUALITY FILTER - the key innovation

        # If they gain much better monopoly than us, reject
        if their_quality > our_quality * self.max_quality_ratio:
            return False

        # If our quality is at least 85% of theirs, accept
        if our_quality >= their_quality * self.min_quality_ratio:
            return True

        # Edge case: they get monopoly and we don't - be cautious
        if they_gain_monopoly and not we_gain_monopoly:
            # Only accept if we get significant cash
            net_cash = offer.cash_offered - offer.cash_requested
            return net_cash > 200  # Arbitrary threshold

        return True  # Default accept

    def generate_trade_offers(self, state: GameState) -> List[TradeOffer]:
        """
        Generate trade offers to propose to opponents.

        Focus on monopoly-completing trades.
        """
        offers = []
        player = state.my_state

        for group, positions in GROUP_PROPERTIES.items():
            # Do we own part of this group?
            owned_in_group = [p for p in positions if p in player.properties]
            needed = [p for p in positions if p not in player.properties]

            if len(owned_in_group) == 0 or len(needed) == 0:
                continue

            # Who owns the pieces we need?
            for needed_pos in needed:
                for opp in state.opponents:
                    if needed_pos in opp.properties:
                        # Found a potential trade

                        # What do they need that we have?
                        for their_group, their_positions in GROUP_PROPERTIES.items():
                            their_owned = [p for p in their_positions if p in opp.properties]
                            their_needed = [p for p in their_positions if p in player.properties]

                            if len(their_owned) > 0 and len(their_needed) > 0:
                                # Both sides can benefit

                                # Simple 1-for-1 trade
                                offer = TradeOffer(
                                    from_player=player.player_id,
                                    to_player=opp.player_id,
                                    properties_offered={their_needed[0]},
                                    properties_requested={needed_pos},
                                    cash_offered=0,
                                    cash_requested=0
                                )

                                # Adjust with cash if values differ
                                our_value = PROPERTY_PRICES.get(their_needed[0], 0)
                                their_value = PROPERTY_PRICES.get(needed_pos, 0)
                                diff = their_value - our_value

                                if diff > 0:
                                    offer.cash_offered = diff
                                else:
                                    offer.cash_requested = -diff

                                # Check if this trade passes our own filter
                                # (swap perspectives)
                                reverse_offer = TradeOffer(
                                    from_player=opp.player_id,
                                    to_player=player.player_id,
                                    properties_offered={needed_pos},
                                    properties_requested={their_needed[0]},
                                    cash_offered=offer.cash_requested,
                                    cash_requested=offer.cash_offered
                                )

                                # Only propose if we'd accept it ourselves
                                if self.evaluate_trade(state, reverse_offer):
                                    offers.append(offer)

        return offers

    # ============== BUILDING DECISIONS ==============

    def should_build_house(self, state: GameState, position: int) -> bool:
        """
        Decide whether to build a house on a property.

        Priority order (from ROI analysis):
        1. Orange - best ROI (3.48%)
        2. Red - 3.05%
        3. Dark Blue - 2.99%
        4. Yellow - 2.96%
        """
        player = state.my_state
        group = POSITION_TO_GROUP.get(position)

        if not group or group in ['railroad', 'utility']:
            return False

        # Must have monopoly
        if not self.board.has_monopoly(player.properties, group):
            return False

        # Must have available houses
        if state.available_houses <= 0:
            return False

        # Check cost
        house_cost = HOUSE_COST.get(group, 100)
        if player.cash - house_cost < self.absolute_min_cash + 50:
            return False

        # Check even building rule - all properties in group must be within 1 house
        houses_in_group = [player.houses.get(p, 0) for p in GROUP_PROPERTIES[group]]
        current_houses = player.houses.get(position, 0)

        if current_houses > min(houses_in_group):
            return False  # Must build on lowest first

        # Max 4 houses before hotel
        if current_houses >= 4:
            return False

        return True

    def get_building_priority(self, state: GameState) -> List[int]:
        """
        Get list of properties to build on, in priority order.

        Based on ROI rankings at 3 houses.
        """
        player = state.my_state
        priority_groups = ['orange', 'red', 'darkBlue', 'yellow', 'green', 'pink', 'lightBlue', 'brown']

        buildable = []

        for group in priority_groups:
            if not self.board.has_monopoly(player.properties, group):
                continue

            props = GROUP_PROPERTIES[group]
            for pos in props:
                if self.should_build_house(state, pos):
                    buildable.append(pos)

        return buildable

    # ============== JAIL DECISIONS ==============

    def should_pay_jail_fee(self, state: GameState) -> bool:
        """
        Decide whether to pay $50 to leave jail.

        Early game: Stay in jail (save money, can't buy much anyway)
        Late game: Pay to get out (need to collect rent, avoid opponents' hotels)
        """
        # Simple heuristic: pay if we have monopolies to defend/collect
        player = state.my_state

        for group in GROUP_PROPERTIES:
            if self.board.has_monopoly(player.properties, group):
                return True  # Pay to collect rent

        # Also pay if game is late (lots of development on board)
        total_houses = sum(player.houses.values())
        for opp in state.opponents:
            total_houses += sum(opp.houses.values())

        if total_houses > 10:
            return True  # Late game - get out

        return False  # Stay in jail

    # ============== MORTGAGE DECISIONS ==============

    def get_mortgage_decision(self, state: GameState, amount_needed: int) -> List[int]:
        """
        Decide which properties to mortgage to raise cash.

        Priority: Mortgage least valuable, non-monopoly properties first.
        Never mortgage properties in complete monopolies if possible.
        """
        player = state.my_state
        mortgageable = []

        for pos in player.properties:
            if pos in player.mortgaged:
                continue
            if player.houses.get(pos, 0) > 0:
                continue  # Can't mortgage with houses

            group = POSITION_TO_GROUP.get(pos)
            has_monopoly = group and self.board.has_monopoly(player.properties, group)

            price = PROPERTY_PRICES.get(pos, 0)
            mortgage_value = price // 2

            mortgageable.append({
                'position': pos,
                'value': mortgage_value,
                'has_monopoly': has_monopoly,
                'group_quality': GROUP_QUALITY.get(group, 1.0) if group else 0
            })

        # Sort: non-monopoly first, then by lowest quality
        mortgageable.sort(key=lambda x: (x['has_monopoly'], x['group_quality']))

        to_mortgage = []
        raised = 0

        for prop in mortgageable:
            if raised >= amount_needed:
                break
            to_mortgage.append(prop['position'])
            raised += prop['value']

        return to_mortgage

    def should_unmortgage(self, state: GameState, position: int) -> bool:
        """
        Decide whether to unmortgage a property.

        Priority: Unmortgage monopoly properties first for rent collection.
        """
        player = state.my_state

        if position not in player.mortgaged:
            return False

        price = PROPERTY_PRICES.get(position, 0)
        unmortgage_cost = int(price * 0.55)  # 50% + 10% interest

        if player.cash - unmortgage_cost < self.absolute_min_cash + 100:
            return False

        # Prioritize unmortgaging monopoly properties
        group = POSITION_TO_GROUP.get(position)
        if group and self.board.has_monopoly(player.properties, group):
            return True

        return False
