'use client';

import { useMemo } from 'react';

interface BaseIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: 'file' | 'link' | 'integration';
  sourceId?: string;
  sourceName?: string;
  sourceValue?: string | null;
  sourceMeta?: string | null;
}

interface IntentListProps<T extends BaseIntent> {
  intents: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  onArchiveIntent?: (intent: T) => void;
  onRemoveIntent?: (intent: T) => void;
  onOpenIntentSource?: (intent: T) => void;
  newIntentIds?: Set<string>;
  selectedIntentIds?: Set<string>;
  removingIntentIds?: Set<string>;
  className?: string;
}

export default function IntentList<T extends BaseIntent>({
  intents,
  isLoading = false,
  emptyMessage = 'No intents yet',
  onArchiveIntent,
  onRemoveIntent,
  onOpenIntentSource,
  newIntentIds = new Set(),
  selectedIntentIds = new Set(),
  removingIntentIds = new Set(),
  className = '',
}: IntentListProps<T>) {
  // Keep intents in the order they were provided (Protocol API order)
  const sortedIntents = useMemo(() => {
    return [...intents];
  }, [intents]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-6 ${className}`}>
        <span className="h-6 w-6 border-2 border-[#CCCCCC] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (sortedIntents.length === 0) {
    return (
      <div className={`text-xs text-[#666] font-ibm-plex-mono py-4 text-center ${className}`}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {sortedIntents.map((intent) => {
        const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
        const createdAt = new Date(intent.createdAt);
        const createdLabel = Number.isNaN(createdAt.getTime()) ? null : createdAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        const isFresh = newIntentIds.has(intent.id);
        const isSelectedSource = selectedIntentIds.has(intent.id);
        const canOpenSource = intent.sourceType === 'link' && intent.sourceValue && /^https?:/i.test(intent.sourceValue);

        return (
          <div key={intent.id} className="chatgpt-card">
            <div className="chatgpt-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {createdLabel && (
                  <span className="chatgpt-pill" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {createdLabel}
                  </span>
                )}
                {isFresh && !isSelectedSource && (
                  <span className="chatgpt-pill" style={{ backgroundColor: '#0A8F5A', color: '#fff' }}>New</span>
                )}
              </div>
            </div>
            <div className="chatgpt-card-title">{summary}</div>
          </div>
        );
      })}
    </div>
  );
}
