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

(window as any).__renderIndexDiscover = render;

window.addEventListener('message', (event) => {
  if (event?.data?.type === 'index-discover/render') {
    render(event.data.payload);
  }
});
