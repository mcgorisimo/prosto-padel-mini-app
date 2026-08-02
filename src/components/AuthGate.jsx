import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

export function resolveOwnProfileGate({
  backendRequired,
  sessionReady,
  profileStatus,
  hasProfile,
}) {
  if (!backendRequired) return 'legacy';
  if (!sessionReady) return 'loading';
  if (profileStatus === 'loading' || profileStatus === 'inactive') {
    return 'loading';
  }
  if (profileStatus === 'ready' && hasProfile) return 'ready';
  return 'error';
}

export function createBackendMatchActions(telegramBackendLogin) {
  if (telegramBackendLogin?.sessionReady !== true) return null;

  return Object.freeze({
    listMatches: telegramBackendLogin.listMatches,
    listAccountMatches: telegramBackendLogin.listAccountMatches,
    loadMatch: telegramBackendLogin.loadMatch,
    createMatch: telegramBackendLogin.createMatch,
    updateMatchDescription:
      telegramBackendLogin.updateMatchDescription,
    moderateText: telegramBackendLogin.moderateText,
    joinMatch: telegramBackendLogin.joinMatch,
    leaveMatch: telegramBackendLogin.leaveMatch,
    searchPlayers: telegramBackendLogin.searchPlayers,
    listIncomingMatchInvitations:
      telegramBackendLogin.listIncomingMatchInvitations,
    listOutgoingMatchInvitations:
      telegramBackendLogin.listOutgoingMatchInvitations,
    createMatchInvitation:
      telegramBackendLogin.createMatchInvitation,
    acceptMatchInvitation:
      telegramBackendLogin.acceptMatchInvitation,
    declineMatchInvitation:
      telegramBackendLogin.declineMatchInvitation,
    cancelMatchInvitation:
      telegramBackendLogin.cancelMatchInvitation,
    listMatchMessages:
      telegramBackendLogin.listMatchMessages,
    sendMatchMessage:
      telegramBackendLogin.sendMatchMessage,
    listMatchWaitlist:
      telegramBackendLogin.listMatchWaitlist,
    joinMatchWaitlist:
      telegramBackendLogin.joinMatchWaitlist,
    leaveMatchWaitlist:
      telegramBackendLogin.leaveMatchWaitlist,
    readMatchLineup:
      telegramBackendLogin.readMatchLineup,
    assignMatchLineupSlot:
      telegramBackendLogin.assignMatchLineupSlot,
    releaseMatchLineupSlot:
      telegramBackendLogin.releaseMatchLineupSlot,
    readMatchResult:
      telegramBackendLogin.readMatchResult,
    submitMatchResult:
      telegramBackendLogin.submitMatchResult,
    confirmMatchResult:
      telegramBackendLogin.confirmMatchResult,
    disputeMatchResult:
      telegramBackendLogin.disputeMatchResult,
    listAdminPlayers:
      telegramBackendLogin.listAdminPlayers,
    setAdminPlayerRatingState:
      telegramBackendLogin.setAdminPlayerRatingState,
  });
}

