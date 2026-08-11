import React from 'react';

export const ROOT_ERROR_STAGE = 'authenticated_app_render';

const ROOT_ERROR_REPORT = Object.freeze({ stage: ROOT_ERROR_STAGE });

const shellStyle = Object.freeze({
  alignItems: 'center',
  background:
    'radial-gradient(circle at 50% -8%, rgba(216, 243, 74, 0.12), transparent 24rem), linear-gradient(180deg, #FBF8EF 0%, #F5F1E8 100%)',
  color: '#071F16',
  display: 'flex',
  justifyContent: 'center',
  minHeight: '100dvh',
  padding:
    'calc(24px + env(safe-area-inset-top, 0px)) 20px calc(24px + env(safe-area-inset-bottom, 0px))',
  textAlign: 'center',
});

const cardStyle = Object.freeze({
  background: '#FBF8EF',
  border: '1px solid rgba(7, 31, 22, 0.10)',
  borderRadius: '24px',
  boxShadow: '0 18px 50px rgba(5, 15, 11, 0.12)',
  maxWidth: '390px',
  padding: '28px 24px',
  width: '100%',
});

const eyebrowStyle = Object.freeze({
  color: 'rgba(7, 31, 22, 0.62)',
  fontSize: '12px',
  fontWeight: 800,
  letterSpacing: '0.16em',
  marginBottom: '12px',
  textTransform: 'uppercase',
});

const headingStyle = Object.freeze({
  fontSize: '24px',
  lineHeight: 1.2,
  marginBottom: '10px',
});

const bodyStyle = Object.freeze({
  color: 'rgba(7, 31, 22, 0.68)',
  fontSize: '15px',
  lineHeight: 1.5,
  marginBottom: '22px',
});

const actionStyle = Object.freeze({
  background: '#071F16',
  border: '1px solid #071F16',
  borderRadius: '14px',
  color: '#F5F1E8',
  cursor: 'pointer',
  fontSize: '15px',
  fontWeight: 800,
  minHeight: '48px',
  padding: '12px 20px',
  width: '100%',
});

export default class RootErrorBoundary extends React.Component {
  state = {
    hasError: false,
    retryVersion: 0,
  };

  retryButton = React.createRef();

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    try {
      this.props.onReport?.(ROOT_ERROR_REPORT);
    } catch {
      // A diagnostic sink must never replace the sanitized recovery screen.
    }

    this.retryButton.current?.focus();
  }

  handleRetry = () => {
    this.setState(({ retryVersion }) => ({
      hasError: false,
      retryVersion: retryVersion + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <main
          aria-labelledby="root-error-title"
          data-testid="root-error-boundary"
          role="alert"
          style={shellStyle}
        >
          <section style={cardStyle}>
            <p style={eyebrowStyle}>Просто Падел</p>
            <h1 id="root-error-title" style={headingStyle}>
              Не удалось открыть приложение
            </h1>
            <p style={bodyStyle}>
              Попробуйте снова. Если ошибка повторится, полностью переоткройте
              Mini App.
            </p>
            <button
              onClick={this.handleRetry}
              ref={this.retryButton}
              style={actionStyle}
              type="button"
            >
              Попробовать снова
            </button>
          </section>
        </main>
      );
    }

    return (
      <React.Fragment key={this.state.retryVersion}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
