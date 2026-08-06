'use strict';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  cards:    [],
  cardById: new Map(),
  filtered: [],
  deck: {
    name:      'My Deck',
    houseCard: null,   // card object
    agenda:    null,   // card object
    draw:      {},     // id -> count
    plots:     {},     // id -> count
  },
};

const DRAW_TYPES  = ['Character', 'Location', 'Attachment', 'Event'];
const TYPE_ORDER  = ['Character', 'Location', 'Attachment', 'Event'];
const TYPE_ABBR   = { Character: 'Char', Location: 'Loc', Attachment: 'Att', Event: 'Evt', Plot: 'Plot', 'House Card': 'House', Agenda: 'Agenda', Title: 'Title' };

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const res = await fetch('cards.json');
  if (!res.ok) { document.body.textContent = 'Error loading cards.json'; return; }
  state.cards = await res.json();
  state.cards.forEach(c => state.cardById.set(c.id, c));

  // Populate set filter
  const sets = [...new Set(state.cards.map(c => c.set).filter(Boolean))].sort();
  const setEl = document.getElementById('filter-set');
  sets.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; setEl.appendChild(o); });

  // Filters
  ['filter-house', 'filter-type', 'filter-set'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // Deck actions
  document.getElementById('slot-house-x').addEventListener('click',  () => { state.deck.houseCard = null; syncDeck(); });
  document.getElementById('slot-agenda-x').addEventListener('click', () => { state.deck.agenda    = null; syncDeck(); });
  document.getElementById('btn-clear').addEventListener('click',  clearDeck);
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('file-import').addEventListener('change', importJSON);

  // Card list: event delegation
  const list = document.getElementById('card-list');
  list.addEventListener('click', e => {
    const btn = e.target.closest('.add-btn');
    if (!btn) return;
    const row = btn.closest('.card-row');
    const card = state.cardById.get(row?.dataset.id);
    if (card) addCard(card);
  });
  list.addEventListener('mouseover', e => {
    const row = e.target.closest('.card-row');
    const card = state.cardById.get(row?.dataset.id);
    if (card) showTip(card, e);
  });
  list.addEventListener('mouseout',  e => { if (!e.target.closest('.card-row')) return; hideTip(); });
  list.addEventListener('mousemove', moveTip);

  // Deck panel: event delegation
  const panel = document.getElementById('deck-panel');
  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, section } = btn.dataset;
    const card = state.cardById.get(id);
    if (!card) return;
    if (action === 'add') addCard(card);
    if (action === 'dec') decCard(card, section);
  });
  panel.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tipid]');
    const card = state.cardById.get(el?.dataset.tipid);
    if (card) showTip(card, e);
  });
  panel.addEventListener('mouseout',  e => { if (!e.target.closest('[data-tipid]')) return; hideTip(); });
  panel.addEventListener('mousemove', moveTip);

  // Deck name sync
  document.getElementById('deck-name').addEventListener('input', e => { state.deck.name = e.target.value; });

  applyFilters();
  renderDeck();
}

// ── Filters ──────────────────────────────────────────────────────────────────

function applyFilters() {
  const house  = document.getElementById('filter-house').value;
  const type   = document.getElementById('filter-type').value;
  const set    = document.getElementById('filter-set').value;
  const search = document.getElementById('filter-search').value.toLowerCase().trim();

  state.filtered = state.cards.filter(c => {
    if (type   && c.type !== type) return false;
    if (set    && c.set  !== set)  return false;
    if (search && !c.name.toLowerCase().includes(search)) return false;
    if (house) {
      if (house === 'Neutral') {
        if (!c.houses.includes('Neutral')) return false;
      } else {
        // show selected house + Neutral + multi-house containing it
        if (!c.houses.includes(house) && !c.houses.includes('Neutral')) return false;
      }
    }
    return true;
  });

  document.getElementById('result-count').textContent = `${state.filtered.length} cards`;
  renderCardList();
}

// ── Card list rendering ───────────────────────────────────────────────────────

