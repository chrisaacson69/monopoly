namespace Monopoly.Model
{
    using System.Collections.Generic;
    using Players;
    using Tiles;
    using Enums;

    public static class Board
    {
        public static List<Player> players;
        public static List<Tile> allTiles;
        public static int CurrentPlayerIndex;

        public static void InitializeBoard()
        {
            CurrentPlayerIndex = 0;
            players = new List<Player>()
            {
                new Player(1),
                new Player(2)
            };
            allTiles = new List<Tile>()
                {
                new SpecialTile(0,"GO!"),
                new Street(1,"Old Kent Road",NeighbourHoodType.Brown,60, 2),
                new ChanceCard(2,"Community Chest"),
                new Street(3,"Whitechapel Road",NeighbourHoodType.Brown,60, 4),
                new Tax(4,"Income Tax", 200),
                new Street(5,"Kings Cross Station",NeighbourHoodType.Station,200, 25),
                new Street(6,"The Angel Islington",NeighbourHoodType.Blue,100, 6),
                new ChanceCard(7,"Chance Card"),
                new Street(8,"Euston Road",NeighbourHoodType.Blue,100, 6),
                new Street(9,"Pentonville Road",NeighbourHoodType.Blue,120, 8),
                new SpecialTile(10,"Jail"),
                new Street(11,"Pall Mall",NeighbourHoodType.HotPink,140, 10),
                new Street(12,"Electric Company",NeighbourHoodType.Utility,150, 20),
                new Street(13,"Whitehall",NeighbourHoodType.HotPink,140, 10),
                new Street(14,"Northumberland Avenue",NeighbourHoodType.HotPink,160, 12),
                new Street(15,"Marylebone Station",NeighbourHoodType.Station, 200, 25),
                new Street(16,"Bow Street",NeighbourHoodType.Orange,180, 14),
                new ChanceCard(17,"Community Chest"),
                new Street(18,"Marlborough Street",NeighbourHoodType.Orange, 180, 14),
                new Street(19,"Vine Street",NeighbourHoodType.Orange, 200, 16),
                new SpecialTile(20,"Free Parking"),
                new Street(21,"Strand",NeighbourHoodType.Red, 220, 18),
                new ChanceCard(22,"Chance Card"),
                new Street(23,"Fleet Street",NeighbourHoodType.Red, 220, 18),
                new Street(24,"Trafalgar Square",NeighbourHoodType.Red, 240, 20),
                new Street(25,"Fenchurch Station",NeighbourHoodType.Station, 200, 25),
                new Street(26,"Leicester Square",NeighbourHoodType.Yellow, 260, 2),
                new Street(27,"Coventry Street",NeighbourHoodType.Yellow, 260, 2),
                new Street(28,"Water Works",NeighbourHoodType.Utility, 150, 2),
                new Street(29,"Picadilly",NeighbourHoodType.Yellow, 280, 2),
                new SpecialTile(30,"Go To Jail"),
                new Street(31,"Regent Street",NeighbourHoodType.Green, 300, 2),
                new Street(32,"Oxford Street",NeighbourHoodType.Green, 300, 2),
                new ChanceCard(33,"Community Chest"),
                new Street(34,"Bond Street",NeighbourHoodType.Green, 320, 25),
                new Street(35,"Liverpool Station",NeighbourHoodType.Station, 200, 2),
                new ChanceCard(36,"Chance Card"),
                new Street(37,"Park Lane",NeighbourHoodType.Purple, 350, 2),
                new Tax(38,"Super Tax",150),
                new Street(39,"Mayfair",NeighbourHoodType.Purple, 400, 2),
                };
        }

        public static void AddStreetToPlayer(int streetIndex, int playerIndex)
        {
            Street currentStreet = (Street)allTiles[streetIndex];
            currentStreet.Owner = players[playerIndex];
            
            players[playerIndex].Streets.Add(currentStreet);
            players[playerIndex].DecrementMoney(currentStreet.Price);
        }
    }
}
