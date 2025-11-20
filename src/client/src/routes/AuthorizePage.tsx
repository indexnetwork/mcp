import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import logoBlack from '../assets/logo-black.svg';

type StatusVariant = 'neutral' | 'error' | 'success';

type StatusState = {
  message: string;
  variant: StatusVariant;
};

const STATUS_DEFAULT: StatusState = { message: '', variant: 'neutral' };

function AuthorizePage() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, login, getAccessToken } = usePrivy();

  const [status, setStatus] = useState<StatusState>(STATUS_DEFAULT);
  const [pending, setPending] = useState(false);
  const [autoPrompted, setAutoPrompted] = useState(false);
  const completionStateRef = useRef<'idle' | 'running' | 'done'>('idle');

  // Extract OAuth parameters from URL
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'read';
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');

  const setStatusMessage = useCallback((message: string, variant: StatusVariant = 'neutral') => {
    setStatus({ message, variant });
  }, []);

  const finalizeAuthorization = useCallback(async () => {
    if (completionStateRef.current !== 'idle') {
      return;
    }

    completionStateRef.current = 'running';

    try {
      setPending(true);
      setStatusMessage('Authorizing access…');

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Unable to retrieve Privy access token.');
      }

      const response = await fetch('/authorize/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          privy_token: token,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error_description ?? payload.error ?? 'Authorization failed.';
        throw new Error(message);
      }

      const payload = await response.json();
      completionStateRef.current = 'done';
      setStatusMessage('Authorization successful. Redirecting…', 'success');
      window.location.href = payload.redirect_uri;
    } catch (error: any) {
      completionStateRef.current = 'idle';
      console.error(error);
      const message = error?.message ?? 'Authorization failed.';
      setStatusMessage(message, 'error');
    } finally {
      setPending(false);
    }
  }, [clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, getAccessToken, setStatusMessage]);

  // Validate OAuth parameters
  useEffect(() => {
    if (!clientId || !redirectUri || !codeChallenge || !codeChallengeMethod) {
      setStatusMessage('Invalid authorization request: missing required parameters', 'error');
      return;
    }

    if (codeChallengeMethod !== 'S256') {
      setStatusMessage('Invalid code_challenge_method: only S256 is supported', 'error');
      return;
    }
  }, [clientId, redirectUri, codeChallenge, codeChallengeMethod, setStatusMessage]);

  // Finalize authorization when authenticated
  useEffect(() => {
    if (ready && authenticated) {
      finalizeAuthorization();
    }
  }, [authenticated, finalizeAuthorization, ready]);

  // Apply Privy modal styling: hide close button, remove rounded corners, hide "Protected by Privy", prevent outside click close
  useEffect(() => {
    const applyPrivyStyling = () => {
      // Hide close button
      const closeSelectors = [
        '#privy-modal-close-button',
        '[data-testid="privy-modal-close-button"]',
        'button[aria-label="Close"]',
        'button[aria-label="close modal"]'
      ];
      closeSelectors.forEach((selector) => {
        document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
          el.style.display = 'none';
          el.querySelectorAll<SVGElement>('svg').forEach((icon) => {
            icon.style.display = 'none';
          });
        });
      });

      // Hide the ModalFooter which contains "Protected by Privy"
      document.querySelectorAll<HTMLElement>('[class*="ModalFooter"]').forEach((el) => {
        el.style.display = 'none';
      });

      // Remove rounded corners from modal content and inputs
      document.querySelectorAll<HTMLElement>('#privy-modal-content').forEach((el) => {
        el.style.borderRadius = '0';
      });

      // Remove rounded corners from buttons and inputs inside Privy modal
      document.querySelectorAll<HTMLElement>('#privy-dialog button, #privy-dialog input, #privy-modal-content button, #privy-modal-content input').forEach((el) => {
        el.style.borderRadius = '0';
      });

      // Prevent clicking outside modal from closing it by intercepting backdrop clicks
      document.querySelectorAll<HTMLElement>('#privy-dialog-scrim, [data-testid="privy-dialog-scrim"]').forEach((el) => {
        el.style.pointerEvents = 'none';
      });
    };

    const interval = window.setInterval(applyPrivyStyling, 100);
    const observer = new MutationObserver(applyPrivyStyling);
    observer.observe(document.body, { childList: true, subtree: true });
    applyPrivyStyling();
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  // Auto-open Privy login modal
  useEffect(() => {
    if (ready && !authenticated && !autoPrompted) {
      setAutoPrompted(true);
      login();
    }
  }, [authenticated, autoPrompted, login, ready]);

  const handleOpenModal = useCallback(() => {
    if (!ready) {
      setStatusMessage('Authentication system is starting up. Try again in a moment.', 'error');
      return;
    }
    login();
  }, [login, ready, setStatusMessage]);

  return (
    <div style={styles.authModal}>
      <img src={logoBlack} alt="Index Network" style={styles.logoMark} />
      <div style={styles.cta}>
        <button
          type="button"
          style={styles.srOnly}
          disabled={pending || !ready}
          onClick={handleOpenModal}
        >
          Open Privy Sign-in
        </button>

        {status.message && (
          <p style={{
            ...styles.statusLine,
            ...(status.variant === 'error' ? styles.statusError : {}),
            ...(status.variant === 'success' ? styles.statusSuccess : {}),
          }}>
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  authModal: {
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#f5f5f7',
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  logoMark: {
    position: 'absolute',
    top: '5vh',
    left: '20vw',
    width: '96px',
    height: 'auto',
    pointerEvents: 'none',
    zIndex: 1,
  },
  cta: {
    marginTop: '200px',
    textAlign: 'center',
  },
  statusLine: {
    margin: 0,
    fontSize: '13px',
    lineHeight: 1.5,
    textAlign: 'center',
    color: '#4b5563',
  },
  statusError: {
    color: '#b91c1c',
  },
  statusSuccess: {
    color: '#15803d',
  },
  srOnly: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
};

export default AuthorizePage;
