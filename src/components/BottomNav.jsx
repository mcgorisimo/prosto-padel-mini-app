import { Home, Trophy, UserRound } from 'lucide-react';
import { CrossedPadelRacketsIcon, PadelBookingIcon } from './icons/PadelIcons';

export default function BottomNav({ active, setActive, profileBadgeCount = 0 }) {
  const tabs = [
    { id: 'home', label: 'Главная', Icon: Home },
    { id: 'matches', label: 'Матчи', Icon: CrossedPadelRacketsIcon },
    { id: 'booking', label: 'Бронь', Icon: PadelBookingIcon, primary: true },
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
              {id === 'profile' && profileBadgeCount > 0 && (
                <span
                  className="nav-notification-badge"
                  data-testid="profile-notification-badge"
                >
                  {profileBadgeCount > 9 ? '9+' : profileBadgeCount}
                </span>
              )}
            </span>
            <span className="label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
