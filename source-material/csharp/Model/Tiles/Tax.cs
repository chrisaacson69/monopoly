namespace Monopoly.Model.Tiles
{
    using Interfaces;
    using Players;

    public class Tax:Tile, ITile
    {
        public int TaxAmount { get; private set; }
        public Tax(int index, string name, int taxAmount)
            :base(index,name)
        {
            this.TaxAmount = taxAmount;
        }

        public override string ActOnPlayer(Player player)
        {
            player.DecrementMoney(this.TaxAmount);
            return this.Name + ": " + this.TaxAmount;
        }
    }
}
