import type { MouseEventHandler } from 'react';
import ReactMarkdown from 'react-markdown';

interface SynthesisTextProps {
  content: string;
}

export function SynthesisText({ content }: SynthesisTextProps) {
  if (!content) {
    return null;
  }

  return (
    <div className="space-y-1">
      <ReactMarkdown
        components={{
          a: ({ node, href, children, ...props }) => {
            const url = href ?? '#';

            const handleClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
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
                className="text-link underline underline-offset-2 cursor-pointer hover:opacity-80"
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