function renderCardList() {
  const list = document.getElementById('card-list');
  const frag = document.createDocumentFragment();

  state.filtered.forEach(card => {
    const inDeck  = countInDeck(card);
    const atMax   = inDeck >= maxCopies(card);
    const isPlot  = card.type === 'Plot';
    const plotFull = isPlot && totalPlots() >= 7 && !state.deck.plots[card.id];

    const row = document.createElement('div');
    row.className = 'card-row' + (inDeck > 0 ? ' in-deck' : '');
    row.dataset.id = card.id;

    // Add button
    const btn = document.createElement('button');
    btn.className = 'add-btn';
    btn.textContent = '+';
    btn.disabled = atMax || plotFull;
    btn.title = atMax ? 'Limit reached' : plotFull ? 'Plot deck full (7/7)' : 'Add to deck';
    row.appendChild(btn);

    // Name
    const nm = document.createElement('span');
    nm.className = 'card-name' + (card.unique ? ' unique' : '');
    nm.textContent = card.name;
    row.appendChild(nm);

    // Type badge (+ set label when multiple versions of same card exist)
    const tb = document.createElement('span');
    tb.className = 'type-badge';
    tb.textContent = (TYPE_ABBR[card.type] || card.type)
      + (card.multi ? '  ' + setShort(card.set) : '');
    row.appendChild(tb);

    // Stats
    const st = document.createElement('span');
    st.className = 'card-stats';
    st.innerHTML = statsHTML(card);
    row.appendChild(st);

    // In-deck count
    const cb = document.createElement('span');
    cb.className = 'count-badge';
    cb.textContent = inDeck > 0 ? `×${inDeck}` : '';
    row.appendChild(cb);

    frag.appendChild(row);
  });

  list.replaceChildren(frag);
}

function setShort(set) {
  // "01_Core Set" → "#1", "10_King's Landing" → "#10", "A Change of Seasons" → "ACS"
  const m = set.match(/^(\d+)/);
  if (m) return '#' + parseInt(m[1], 10);
  return set.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4);
}

function statsHTML(c) {
  if (c.type === 'Character') {
    const icons = [
      c.military ? '<span class="icon-m">⚔</span>' : '',
      c.intrigue ? '<span class="icon-i">👁</span>' : '',
      c.power    ? '<span class="icon-p">☀</span>' : '',
    ].join('');
    return `${c.cost ?? '—'}g ${c.strength ?? '—'}str ${icons}`;
  }
  if (c.type === 'Plot') return `${c.plot_income ?? 0}/${c.plot_init ?? 0}/${c.plot_claim ?? 0}`;
  if (c.cost != null) return `${c.cost}g`;
  return '';
}

// ── Deck logic ────────────────────────────────────────────────────────────────

function countInDeck(card) {
  if (card.type === 'House Card') return state.deck.houseCard?.id === card.id ? 1 : 0;
  if (card.type === 'Agenda')     return state.deck.agenda?.id    === card.id ? 1 : 0;
  if (card.type === 'Plot')       return state.deck.plots[card.id] || 0;
  return state.deck.draw[card.id] || 0;
}

function maxCopies(card) {
  if (card.type === 'House Card' || card.type === 'Agenda') return 1;
  if (card.type === 'Plot')  return card.unique ? 1 : 2;
  return card.unique ? 1 : 3;
}

function totalPlots() { return Object.values(state.deck.plots).reduce((s, n) => s + n, 0); }
function totalDraw()  { return Object.values(state.deck.draw ).reduce((s, n) => s + n, 0); }

function addCard(card) {
  const cur = countInDeck(card);
  const max = maxCopies(card);
  if (cur >= max) return;

  if (card.type === 'House Card') { state.deck.houseCard = card; }
  else if (card.type === 'Agenda') { state.deck.agenda = card; }
  else if (card.type === 'Plot') {
    if (totalPlots() >= 7) return;
    state.deck.plots[card.id] = (state.deck.plots[card.id] || 0) + 1;
  } else if (DRAW_TYPES.includes(card.type)) {
    state.deck.draw[card.id] = (state.deck.draw[card.id] || 0) + 1;
  } else return;

  syncDeck();
}

