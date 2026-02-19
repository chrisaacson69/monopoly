"""
Board Mapping for Richup.io

Maps richup.io's real-world location properties to standard Monopoly color groups
for EPT and valuation calculations.

NOTE: These mappings need to be verified against the actual richup.io board.
The positions and groupings are based on standard Monopoly layout patterns.
"""

# Standard Monopoly property groups with landing probabilities from our Markov analysis
# Key insight: Orange has best ROI, Brown is a trap

GROUP_QUALITY = {
    # Based on empirical win rates from 500+ game simulations
    'brown': 0.85,      # 30.2% win rate - THE TRAP
    'lightBlue': 0.95,  # 39.6% win rate
    'pink': 0.95,       # 38.4% win rate
    'orange': 1.00,     # 39.6% win rate - baseline (best ROI)
    'red': 1.05,        # 42.1% win rate
    'yellow': 1.20,     # 48.2% win rate
    'green': 1.30,      # 51.5% win rate - BEST
    'darkBlue': 1.15,   # 45.5% win rate
    'railroad': 1.00,   # Utility
    'utility': 0.90,    # Lower value
}

# Landing probabilities from Markov chain analysis (steady-state)
LANDING_PROBABILITIES = {
    # Position: probability
    # Most landed non-jail squares
    24: 0.0316,  # Illinois Ave equivalent
    0: 0.0312,   # Go
    21: 0.0305,  # New York Ave equivalent
    25: 0.0303,  # B&O Railroad equivalent

    # Jail/Just Visiting is ~6.2% combined
    10: 0.062,   # Jail square

    # Other key squares (approximations)
    5: 0.0289,   # Reading RR
    15: 0.0286,  # Pennsylvania RR
    35: 0.0280,  # Short Line RR
}

# Property face values by position (standard Monopoly, to be mapped to richup.io)
PROPERTY_PRICES = {
    # Brown
    1: 60,
    3: 60,
    # Light Blue
    6: 100,
    8: 100,
    9: 120,
    # Pink
    11: 140,
    13: 140,
    14: 160,
    # Orange
    16: 180,
    18: 180,
    19: 200,
    # Red
    21: 220,
    23: 220,
    24: 240,
    # Yellow
    26: 260,
    27: 260,
    29: 280,
    # Green
    31: 300,
    32: 300,
    34: 320,
    # Dark Blue
    37: 350,
    39: 400,
    # Railroads
    5: 200,
    15: 200,
    25: 200,
    35: 200,
    # Utilities
    12: 150,
    28: 150,
}

# Rent values at different development levels
# rent[position] = [base, monopoly, 1house, 2house, 3house, 4house, hotel]
RENT_TABLE = {
    # Brown
    1: [2, 4, 10, 30, 90, 160, 250],
    3: [4, 8, 20, 60, 180, 320, 450],
    # Light Blue
    6: [6, 12, 30, 90, 270, 400, 550],
    8: [6, 12, 30, 90, 270, 400, 550],
    9: [8, 16, 40, 100, 300, 450, 600],
    # Pink
    11: [10, 20, 50, 150, 450, 625, 750],
    13: [10, 20, 50, 150, 450, 625, 750],
    14: [12, 24, 60, 180, 500, 700, 900],
    # Orange
    16: [14, 28, 70, 200, 550, 750, 950],
    18: [14, 28, 70, 200, 550, 750, 950],
    19: [16, 32, 80, 220, 600, 800, 1000],
    # Red
    21: [18, 36, 90, 250, 700, 875, 1050],
    23: [18, 36, 90, 250, 700, 875, 1050],
    24: [20, 40, 100, 300, 750, 925, 1100],
    # Yellow
    26: [22, 44, 110, 330, 800, 975, 1150],
    27: [22, 44, 110, 330, 800, 975, 1150],
    29: [24, 48, 120, 360, 850, 1025, 1200],
    # Green
    31: [26, 52, 130, 390, 900, 1100, 1275],
    32: [26, 52, 130, 390, 900, 1100, 1275],
    34: [28, 56, 150, 450, 1000, 1200, 1400],
    # Dark Blue
    37: [35, 70, 175, 500, 1100, 1300, 1500],
    39: [50, 100, 200, 600, 1400, 1700, 2000],
}

