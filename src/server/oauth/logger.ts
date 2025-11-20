/**
 * Structured logging helper for OAuth events
 * Outputs JSON for easy parsing and grepping
 */

export function logAuthEvent(event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({
    type: 'auth_event',
    event,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}