function decCard(card, section) {
  if (section === 'draw') {
    if (!state.deck.draw[card.id]) return;
    state.deck.draw[card.id]--;
    if (state.deck.draw[card.id] === 0) delete state.deck.draw[card.id];
  } else if (section === 'plots') {
    if (!state.deck.plots[card.id]) return;
    state.deck.plots[card.id]--;
    if (state.deck.plots[card.id] === 0) delete state.deck.plots[card.id];
  }
  syncDeck();
}

function clearDeck() {
  if (!confirm('Clear the deck?')) return;
  state.deck.houseCard = null;
  state.deck.agenda    = null;
  state.deck.draw      = {};
  state.deck.plots     = {};
  syncDeck();
}

// syncDeck = re-render card list + deck panel
function syncDeck() {
  renderCardList();
  renderDeck();
}

// ── Deck panel rendering ──────────────────────────────────────────────────────

function renderDeck() {
  // Slots
  setSlot('house', state.deck.houseCard);
  setSlot('agenda', state.deck.agenda);

  // Draw deck
  const drawTotal = totalDraw();
  document.getElementById('draw-total').textContent = drawTotal;

  // Breakdown by type
  const grouped = {};
  TYPE_ORDER.forEach(t => { grouped[t] = []; });
  Object.entries(state.deck.draw).forEach(([id, count]) => {
    const card = state.cardById.get(id);
    if (!card) return;
    if (!grouped[card.type]) grouped[card.type] = [];
    grouped[card.type].push({ card, count });
  });

  const parts = TYPE_ORDER
    .filter(t => (grouped[t] || []).length > 0)
    .map(t => {
      const n = (grouped[t] || []).reduce((s, e) => s + e.count, 0);
      return `${TYPE_ABBR[t]}:${n}`;
    });
  document.getElementById('draw-breakdown').textContent = parts.length ? `(${parts.join('  ')})` : '';

  const drawEl = document.getElementById('deck-draw');
  const dfrag  = document.createDocumentFragment();
  TYPE_ORDER.forEach(type => {
    const entries = (grouped[type] || []).sort((a, b) => a.card.name.localeCompare(b.card.name));
    if (!entries.length) return;
    const grp = document.createElement('div');
    grp.className = 'dk-group';
    grp.textContent = `${type} (${entries.reduce((s, e) => s + e.count, 0)})`;
    dfrag.appendChild(grp);
    entries.forEach(({ card, count }) => dfrag.appendChild(makeDkRow(card, count, 'draw')));
  });
  drawEl.replaceChildren(dfrag);

  // Plots
  const plotsTotal = totalPlots();
  document.getElementById('plots-total').textContent = plotsTotal;

  const plotsEl = document.getElementById('deck-plots');
  const pfrag   = document.createDocumentFragment();
  Object.entries(state.deck.plots)
    .map(([id, count]) => ({ card: state.cardById.get(id), count }))
    .filter(e => e.card)
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .forEach(({ card, count }) => pfrag.appendChild(makeDkRow(card, count, 'plots')));
  plotsEl.replaceChildren(pfrag);
}

function setSlot(which, card) {
  const val = document.getElementById(`slot-${which}-val`);
  const btn = document.getElementById(`slot-${which}-x`);
  if (card) {
    val.textContent = card.name;
    val.className = 'slot-filled';
    btn.classList.remove('hidden');
  } else {
    val.textContent = '— not selected';
    val.className = 'slot-empty';
    btn.classList.add('hidden');
  }
}

