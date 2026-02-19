namespace Monopoly.Model.Tiles
{
    using System;
    using Players;
    using System.Collections.Generic;
    using System.Linq;

    public static class ChanceCardGenerator
    {
        private static readonly Random rng = new Random();
        private const int GO_POSITION = 0;
        private const int MAYFAIR_POSITION = 39;
        private const int BANK_MONEY_BONUS = 100;
        private const int PRETTY_BONUS = 50;

        private static List<Func<Player, string>> listOfChanceCards = new List<Func<Player, string>>
        {

            BankIsGivingYouMoney,
            YouArePrettyGivingBonus,
            GiveAmountToOtherPlayers
        }; 
              
        private static string BankIsGivingYouMoney(Player player)
        {
            player.IncrementMoney(BANK_MONEY_BONUS);
            return "The Bank is giving you 100. \nKeep it safe!";
        }
        private static string YouArePrettyGivingBonus(Player player)
        {
            player.IncrementMoney(PRETTY_BONUS);
            return "You have won a \nfashion contest. Receive 50.";
        }

        private static string GiveAmountToOtherPlayers(Player player)
        {
            Board.players[Board.CurrentPlayerIndex].DecrementMoney(30);
            Board.players[(Board.CurrentPlayerIndex + 1) % 2].IncrementMoney(30);
            return "The other player is smarter.\nGive him 30.";
        }

        public static string GenerateRandomCard(Player player)
        {
            listOfChanceCards = listOfChanceCards
                .OrderBy(x => rng.Next())
                .ToList();

            Func<Player, string> randomChanceCard = listOfChanceCards[rng.Next(0,3)];

            return randomChanceCard.Invoke(player);
        }  
    }
}
