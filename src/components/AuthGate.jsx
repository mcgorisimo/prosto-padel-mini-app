import React, { useState, useEffect } from 'react';
import App          from '../App';
import WelcomeScreen from './auth/WelcomeScreen';
import SignUpScreen  from './auth/SignUpScreen';
import LoginScreen   from './auth/LoginScreen';
import Toast from './Toast'; // Correct path for Toast
import { supabase } from '../lib/supabaseClient';
import { logSupabaseError } from '../lib/profileApi';
import BallLoader from './BallLoader'; // Р•СЃР»Рё РјСЏС‡ Р»РµР¶РёС‚ РІ РїР°РїРєРµ components

const normalizeTelegramUsername = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '');

export default function AuthGate() {
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
      (_event, session) => {
        setSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const showToast = (message, variant = 'info') => {
    setToastMessage({ message, variant });
    setTimeout(() => setToastMessage(null), 3000);
  };

const handleSignUp = async ({ email, password, options }) => {
  setLoading(true);
  setError('');
  try {
    // 1. Р РµРіРёСЃС‚СЂРёСЂСѓРµРј РІ Auth (РґР°РЅРЅС‹Рµ РёР· options.data РїРѕРїР°РґСѓС‚ РІ РјРµС‚Р°РґР°РЅРЅС‹Рµ)
    const { data: authData, error: authError } = await supabase.auth.signUp({ 
      email, 
      password, 
      options 
    });

    if (authError) throw authError;

    // 2. РЎР РђР—РЈ СЃРѕР·РґР°РµРј Р·Р°РїРёСЃСЊ РІ С‚Р°Р±Р»РёС†Рµ profiles, РёСЃРїРѕР»СЊР·СѓСЏ С‚Рµ Р¶Рµ РґР°РЅРЅС‹Рµ
    if (authData.user) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .insert([
          { 
            id: authData.user.id, 
            first_name: options.data.first_name, // Р‘РµСЂРµРј РёР· С‚РѕРіРѕ, С‡С‚Рѕ РїСЂРёС€Р»Рѕ
            last_name: options.data.last_name,   // Р‘РµСЂРµРј РёР· С‚РѕРіРѕ, С‡С‚Рѕ РїСЂРёС€Р»Рѕ
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
    
    // Р•СЃР»Рё СЃРµСЃСЃРёСЏ РЅРµ СЃРѕР·РґР°Р»Р°СЃСЊ (РЅСѓР¶РЅРѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РїРѕС‡С‚С‹), 
    // supabase РјРѕР¶РµС‚ РЅРµ Р·Р°Р»РѕРіРёРЅРёС‚СЊ СЃСЂР°Р·Сѓ. РќРѕ РѕР±С‹С‡РЅРѕ РЅР° dev-СЂРµР¶РёРјРµ Р»РѕРіРёРЅРёС‚.
  } catch (error) {
    logSupabaseError('auth-gate.signup', error);
    setError(error.message);
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
      showToast("РЎ РІРѕР·РІСЂР°С‰РµРЅРёРµРј!", "success");
    } catch (error) {
      logSupabaseError('auth-gate.login', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // 1. РџРѕРєР°Р·С‹РІР°РµРј Р»РѕР°РґРµСЂ (РµСЃР»Рё С‚С‹ СЃРґРµР»Р°Р» BallLoader, РёСЃРїРѕР»СЊР·СѓР№ РµРіРѕ С‚СѓС‚!)
  if (loading) return <BallLoader />;

  const toast = toastMessage && (
    <Toast
      message={toastMessage.message}
      variant={toastMessage.variant}
      onClose={() => setToastMessage(null)}
    />
  );

  // 2. Р•СЃР»Рё Р·Р°Р»РѕРіРёРЅРµРЅС‹ вЂ” РїСѓСЃРєР°РµРј РІ СЃР°РјРѕ РїСЂРёР»РѕР¶РµРЅРёРµ
  if (session) {
    return (
      <>
        <App session={session} showToast={showToast} />
        {toast}
      </>
    );
  }

  // 3. Р“Р»Р°РІРЅС‹Р№ СЂРµРЅРґРµСЂ СЌРєСЂР°РЅРѕРІ Р°РІС‚РѕСЂРёР·Р°С†РёРё + Toast
  // Note: WelcomeScreen, SignUpScreen, LoginScreen should also receive showToast if they use it.

  // 3. Р“Р»Р°РІРЅС‹Р№ СЂРµРЅРґРµСЂ СЌРєСЂР°РЅРѕРІ Р°РІС‚РѕСЂРёР·Р°С†РёРё + Toast
  return (
    <>
      {authView === 'welcome' && (
        <WelcomeScreen 
          onLogin={() => setAuthView('login')} 
          onSignUp={() => setAuthView('signup')}
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
    </>
  );
}
