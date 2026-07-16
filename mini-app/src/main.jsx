import React, { useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './components/AuthGate';
import SplashScreen from './components/SplashScreen';
import './index.css';

const SPLASH_SESSION_KEY = 'prosto-padel-splash-shown';

function shouldShowSplash() {
  try {
    return window.sessionStorage.getItem(SPLASH_SESSION_KEY) !== 'true';
  } catch {
    return true;
  }
}

function MiniAppRoot() {
  const [showSplash, setShowSplash] = useState(shouldShowSplash);

  const handleSplashComplete = useCallback(() => {
    try {
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, 'true');
    } catch {
      // The app must remain available when WebView storage is restricted.
    }

    setShowSplash(false);
  }, []);

  return (
    <>
      <AuthGate />
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MiniAppRoot />
  </React.StrictMode>
);
