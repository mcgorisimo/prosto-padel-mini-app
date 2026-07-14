import React from 'react';

const BallLoader = () => {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: '#020617', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
    }}>
      <div className="padel-ball">
        <div className="line"></div>
      </div>
      
      <style>{`
        .padel-ball {
          width: 80px; height: 80px;
          background: #d4f01d;
          border-radius: 50%;
          position: relative;
          box-shadow: inset -10px -10px 20px rgba(0,0,0,0.3), 0 20px 40px rgba(0,0,0,0.5);
          animation: spin 2s infinite linear;
        }
        .line {
          position: absolute; width: 100%; height: 100%;
          border: 3px solid white; border-radius: 50%;
          top: -10%; left: -25%; opacity: 0.6;
        }
        @keyframes spin {
          from { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.1); }
          to { transform: rotate(360deg) scale(1); }
        }
      `}</style>
    </div>
  );
};

export default BallLoader;