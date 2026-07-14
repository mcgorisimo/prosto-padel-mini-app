import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import AdminPlayerDetails from './AdminPlayerDetails';
import { getLevelForRating } from '../lib/ratingEngine';
import { adminListProfiles } from '../lib/profileApi';
import { useTelegram } from '../hooks/useTelegram';

const C = {
  bg: '#050F0B',
  card: 'rgba(255,255,255,0.045)',
  surface: '#071F16',
  border: 'rgba(245,241,232,0.12)',
  accent: '#D8F34A',
  text: '#F5F1E8',
  muted: 'rgba(245,241,232,0.62)',
  coral: '#FF6F61',
  win: '#D8F34A',
};

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'unverified', label: 'Неподтверждённые' },
  { key: 'verified', label: 'Подтверждённые' },
];

const formatName = (player) =>
  [player?.first_name, player?.last_name].filter(Boolean).join(' ') || 'Игрок без имени';

const formatRating = (rating) =>
  Number.isFinite(Number(rating)) ? Number(rating).toFixed(2) : '3.00';

const isPlayerRatingVerified = (player) => player?.is_verified === true;

function AccessDenied({ onBack }) {
  return (
    <div style={{ padding: '24px 16px 0' }}>
      <div style={{ background: 'rgba(255,111,97,0.08)', border: '1px solid rgba(255,111,97,0.24)', borderRadius: '16px', padding: '16px' }}>
        <div style={{ color: C.text, fontSize: '16px', fontWeight: 800, marginBottom: '8px' }}>
          Раздел доступен только администратору
        </div>
        <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.55, marginBottom: '14px' }}>
          Для просмотра базы игроков нужен админский профиль.
        </div>
        <button onClick={onBack} style={{ width: '100%', padding: '12px', background: 'transparent', color: C.coral, border: `1px solid ${C.coral}`, borderRadius: '12px', fontSize: '14px', fontWeight: 700 }}>
          Назад
        </button>
      </div>
    </div>
  );
}

function PlayerCard({ player, onOpen }) {
  const rating = Number(player?.rating ?? 3.0);
  const level = getLevelForRating(Number.isFinite(rating) ? rating : 3.0);
  const verified = isPlayerRatingVerified(player);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.text, fontSize: '15px', fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {formatName(player)}
          </div>
          <div style={{ color: C.muted, fontSize: '12px', marginTop: '3px' }}>
            {player?.phone || 'Телефон не указан'}
          </div>
        </div>
        <span style={{
          color: verified ? C.win : C.coral,
          background: verified ? 'rgba(216,243,74,0.08)' : 'rgba(255,111,97,0.08)',
          border: `1px solid ${verified ? 'rgba(216,243,74,0.24)' : 'rgba(255,111,97,0.24)'}`,
          borderRadius: '999px',
          padding: '4px 8px',
          fontSize: '11px',
          fontWeight: 800,
          flexShrink: 0,
        }}>
          {verified ? 'Подтверждён' : 'Не подтверждён'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
        <div>
          <div style={{ color: C.muted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Рейтинг</div>
          <div style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginTop: '3px' }}>{formatRating(player?.rating)}</div>
        </div>
        <div>
          <div style={{ color: C.muted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Уровень</div>
          <div style={{ color: level.color, fontSize: '13px', fontWeight: 900, marginTop: '3px' }}>{level.label}</div>
        </div>
        <div>
          <div style={{ color: C.muted, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>Роль</div>
          <div style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginTop: '3px' }}>{player?.role || 'user'}</div>
        </div>
      </div>

      <button onClick={() => onOpen(player)} style={{
        width: '100%',
        padding: '11px',
        background: C.surface,
        color: C.accent,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 800,
        cursor: 'pointer',
      }}>
        Открыть
      </button>
    </div>
  );
}

export default function AdminPlayersScreen({ user, onBack }) {
  const { tg } = useTelegram();
  const isAdmin = user?.role === 'admin';
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [tg, onBack]);

  useEffect(() => {
    if (!isAdmin) return;

    const loadPlayers = async () => {
      setLoading(true);
      setError('');

      let data = [];
      let loadError = null;
      try {
        data = await adminListProfiles({ search: query, filter });
      } catch (error) {
        loadError = error;
      }

      if (loadError) {
        setPlayers([]);
        setError('Не удалось загрузить игроков. Проверьте доступ и попробуйте еще раз.');
      } else {
        setPlayers(data || []);
      }

      setLoading(false);
    };

    loadPlayers();
  }, [isAdmin, query, filter]);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return players.filter((player) => {
      const verified = isPlayerRatingVerified(player);
      if (filter === 'verified' && !verified) return false;
      if (filter === 'unverified' && verified) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        player.first_name,
        player.last_name,
        player.phone,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [players, query, filter]);

  const handleSaved = (updatedPlayer) => {
    setPlayers(prev => prev.map(player => player.id === updatedPlayer.id ? updatedPlayer : player));
    setSelectedPlayer(updatedPlayer);
  };

  if (!isAdmin) {
    return <AccessDenied onBack={onBack} />;
  }

  if (selectedPlayer) {
    return (
      <AdminPlayerDetails
        user={user}
        player={selectedPlayer}
        onBack={() => setSelectedPlayer(null)}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div style={{ padding: '20px 16px 0' }}>
      <div style={{ color: C.text, fontSize: '20px', fontWeight: 900, marginBottom: '5px' }}>
        Игроки клуба
      </div>
      <div style={{ color: C.muted, fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>
        Зарегистрированные игроки из базы профилей.
      </div>

      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <Search size={16} color={C.muted} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Имя, фамилия или телефон"
          style={{
            width: '100%',
            padding: '12px 14px 12px 38px',
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '13px',
            color: C.text,
            fontSize: '14px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px' }}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                flexShrink: 0,
                padding: '8px 11px',
                background: active ? 'rgba(216,243,74,0.14)' : C.card,
                color: active ? C.accent : C.muted,
                border: `1px solid ${active ? 'rgba(216,243,74,0.32)' : C.border}`,
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', fontSize: '13px' }}>
          Загружаем игроков...
        </div>
      )}

      {!loading && error && (
        <div style={{ color: C.coral, background: 'rgba(255,111,97,0.08)', border: '1px solid rgba(255,111,97,0.24)', borderRadius: '16px', padding: '16px', fontSize: '13px', lineHeight: 1.45 }}>
          {error}
        </div>
      )}

      {!loading && !error && filteredPlayers.length === 0 && (
        <div style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', fontSize: '13px', lineHeight: 1.45 }}>
          Игроки не найдены.
        </div>
      )}

      {!loading && !error && filteredPlayers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredPlayers.map(player => (
            <PlayerCard key={player.id} player={player} onOpen={setSelectedPlayer} />
          ))}
        </div>
      )}
    </div>
  );
}
