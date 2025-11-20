/**
 * Widget Configuration
 * Single source of truth for widget metadata shared between tools and resources
 */

export type WidgetKey = 'echo' | 'list-view' | 'intent-display' | 'discover-connections';

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
  echo: {
    key: 'echo',
    fileName: 'echo',
    uri: 'ui://widget/echo.html',
    title: 'Echo Widget',
    description: 'Simple echo widget that displays text',
    toolMeta: {
      outputTemplate: 'ui://widget/echo.html',
      invoking: 'Echoing...',
      invoked: 'Echo complete',
      widgetAccessible: true,
      resultCanProduceWidget: true,
    },
  },
  'list-view': {
    key: 'list-view',
    fileName: 'list-view',
    uri: 'ui://widget/list-view.html',
    title: 'ListView Widget',
    description: 'Interactive list view with actions',
    toolMeta: {
      outputTemplate: 'ui://widget/list-view.html',
      invoking: 'Loading items...',
      invoked: 'Items loaded',
      widgetAccessible: true,
      resultCanProduceWidget: true,
    },
  },
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
