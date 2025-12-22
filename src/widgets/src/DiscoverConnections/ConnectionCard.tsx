import { Avatar } from '@openai/apps-sdk-ui/components/Avatar';
import { SynthesisText } from './SynthesisText';
import { ConnectionActions, type ConnectionAction, type ConnectionStatus } from './ConnectionActions';

interface ConnectionCardProps {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  mutualIntentCount: number;
  synthesis: string;
  connectionStatus: ConnectionStatus;
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
}

export function ConnectionCard({ user, mutualIntentCount, synthesis, connectionStatus, onAction }: ConnectionCardProps) {
  const avatarUrl = user.avatar ?? '';

  return (
    <div className="w-full rounded-2xl border border-default bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <Avatar imageUrl={avatarUrl} name={user.name} size={40} />
          ) : (
            <Avatar name={user.name} size={40} />
          )}
          <div>
            <h2 className="font-semibold">{user.name}</h2>
            <p className="text-sm text-secondary">
              {mutualIntentCount > 0
                ? `${mutualIntentCount} mutual intent${mutualIntentCount !== 1 ? 's' : ''}`
                : 'Potential connection'}
            </p>
          </div>
        </div>
        <ConnectionActions
          userId={user.id}
          connectionStatus={connectionStatus}
          onAction={onAction}
        />
      </div>

      {synthesis && (
        <div className="mt-3 border-t border-subtle pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-secondary">
            What could happen here
          </p>
          <SynthesisText content={synthesis} />
        </div>
      )}
    </div>
  );
}
