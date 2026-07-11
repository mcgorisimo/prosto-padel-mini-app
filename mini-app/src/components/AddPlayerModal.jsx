import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const C = {
  bg:      '#020617',
  card:    '#0f172a',
  surface: '#141B3D',
  border:  '#1E2755',
  accent:  '#2563eb',
  text:    '#FFFFFF',
  muted:   '#8B9CC8',
};

function BottomSheet({ children, onClose }) {
  return (
    <div
      className="app-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div
        className="app-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#07160F', borderRadius: '20px 20px 0 0',
          width: '100%', maxWidth: '480px', padding: '0 20px 48px',
          border: '1px solid rgba(245,241,232,0.16)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '12px 0 20px', textAlign: 'center' }}>
          <div style={{ width: '40px', height: '4px', background: C.border, borderRadius: '2px', display: 'inline-block' }} />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AddPlayerModal({ onSelectPlayer, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    const searchPlayers = async () => {
      setLoading(true);
      const query = searchQuery.trim().toLowerCase();

      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, rating')
        .or(
          `first_name.ilike.%${query}%,last_name.ilike.%${query}%`
        )
        .limit(20);

      if (error) {
        console.error('Error searching players:', error);
        setResults([]);
      } else {
        setResults(data || []);
      }
      setLoading(false);
    };

    const timer = setTimeout(searchPlayers, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectPlayer = (player) => {
    onSelectPlayer({
      id: player.id,
      firstName: player.first_name,
      lastName: player.last_name,
      numericRating: player.rating || 3.0,
      isOrganizer: false,
      isVerified: false,
    });
    onClose();
  };

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ color: C.text, fontSize: '17px', fontWeight: 700 }}>Добавить игрока</div>
        <div style={{ color: C.muted, fontSize: '12px', marginTop: '3px' }}>Поиск среди игроков клуба</div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          autoFocus
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Имя или фамилия"
          style={{
            width: '100%',
            background: C.surface,
            border: `1px solid ${C.accent}`,
            borderRadius: '10px',
            padding: '12px 14px',
            color: C.text,
            fontSize: '15px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        paddingRight: '8px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', color: C.muted, padding: '20px' }}>
            Поиск...
          </div>
        )}

        {!loading && searchQuery.trim() && results.length === 0 && (
          <div style={{ textAlign: 'center', color: C.muted, padding: '20px' }}>
            Игроки не найдены
          </div>
        )}

        {results.map(player => (
          <button
            key={player.id}
            onClick={() => handleSelectPlayer(player)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              marginBottom: '8px',
              background: 'rgba(37, 99, 235, 0.08)',
              border: `1px solid ${C.border}`,
              borderRadius: '10px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(37, 99, 235, 0.15)';
              e.currentTarget.style.borderColor = C.accent;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(37, 99, 235, 0.08)';
              e.currentTarget.style.borderColor = C.border;
            }}
          >
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '700',
              color: '#fff',
              flexShrink: 0,
            }}>
              {player.first_name?.[0]}{player.last_name?.[0]}
            </div>
            <div>
              <div style={{ color: C.text, fontWeight: '600', fontSize: '14px' }}>
                {player.first_name} {player.last_name}
              </div>
              <div style={{ color: C.muted, fontSize: '11px', marginTop: '2px' }}>
                Рейтинг: {(player.rating || 3.0).toFixed(2)}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{
          width: '100%',
          padding: '14px',
          marginTop: '16px',
          background: 'transparent',
          color: C.muted,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          fontSize: '15px',
          cursor: 'pointer',
        }}
      >
        Отмена
      </button>
    </BottomSheet>
  );
}
