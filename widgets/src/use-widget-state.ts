import { useState, useEffect } from 'react';

export function useWidgetState<T>(initialState: T): [T, (newState: T) => void] {
  const [state, setState] = useState<T>(initialState);
  
  useEffect(() => {
    const handleStateUpdate = (event: CustomEvent) => {
      if (event.detail?.state) setState(event.detail.state);
    };
    window.addEventListener('openai:set_globals', handleStateUpdate as EventListener);
    return () => window.removeEventListener('openai:set_globals', handleStateUpdate as EventListener);
  }, []);

  const updateState = (newState: T) => {
    setState(newState);
    // Sync state back to ChatGPT
    if ((window as any).openai?.setWidgetState) {
      (window as any).openai.setWidgetState(newState);
    }
  };

  return [state, updateState];
}

