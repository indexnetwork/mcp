import React from 'react';
import ReactMarkdown from 'react-markdown';

interface SynthesisTextProps {
  content: string;
}

export function SynthesisText({ content }: SynthesisTextProps) {
  if (!content) {
    return null;
  }

  return (
    <div style={{
      color: '#374151',
      fontSize: '0.875rem',
      lineHeight: 1.625,
    }}>
      <ReactMarkdown
        components={{
          a: ({ node, href, children, ...props }) => {
            const url = href ?? '#';

            const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
              e.preventDefault();
              try {
                (window as any).openai?.openExternal?.({ href: url });
              } catch {
                // ignore
              }
            };

            return (
              <a
                {...props}
                href={url}
                onClick={handleClick}
                style={{
                  color: '#007EFF',
                  fontWeight: 500,
                  padding: '0.125rem',
                  margin: '-0.125rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  background: '#edf5ff',
                  textDecoration: 'none',
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
