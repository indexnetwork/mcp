import "./styles.css";

type WidgetCard = {
  header?: { title?: string; badge?: string };
  body?: { context?: string; stats?: Array<{ label: string; value: string | number }>; vibecheck?: string };
  actions?: Array<{ label: string; hint?: string }>;
};

type WidgetPayload = {
  summary?: string;
  cards?: WidgetCard[];
};

const summaryEl = document.getElementById('discover-summary');
const cardsEl = document.getElementById('discover-cards');

function render(payload?: WidgetPayload | null) {
  if (!summaryEl || !cardsEl) return;
  if (!payload) {
    summaryEl.textContent = 'Waiting for discovery data…';
    cardsEl.innerHTML = '';
    return;
  }

  summaryEl.textContent = payload.summary ?? '';
  cardsEl.innerHTML = '';

  (payload.cards ?? []).forEach((card) => {
    const section = document.createElement('section');
    section.className = 'card';

    const header = document.createElement('header');
    header.className = 'card-header';

    const title = document.createElement('h3');
    title.textContent = card.header?.title ?? 'Unknown collaborator';
    header.appendChild(title);

    if (card.header?.badge) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = card.header.badge;
      header.appendChild(badge);
    }

    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'card-body';

    if (card.body?.context) {
      const context = document.createElement('p');
      context.textContent = card.body.context;
      body.appendChild(context);
    }

    if (card.body?.stats?.length) {
      const list = document.createElement('ul');
      card.body.stats.forEach((stat) => {
        const li = document.createElement('li');
        li.textContent = `${stat.label}: ${stat.value}`;
        list.appendChild(li);
      });
      body.appendChild(list);
    }

    if (card.body?.vibecheck) {
      const vibe = document.createElement('p');
      vibe.className = 'vibecheck';
      vibe.textContent = card.body.vibecheck;
      body.appendChild(vibe);
    }

    section.appendChild(body);
    cardsEl.appendChild(section);
  });
}

// Function to load data from window.openai
function loadData() {
  const openai = (window as any).openai;

  // Debug logging
  console.log('[Discover Widget] window.openai available properties:', Object.keys(openai || {}));
  console.log('[Discover Widget] toolOutput:', openai?.toolOutput);
  console.log('[Discover Widget] toolInput:', openai?.toolInput);
  console.log('[Discover Widget] toolResponseMetadata:', openai?.toolResponseMetadata);

  // Try all possible data sources - toolOutput is the structured response
  const data = openai?.toolOutput ||
               openai?.toolOutput?.structuredContent ||
               openai?.toolOutput?.result?.structuredContent ||
               openai?.toolOutput?.result ||
               openai?.toolResponseMetadata?.structuredContent ||
               null;

  console.log('[Discover Widget] Extracted data:', data);
  console.log('[Discover Widget] Has summary?', !!data?.summary);
  console.log('[Discover Widget] Has cards?', !!data?.cards);

  if (data && (data.summary || data.cards)) {
    console.log('[Discover Widget] Rendering with data');
    render(data);
  } else {
    console.log('[Discover Widget] No valid data found');
    render(null);
  }
}

// Try to load immediately
loadData();

// Listen for the openai:set_globals event in case data arrives later
window.addEventListener('openai:set_globals', () => {
  console.log('[Discover Widget] openai:set_globals event fired');
  loadData();
});

// Keep the legacy message listener for backwards compatibility
window.addEventListener('message', (event) => {
  if (event?.data?.type === 'index-discover/render') {
    render(event.data.payload);
  }
});

// Expose render function for debugging
(window as any).__renderIndexDiscover = render;
