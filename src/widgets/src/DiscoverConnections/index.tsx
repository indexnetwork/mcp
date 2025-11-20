import React from 'react';
import { createRoot } from 'react-dom/client';
import { useOpenAi } from '../hooks/useOpenAi';
import { ConnectionCard } from './ConnectionCard';
import './styles.css';

// Types
interface Connection {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  mutualIntentCount: number;
  synthesis: string;
}

interface DiscoverConnectionsData {
  connections: Connection[];
  intentsExtracted?: number;
  connectionsFound?: number;
}

// Main Widget Component
function DiscoverConnectionsWidget() {
  const toolOutput = useOpenAi();

  // Try multiple possible data sources (same pattern as IntentDisplay)
  const data = (
    (toolOutput as any)?.structuredContent ||
    (toolOutput as any)?.result?.structuredContent ||
    toolOutput
  ) as DiscoverConnectionsData | null;

  const connections = data?.connections ?? [];

  console.log('[DiscoverConnectionsWidget] Rendering with', connections.length, 'connections');

  if (!data) {
    return (
      <div style={{ padding: '1rem', fontSize: '0.875rem', color: '#6B7280' }}>
        No connections yet. Run the discover_connections tool first.
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div style={{ padding: '1rem', fontSize: '0.875rem', color: '#6B7280' }}>
        No potential connections found for this input.
      </div>
    );
  }

  return (
    <div style={{ background: '#F9FAFB', padding: '0.5rem' }}>
      {connections.map((conn) => (
        <ConnectionCard
          key={conn.user.id}
          user={conn.user}
          mutualIntentCount={conn.mutualIntentCount}
          synthesis={conn.synthesis}
        />
      ))}
    </div>
  );
}

// Mount the widget
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<DiscoverConnectionsWidget />);
}

export default DiscoverConnectionsWidget;
