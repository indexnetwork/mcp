import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import logoBlack from './assets/logo-black.svg';

type AuthorizationPageContext = {
  state: string;
  clientId: string;
  clientName?: string;
  scope: string[];
  resource?: string;
  redirectUri: string;
  authorizeUri: string;
  completeUri: string;
  issuer: string;
  privyAppId: string;
  privyClientId?: string;
};

type StatusVariant = 'neutral' | 'error' | 'success';

type StatusState = {
  message: string;
  variant: StatusVariant;
};

const STATUS_DEFAULT: StatusState = { message: '', variant: 'neutral' };

function readAuthorizationContext(): AuthorizationPageContext {
  const element = document.getElementById('oauth-context');
  if (!element) {
    throw new Error('Missing authorization context.');
  }

  const payload = element.textContent ?? element.innerHTML ?? '';
  if (!payload) {
    throw new Error('Authorization context is empty.');
  }

  return JSON.parse(payload) as AuthorizationPageContext;
}

function ConsentExperience({ context }: { context: AuthorizationPageContext }) {
  const [status, setStatus] = useState<StatusState>(STATUS_DEFAULT);
  const [pending, setPending] = useState(false);
  const [autoPrompted, setAutoPrompted] = useState(false);
  const completionStateRef = useRef<'idle' | 'running' | 'done'>('idle');

  const { ready, authenticated, login, getAccessToken } = usePrivy();

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

      const response = await fetch(context.completeUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: context.state,
          privyToken: token,
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error_description ?? payload.error ?? 'Authorization failed.';
        throw new Error(message);
      }

      const payload = await response.json();
      completionStateRef.current = 'done';
      setStatusMessage('Authorization successful. Redirecting…', 'success');
      window.location.href = payload.redirectUri;
    } catch (error: any) {
      completionStateRef.current = 'idle';
      console.error(error);
      const message = error?.message ?? 'Authorization failed.';
      setStatusMessage(message, 'error');
    } finally {
      setPending(false);
    }
  }, [context.completeUri, context.state, getAccessToken, setStatusMessage]);

  useEffect(() => {
    if (ready && authenticated) {
      finalizeAuthorization();
    }
  }, [authenticated, finalizeAuthorization, ready]);

  useEffect(() => {
    const selectors = [
      '#privy-modal-close-button',
      '[data-testid="privy-modal-close-button"]',
      'button[aria-label="Close"]',
      'button[aria-label="close modal"]'
    ];

    const hideCloseButton = () => {
      selectors.forEach((selector) => {
        document.querySelectorAll<HTMLElement>(selector).forEach((close) => {
          close.style.display = 'none';
          close.querySelectorAll<SVGElement>('svg').forEach((icon) => {
            icon.style.display = 'none';
          });
        });
      });
    };

    const interval = window.setInterval(hideCloseButton, 100);
    const observer = new MutationObserver(hideCloseButton);
    observer.observe(document.body, { childList: true, subtree: true });
    hideCloseButton();
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  const handleOpenModal = useCallback(() => {
    if (!ready) {
      setStatusMessage('Authentication system is starting up. Try again in a moment.', 'error');
      return;
    }
    login();
  }, [login, ready, setStatusMessage]);

  useEffect(() => {
    if (ready && !authenticated && !autoPrompted) {
      setAutoPrompted(true);
      login();
    }
  }, [authenticated, autoPrompted, login, ready]);

  return (
    <div className="auth-modal">
      <img src={logoBlack} alt="Index Network" className="logo-mark" />
      <div className="cta" role="region" aria-live="polite">
        <button
          type="button"
          className="sr-only"
          disabled={pending || !ready}
          onClick={handleOpenModal}
        >
          Open Privy Sign-in
        </button>

        {status.message && (
          <p className={`status-line ${status.variant}`}>
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const context = useMemo(readAuthorizationContext, []);

  return (
    <PrivyProvider
      appId={context.privyAppId}
      clientId={context.privyClientId ?? undefined}
      config={{
        loginMethods: ['email', 'google']
      }}
    >
      <ConsentExperience context={context} />
    </PrivyProvider>
  );
}
