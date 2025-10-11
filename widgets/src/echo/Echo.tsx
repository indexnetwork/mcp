import { useEffect, useState } from 'react';
import { useWidgetProps } from '../use-widget-props';
import './echo.css';

interface EchoProps {
  message?: string;
}

export function Echo() {
  const props = useWidgetProps<EchoProps>({ message: '' });
  const [message, setMessage] = useState(props.message || '');

  useEffect(() => {
    // Listen for updates from ChatGPT
    const handleUpdate = () => {
      const toolOutput = (window as any).openai?.toolOutput;
      if (toolOutput?.message) {
        setMessage(toolOutput.message);
      }
    };

    // Initial render
    handleUpdate();

    // Listen for global updates
    window.addEventListener('openai:set_globals', handleUpdate);
    
    return () => {
      window.removeEventListener('openai:set_globals', handleUpdate);
    };
  }, []);

  return (
    <div className="card">
      <div className="icon">I</div>
      <div className="content">
        <div className="title">ECHO</div>
        <div className="message">{message}</div>
      </div>
    </div>
  );
}
