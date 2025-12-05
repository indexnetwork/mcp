import '../main.css';
import { createRoot } from 'react-dom/client';
import { useOpenAi } from '../hooks/useOpenAi';
import { EmptyMessage } from '@openai/apps-sdk-ui/components/EmptyMessage';
import { Members } from '@openai/apps-sdk-ui/components/Icon';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';
import { ConnectionCard } from './ConnectionCard';

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

  // Loading state - connections array not yet available
  if (!data?.connections) {
    return (
      <div className="w-full flex items-center justify-center py-6">
        <LoadingIndicator size={24} />
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="w-full">
        <EmptyMessage fill="none">
          <EmptyMessage.Icon>
            <Members />
          </EmptyMessage.Icon>
          <EmptyMessage.Title>
            No potential connections found
          </EmptyMessage.Title>
          <EmptyMessage.Description>
            Try adding more intents to find connections.
          </EmptyMessage.Description>
        </EmptyMessage>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
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
