export function useWidgetProps<T>(defaults: T): T {
  return (window as any).openai?.toolOutput || defaults;
}

