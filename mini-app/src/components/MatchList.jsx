import MatchCard from './MatchCard';

export default function MatchList({ matches }) {
  return (
    <section className="matches-section">
      <h2 className="section-title">Последние матчи</h2>
      <div className="matches-list">
        {matches.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </div>
    </section>
  );
}
