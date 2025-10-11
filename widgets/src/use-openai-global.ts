export function useOpenAiGlobal(key: string) {
  return (window as any).openai?.[key];
}

