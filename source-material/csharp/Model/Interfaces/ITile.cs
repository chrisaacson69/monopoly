namespace Monopoly.Model.Interfaces
{
    using Players;

    public interface ITile
    {
        int Index { get; }
        string Name { get; }
        string ActOnPlayer(Player player);
    }
}
