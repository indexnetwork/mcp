import { useWidgetProps } from '../use-widget-props';
import { useOpenAiGlobal } from '../use-openai-global';
import './echo.css';

interface EchoProps {
  message?: string;
}

export function Echo() {
  const props = useWidgetProps<EchoProps>({ message: '' });
  const theme = useOpenAiGlobal('theme');
  const displayMode = useOpenAiGlobal('displayMode');
  const maxHeight = useOpenAiGlobal('maxHeight');

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
        <div className="message">{props.message || ''}</div>
      </div>
    </div>
  );
}
