/**
 * Hook to access global context information from the ChatGPT host environment.
 * 
 * @param key - The global property key to retrieve
 * @returns The value of the global property or undefined if not available
 * 
 * Available global properties:
 * - `theme`: "light" | "dark" - Current theme
 * - `displayMode`: "pip" | "inline" | "fullscreen" - Widget display mode
 * - `locale`: string - User's locale (e.g., "en-US")
 * - `maxHeight`: number - Maximum height constraint for inline mode
 * 
 * @example
 * ```typescript
 * function ThemedWidget() {
 *   const theme = useOpenAiGlobal('theme');
 *   const displayMode = useOpenAiGlobal('displayMode');
 *   
 *   return (
 *     <div className={theme === 'dark' ? 'dark-theme' : 'light-theme'}>
 *       Displaying in {displayMode} mode
 *     </div>
 *   );
 * }
 * ```
 */
export function useOpenAiGlobal(key: string) {
  return (window as any).openai?.[key];
}

