namespace Monopoly.Model.Tiles
{
    using Interfaces;
    using Players;

    public abstract class Tile : ITile
    {
        public Tile(int index, string name)
        {
            this.Index = index;
            this.Name = name;
        }

        public int Index { get; private set; }

        public string Name { get; private set; }

        public abstract string ActOnPlayer(Player player);
 
    }
}
