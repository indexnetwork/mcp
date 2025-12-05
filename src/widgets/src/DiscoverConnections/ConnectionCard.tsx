import React from 'react';
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
    <div className="chatgpt-card">
      <div className="chatgpt-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user.name}
              style={{
                borderRadius: '50%',
                width: '2.5rem',
                height: '2.5rem',
              }}
            />
          ) : (
            <div style={{
              borderRadius: '50%',
              width: '2.5rem',
              height: '2.5rem',
              background: 'var(--chatgpt-pill-bg)',
            }} />
          )}
          <div>
            <div className="chatgpt-card-title">{user.name}</div>
            <div className="chatgpt-card-subtitle">
              {mutualIntentCount > 0
                ? `${mutualIntentCount} mutual intent${mutualIntentCount !== 1 ? 's' : ''}`
                : 'Potential connection'}
            </div>
          </div>
        </div>
      </div>

      {synthesis && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="chatgpt-card-subtitle" style={{ marginBottom: '0.5rem' }}>
            What could happen here
          </div>
          <SynthesisText content={synthesis} />
        </div>
      )}
    </div>
  );
}
