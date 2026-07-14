const tg = typeof window !== 'undefined' && window.Telegram?.WebApp
    ? window.Telegram.WebApp
    : null;

if (tg) {
    tg.ready?.();
    tg.expand?.();

    if (typeof tg.disableVerticalSwipes === 'function') {
        tg.disableVerticalSwipes();
    }
}

const isDevelopment = import.meta.env.DEV;

const MOCK_USER = {
    id: 123456789,
    first_name: 'Dev',
    last_name: 'User',
    username: 'dev_user',
    photo_url: '',
};

export function useTelegram() {
    const onClose = () => {
        tg?.close?.();
    };

    const user = tg?.initDataUnsafe?.user || (isDevelopment ? MOCK_USER : null);

    return {
        tg,
        user,
        queryId: tg?.initDataUnsafe?.query_id,
        onClose,
    };
}
