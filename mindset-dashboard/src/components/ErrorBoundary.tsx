import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: '#fff', background: '#000', minHeight: '100vh', fontFamily: 'sans-serif', overflowY: 'auto' }}>
          <h1 style={{ color: '#ef4444', fontSize: '24px' }}>Oups ! Une erreur est survenue.</h1>
          <p style={{ marginTop: '10px' }}>L'application a rencontré un problème critique.</p>
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.href = '/landing.html';
            }}
            style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', marginTop: '20px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Vider le cache et redémarrer
          </button>
          <pre style={{ marginTop: '20px', background: '#111', padding: '15px', borderRadius: '8px', overflowX: 'auto', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.toString()}
            <br />
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
