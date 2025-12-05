'use client';

import { useMemo } from 'react';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Calendar } from '@openai/apps-sdk-ui/components/Icon';
import { LoadingIndicator } from '@openai/apps-sdk-ui/components/Indicator';

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
        <LoadingIndicator size={24} />
      </div>
    );
  }

  if (sortedIntents.length === 0) {
    return (
      <div className={`py-4 text-center text-sm text-secondary ${className}`}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {sortedIntents.map((intent) => {
        const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
        const createdAt = new Date(intent.createdAt);
        const createdLabel = Number.isNaN(createdAt.getTime()) ? null : createdAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        const isFresh = newIntentIds.has(intent.id);
        const isSelectedSource = selectedIntentIds.has(intent.id);

        return (
          <div
            key={intent.id}
            className="w-full rounded-2xl border border-default bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                {createdLabel && (
                  <Badge variant="soft" color="secondary" size="sm">
                    <Calendar className="size-3" />
                    <span className="ml-1">{createdLabel}</span>
                  </Badge>
                )}
                {isFresh && !isSelectedSource && (
                  <Badge variant="soft" color="success" size="sm">
                    New
                  </Badge>
                )}
              </div>
            </div>
            <p className="mt-2">{summary}</p>
          </div>
        );
      })}
    </div>
  );
}
