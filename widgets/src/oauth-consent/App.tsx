import { useCallback, useEffect, useMemo, useState } from 'react';
import Privy, { LocalStorage } from '@privy-io/js-sdk-core';

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

export default function App() {
  const context = useMemo(readAuthorizationContext, []);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<StatusState>(STATUS_DEFAULT);
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [privyClient, setPrivyClient] = useState<InstanceType<typeof Privy> | null>(null);

  useEffect(() => {
    const client = new Privy({
      appId: context.privyAppId,
      clientId: context.privyClientId ?? undefined,
      storage: new LocalStorage()
    });
    setPrivyClient(client);
  }, [context]);

  const setStatusMessage = useCallback((message: string, variant: StatusVariant = 'neutral') => {
    setStatus({ message, variant });
  }, []);

  const resetStatus = useCallback(() => setStatus(STATUS_DEFAULT), []);

  const handleSendCode = useCallback(async () => {
    if (!privyClient) {
      setStatusMessage('Loading authentication client…', 'error');
      return;
    }

    const trimmed = email.trim();
    if (!trimmed) {
      setStatusMessage('Enter a valid email address.', 'error');
      return;
    }

    try {
      setPending(true);
      setStatusMessage('Sending verification code…');
      await privyClient.auth.email.sendCode(trimmed);
      setStage('code');
      setStatusMessage('We sent a 6-digit code to your email.', 'success');
    } catch (error: any) {
      console.error(error);
      const message = error?.message ?? 'Failed to send verification code.';
      setStatusMessage(message, 'error');
    } finally {
      setPending(false);
    }
  }, [email, privyClient, setStatusMessage]);

  const handleVerifyCode = useCallback(async () => {
    if (!privyClient) {
      setStatusMessage('Loading authentication client…', 'error');
      return;
    }

    if (!email) {
      setStatusMessage('Please request a verification code first.', 'error');
      setStage('email');
      return;
    }

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setStatusMessage('Enter the 6-digit verification code.', 'error');
      return;
    }

    try {
      setPending(true);
      setStatusMessage('Signing in…');
      const session = await privyClient.auth.email.loginWithCode(email, trimmedCode);
      console.log('Privy session', session);

      const appAccessToken = (session as any)?.token;
      const privyAccessToken = (session as any)?.privy_access_token;
      console.log('Selected Privy token source', {
        hasAppAccessToken: Boolean(appAccessToken),
        hasPrivyAccessToken: Boolean(privyAccessToken),
        hasAccessTokenField: Boolean(session?.accessToken?.token)
      });

      if (!appAccessToken && !privyAccessToken) {
        throw new Error('Unable to retrieve Privy access token.');
      }

      const response = await fetch(context.completeUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: context.state,
          privyToken: appAccessToken ?? privyAccessToken,
          fallbackToken: privyAccessToken && privyAccessToken !== appAccessToken ? privyAccessToken : undefined
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error_description ?? payload.error ?? 'Authorization failed.';
        throw new Error(message);
      }

      const payload = await response.json();
      setStatusMessage('Authorization successful. Redirecting…', 'success');
      window.location.href = payload.redirectUri;
    } catch (error: any) {
      console.error(error);
      const message = error?.message ?? 'Verification failed.';
      setStatusMessage(message, 'error');
    } finally {
      setPending(false);
    }
  }, [code, context.completeUri, context.state, privyClient, email, setStatusMessage]);

  return (
    <main className="card">
      <h1>Sign in with Privy</h1>
      <p>
        Authorize <strong>{context.clientName ?? 'this application'}</strong> to use your Index Network account.
      </p>
      <section>
        <h2>Requested permissions</h2>
        <ul className="scopes">
          {context.scope.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
      </section>
      <p className={`status ${status.variant !== 'neutral' ? status.variant : ''}`}>{status.message}</p>

      <form
        className={stage === 'email' ? '' : 'hidden'}
        onSubmit={(event) => {
          event.preventDefault();
          handleSendCode();
        }}
      >
        <label>
          Email address
          <input
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            disabled={pending}
            onChange={(event) => {
              setEmail(event.target.value);
              resetStatus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSendCode();
              }
            }}
          />
        </label>
        <button type="button" onClick={handleSendCode} disabled={pending}>
          Send verification code
        </button>
      </form>

      <form
        className={stage === 'code' ? '' : 'hidden'}
        onSubmit={(event) => {
          event.preventDefault();
          handleVerifyCode();
        }}
      >
        <label>
          Verification code
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="123456"
            autoComplete="one-time-code"
            value={code}
            disabled={pending}
            onChange={(event) => {
              setCode(event.target.value);
              resetStatus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleVerifyCode();
              }
            }}
          />
        </label>
        <button type="button" onClick={handleVerifyCode} disabled={pending}>
          Verify &amp; continue
        </button>
      </form>
    </main>
  );
}
