import { useState } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';

export type ConnectionAction = 'REQUEST' | 'SKIP' | 'ACCEPT' | 'DECLINE' | 'CANCEL';
export type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped';

interface ConnectionActionsProps {
  userId: string;
  connectionStatus: ConnectionStatus;
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
  disabled?: boolean;
}

export function ConnectionActions({
  userId,
  connectionStatus,
  onAction,
  disabled = false,
}: ConnectionActionsProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleAction = async (action: ConnectionAction) => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    try {
      await onAction(action, userId);
    } catch (err) {
      console.error('Connection action failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  switch (connectionStatus) {
    case 'none':
    case 'declined':
    case 'skipped':
      return (
        <div className="flex items-center gap-2">
          <Button
            variant="solid"
            color="primary"
            size="sm"
            onClick={() => handleAction('REQUEST')}
            disabled={disabled || isLoading}
          >
            Connect
          </Button>
          <Button
            variant="soft"
            color="secondary"
            size="sm"
            onClick={() => handleAction('SKIP')}
            disabled={disabled || isLoading}
          >
            Skip
          </Button>
        </div>
      );

    case 'pending_sent':
      return (
        <div className="flex items-center gap-2">
          <Button
            variant="soft"
            color="secondary"
            size="sm"
            onClick={() => handleAction('CANCEL')}
            disabled={disabled || isLoading}
          >
            Cancel Request
          </Button>
        </div>
      );

    case 'pending_received':
      return (
        <div className="flex items-center gap-2">
          <Button
            variant="solid"
            color="primary"
            size="sm"
            onClick={() => handleAction('ACCEPT')}
            disabled={disabled || isLoading}
          >
            Accept
          </Button>
          <Button
            variant="soft"
            color="secondary"
            size="sm"
            onClick={() => handleAction('DECLINE')}
            disabled={disabled || isLoading}
          >
            Decline
          </Button>
        </div>
      );

    case 'connected':
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-secondary">
          Connected
        </div>
      );

    default:
      return null;
  }
}

