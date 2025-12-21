/**
 * Widget Configuration
 * Single source of truth for widget metadata shared between tools and resources
 */

import { config } from '../config.js';

export type WidgetKey = 'discover-connections';

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
    'openai/widgetDescription'?: string; // Model-only guidance to reduce redundant narration
    'openai/widgetCSP'?: {
      connect_domains: string[];
      resource_domains: string[];
    };
    'openai/widgetDomain'?: string;
    'openai/widgetPrefersBorder'?: boolean;
  };
}

export const WIDGETS: Record<WidgetKey, WidgetConfig> = {
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
    resourceMeta: {
      'openai/widgetDescription': 'This widget fully renders the discovered connections and their summaries. Do not repeat or re-list the connections in your follow-up message. Instead, respond with one very short sentence suggesting what the user could do next with these connections.',
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: [config.server.baseUrl],
      },
      'openai/widgetDomain': 'https://chatgpt.com',
      'openai/widgetPrefersBorder': false,
    },
  },
};
