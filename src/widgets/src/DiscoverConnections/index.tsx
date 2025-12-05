import React from 'react';
import { createRoot } from 'react-dom/client';
import { useOpenAi } from '../hooks/useOpenAi';
import { ConnectionCard } from './ConnectionCard';
import '../shared/chatgpt-theme.css';
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
      <div className="chatgpt-widget-root">
        <div className="chatgpt-empty">
          No connections yet. Run the discover_connections tool first.
        </div>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="chatgpt-widget-root">
        <div className="chatgpt-empty">
          No potential connections found for this input.
        </div>
      </div>
    );
  }

  return (
    <div className="chatgpt-widget-root">
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
