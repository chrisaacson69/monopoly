namespace Monopoly.Model.Tiles
{
    using Interfaces;
    using Players;

    public class ChanceCard : Tile, ITile
    {
        public ChanceCard(int index, string name)
            :base(index, name)
        {

        }

        public override string ActOnPlayer(Player player)
        {
            return ChanceCardGenerator.GenerateRandomCard(player);
        }
    }
}
