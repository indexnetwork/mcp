import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './index.css';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;

if (!privyAppId) {
  console.error('VITE_PRIVY_APP_ID is not set in environment variables');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['email', 'google'],
        appearance: {
          theme: 'light',
          accentColor: '#676FFF',
          logo: undefined,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);
