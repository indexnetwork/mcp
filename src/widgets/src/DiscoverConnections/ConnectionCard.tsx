import { Avatar } from '@openai/apps-sdk-ui/components/Avatar';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Members } from '@openai/apps-sdk-ui/components/Icon';
import { SynthesisText } from './SynthesisText';

interface ConnectionCardProps {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  mutualIntentCount: number;
  synthesis: string;
}

export function ConnectionCard({ user, mutualIntentCount, synthesis }: ConnectionCardProps) {
  const avatarUrl = user.avatar ?? '';

  return (
    <div className="w-full rounded-2xl border border-default bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
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
        {mutualIntentCount > 0 && (
          <Badge variant="soft" color="secondary" size="sm">
            <Members className="size-3" />
            <span className="ml-1">{mutualIntentCount}</span>
          </Badge>
        )}
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
