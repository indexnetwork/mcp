/**
 * Widget Configuration
 * Single source of truth for widget metadata shared between tools and resources
 */

export type WidgetKey = 'intent-display' | 'discover-connections';

export interface WidgetConfig {
  key: WidgetKey;
  fileName: string; // Bundle filename (matches vite entry key)
  uri: string; // Resource URI
  title: string; // Human-readable name for ListResources
  description: string; // Widget description
  toolMeta: {
    outputTemplate: string; // Same as uri
    invoking: string; // Tool invocation message
    invoked: string; // Tool invoked message
    widgetAccessible: boolean;
    resultCanProduceWidget: boolean;
  };
  resourceMeta?: {
    // Resource-specific metadata (if any)
    // Currently all widgets use tool-level metadata only
  };
}

export const WIDGETS: Record<WidgetKey, WidgetConfig> = {
  'intent-display': {
    key: 'intent-display',
    fileName: 'intent-display',
    uri: 'ui://widget/intent-display.html',
    title: 'IntentDisplay Widget',
    description: 'Displays extracted intents with archive/delete actions',
    toolMeta: {
      outputTemplate: 'ui://widget/intent-display.html',
      invoking: 'Extracting intents...',
      invoked: 'Intents extracted',
      widgetAccessible: true,
      resultCanProduceWidget: true,
    },
  },
  'discover-connections': {
    key: 'discover-connections',
    fileName: 'discover-connections',
    uri: 'ui://widget/discover-connections.html',
    title: 'DiscoverConnections Widget',
    description: 'Displays discovered connections with synthesis summaries',
    toolMeta: {
      outputTemplate: 'ui://widget/discover-connections.html',
      invoking: 'Finding potential connections...',
      invoked: 'Found potential connections',
      widgetAccessible: true,
      resultCanProduceWidget: true,
    },
  },
};
