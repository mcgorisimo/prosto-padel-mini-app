import { CalendarDays, ChartNoAxesCombined, Home, Trophy, UserRound } from 'lucide-react';

export default function BottomNav({ active, setActive }) {
  const tabs = [
    { id: 'home', label: 'Главная', Icon: Home },
    { id: 'profile', label: 'Профиль', Icon: UserRound },
    { id: 'leaderboard', label: 'Рейтинг', Icon: Trophy },
    { id: 'matches', label: 'Матчи', Icon: ChartNoAxesCombined },
    { id: 'booking', label: 'Бронь', Icon: CalendarDays },
  ];

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {tabs.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            className={`nav-item ${isActive ? 'active' : ''}`}
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
