import React, { useState, useEffect, useRef } from 'react';
import PadelButton from './ui/PadelButton';

const C = {
  bg:      '#050F0B',
  card:    '#071F16',
  surface: 'rgba(255,255,255,0.045)',
  border:  'rgba(245,241,232,0.10)',
  accent:  '#D8F34A',
  text:    '#F5F1E8',
  muted:   'rgba(245,241,232,0.62)',
};

export default function MatchChat({ match, currentUser, messages = [], onSendMessage, onClose, showToast }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    // Scroll to bottom on initial load and when new messages arrive
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const messageText = text.trim();

    if (sending || !messageText) {
      return;
    }

    setSending(true);

    try {
      await onSendMessage(messageText);
      setText('');
    } catch {
      // Keep the draft so the player can retry after a failed request.
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const safeMessages = messages.map((message) => ({
    ...message,
    senderId: message.senderId ?? message.sender_id,
    senderName: message.senderName ?? message.sender_name,
    timestamp: message.timestamp ?? message.created_at,
  }));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/80 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-2xl h-[85dvh] bg-app-bg rounded-t-[28px] border-t border-warm-white/10"
        style={{ touchAction: 'pan-y' }}
      >
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">
              Чат матча: {match.title || 'Обсуждение'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {match.date}, {match.time}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 text-2xl leading-none px-1 hover:text-slate-200"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </header>

        {/* Messages Area */}
<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 no-scrollbar">
  {safeMessages.length > 0 ? (
    safeMessages.map((msg, index) => {
      const senderId = msg.senderId ?? msg.sender_id;
      const previousSenderId = safeMessages[index - 1]?.senderId ?? safeMessages[index - 1]?.sender_id;
      const senderName = msg.senderName ?? msg.sender_name;
      const timestamp = msg.timestamp ?? msg.created_at;
      const isMe = senderId === currentUser?.id;
      const showName = !isMe && (index === 0 || previousSenderId !== senderId);

      return (
        <div key={msg.id || index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
          {showName && (
            <span className="text-[10px] text-slate-400 mb-1 ml-1">
              {senderName || 'Игрок'}
            </span>
          )}
          <div className={`px-3 py-2 rounded-2xl max-w-[80%] text-sm leading-relaxed ${
            isMe ? 'bg-accent-light text-app-bg rounded-tr-none' : 'bg-white/[0.06] text-warm-white rounded-tl-none'
          }`}>
            {msg.text}
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 px-1">
            {timestamp ? new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
          </div>
        </div>
      );
    })
  ) : (
    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
      <p>Сообщений пока нет. Начните общение!</p>
    </div>
  )}
  <div ref={messagesEndRef} />
</div>
        

        {/* Input */}
        <footer className="p-4 border-t border-warm-white/10 bg-app-bg shrink-0">
          <div className="flex items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Написать сообщение..."
              rows={1}
              className="flex-1 bg-white/[0.04] text-warm-white placeholder-warm-white/35 rounded-2xl border border-warm-white/10 p-3 text-sm focus:ring-accent-light focus:border-accent-light resize-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              style={{ maxHeight: '100px' }}
            />
            <PadelButton
              variant="info"
              size="md"
              onClick={handleSend}
              disabled={sending || !text.trim()}
              className="h-[46px]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </PadelButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
