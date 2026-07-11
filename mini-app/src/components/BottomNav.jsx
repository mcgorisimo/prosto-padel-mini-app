import { Home, Swords, Trophy, UserRound } from 'lucide-react';

function CourtIcon({ size = 21, strokeWidth = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 12h16" />
      <path d="M12 3v18" />
      <path d="M8 7h8" />
      <path d="M8 17h8" />
    </svg>
  );
}

export default function BottomNav({ active, setActive }) {
  const tabs = [
    { id: 'home', label: 'Главная', Icon: Home },
    { id: 'matches', label: 'Матчи', Icon: Swords },
    { id: 'booking', label: 'Бронь', Icon: CourtIcon, primary: true },
    { id: 'leaderboard', label: 'Рейтинг', Icon: Trophy },
    { id: 'profile', label: 'Профиль', Icon: UserRound },
  ];

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {tabs.map(({ id, label, Icon, primary }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            className={`nav-item ${primary ? 'primary' : ''} ${isActive ? 'active' : ''}`}
            onClick={() => setActive(id)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="icon" aria-hidden="true">
              <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
            </span>
            <span className="label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
