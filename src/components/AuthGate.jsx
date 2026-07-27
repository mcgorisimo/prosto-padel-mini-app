import React, { useCallback, useState, useEffect } from 'react';
import App          from '../App';
import WelcomeScreen from './auth/WelcomeScreen';
import SignUpScreen  from './auth/SignUpScreen';
import LoginScreen   from './auth/LoginScreen';
import Toast from './Toast'; // Correct path for Toast
import { supabase } from '../lib/supabaseClient';
import { useTelegramBackendLogin } from '../hooks/useTelegramBackendLogin';
import TelegramBackendLoginStatus from './auth/TelegramBackendLoginStatus';
import BallLoader from './BallLoader'; // Если мяч лежит в папке components

const normalizeTelegramUsername = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '');

const isTelegramBackendSuccess = (status) =>
  status === 'authenticated' || status === 'session_restored';

export default function AuthGate() {
  const telegramBackendLogin = useTelegramBackendLogin();
  const [session, setSession] = useState(null);
  const [authView, setAuthView] = useState('welcome'); // welcome, signup, login
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT') {
          telegramBackendLogin.clear();
        }
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, [telegramBackendLogin.clear]);

  useEffect(() => {
    if (
      (session || authView !== 'welcome') &&
      isTelegramBackendSuccess(telegramBackendLogin.status)
    ) {
      telegramBackendLogin.dismissSuccess();
    }
  }, [
    authView,
    session,
    telegramBackendLogin.dismissSuccess,
    telegramBackendLogin.status,
  ]);

  const handleAppLogout = useCallback(async () => {
    const backendResult = await telegramBackendLogin.logout();
    if (backendResult.outcome !== 'logged_out') {
      throw new Error('Backend session logout failed');
    }

    const { error: supabaseError } = await supabase.auth.signOut();
    if (supabaseError) throw supabaseError;
  }, [telegramBackendLogin.logout]);

  const showToast = (message, variant = 'info') => {
    setToastMessage({ message, variant });
    setTimeout(() => setToastMessage(null), 3000);
  };

const handleSignUp = async ({ email, password, options }) => {
  setLoading(true);
  setError('');
  try {
    // 1. Регистрируем в Auth (данные из options.data попадут в метаданные)
    const { data: authData, error: authError } = await supabase.auth.signUp({ 
      email, 
      password, 
      options 
    });

    if (authError) throw authError;

    // 2. СРАЗУ создаем запись в таблице profiles, используя те же данные
    if (authData.user) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .insert([
          { 
            id: authData.user.id, 
            first_name: options.data.first_name, // Берем из того, что пришло
            last_name: options.data.last_name,   // Берем из того, что пришло
            username: normalizeTelegramUsername(options.data.username) || null,
            role: 'user', 
            rating: options.data.rating || 3.0,
            is_verified: false,
          }
        ])
        .select('id')
        .single();
        
      if (profileError) {
        throw profileError;
      }

      if (!profileData?.id) {
        throw new Error('Profile creation returned no rows');
      }
    }
    
    // Если сессия не создалась (нужно подтверждение почты), 
    // supabase может не залогинить сразу. Но обычно на dev-режиме логинит.
  } catch (error) {
    setError('Не удалось создать профиль. Проверьте данные и попробуйте еще раз.');
  } finally {
    setLoading(false);
  }
};

  const handleLogin = async ({ email, password }) => {
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast("С возвращением!", "success");
    } catch (error) {
      setError('Не удалось войти. Проверьте email и пароль.');
    } finally {
      setLoading(false);
    }
  };

  // 1. Показываем лоадер (если ты сделал BallLoader, используй его тут!)
  const telegramBackendStatus = (
    <TelegramBackendLoginStatus
      status={
        (session || authView !== 'welcome') &&
        isTelegramBackendSuccess(telegramBackendLogin.status)
          ? 'idle'
          : telegramBackendLogin.status
      }
      accountKind={telegramBackendLogin.accountKind}
    />
  );

  const showAuthView = (nextView) => {
    telegramBackendLogin.dismissSuccess();
    setAuthView(nextView);
  };

  if (loading) {
    return (
      <>
        <BallLoader />
        {telegramBackendStatus}
      </>
    );
  }

  const toast = toastMessage && (
    <Toast
      message={toastMessage.message}
      variant={toastMessage.variant}
      onClose={() => setToastMessage(null)}
    />
  );

  // 2. Если залогинены — пускаем в само приложение
  if (session) {
    return (
      <>
        <App
          session={session}
          showToast={showToast}
          onLogout={handleAppLogout}
        />
        {toast}
        {telegramBackendStatus}
      </>
    );
  }

  // 3. Главный рендер экранов авторизации + Toast
  // Note: WelcomeScreen, SignUpScreen, LoginScreen should also receive showToast if they use it.

  // 3. Главный рендер экранов авторизации + Toast
  return (
    <>
      {authView === 'welcome' && (
        <WelcomeScreen 
          onLogin={() => showAuthView('login')}
          onSignUp={() => showAuthView('signup')}
          showToast={showToast} // Pass showToast to WelcomeScreen
        />
      )}

      {authView === 'signup' && (
        <SignUpScreen 
          onBack={() => { setAuthView('welcome'); setError(''); }} 
          onSuccess={handleSignUp}
          loading={loading}
          error={error}
          showToast={showToast} // Pass showToast to SignUpScreen
        />
      )}

      {authView === 'login' && (
        <LoginScreen 
          onBack={() => { setAuthView('welcome'); setError(''); }} 
          onSuccess={handleLogin}
          loading={loading}
          error={error}
          showToast={showToast} // Pass showToast to LoginScreen
        />
      )}

      {toast}
      {telegramBackendStatus}
    </>
  );
}
