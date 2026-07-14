export default function StatsRow({ stats }) {
  const winrate = stats.matches > 0
    ? Math.round(stats.wins / stats.matches * 100) + '%'
    : '0%';

  return (
    <div className="stats-card">
      <div className="stat">
        <span className="stat-value">{stats.rating}</span>
        <span className="stat-label">Рейтинг</span>
      </div>
      <div className="stat-divider" />
      <div className="stat">
        <span className="stat-value">{stats.matches}</span>
        <span className="stat-label">Матчей</span>
      </div>
      <div className="stat-divider" />
      <div className="stat">
        <span className="stat-value">{stats.wins}</span>
        <span className="stat-label">Побед</span>
      </div>
      <div className="stat-divider" />
      <div className="stat">
        <span className="stat-value stat-value-accent">{winrate}</span>
        <span className="stat-label">Винрейт</span>
      </div>
    </div>
  );
}
