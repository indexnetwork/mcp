import { useState } from 'react';
import { useOpenAi } from '../hooks/useOpenAi';
import IntentList from '../shared/IntentList';
import './styles.css';

interface Intent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
}

interface IntentData {
  intents: Intent[];
  filesProcessed?: number;
  linksProcessed?: number;
  intentsGenerated: number;
}

export function IntentDisplay() {
  const toolOutput = useOpenAi();

  const [removedIntentIds, setRemovedIntentIds] = useState<Set<string>>(new Set());
  const [removingIntentIds, setRemovingIntentIds] = useState<Set<string>>(new Set());

  // Try multiple possible data sources
  const data = (toolOutput?.structuredContent ||
                toolOutput?.result?.structuredContent ||
                toolOutput) as IntentData | null;

  const visibleIntents = data?.intents?.filter(
    intent => !removedIntentIds.has(intent.id)
  ) || [];

  console.log('[IntentDisplay] Rendering with', visibleIntents.length, 'intents');

  const handleRemoveIntent = async (intent: Intent) => {
    try {
      setRemovingIntentIds(prev => new Set(prev).add(intent.id));

      const response = await fetch(`/api/intents/${intent.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Failed to remove intent');

      setRemovedIntentIds(prev => new Set(prev).add(intent.id));
    } catch (error) {
      console.error('Error removing intent:', error);
      alert('Failed to remove intent. Please try again.');
    } finally {
      setRemovingIntentIds(prev => {
        const next = new Set(prev);
        next.delete(intent.id);
        return next;
      });
    }
  };

  if (!data || visibleIntents.length === 0) {
    return (
      <div className="chatgpt-widget-root">
        <div className="chatgpt-empty">
          {removedIntentIds.size > 0
            ? 'All intents have been removed.'
            : 'No intents detected.'}
        </div>
      </div>
    );
  }

  const { filesProcessed = 0, linksProcessed = 0, intentsGenerated } = data;

  return (
    <div className="chatgpt-widget-root">
      {(filesProcessed > 0 || linksProcessed > 0) && (
        <div className="chatgpt-summary">
          Generated {intentsGenerated} intent(s) from {filesProcessed} file(s) and {linksProcessed} link(s)
        </div>
      )}

      <IntentList
        intents={visibleIntents}
        isLoading={false}
        emptyMessage="No intents detected."
        onRemoveIntent={handleRemoveIntent}
        removingIntentIds={removingIntentIds}
      />
    </div>
  );
}
