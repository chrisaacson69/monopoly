namespace Monopoly.Model.Tiles
{
    using Interfaces;
    using Players;
    using Enums;

    public class Street : Tile, ITile
    {
        public Street(int index, string name, NeighbourHoodType neighbourhood, int price, int rent)
            :base(index,name)
        {
            this.Neighbourhood = neighbourhood;
            this.Price = price;
            this.Rent = rent;
            this.Owner = null;
        }

        public NeighbourHoodType Neighbourhood { get; set; }
        public Player Owner { get; set; }
        public int Price { get; set; }
        public int Rent { get; set; }

        public override string ActOnPlayer(Player player)
        {
            if (this.Owner==player)
            {
                return "You already own "+this.Name+".";
            }
            else if (this.Owner==null)
            {
                return this.Name + " is available \nfor purchase.";
            }
            else
            {
                player.DecrementMoney(this.Rent);
                this.Owner.IncrementMoney(this.Rent);
                return string.Format("{0}\n is owned by Player{1}.\nYou paid him {2}!",this.Name,player.Index,this.Rent);
            }
        }
    }
}
