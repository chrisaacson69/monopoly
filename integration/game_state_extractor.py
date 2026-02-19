"""
Game State Extractor for Richup.io

Extracts game state from the richup.io DOM using Selenium.
This is the bridge between the web interface and our AI.

NOTE: CSS selectors may need updates if richup.io changes their UI.
"""

import re
import logging
from typing import Optional, List, Dict, Set
from dataclasses import dataclass

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from strategic_ai import PlayerState, GameState, TradeOffer

logger = logging.getLogger(__name__)


class GameLocators:
    """
    CSS/XPath selectors for richup.io game elements.

    These will need to be updated as richup.io updates their UI.
    The class names appear to be randomly generated, so we use
    structural selectors where possible.
    """

    # Player info panel
    PLAYER_CASH = (By.CSS_SELECTOR, ".player-cash, [class*='cash'], [class*='money']")
    PLAYER_NAME = (By.CSS_SELECTOR, ".player-name, [class*='name']")

    # Properties - typically shown in a sidebar or on the board
    OWNED_PROPERTIES = (By.CSS_SELECTOR, "[class*='owned'], [class*='property']")
    PROPERTY_CARD = (By.CSS_SELECTOR, "[class*='property-card'], [class*='deed']")

    # Current position on board
    PLAYER_TOKEN = (By.CSS_SELECTOR, "[class*='token'], [class*='piece']")
    BOARD_SQUARE = (By.CSS_SELECTOR, "[class*='square'], [class*='tile']")

    # Action buttons
    ROLL_DICE_BUTTON = (By.CSS_SELECTOR, ".zrAsGo65 > div:nth-child(1) > button:nth-child(1)")
    BUY_BUTTON = (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(2) > div > div > button")
    AUCTION_BUTTON = (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(1) > div > div > button")
    END_TURN_BUTTON = (By.CSS_SELECTOR, "div._YZ7dkIA:nth-child(1) > div > div > div > button")

    # Auction interface
    AUCTION_CURRENT_BID = (By.CSS_SELECTOR, ".LJ72TaNX > span:nth-child(2)")
    AUCTION_BID_BUTTONS = (By.CSS_SELECTOR, "[class*='bid'] button")

    # Trade interface
    TRADE_BUTTON = (By.CLASS_NAME, "yCokhJwL")
    TRADE_PLAYER_LIST = (By.CLASS_NAME, "qS3VjzBC")
    TRADE_OFFER_PANEL = (By.CSS_SELECTOR, "[class*='trade'], [class*='offer']")

    # Building
    BUILD_BUTTON = (By.CSS_SELECTOR, "[class*='build'], [class*='house']")

    # Mortgage
    MORTGAGE_BUTTON = (By.CSS_SELECTOR, "[class*='mortgage']")

    # Jail
    PAY_JAIL_BUTTON = (By.CSS_SELECTOR, "[class*='jail'] button, [class*='pay']")

    # Game status
    TURN_INDICATOR = (By.CSS_SELECTOR, "[class*='turn'], [class*='current']")
    GAME_LOG = (By.CSS_SELECTOR, "[class*='log'], [class*='history']")


class GameStateExtractor:
    """
    Extracts game state from the richup.io DOM.

    This class handles all the messy DOM interaction and provides
    clean GameState objects to the AI.
    """

    def __init__(self, driver: webdriver.Firefox, my_player_id: str = "me"):
        self.driver = driver
        self.my_player_id = my_player_id
        self.wait = WebDriverWait(driver, 5)

    def extract_state(self) -> Optional[GameState]:
        """
        Extract complete game state from current page.

        Returns None if unable to extract state (e.g., game not loaded).
        """
        try:
            my_state = self._extract_my_state()
            opponents = self._extract_opponents()
            current_turn = self._get_current_turn()
            turn_number = self._get_turn_number()

            return GameState(
                my_state=my_state,
                opponents=opponents,
                current_turn=current_turn,
                turn_number=turn_number,
                available_houses=self._get_available_houses(),
                available_hotels=self._get_available_hotels()
            )
        except Exception as e:
            logger.error(f"Failed to extract game state: {e}")
            return None

    def _extract_my_state(self) -> PlayerState:
        """Extract our player's state."""
        cash = self._get_my_cash()
        properties = self._get_my_properties()
        position = self._get_my_position()
        in_jail = self._am_i_in_jail()
        mortgaged = self._get_my_mortgaged()
        houses = self._get_my_houses()

        return PlayerState(
            player_id=self.my_player_id,
            cash=cash,
            properties=properties,
            position=position,
            in_jail=in_jail,
            mortgaged=mortgaged,
            houses=houses
        )

    def _extract_opponents(self) -> List[PlayerState]:
        """Extract all opponent states."""
        opponents = []

        # This will need to be customized based on richup.io's UI
        # Typically there's a player list panel showing all players
        try:
            player_panels = self.driver.find_elements(By.CSS_SELECTOR, "[class*='player']")

            for i, panel in enumerate(player_panels):
                # Skip our own panel
                if self._is_my_panel(panel):
                    continue

                opp = self._extract_opponent_from_panel(panel, f"opponent_{i}")
                if opp:
                    opponents.append(opp)

        except Exception as e:
            logger.warning(f"Failed to extract opponents: {e}")

        return opponents

    def _extract_opponent_from_panel(self, panel, player_id: str) -> Optional[PlayerState]:
        """Extract opponent state from their UI panel."""
        try:
            # Look for cash display
            cash_el = panel.find_element(By.CSS_SELECTOR, "[class*='cash'], [class*='money']")
            cash = self._parse_money(cash_el.text)

            # Look for properties
            properties = set()  # TODO: Extract from panel

            return PlayerState(
                player_id=player_id,
                cash=cash,
                properties=properties,
                position=0,  # TODO: Extract position
                in_jail=False,  # TODO: Detect
                mortgaged=set(),
                houses={}
            )
        except Exception as e:
            logger.debug(f"Could not extract opponent {player_id}: {e}")
            return None

    def _get_my_cash(self) -> int:
        """Get our current cash balance."""
        try:
            # Try multiple selectors
            selectors = [
                "[class*='cash']",
                "[class*='money']",
                "[class*='balance']",
                ".player-cash"
            ]

            for selector in selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for el in elements:
                        text = el.text
                        money = self._parse_money(text)
                        if money > 0:
                            return money
                except:
                    continue

            logger.warning("Could not find cash display")
            return 1500  # Default starting cash

        except Exception as e:
            logger.error(f"Error getting cash: {e}")
            return 1500

    def _parse_money(self, text: str) -> int:
        """Parse money amount from text like '$1,500' or '1500'."""
        # Remove non-numeric characters except digits
        cleaned = re.sub(r'[^\d]', '', text)
        if cleaned:
            return int(cleaned)
        return 0

    def _get_my_properties(self) -> Set[int]:
        """Get set of property positions we own."""
        # TODO: Implement based on richup.io UI
        # This might involve:
        # 1. Looking at a "owned properties" panel
        # 2. Checking board squares for ownership indicators
        # 3. Parsing a property list sidebar

        properties = set()

        try:
            # Look for owned property cards/deeds
            owned = self.driver.find_elements(By.CSS_SELECTOR, "[class*='owned']")
            for el in owned:
                # Extract property ID somehow
                # This depends on richup.io's data attributes
                pass

        except Exception as e:
            logger.debug(f"Error getting properties: {e}")

        return properties

    def _get_my_position(self) -> int:
        """Get our current board position (0-39)."""
        # TODO: Implement based on richup.io UI
        return 0

    def _am_i_in_jail(self) -> bool:
        """Check if we're currently in jail."""
        try:
            # Look for jail indicator
            jail_elements = self.driver.find_elements(By.CSS_SELECTOR, "[class*='jail']")
            for el in jail_elements:
                if 'in jail' in el.text.lower():
                    return True
        except:
            pass
        return False

    def _get_my_mortgaged(self) -> Set[int]:
        """Get set of our mortgaged property positions."""
        # TODO: Implement
        return set()

    def _get_my_houses(self) -> Dict[int, int]:
        """Get dict of position -> house count."""
        # TODO: Implement
        return {}

    def _get_current_turn(self) -> str:
        """Get player ID whose turn it is."""
        try:
            turn_el = self.driver.find_element(By.CSS_SELECTOR, "[class*='turn'], [class*='current']")
            # Parse to determine if it's our turn
            if 'your turn' in turn_el.text.lower():
                return self.my_player_id
        except:
            pass
        return "unknown"

    def _get_turn_number(self) -> int:
        """Get current turn/round number."""
        # TODO: Implement if richup.io shows this
        return 0

    def _get_available_houses(self) -> int:
        """Get number of houses available in bank."""
        return 32  # Default max

    def _get_available_hotels(self) -> int:
        """Get number of hotels available in bank."""
        return 12  # Default max

    def _is_my_panel(self, panel) -> bool:
        """Check if a player panel belongs to us."""
        # TODO: Implement based on richup.io's UI
        # Might check for "You" label or highlighting
        return False

    # ============== ACTION DETECTION ==============

    def is_my_turn(self) -> bool:
        """Check if it's currently our turn."""
        try:
            # Look for roll dice button being enabled
            roll_btn = self.driver.find_element(*GameLocators.ROLL_DICE_BUTTON)
            return roll_btn.is_enabled()
        except:
            return False

    def can_buy_property(self) -> bool:
        """Check if buy property option is available."""
        try:
            buy_btn = self.driver.find_element(*GameLocators.BUY_BUTTON)
            return buy_btn.is_displayed() and buy_btn.is_enabled()
        except:
            return False

    def can_auction(self) -> bool:
        """Check if auction option is available."""
        try:
            auction_btn = self.driver.find_element(*GameLocators.AUCTION_BUTTON)
            return auction_btn.is_displayed() and auction_btn.is_enabled()
        except:
            return False

    def is_in_auction(self) -> bool:
        """Check if we're currently in an auction."""
        try:
            bid_el = self.driver.find_element(*GameLocators.AUCTION_CURRENT_BID)
            return bid_el.is_displayed()
        except:
            return False

    def get_current_auction_bid(self) -> int:
        """Get current auction bid amount."""
        try:
            bid_el = self.driver.find_element(*GameLocators.AUCTION_CURRENT_BID)
            return self._parse_money(bid_el.text)
        except:
            return 0

    def has_trade_offer(self) -> bool:
        """Check if there's an incoming trade offer."""
        try:
            offer_el = self.driver.find_element(*GameLocators.TRADE_OFFER_PANEL)
            return offer_el.is_displayed()
        except:
            return False

    def get_trade_offer(self) -> Optional[TradeOffer]:
        """Extract details of incoming trade offer."""
        # TODO: Implement based on richup.io trade UI
        return None

    def can_end_turn(self) -> bool:
        """Check if we can end our turn."""
        try:
            end_btn = self.driver.find_element(*GameLocators.END_TURN_BUTTON)
            return end_btn.is_displayed() and end_btn.is_enabled()
        except:
            return False
