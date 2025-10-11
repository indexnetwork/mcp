import { useState, useEffect } from 'react';

/**
 * Hook for managing persistent widget state that syncs bidirectionally with ChatGPT.
 * 
 * @template T - The type of the state object
 * @param initialState - Initial state values
 * @returns A tuple containing the current state and a function to update it
 * 
 * The state is automatically synchronized with ChatGPT:
 * - Incoming state updates from ChatGPT are applied to the widget
 * - Outgoing state changes from the widget are sent back to ChatGPT
 * 
 * @example
 * ```typescript
 * interface WidgetState {
 *   selectedItem: string;
 *   isExpanded: boolean;
 * }
 * 
 * function MyWidget() {
 *   const [state, setState] = useWidgetState<WidgetState>({
 *     selectedItem: '',
 *     isExpanded: false
 *   });
 *   
 *   const handleItemClick = (item: string) => {
 *     setState({ ...state, selectedItem: item });
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={() => setState({ ...state, isExpanded: !state.isExpanded })}>
 *         {state.isExpanded ? 'Collapse' : 'Expand'}
 *       </button>
 *       {state.selectedItem && <div>Selected: {state.selectedItem}</div>}
 *     </div>
 *   );
 * }
 * ```
 */
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

