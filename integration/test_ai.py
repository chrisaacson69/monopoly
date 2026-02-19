"""
Test script for the Strategic AI port.

Verifies that the Python AI makes the same decisions as the JavaScript version.
"""

from strategic_ai import StrategicAI, PlayerState, GameState, TradeOffer
from board_mapping import GROUP_QUALITY, POSITION_TO_GROUP, GROUP_PROPERTIES


def test_monopoly_quality():
    """Test monopoly quality calculations."""
    ai = StrategicAI()

    # No properties = no quality
    assert ai.get_monopoly_quality(set()) == 0

    # Brown monopoly = 0.85 (worst)
    brown_monopoly = {1, 3}
    quality = ai.get_monopoly_quality(brown_monopoly)
    assert quality == 0.85, f"Expected 0.85, got {quality}"

    # Green monopoly = 1.30 (best)
    green_monopoly = {31, 32, 34}
    quality = ai.get_monopoly_quality(green_monopoly)
    assert quality == 1.30, f"Expected 1.30, got {quality}"

    # Multiple monopolies
    both = brown_monopoly | green_monopoly
    quality = ai.get_monopoly_quality(both)
    assert quality == 0.85 + 1.30, f"Expected 2.15, got {quality}"

    print("[PASS] Monopoly quality tests passed")


def test_purchase_decision():
    """Test property purchase decisions."""
    ai = StrategicAI()

    # Create basic game state
    me = PlayerState(
        player_id="me",
        cash=500,
        properties={16, 18},  # Own 2/3 of orange
        position=19  # On third orange
    )

    opponent = PlayerState(
        player_id="opp",
        cash=500,
        properties={21, 23},  # Own 2/3 of red
    )

    state = GameState(
        my_state=me,
        opponents=[opponent],
        current_turn="me"
    )

    # Should buy - completes monopoly!
    assert ai.should_buy_property(state, 19, 200) == True

    # Test with low cash
    me.cash = 100
    # Should still buy to complete monopoly if we can afford it
    result = ai.should_buy_property(state, 19, 200)
    # 100 - 200 = -100, less than minimum, so NO
    assert result == False, "Should not buy when it leaves us broke"

    print("[PASS] Purchase decision tests passed")


def test_blocking():
    """Test blocking decisions."""
    ai = StrategicAI()

    me = PlayerState(
        player_id="me",
        cash=500,
        properties=set()
    )

    # Opponent about to complete red
    opponent = PlayerState(
        player_id="opp",
        cash=500,
        properties={21, 23},  # Own 2/3 of red
    )

    state = GameState(
        my_state=me,
        opponents=[opponent],
        current_turn="me"
    )

    # Position 24 completes opponent's red - should block!
    result = ai.should_buy_property(state, 24, 240)
    assert result == True, "Should buy to block opponent's monopoly"

    print("[PASS] Blocking tests passed")


def test_trade_quality_filter():
    """Test the key trade quality filter."""
    ai = StrategicAI()

    me = PlayerState(
        player_id="me",
        cash=500,
        properties={1, 3},  # Brown monopoly (worst)
    )

    opponent = PlayerState(
        player_id="opp",
        cash=500,
        properties={31, 32},  # 2/3 of green (best)
    )

    state = GameState(
        my_state=me,
        opponents=[opponent],
        current_turn="me"
    )

    # Trade: We give our brown, they give part of green
    # This would give them nothing, we'd get nothing
    # But if we give them green completion piece...

    # Scenario: They want our green property (34), offer brown
    me.properties = {34}  # We have the green piece they need
    opponent.properties = {31, 32, 1}  # They have 2/3 green + 1 brown

    state = GameState(
        my_state=me,
        opponents=[opponent],
        current_turn="opp"
    )

    # They offer brown (1) for our green (34)
    # This gives them green monopoly (1.30 quality)
    # We get... partial brown (0 quality, need 2 for monopoly)
    offer = TradeOffer(
        from_player="opp",
        to_player="me",
        properties_offered={1},
        properties_requested={34},
        cash_offered=0,
        cash_requested=0
    )

    # AI should REJECT - they get green monopoly (1.30), we get nothing
    result = ai.evaluate_trade(state, offer)
    assert result == False, "Should reject trade that gives opponent high-quality monopoly"

    print("[PASS] Trade quality filter tests passed")


def test_auction_bidding():
    """Test auction bid calculations."""
    ai = StrategicAI()

    me = PlayerState(
        player_id="me",
        cash=500,
        properties={16, 18}  # 2/3 orange
    )

    state = GameState(
        my_state=me,
        opponents=[PlayerState("opp", 500)],
        current_turn="me"
    )

    # Bidding on property that completes our monopoly
    bid = ai.get_auction_bid(state, 19, 100)  # Current bid $100
    # Should bid premium (base 5%) * monopoly bonus (1.5x)
    # Max = 200 * 1.05 * 1.5 = 315
    # Bid = current + 10 = 110
    assert bid == 110, f"Expected 110, got {bid}"

    # Test that we don't overbid
    bid = ai.get_auction_bid(state, 19, 400)  # High current bid
    # Max we'd pay is around 315, so we pass
    assert bid == 0, f"Expected 0 (pass), got {bid}"

    print("[PASS] Auction bidding tests passed")


def test_relative_ept():
    """Test relative EPT calculations."""
    ai = StrategicAI()

    # Player with good monopoly
    me = PlayerState(
        player_id="me",
        cash=500,
        properties={16, 18, 19}  # Orange monopoly
    )

    # Opponent with weak properties
    opp = PlayerState(
        player_id="opp",
        cash=500,
        properties={1, 3}  # Brown monopoly
    )

    state = GameState(
        my_state=me,
        opponents=[opp],
        current_turn="me"
    )

    relative_ept = ai.calculate_relative_ept(state)

    # Our orange should have higher EPT than their brown
    # So our relative EPT should be positive
    assert relative_ept > 0, f"Expected positive relative EPT, got {relative_ept}"

    print(f"[PASS] Relative EPT tests passed (relative EPT: ${relative_ept:.2f})")


def test_building_priority():
    """Test house building priority."""
    ai = StrategicAI()

    me = PlayerState(
        player_id="me",
        cash=1000,
        properties={16, 18, 19, 1, 3}  # Orange + Brown monopolies
    )

    state = GameState(
        my_state=me,
        opponents=[PlayerState("opp", 500)],
        current_turn="me",
        available_houses=32
    )

    priority = ai.get_building_priority(state)

    # Orange should come before Brown (better ROI)
    orange_positions = {16, 18, 19}
    brown_positions = {1, 3}

    first_orange_idx = None
    first_brown_idx = None

    for i, pos in enumerate(priority):
        if pos in orange_positions and first_orange_idx is None:
            first_orange_idx = i
        if pos in brown_positions and first_brown_idx is None:
            first_brown_idx = i

    assert first_orange_idx is not None, "Orange should be in build priority"
    assert first_brown_idx is not None, "Brown should be in build priority"
    assert first_orange_idx < first_brown_idx, "Orange should come before Brown"

    print("[PASS] Building priority tests passed")


def run_all_tests():
    """Run all AI tests."""
    print("=" * 50)
    print("Strategic AI Test Suite")
    print("=" * 50)
    print()

    test_monopoly_quality()
    test_purchase_decision()
    test_blocking()
    test_trade_quality_filter()
    test_auction_bidding()
    test_relative_ept()
    test_building_priority()

    print()
    print("=" * 50)
    print("All tests passed! [PASS]")
    print("=" * 50)


if __name__ == "__main__":
    run_all_tests()
