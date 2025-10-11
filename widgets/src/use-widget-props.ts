/**
 * Hook to access structured data passed from the MCP server tool response.
 * 
 * @template T - The type of props expected from the tool output
 * @param defaults - Default values to use if no tool output is available
 * @returns The tool output data or the provided defaults
 * 
 * @example
 * ```typescript
 * interface MyProps {
 *   message: string;
 *   count: number;
 * }
 * 
 * function MyWidget() {
 *   const props = useWidgetProps<MyProps>({ message: '', count: 0 });
 *   return <div>{props.message}</div>;
 * }
 * ```
 */
export function useWidgetProps<T>(defaults: T): T {
  const openai = (window as any).openai;
  
  return openai?.toolOutput?.structuredContent || 
         openai?.toolOutput?.result?.structuredContent || 
         openai?.toolOutput?.result || 
         defaults;
}

