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
    <div className="chatgpt-markdown">
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
                style={{ cursor: 'pointer' }}
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
