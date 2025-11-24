import { useOpenAiGlobal } from '../use-openai-global';
import './echo.css';

// Helper hook to get tool output (similar to official SDK)
function useToolOutput() {
  return useOpenAiGlobal('toolOutput');
}

export function Echo() {
  const toolOutput = useToolOutput();
  const theme = useOpenAiGlobal('theme');
  const displayMode = useOpenAiGlobal('displayMode');
  const maxHeight = useOpenAiGlobal('maxHeight');

  // Debug logging - check all possible data sources
  const openai = (window as any).openai;
  console.log('[Echo Widget] toolOutput:', toolOutput);
  console.log('[Echo Widget] toolInput:', openai?.toolInput);
  console.log('[Echo Widget] toolResponseMetadata:', openai?.toolResponseMetadata);
  console.log('[Echo Widget] widget:', openai?.widget);
  console.log('[Echo Widget] widgetState:', openai?.widgetState);

  // Extract message from all possible locations
  const message = toolOutput?.structuredContent?.message ||
                  toolOutput?.result?.structuredContent?.message ||
                  toolOutput?.result?.message ||
                  openai?.toolResponseMetadata?.structuredContent?.message ||
                  openai?.widget?.structuredContent?.message ||
                  openai?.toolInput?.message ||
                  '';

  console.log('[Echo Widget] Final message:', message);

  return (
    <div
      className={`card ${theme === 'dark' ? 'dark' : ''} ${displayMode || 'inline'}`}
      style={{
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflow: maxHeight ? 'auto' : undefined
      }}
    >
      <div className="icon">I</div>
      <div className="content">
        <div className="title">ECHO</div>
        <div className="message">{message || 'No message received'}</div>
      </div>
    </div>
  );
}
