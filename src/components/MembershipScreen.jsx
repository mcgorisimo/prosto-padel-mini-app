import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTelegram } from '../hooks/useTelegram';
import PadelButton from './ui/PadelButton';
import PadelCard from './ui/PadelCard';

const STATUS_LABELS = Object.freeze({
  active: 'Активен',
  scheduled: 'Скоро начнётся',
  expired: 'Завершён',
  exhausted: 'Посещения закончились',
});

function resolvePanel(result, collectionKey) {
  if (result?.outcome === 'not_configured') return { state: 'not_configured', items: [] };
  if (result?.outcome === 'unavailable' ||
      (result?.outcome === 'rejected' && result.reason === 'unavailable')) {
    return { state: 'unavailable', items: [] };
  }
  if (result?.outcome === 'loaded' && Array.isArray(result[collectionKey])) {
    return {
      state: result[collectionKey].length === 0 ? 'empty' : 'loaded',
      items: result[collectionKey],
    };
  }
  return { state: 'error', items: [] };
}

function StateMessage({ kind, state, onRetry }) {
  const isMine = kind === 'mine';
  const copy = {
    not_configured: isMine
      ? ['Проверка абонементов пока недоступна', 'Когда клуб подключит безопасную проверку, ваши абонементы появятся здесь.']
      : ['Каталог пока недоступен', 'Клуб ещё не опубликовал подтверждённый каталог абонементов.'],
    empty: isMine
      ? ['У вас пока нет абонементов', 'Активные и завершённые абонементы будут собраны здесь.']
      : ['Сейчас нет доступных абонементов', 'Новые варианты появятся здесь после публикации клубом.'],
    unavailable: ['Сервис временно недоступен', 'Проверьте соединение и попробуйте ещё раз.'],
    error: ['Не удалось загрузить данные', 'Попробуйте ещё раз чуть позже.'],
  }[state];
  const retryable = state === 'unavailable' || state === 'error';

  return (
    <PadelCard padding="lg" className="text-center">
      <h2 className="text-lg font-bold text-warm-white">{copy[0]}</h2>
      <p className="mt-3 text-sm leading-relaxed text-warm-white/66">{copy[1]}</p>
      {retryable && (
        <PadelButton variant="ghost" size="md" className="mt-5 min-h-[48px] motion-reduce:transform-none motion-reduce:transition-none" onClick={onRetry}>
          Повторить
        </PadelButton>
      )}
    </PadelCard>
  );
}

function MembershipList({ memberships }) {
  return (
    <div className="space-y-3">
      {memberships.map((membership) => (
        <PadelCard key={membership.id}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 text-base font-bold text-warm-white">{membership.title}</h2>
            <span className="shrink-0 rounded-full border border-accent-light/20 bg-accent-light/[0.07] px-2 py-1 text-[11px] font-bold text-accent-light">
              {STATUS_LABELS[membership.status]}
            </span>
          </div>
          <dl className="mt-4 grid gap-2 text-sm text-warm-white/66">
            <div className="flex justify-between gap-4">
              <dt>Осталось посещений</dt>
              <dd className="font-bold text-warm-white">{membership.remainingVisits ?? 'Не указано'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Действует до</dt>
              <dd className="font-bold text-warm-white">{membership.expiresOn ?? 'Не указано'}</dd>
            </div>
          </dl>
        </PadelCard>
      ))}
    </div>
  );
}

function ProductList({ products }) {
  return (
    <div className="space-y-3">
      {products.map((product) => (
        <PadelCard key={product.id}>
          <h2 className="text-base font-bold text-warm-white">{product.title}</h2>
          {product.description && <p className="mt-2 text-sm leading-relaxed text-warm-white/66">{product.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-warm-white/62">
            {product.visitCount !== null && <span className="rounded-full border border-warm-white/10 px-2.5 py-1.5">{product.visitCount} посещений</span>}
            {product.validityDays !== null && <span className="rounded-full border border-warm-white/10 px-2.5 py-1.5">{product.validityDays} дней</span>}
          </div>
        </PadelCard>
      ))}
      <p className="px-2 text-center text-xs leading-relaxed text-warm-white/48">
        Оформление и оплата появятся отдельным этапом.
      </p>
    </div>
  );
}

function MembershipPanel({ kind, read }) {
  const collectionKey = kind === 'mine' ? 'memberships' : 'products';
  const [panel, setPanel] = useState({ state: 'loading', items: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPanel({ state: 'loading', items: [] });
    Promise.resolve()
      .then(() => active ? read?.() : undefined)
      .then((result) => { if (active) setPanel(resolvePanel(result, collectionKey)); })
      .catch(() => { if (active) setPanel({ state: 'error', items: [] }); });
    return () => { active = false; };
  }, [attempt, collectionKey, read]);

  if (panel.state === 'loading') {
    return (
      <PadelCard padding="lg" className="text-center" aria-busy="true">
        <p role="status" className="text-sm text-warm-white/70">Загружаем абонементы…</p>
      </PadelCard>
    );
  }
  if (panel.state !== 'loaded') {
    return <StateMessage kind={kind} state={panel.state} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  return kind === 'mine'
    ? <MembershipList memberships={panel.items} />
    : <ProductList products={panel.items} />;
}

export default function MembershipScreen({ readMemberships, readCatalog, onBack }) {
  const { tg } = useTelegram();
  const [activeTab, setActiveTab] = useState('mine');
  const heading = useRef(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const back = tg?.BackButton;
    if (!back) return undefined;
    back.show();
    back.onClick(onBack);
    return () => { back.offClick(onBack); back.hide(); };
  }, [tg, onBack]);

  const tabs = [
    { id: 'mine', label: 'Мои абонементы' },
    { id: 'catalog', label: 'Купить абонемент' },
  ];

  return (
    <main className="min-h-screen overflow-y-auto bg-app-bg px-4 text-warm-white" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <header className="mb-5 flex items-center gap-3">
        <button type="button" aria-label="Назад" onClick={onBack} className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-warm-white/10">
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-black">Абонементы</h1>
      </header>

      <div role="tablist" aria-label="Разделы абонементов" className="mb-5 grid grid-cols-2 gap-1 rounded-[18px] border border-warm-white/10 bg-white/[0.035] p-1">
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`membership-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`membership-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[48px] rounded-[14px] px-2 py-2 text-sm font-bold leading-tight transition-colors motion-reduce:transition-none ${selected ? 'bg-accent-light text-app-bg' : 'text-warm-white/62'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <section
        id={`membership-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`membership-tab-${activeTab}`}
      >
        <MembershipPanel
          kind={activeTab}
          read={activeTab === 'mine' ? readMemberships : readCatalog}
        />
      </section>
    </main>
  );
}
