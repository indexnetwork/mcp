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
    <div style={{
      padding: 0,
      marginTop: 0,
      background: '#FFFFFF',
      border: '1px solid #1F2937',
      borderBottomWidth: '2px',
      marginBottom: '1rem',
    }}>
      <div style={{ padding: '1rem 0.5rem' }}>
        {/* User Header */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1rem',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            width: '100%',
            marginBottom: '0.5rem',
          }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user.name}
                style={{
                  borderRadius: '50%',
                  width: '3rem',
                  height: '3rem',
                }}
              />
            ) : (
              <div style={{
                borderRadius: '50%',
                width: '3rem',
                height: '3rem',
                background: '#E5E7EB',
              }} />
            )}
            <div>
              <h2 style={{
                fontWeight: 700,
                fontSize: '1.125rem',
                color: '#111827',
                fontFamily: '"IBM Plex Mono", monospace',
                margin: 0,
              }}>
                {user.name}
              </h2>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                fontSize: '0.875rem',
                color: '#6B7280',
                fontFamily: '"IBM Plex Mono", monospace',
              }}>
                {mutualIntentCount > 0
                  ? `${mutualIntentCount} mutual intent${mutualIntentCount !== 1 ? 's' : ''}`
                  : 'Potential connection'}
              </div>
            </div>
          </div>
        </div>

        {/* Synthesis Section */}
        {synthesis && (
          <div style={{ marginBottom: '0.5rem' }}>
            <h3 style={{
              fontWeight: 500,
              color: '#374151',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
            }}>
              What could happen here
            </h3>
            <SynthesisText content={synthesis} />
          </div>
        )}
      </div>
    </div>
  );
}