# Position to color group mapping
POSITION_TO_GROUP = {
    1: 'brown', 3: 'brown',
    6: 'lightBlue', 8: 'lightBlue', 9: 'lightBlue',
    11: 'pink', 13: 'pink', 14: 'pink',
    16: 'orange', 18: 'orange', 19: 'orange',
    21: 'red', 23: 'red', 24: 'red',
    26: 'yellow', 27: 'yellow', 29: 'yellow',
    31: 'green', 32: 'green', 34: 'green',
    37: 'darkBlue', 39: 'darkBlue',
    5: 'railroad', 15: 'railroad', 25: 'railroad', 35: 'railroad',
    12: 'utility', 28: 'utility',
}

# Properties in each group
GROUP_PROPERTIES = {
    'brown': [1, 3],
    'lightBlue': [6, 8, 9],
    'pink': [11, 13, 14],
    'orange': [16, 18, 19],
    'red': [21, 23, 24],
    'yellow': [26, 27, 29],
    'green': [31, 32, 34],
    'darkBlue': [37, 39],
    'railroad': [5, 15, 25, 35],
    'utility': [12, 28],
}

# House/hotel costs per group
HOUSE_COST = {
    'brown': 50,
    'lightBlue': 50,
    'pink': 100,
    'orange': 100,
    'red': 150,
    'yellow': 150,
    'green': 200,
    'darkBlue': 200,
}


class PropertyInfo:
    """Information about a single property."""

    def __init__(self, position, name=None):
        self.position = position
        self.name = name or f"Property_{position}"
        self.group = POSITION_TO_GROUP.get(position)
        self.price = PROPERTY_PRICES.get(position, 0)
        self.rents = RENT_TABLE.get(position, [0] * 7)

    def get_rent(self, level):
        """Get rent at development level (0=base, 1=monopoly, 2-5=houses, 6=hotel)."""
        if level < len(self.rents):
            return self.rents[level]
        return self.rents[-1]

    def get_landing_probability(self):
        """Get probability of landing on this square."""
        return LANDING_PROBABILITIES.get(self.position, 0.025)  # Default ~2.5%


class BoardMapper:
    """Maps richup.io board state to our internal model."""

    def __init__(self):
        self.properties = {pos: PropertyInfo(pos) for pos in PROPERTY_PRICES}

    def get_group_quality(self, group):
        """Get quality multiplier for a color group."""
        return GROUP_QUALITY.get(group, 1.0)

    def get_group_properties(self, group):
        """Get list of property positions in a group."""
        return GROUP_PROPERTIES.get(group, [])

    def has_monopoly(self, owned_positions, group):
        """Check if player owns all properties in a group."""
        group_props = self.get_group_properties(group)
        return all(pos in owned_positions for pos in group_props)

    def get_blocking_value(self, position, other_players_owned):
        """Calculate blocking value - how valuable is it to prevent opponent monopoly."""
        group = POSITION_TO_GROUP.get(position)
        if not group:
            return 0

        group_props = self.get_group_properties(group)

        # Check if any opponent is close to completing this group
        for opponent_owned in other_players_owned:
            owned_in_group = [p for p in group_props if p in opponent_owned]
            if len(owned_in_group) == len(group_props) - 1:
                # Opponent owns all but one - high blocking value!
                quality = self.get_group_quality(group)
                return PROPERTY_PRICES.get(position, 100) * quality * 0.5

        return 0

    def calculate_ept(self, owned_positions, num_opponents=3):
        """
        Calculate Expected Property earnings per Turn.
        EPT = sum(landing_prob * rent * num_opponents)
        """
        total_ept = 0

        for pos in owned_positions:
            prop = self.properties.get(pos)
            if not prop:
                continue

            group = prop.group
            has_monopoly = self.has_monopoly(owned_positions, group)

            # Determine development level (simplified - assume base or monopoly)
            level = 1 if has_monopoly else 0

            rent = prop.get_rent(level)
            prob = prop.get_landing_probability()

            total_ept += prob * rent * num_opponents

        return total_ept


# Richup.io specific mappings (TO BE FILLED IN after manual inspection)
# The board uses real-world locations - need to map these to positions

RICHUP_NAME_TO_POSITION = {
    # TODO: Fill in after inspecting richup.io board
    # Example:
    # "Mediterranean Ave": 1,
    # "Baltic Ave": 3,
    # etc.
}

def map_richup_property(richup_name):
    """Map a richup.io property name to our position index."""
    return RICHUP_NAME_TO_POSITION.get(richup_name)