function makeDkRow(card, count, section) {
  const row  = document.createElement('div');
  row.className = 'dk-row';

  const cnt = document.createElement('span');
  cnt.className = 'dk-count';
  cnt.textContent = `×${count}`;

  const nm = document.createElement('span');
  nm.className = 'dk-name' + (card.unique ? ' unique' : '');
  nm.textContent = card.name;
  nm.dataset.tipid = card.id;

  const atMax    = count >= maxCopies(card);
  const plotFull = section === 'plots' && totalPlots() >= 7 && count < maxCopies(card);

  const minusBtn = document.createElement('button');
  minusBtn.className = 'dk-btn rm';
  minusBtn.textContent = '−';
  minusBtn.dataset.action  = 'dec';
  minusBtn.dataset.id      = card.id;
  minusBtn.dataset.section = section;

  const plusBtn = document.createElement('button');
  plusBtn.className = 'dk-btn';
  plusBtn.textContent = '+';
  plusBtn.dataset.action  = 'add';
  plusBtn.dataset.id      = card.id;
  plusBtn.dataset.section = section;
  plusBtn.disabled = atMax || plotFull;

  row.append(cnt, nm, minusBtn, plusBtn);
  return row;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const tip    = document.getElementById('tooltip');
const tipImg = document.getElementById('tooltip-img');

function showTip(card, e) {
  document.getElementById('tooltip-name').textContent = (card.unique ? '★ ' : '') + card.name;
  document.getElementById('tooltip-meta').textContent = [
    card.houses.join(' · '), card.type, card.traits
  ].filter(Boolean).join('  ·  ');

  let body = '';
  if (card.type === 'Character') {
    body += `Cost: ${card.cost ?? '—'}   STR: ${card.strength ?? '—'}\n`;
    const ic = [card.military && 'Military', card.intrigue && 'Intrigue', card.power && 'Power'].filter(Boolean);
    if (ic.length) body += `Icons: ${ic.join(', ')}\n`;
  } else if (card.type === 'Plot') {
    body += `Income: ${card.plot_income ?? 0}   Initiative: ${card.plot_init ?? 0}   Claim: ${card.plot_claim ?? 0}\n`;
  } else if (card.cost != null) {
    body += `Cost: ${card.cost}\n`;
  }
  if (card.keywords) body += `\nKeywords: ${card.keywords}\n`;
  if (card.text)     body += `\n${card.text}`;
  if (card.set)      body += `\n\n${card.set}`;
  document.getElementById('tooltip-text').textContent = body;

  if (card.img) {
    tipImg.src = card.img;
    tipImg.classList.remove('hide');
  } else {
    tipImg.classList.add('hide');
  }

  tip.classList.add('show');
  moveTip(e);
}

function moveTip(e) {
  if (!tip.classList.contains('show')) return;
  const W = window.innerWidth, H = window.innerHeight;
  const tw = tip.offsetWidth + 12, th = tip.offsetHeight + 12;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + tw > W) x = e.clientX - tw;
  if (y + th > H) y = e.clientY - th;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

function hideTip() { tip.classList.remove('show'); }

// ── Export / Import ───────────────────────────────────────────────────────────

function exportJSON() {
  const data = {
    name:       state.deck.name || 'My Deck',
    house:      state.deck.houseCard?.house || null,
    house_card: state.deck.houseCard?.id   || null,
    agenda:     state.deck.agenda?.id      || null,
    plots: Object.entries(state.deck.plots).map(([id, count]) => ({ id, count })),
    draw:  Object.entries(state.deck.draw ).map(([id, count]) => ({ id, count })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (state.deck.name || 'deck').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      state.deck.name      = data.name || 'Imported';
      state.deck.houseCard = data.house_card ? state.cardById.get(data.house_card) || null : null;
      state.deck.agenda    = data.agenda     ? state.cardById.get(data.agenda)     || null : null;
      state.deck.draw  = {};
      state.deck.plots = {};
      (data.draw  || []).forEach(({ id, count }) => { if (state.cardById.has(id)) state.deck.draw[id]  = count; });
      (data.plots || []).forEach(({ id, count }) => { if (state.cardById.has(id)) state.deck.plots[id] = count; });
      document.getElementById('deck-name').value = state.deck.name;
      syncDeck();
    } catch { alert('Invalid JSON file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