export default function AuthGate() {
  const telegramBackendLogin = useTelegramBackendLogin();
  const [session, setSession] = useState(null);
  const [authView, setAuthView] = useState('welcome'); // welcome, signup, login
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState(null);
  const [backendProfile, setBackendProfile] = useState(null);
  const [backendProfileStatus, setBackendProfileStatus] =
    useState('inactive');
  const backendProfileRequestRef = useRef(0);

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
          backendProfileRequestRef.current += 1;
          setBackendProfile(null);
          setBackendProfileStatus('inactive');
          telegramBackendLogin.clear();
        }
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, [telegramBackendLogin.clear]);

  useEffect(() => {
    if (!telegramBackendLogin.sessionReady) {
      backendProfileRequestRef.current += 1;
      setBackendProfile(null);
      setBackendProfileStatus((previous) =>
        previous === 'ready' || previous === 'loading'
          ? 'error'
          : 'inactive');
      return;
    }

    const requestToken = backendProfileRequestRef.current + 1;
    backendProfileRequestRef.current = requestToken;
    setBackendProfileStatus('loading');
    void telegramBackendLogin.loadOwnProfile().then(
      (result) => {
        if (backendProfileRequestRef.current !== requestToken) return;
        if (result.outcome === 'profile_loaded') {
          setBackendProfile(result.profile);
          setBackendProfileStatus('ready');
          return;
        }
        setBackendProfile(null);
        setBackendProfileStatus('error');
      },
      () => {
        if (backendProfileRequestRef.current === requestToken) {
          setBackendProfile(null);
          setBackendProfileStatus('error');
        }
      },
    );
  }, [
    telegramBackendLogin.loadOwnProfile,
    telegramBackendLogin.sessionReady,
  ]);

  useEffect(() => () => {
    backendProfileRequestRef.current += 1;
  }, []);

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
    backendProfileRequestRef.current += 1;
    setBackendProfile(null);
    setBackendProfileStatus('inactive');
    const backendResult = await telegramBackendLogin.logout();
    if (backendResult.outcome !== 'logged_out') {
      throw new Error('Backend session logout failed');
    }

    const { error: supabaseError } = await supabase.auth.signOut();
    if (supabaseError) throw supabaseError;
  }, [telegramBackendLogin.logout]);

  const handleBackendProfileSave = useCallback(async (changes) => {
    backendProfileRequestRef.current += 1;
    const result = await telegramBackendLogin.updateOwnProfile(changes);
    if (result.outcome === 'profile_updated') {
      setBackendProfile(result.profile);
      setBackendProfileStatus('ready');
    }
    return result;
  }, [telegramBackendLogin.updateOwnProfile]);

  const backendMatchActions = useMemo(
    () => createBackendMatchActions(telegramBackendLogin),
    [
      telegramBackendLogin.createMatch,
      telegramBackendLogin.updateMatchDescription,
      telegramBackendLogin.moderateText,
      telegramBackendLogin.createMatchInvitation,
      telegramBackendLogin.acceptMatchInvitation,
      telegramBackendLogin.cancelMatchInvitation,
      telegramBackendLogin.declineMatchInvitation,
      telegramBackendLogin.joinMatch,
      telegramBackendLogin.leaveMatch,
      telegramBackendLogin.listIncomingMatchInvitations,
      telegramBackendLogin.listAccountMatches,
      telegramBackendLogin.listMatches,
      telegramBackendLogin.listOutgoingMatchInvitations,
      telegramBackendLogin.listMatchMessages,
      telegramBackendLogin.listMatchWaitlist,
      telegramBackendLogin.loadMatch,
      telegramBackendLogin.joinMatchWaitlist,
      telegramBackendLogin.leaveMatchWaitlist,
      telegramBackendLogin.readMatchLineup,
      telegramBackendLogin.assignMatchLineupSlot,
      telegramBackendLogin.releaseMatchLineupSlot,
      telegramBackendLogin.readMatchResult,
      telegramBackendLogin.submitMatchResult,
      telegramBackendLogin.confirmMatchResult,
      telegramBackendLogin.disputeMatchResult,
      telegramBackendLogin.listAdminPlayers,
      telegramBackendLogin.setAdminPlayerRatingState,
      telegramBackendLogin.searchPlayers,
      telegramBackendLogin.sendMatchMessage,
      telegramBackendLogin.sessionReady,
    ],
  );

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
  const backendProfileRequired =
    telegramBackendLogin.status !== 'disabled' &&
    telegramBackendLogin.status !== 'outside_telegram';
  const effectiveBackendProfileStatus =
    telegramBackendLogin.sessionReady &&
    backendProfileStatus === 'inactive'
      ? 'loading'
      : backendProfileStatus;
  const ownProfileGate = resolveOwnProfileGate({
    backendRequired: backendProfileRequired,
    sessionReady: telegramBackendLogin.sessionReady,
    profileStatus: effectiveBackendProfileStatus,
    hasProfile: backendProfile !== null,
  });
  const visibleTelegramBackendStatus =
    session && ownProfileGate === 'error'
      ? 'profile_unavailable'
      : (session || authView !== 'welcome') &&
          isTelegramBackendSuccess(telegramBackendLogin.status)
        ? 'idle'
        : telegramBackendLogin.status;

  const telegramBackendStatus = (
    <TelegramBackendLoginStatus
      status={visibleTelegramBackendStatus}
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

  if (
    session &&
    backendProfileRequired &&
    ownProfileGate !== 'ready'
  ) {
    return (
      <div
        data-testid="backend-own-profile-gate"
        data-state={ownProfileGate}
      >
        <BallLoader />
        {telegramBackendStatus}
      </div>
    );
  }

  // 2. Если залогинены — пускаем в само приложение
  if (session) {
    return (
      <>
        <App
          session={session}
          backendProfile={backendProfile}
          backendMatchRequired={backendProfileRequired}
          backendMatchLifecycleStatus={telegramBackendLogin.status}
          backendProfileStatus={effectiveBackendProfileStatus}
          backendMatchActions={backendMatchActions}
          onBackendProfileSave={
            telegramBackendLogin.sessionReady
              ? handleBackendProfileSave
              : null
          }
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
