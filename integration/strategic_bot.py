"""
Strategic Bot for Richup.io

Main bot implementation that combines:
1. Selenium browser automation
2. Game state extraction
3. StrategicAI decision making

This bot plays richup.io using our tournament-winning AI.
"""

import time
import logging
import random
from typing import Optional

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException,
    ElementClickInterceptedException, WebDriverException
)

from strategic_ai import StrategicAI, GameState, TradeOffer
from game_state_extractor import GameStateExtractor, GameLocators

logger = logging.getLogger(__name__)


class BotConfig:
    """Configuration for bot behavior."""

    # Timing (seconds) - human-like delays
    MIN_ACTION_DELAY = 1.0
    MAX_ACTION_DELAY = 3.0
    TURN_CHECK_INTERVAL = 2.0
    POST_ROLL_DELAY = 2.5

    # Retry settings
    MAX_RETRIES = 3
    RETRY_DELAY = 1.0

    # Game settings
    MAX_GAME_DURATION = 60 * 60  # 1 hour max
    TURN_TIMEOUT = 30  # seconds to wait for turn


class StrategicBot:
    """
    Main bot class that plays richup.io.

    Combines browser automation with our strategic AI.
    """

    def __init__(self, driver: webdriver.Firefox, player_id: str = "strategic_bot"):
        self.driver = driver
        self.player_id = player_id
        self.ai = StrategicAI()
        self.extractor = GameStateExtractor(driver, player_id)
        self.config = BotConfig()

        self.game_start_time = None
        self.turn_count = 0

    def _human_delay(self, min_delay: float = None, max_delay: float = None):
        """Add human-like random delay between actions."""
        min_d = min_delay or self.config.MIN_ACTION_DELAY
        max_d = max_delay or self.config.MAX_ACTION_DELAY
        delay = random.uniform(min_d, max_d)
        time.sleep(delay)

    def _click_element(self, locator, timeout: float = 5.0) -> bool:
        """
        Click an element with retry logic.

        Returns True if click succeeded.
        """
        for attempt in range(self.config.MAX_RETRIES):
            try:
                wait = WebDriverWait(self.driver, timeout)
                element = wait.until(EC.element_to_be_clickable(locator))
                element.click()
                return True
            except TimeoutException:
                logger.debug(f"Timeout waiting for {locator}")
                return False
            except ElementClickInterceptedException:
                logger.debug(f"Click intercepted, retrying...")
                time.sleep(self.config.RETRY_DELAY)
            except Exception as e:
                logger.warning(f"Click failed: {e}")
                time.sleep(self.config.RETRY_DELAY)

        return False

    def play_game(self):
        """
        Main game loop.

        Plays until game ends or timeout.
        """
        logger.info("Starting strategic bot game loop")
        self.game_start_time = time.time()
        self.turn_count = 0

        while not self._is_game_over():
            try:
                # Check if it's our turn
                if self.extractor.is_my_turn():
                    self._play_turn()
                    self.turn_count += 1

                # Check for incoming trade offers
                if self.extractor.has_trade_offer():
                    self._handle_trade_offer()

                # Check for auction
                if self.extractor.is_in_auction():
                    self._handle_auction()

                # Wait before checking again
                time.sleep(self.config.TURN_CHECK_INTERVAL)

            except Exception as e:
                logger.error(f"Error in game loop: {e}")
                time.sleep(self.config.RETRY_DELAY)

        logger.info(f"Game ended after {self.turn_count} turns")

    def _is_game_over(self) -> bool:
        """Check if game has ended."""
        # Timeout check
        if self.game_start_time:
            elapsed = time.time() - self.game_start_time
            if elapsed > self.config.MAX_GAME_DURATION:
                logger.info("Game timeout reached")
                return True

        # Check for game over screen
        try:
            # Look for end game indicators
            end_elements = self.driver.find_elements(
                By.CSS_SELECTOR,
                "[class*='winner'], [class*='game-over'], [class*='ended']"
            )
            if any(el.is_displayed() for el in end_elements):
                return True
        except:
            pass

        return False

    def _play_turn(self):
        """
        Execute one complete turn.

        A turn consists of:
        1. Roll dice
        2. Handle landing (buy/auction/pay rent)
        3. Optional: Build houses
        4. Optional: Initiate trades
        5. End turn
        """
        logger.info(f"Playing turn {self.turn_count + 1}")

        # Get current game state
        state = self.extractor.extract_state()
        if not state:
            logger.warning("Could not extract game state")
            self._end_turn()
            return

        # 1. Roll dice
        self._human_delay()
        if not self._roll_dice():
            logger.warning("Failed to roll dice")
            return

        # Wait for dice animation and movement
        time.sleep(self.config.POST_ROLL_DELAY)

        # 2. Handle any doubles (may need to roll again)
        while self._can_roll_again():
            self._human_delay()
            self._roll_dice()
            time.sleep(self.config.POST_ROLL_DELAY)

        # Refresh state after movement
        state = self.extractor.extract_state()

        # 3. Handle landing decision (buy/auction)
        if self.extractor.can_buy_property():
            self._handle_purchase_decision(state)

        # 4. Try to build houses if we have monopolies
        self._try_building(state)

        # 5. Consider proposing trades
        self._consider_trades(state)

        # 6. Unmortgage if possible
        self._try_unmortgage(state)

        # 7. End turn
        self._human_delay()
        self._end_turn()

    def _roll_dice(self) -> bool:
        """Click the roll dice button."""
        logger.debug("Rolling dice")
        return self._click_element(GameLocators.ROLL_DICE_BUTTON)

    def _can_roll_again(self) -> bool:
        """Check if we rolled doubles and can roll again."""
        try:
            # Look for "roll again" button
            roll_again = self.driver.find_element(
                By.CSS_SELECTOR,
                "[class*='roll-again'], .s3FE4qke"
            )
            return roll_again.is_displayed() and roll_again.is_enabled()
        except:
            return False

    def _handle_purchase_decision(self, state: GameState):
        """
        Decide whether to buy or auction a property.
        """
        # Get property info from UI
        # TODO: Extract property position from current square
        position = state.my_state.position

        # Get price (from UI or our data)
        from board_mapping import PROPERTY_PRICES
        price = PROPERTY_PRICES.get(position, 0)

        if price == 0:
            logger.debug(f"Position {position} is not a property")
            return

        # Ask AI
        should_buy = self.ai.should_buy_property(state, position, price)

        self._human_delay()

        if should_buy:
            logger.info(f"Buying property at position {position} for ${price}")
            self._click_element(GameLocators.BUY_BUTTON)
        else:
            logger.info(f"Declining property at position {position}, going to auction")
            self._click_element(GameLocators.AUCTION_BUTTON)

    def _handle_auction(self):
        """
        Participate in an auction.
        """
        state = self.extractor.extract_state()
        if not state:
            return

        # TODO: Get property being auctioned
        position = 0  # Need to extract from UI

        while self.extractor.is_in_auction():
            current_bid = self.extractor.get_current_auction_bid()

            # Ask AI for our bid
            our_bid = self.ai.get_auction_bid(state, position, current_bid)

            if our_bid > current_bid:
                logger.info(f"Bidding ${our_bid} (current: ${current_bid})")
                self._place_bid(our_bid - current_bid)
                self._human_delay(0.5, 1.0)
            else:
                # Pass - wait for auction to end
                time.sleep(1.0)

    def _place_bid(self, amount: int):
        """
        Place a bid by clicking bid buttons.

        Richup.io has +2, +10, +100 bid buttons.
        """
        # Click appropriate buttons to reach bid amount
        while amount >= 100:
            self._click_element(
                (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(3) button")
            )
            amount -= 100
            time.sleep(0.2)

        while amount >= 10:
            self._click_element(
                (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(2) button")
            )
            amount -= 10
            time.sleep(0.2)

        while amount >= 2:
            self._click_element(
                (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(1) button")
            )
            amount -= 2
            time.sleep(0.2)

    def _handle_trade_offer(self):
        """
        Respond to an incoming trade offer.
        """
        logger.info("Handling incoming trade offer")

        state = self.extractor.extract_state()
        offer = self.extractor.get_trade_offer()

        if not state or not offer:
            logger.warning("Could not extract trade details")
            return

        # Ask AI
        accept = self.ai.evaluate_trade(state, offer)

        self._human_delay()

        if accept:
            logger.info("Accepting trade offer")
            self._click_element(
                (By.CSS_SELECTOR, "[class*='accept'], button[class*='green']")
            )
        else:
            logger.info("Declining trade offer")
            self._click_element(
                (By.CSS_SELECTOR, "[class*='decline'], button[class*='red']")
            )

    def _consider_trades(self, state: GameState):
        """
        Consider initiating trades with opponents.
        """
        # Get AI suggestions
        offers = self.ai.generate_trade_offers(state)

        if not offers:
            return

        # Try to propose the best offer
        # For now, just try the first one
        offer = offers[0]
        logger.info(f"Proposing trade to {offer.to_player}")

        # TODO: Implement trade proposal UI interaction
        # This requires clicking on trade button, selecting player,
        # selecting properties, entering cash amounts, and confirming

    def _try_building(self, state: GameState):
        """
        Try to build houses on our monopolies.
        """
        build_order = self.ai.get_building_priority(state)

        for position in build_order[:3]:  # Build up to 3 houses per turn
            logger.info(f"Building house on position {position}")

            # TODO: Implement building UI interaction
            # This requires selecting property and clicking build

            self._human_delay(0.5, 1.0)

    def _try_unmortgage(self, state: GameState):
        """
        Try to unmortgage properties.
        """
        for pos in list(state.my_state.mortgaged):
            if self.ai.should_unmortgage(state, pos):
                logger.info(f"Unmortgaging position {pos}")
                # TODO: Implement unmortgage UI interaction
                break  # One unmortgage per turn

    def _end_turn(self) -> bool:
        """Click end turn button."""
        logger.debug("Ending turn")
        return self._click_element(GameLocators.END_TURN_BUTTON)


def run_bot(game_url: str, profile_path: Optional[str] = None):
    """
    Run the strategic bot on a richup.io game.

    Args:
        game_url: URL of the game to join
        profile_path: Optional Firefox profile path (for saved login)
    """
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    logger.info(f"Starting bot for game: {game_url}")

    # Set up Firefox
    options = webdriver.FirefoxOptions()
    if profile_path:
        options.profile = profile_path

    driver = webdriver.Firefox(options=options)

    try:
        # Navigate to game
        driver.get(game_url)
        driver.implicitly_wait(5)

        # Wait for game to load
        time.sleep(5)

        # Create and run bot
        bot = StrategicBot(driver)
        bot.play_game()

    finally:
        driver.quit()


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python strategic_bot.py <game_url> [firefox_profile_path]")
        print("Example: python strategic_bot.py https://richup.io/room/abc123")
        sys.exit(1)

    game_url = sys.argv[1]
    profile = sys.argv[2] if len(sys.argv) > 2 else None

    run_bot(game_url, profile)
