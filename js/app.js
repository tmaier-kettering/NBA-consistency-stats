/**
 * NBA Consistency Stats — app.js
 * Interactive database viewer: filtering, sorting, tabs, tooltips, column filters.
 */

'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════ */

const DATA_URL = 'data/web/stats.json';

/** Tab definitions: id → { label, columns } */
const TABS = {
  scoring: {
    label: 'Scoring',
    columns: ['PTS', 'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3_PCT', 'FTM', 'FTA', 'FT_PCT'],
  },
  rebounds: {
    label: 'Rebounds',
    columns: ['OREB', 'DREB', 'REB'],
  },
  other: {
    label: 'Other',
    columns: ['MIN', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'PLUS_MINUS'],
  },
};

/** Human-readable column descriptions for header tooltips */
const COL_DESC = {
  PTS:        'Points per game — how consistently a player scores.',
  FGM:        'Field Goals Made per game — shot-making consistency.',
  FGA:        'Field Goal Attempts per game — usage/volume consistency.',
  FG_PCT:     'Field Goal Percentage — shooting-efficiency consistency.',
  FG3M:       '3-Point Field Goals Made per game — three-point production consistency.',
  FG3_PCT:    '3-Point Field Goal Percentage — three-point efficiency consistency.',
  FTM:        'Free Throws Made per game — free-throw scoring consistency.',
  FTA:        'Free Throw Attempts per game — free-throw frequency consistency.',
  FT_PCT:     'Free Throw Percentage — free-throw accuracy consistency.',
  OREB:       'Offensive Rebounds per game — offensive rebounding consistency.',
  DREB:       'Defensive Rebounds per game — defensive rebounding consistency.',
  REB:        'Total Rebounds per game — overall rebounding consistency.',
  MIN:        'Minutes Played per game — playing-time consistency.',
  AST:        'Assists per game — playmaking consistency.',
  STL:        'Steals per game — defensive disruption consistency.',
  BLK:        'Blocks per game — shot-blocking consistency.',
  TOV:        'Turnovers per game — ball-security (in)consistency.',
  PF:         'Personal Fouls per game — foul-tendency consistency.',
  PLUS_MINUS: 'Plus/Minus per game — on-court impact consistency.',
};

/** Friendly display names for columns */
const COL_LABEL = {
  PTS: 'PTS', FGM: 'FGM', FGA: 'FGA', FG_PCT: 'FG%',
  FG3M: '3PM', FG3_PCT: '3P%', FTM: 'FTM', FTA: 'FTA', FT_PCT: 'FT%',
  OREB: 'OREB', DREB: 'DREB', REB: 'REB',
  MIN: 'MIN', AST: 'AST', STL: 'STL', BLK: 'BLK',
  TOV: 'TOV', PF: 'PF', PLUS_MINUS: '+/-',
};


/* ══════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════ */

const state = {
  rawData:        null,          // full JSON payload
  seasons:        [],
  currentSeason:  '',
  seasonType:     'Regular Season',
  currentTab:     'scoring',

  playerFilter:   '',            // lower-cased search string
  gpMin:          0,
  gpMax:          82,

  columnFilters:  {},            // { statName: { min, max } } — persists across tabs

  sortColumn:     'name',        // 'name' | 'gp' | stat name
  sortDir:        'asc',         // 'asc' | 'desc'

  activeColFilterKey: null,      // which column the popover is open for
};

/* ══════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

const els = {
  seasonSelect:        $('seasonSelect'),
  btnRegular:          $('btnRegular'),
  btnPlayoffs:         $('btnPlayoffs'),
  playerSearch:        $('playerSearch'),
  acDropdown:          $('acDropdown'),
  gpMinInput:          $('gpMinInput'),
  gpMaxInput:          $('gpMaxInput'),
  gpMinSlider:         $('gpMinSlider'),
  gpMaxSlider:         $('gpMaxSlider'),
  dualRangeFill:       $('dualRangeFill'),
  colFilterSummaryGrp: $('colFilterSummaryGroup'),
  colFilterSummary:    $('colFilterSummary'),
  clearAllFilters:     $('clearAllFilters'),

  tabBtns:             document.querySelectorAll('.tab-btn'),
  rowCount:            $('rowCount'),

  tableLoading:        $('tableLoading'),
  tableEmpty:          $('tableEmpty'),
  statsTable:          $('statsTable'),
  tableHead:           $('tableHead'),
  tableBody:           $('tableBody'),
  tableScrollWrap:     $('tableScrollWrap'),

  headerTooltip:       $('headerTooltip'),
  cellTooltip:         $('cellTooltip'),

  colFilterPopover:    $('colFilterPopover'),
  cfpTitle:            $('colFilterPopoverTitle'),
  cfpMin:              $('cfpMin'),
  cfpMax:              $('cfpMax'),
  cfpRangeHint:        $('cfpRangeHint'),
  cfpApply:            $('cfpApply'),
  cfpClear:            $('cfpClear'),
  cfpClose:            $('cfpClose'),
  popoverBackdrop:     $('popoverBackdrop'),

  footerYear:          $('footerYear'),
};


/* ══════════════════════════════════════════════
   DATA LOADING
   ══════════════════════════════════════════════ */

async function loadData() {
  try {
    const res  = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.rawData = json;
    state.seasons = json.seasons || [];
    return true;
  } catch (err) {
    console.error('Failed to load data:', err);
    els.tableLoading.innerHTML =
      `<p style="color:#c9082a">Failed to load data. Please refresh the page.</p>`;
    return false;
  }
}

/** Return the player array for the current season + type, or [] */
function currentPlayers() {
  if (!state.rawData) return [];
  const key = `${state.currentSeason}|${state.seasonType}`;
  return state.rawData.data[key] || [];
}


/* ══════════════════════════════════════════════
   FILTERING
   ══════════════════════════════════════════════ */

function getFilteredData() {
  let players = currentPlayers();

  // Player name
  if (state.playerFilter) {
    const q = state.playerFilter;
    players = players.filter(p => p.name.toLowerCase().includes(q));
  }

  // Games played range
  players = players.filter(p => p.gp >= state.gpMin && p.gp <= state.gpMax);

  // Column CR filters (applied regardless of active tab)
  for (const [stat, { min, max }] of Object.entries(state.columnFilters)) {
    players = players.filter(p => {
      const s = p.stats[stat];
      if (!s) return false;
      const cr = s.cr;
      if (cr === null || cr === undefined) return false;
      if (min !== null && min !== '' && cr < min) return false;
      if (max !== null && max !== '' && cr > max) return false;
      return true;
    });
  }

  return players;
}


/* ══════════════════════════════════════════════
   SORTING
   ══════════════════════════════════════════════ */

function sortPlayers(players) {
  const { sortColumn, sortDir } = state;
  const mul = sortDir === 'asc' ? 1 : -1;

  return [...players].sort((a, b) => {
    let va, vb;
    if (sortColumn === 'name') {
      va = a.name; vb = b.name;
      return mul * va.localeCompare(vb);
    }
    if (sortColumn === 'gp') {
      va = a.gp ?? 0; vb = b.gp ?? 0;
    } else {
      const sa = a.stats[sortColumn]; const sb = b.stats[sortColumn];
      va = sa ? (sa.cr ?? -Infinity) : -Infinity;
      vb = sb ? (sb.cr ?? -Infinity) : -Infinity;
    }
    return mul * (va < vb ? -1 : va > vb ? 1 : 0);
  });
}


/* ══════════════════════════════════════════════
   COLOUR HEAT-MAP
   ══════════════════════════════════════════════ */

/** Build per-column min/max from the visible players (for colour scaling) */
function buildColRanges(players, columns) {
  const ranges = {};
  for (const col of columns) {
    let mn = Infinity, mx = -Infinity;
    for (const p of players) {
      const s = p.stats[col];
      if (s && s.cr !== null && s.cr !== undefined && s.cr >= 0) {
        if (s.cr < mn) mn = s.cr;
        if (s.cr > mx) mx = s.cr;
      }
    }
    ranges[col] = { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 1 : mx };
  }
  return ranges;
}

/** Return a CSS background colour string for a CR value based on column range */
function crColor(cr, range) {
  if (cr === null || cr === undefined) return null;  // use .cr-null class
  if (cr < 0) return null;  // use .cr-neg class
  const { min, max } = range;
  const span = max - min;
  const norm = span > 0 ? (cr - min) / span : 0.5;
  // Red(0°) → Yellow(45°) → Green(120°)
  const hue = Math.round(norm * 120);
  return `hsl(${hue}, 65%, 91%)`;
}


/* ══════════════════════════════════════════════
   TABLE RENDERING
   ══════════════════════════════════════════════ */

function renderTable() {
  const filtered = getFilteredData();
  const sorted   = sortPlayers(filtered);
  const columns  = TABS[state.currentTab].columns;
  const ranges   = buildColRanges(sorted, columns);

  renderHead(columns);
  renderBody(sorted, columns, ranges);

  // Row count
  const total = currentPlayers().length;
  els.rowCount.textContent =
    sorted.length === total
      ? `${total} players`
      : `${sorted.length} of ${total} players`;

  // Show/hide states
  els.tableLoading.hidden = true;
  els.tableEmpty.hidden   = sorted.length > 0;
  els.statsTable.hidden   = sorted.length === 0;
}

/* ── HEAD ── */
function renderHead(columns) {
  const { sortColumn, sortDir } = state;

  const makeTh = (key, label, isPlayer = false) => {
    const th = document.createElement('th');
    th.dataset.col = key;
    th.className = isPlayer ? 'col-player' : '';
    if (!isPlayer) {
      if (sortColumn === key) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      if (state.columnFilters[key]) th.classList.add('has-col-filter');
    }

    const inner = document.createElement('div');
    inner.className = 'th-inner';

    // Sort label area
    const labelDiv = document.createElement('div');
    labelDiv.className = 'th-label';
    labelDiv.setAttribute('role', 'button');
    labelDiv.setAttribute('tabindex', '0');
    labelDiv.setAttribute('aria-label', `Sort by ${label}`);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    labelDiv.appendChild(nameSpan);

    if (!isPlayer) {
      // Sort icon
      const sortIco = document.createElement('span');
      sortIco.className = 'sort-icon';
      sortIco.setAttribute('aria-hidden', 'true');
      sortIco.innerHTML = `
        <svg class="sort-asc-arrow" width="8" height="5" viewBox="0 0 8 5">
          <path d="M4 0L8 5H0L4 0Z" fill="currentColor"/>
        </svg>
        <svg class="sort-desc-arrow" width="8" height="5" viewBox="0 0 8 5">
          <path d="M4 5L0 0H8L4 5Z" fill="currentColor"/>
        </svg>`;
      labelDiv.appendChild(sortIco);

      // Click / keyboard sort
      labelDiv.addEventListener('click', () => handleSort(key));
      labelDiv.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handleSort(key); });

      // Header tooltip on hover
      labelDiv.addEventListener('mouseenter', e => showHeaderTooltip(key, e));
      labelDiv.addEventListener('mousemove',  e => moveTooltip(els.headerTooltip, e));
      labelDiv.addEventListener('mouseleave', ()  => hideTooltip(els.headerTooltip));

      inner.appendChild(labelDiv);

      // Filter button
      const filterBtn = document.createElement('button');
      filterBtn.className = 'th-filter-btn' + (state.columnFilters[key] ? ' active' : '');
      filterBtn.setAttribute('aria-label', `Filter ${label}`);
      filterBtn.setAttribute('title', `Filter ${label}`);
      filterBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M1 3h14M3 8h10M6 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
      filterBtn.addEventListener('click', e => { e.stopPropagation(); openColFilter(key, filterBtn); });
      inner.appendChild(filterBtn);
    } else {
      // Player column — click label to sort
      labelDiv.addEventListener('click', () => handleSort('name'));
      labelDiv.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handleSort('name'); });
      if (sortColumn === 'name') th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      const sortIco = document.createElement('span');
      sortIco.className = 'sort-icon';
      sortIco.setAttribute('aria-hidden', 'true');
      sortIco.innerHTML = `
        <svg class="sort-asc-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M4 0L8 5H0L4 0Z" fill="currentColor"/></svg>
        <svg class="sort-desc-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M4 5L0 0H8L4 5Z" fill="currentColor"/></svg>`;
      labelDiv.appendChild(sortIco);
      inner.appendChild(labelDiv);
    }

    th.appendChild(inner);
    return th;
  };

  const tr = document.createElement('tr');
  tr.appendChild(makeTh('name', 'Player', true));
  tr.appendChild(makeTh('gp', 'GP'));
  for (const col of columns) tr.appendChild(makeTh(col, COL_LABEL[col] ?? col));

  els.tableHead.innerHTML = '';
  els.tableHead.appendChild(tr);
}

/* ── BODY ── */
function renderBody(players, columns, ranges) {
  const frag = document.createDocumentFragment();

  for (const player of players) {
    const tr = document.createElement('tr');

    // Player name cell
    const tdName = document.createElement('td');
    tdName.className = 'col-player';
    tdName.textContent = player.name;
    tdName.title = player.name;
    tr.appendChild(tdName);

    // GP cell
    const tdGP = document.createElement('td');
    tdGP.className = 'col-gp';
    tdGP.textContent = player.gp;
    tr.appendChild(tdGP);

    // CR cells
    for (const col of columns) {
      const td = document.createElement('td');
      td.className = 'cr-cell';
      const stat = player.stats[col];

      if (!stat || stat.cr === null || stat.cr === undefined) {
        td.classList.add('cr-null');
        td.textContent = '—';
      } else if (stat.cr < 0) {
        td.classList.add('cr-neg');
        td.textContent = stat.cr.toFixed(2);
      } else {
        const bg = crColor(stat.cr, ranges[col]);
        if (bg) td.style.backgroundColor = bg;
        td.textContent = stat.cr.toFixed(2);
      }

      // Cell tooltip
      td.addEventListener('mouseenter', e => showCellTooltip(player.name, col, stat, e));
      td.addEventListener('mousemove',  e => moveTooltip(els.cellTooltip, e));
      td.addEventListener('mouseleave', ()  => hideTooltip(els.cellTooltip));

      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  els.tableBody.innerHTML = '';
  els.tableBody.appendChild(frag);
}


/* ══════════════════════════════════════════════
   SORT
   ══════════════════════════════════════════════ */

function handleSort(column) {
  if (state.sortColumn === column) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortColumn = column;
    state.sortDir = column === 'name' ? 'asc' : 'desc';
  }
  renderTable();
}


/* ══════════════════════════════════════════════
   COLUMN FILTER POPOVER
   ══════════════════════════════════════════════ */

function openColFilter(colKey, triggerEl) {
  state.activeColFilterKey = colKey;

  // Title
  els.cfpTitle.textContent = `Filter: ${COL_LABEL[colKey] ?? colKey} CR`;

  // Pre-fill with existing values
  const existing = state.columnFilters[colKey] || {};
  els.cfpMin.value = existing.min ?? '';
  els.cfpMax.value = existing.max ?? '';

  // Range hint: show min/max CR currently in data
  const players = getFilteredData();
  const values = players
    .map(p => p.stats[colKey]?.cr)
    .filter(v => v !== null && v !== undefined);
  if (values.length) {
    const lo = Math.min(...values).toFixed(2);
    const hi = Math.max(...values).toFixed(2);
    els.cfpRangeHint.textContent = `Data range: ${lo} – ${hi}`;
  } else {
    els.cfpRangeHint.textContent = '';
  }

  // Position below the trigger button
  const rect = triggerEl.getBoundingClientRect();
  const pop  = els.colFilterPopover;
  pop.hidden = false;
  els.popoverBackdrop.hidden = false;

  const popW = 240;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  pop.style.left = `${left}px`;
  pop.style.top  = `${rect.bottom + 4}px`;

  els.cfpMin.focus();
}

function closeColFilter() {
  els.colFilterPopover.hidden = true;
  els.popoverBackdrop.hidden  = true;
  state.activeColFilterKey = null;
}

function applyColFilter() {
  const col = state.activeColFilterKey;
  if (!col) return;

  const minVal = els.cfpMin.value !== '' ? parseFloat(els.cfpMin.value) : null;
  const maxVal = els.cfpMax.value !== '' ? parseFloat(els.cfpMax.value) : null;

  if (minVal === null && maxVal === null) {
    delete state.columnFilters[col];
  } else {
    state.columnFilters[col] = { min: minVal, max: maxVal };
  }

  closeColFilter();
  renderTable();
  renderColFilterSummary();
}

function clearColFilter() {
  const col = state.activeColFilterKey;
  if (col) delete state.columnFilters[col];
  closeColFilter();
  renderTable();
  renderColFilterSummary();
}

function removeColFilter(col) {
  delete state.columnFilters[col];
  renderTable();
  renderColFilterSummary();
}

/** Rebuild the "Active Column Filters" sidebar list */
function renderColFilterSummary() {
  const entries = Object.entries(state.columnFilters);
  els.colFilterSummaryGrp.hidden = entries.length === 0;
  els.colFilterSummary.innerHTML = '';

  for (const [col, { min, max }] of entries) {
    const label = COL_LABEL[col] ?? col;
    const lo = min !== null ? min : '…';
    const hi = max !== null ? max : '…';
    const li = document.createElement('li');
    li.className = 'col-filter-tag';
    li.innerHTML = `
      <span>${label} CR: ${lo} – ${hi}</span>
      <button class="col-filter-tag-remove" aria-label="Remove ${label} filter" data-col="${col}">&#x2715;</button>`;
    els.colFilterSummary.appendChild(li);
  }

  els.colFilterSummary.querySelectorAll('.col-filter-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeColFilter(btn.dataset.col));
  });
}


/* ══════════════════════════════════════════════
   TOOLTIPS
   ══════════════════════════════════════════════ */

function showHeaderTooltip(colKey, e) {
  const desc = COL_DESC[colKey];
  if (!desc) return;
  const label = COL_LABEL[colKey] ?? colKey;
  els.headerTooltip.innerHTML =
    `<strong>${label} CR</strong><div class="tt-stat">${desc}</div>
     <div class="tt-stat" style="margin-top:6px">CR = Average ÷ Standard Deviation</div>`;
  els.headerTooltip.hidden      = false;
  els.headerTooltip.style.opacity = '1';
  moveTooltip(els.headerTooltip, e);
}

function showCellTooltip(playerName, colKey, stat, e) {
  if (!stat) {
    els.cellTooltip.innerHTML =
      `<strong>${playerName}</strong><div class="tt-stat">No data available for ${COL_LABEL[colKey] ?? colKey}</div>`;
  } else {
    const crStr  = stat.cr !== null ? stat.cr.toFixed(4) : 'N/A';
    const avgStr = stat.avg.toFixed(4);
    const stdStr = stat.std.toFixed(4);
    const label  = COL_LABEL[colKey] ?? colKey;
    els.cellTooltip.innerHTML =
      `<strong>${playerName}</strong>
       <div class="tt-stat">${label} CR: <strong style="color:#f7a528">${crStr}</strong></div>
       <div class="tt-stat">Avg: ${avgStr}</div>
       <div class="tt-stat">Std Dev: ${stdStr}</div>`;
  }
  els.cellTooltip.hidden      = false;
  els.cellTooltip.style.opacity = '1';
  moveTooltip(els.cellTooltip, e);
}

function moveTooltip(el, e) {
  const margin = 14;
  const tw = el.offsetWidth  || 180;
  const th = el.offsetHeight || 80;
  let   x  = e.clientX + margin;
  let   y  = e.clientY + margin;
  if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - margin;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - margin;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
}

function hideTooltip(el) {
  el.hidden = true;
  el.style.opacity = '0';
}


/* ══════════════════════════════════════════════
   AUTOCOMPLETE
   ══════════════════════════════════════════════ */

let acFocusIdx = -1;

function getPlayerNames() {
  const players = currentPlayers();
  return [...new Set(players.map(p => p.name))].sort();
}

function showAcDropdown(query) {
  const dd = els.acDropdown;
  dd.innerHTML = '';
  acFocusIdx   = -1;

  if (!query) { hideAcDropdown(); return; }

  const q       = query.toLowerCase();
  const matches = getPlayerNames().filter(n => n.toLowerCase().includes(q)).slice(0, 12);

  if (!matches.length) { hideAcDropdown(); return; }

  for (const name of matches) {
    const li   = document.createElement('li');
    li.id      = `ac-${name.replace(/\s+/g, '-')}`;
    li.role    = 'option';
    li.setAttribute('aria-selected', 'false');

    // Highlight match
    const idx = name.toLowerCase().indexOf(q);
    if (idx >= 0) {
      li.innerHTML =
        escHtml(name.slice(0, idx)) +
        `<span class="ac-highlight">${escHtml(name.slice(idx, idx + q.length))}</span>` +
        escHtml(name.slice(idx + q.length));
    } else {
      li.textContent = name;
    }

    li.addEventListener('mousedown', e => {
      e.preventDefault(); // prevent blur before click
      selectAcItem(name);
    });
    dd.appendChild(li);
  }

  dd.hidden = false;
  els.playerSearch.setAttribute('aria-expanded', 'true');
}

function hideAcDropdown() {
  els.acDropdown.hidden = true;
  els.playerSearch.setAttribute('aria-expanded', 'false');
  acFocusIdx = -1;
}

function selectAcItem(name) {
  els.playerSearch.value = name;
  state.playerFilter     = name.toLowerCase();
  hideAcDropdown();
  renderTable();
}

function acMoveSelection(dir) {
  const items = els.acDropdown.querySelectorAll('li');
  if (!items.length) return;
  items[acFocusIdx]?.setAttribute('aria-selected', 'false');
  acFocusIdx = Math.max(0, Math.min(items.length - 1, acFocusIdx + dir));
  items[acFocusIdx].setAttribute('aria-selected', 'true');
  items[acFocusIdx].scrollIntoView({ block: 'nearest' });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


/* ══════════════════════════════════════════════
   GP RANGE SLIDER (dual range)
   ══════════════════════════════════════════════ */

function updateDualRange() {
  const track = els.dualRangeFill;
  const min   = +els.gpMinSlider.value;
  const max   = +els.gpMaxSlider.value;
  const total = +els.gpMinSlider.max;
  const pMin  = (min / total) * 100;
  const pMax  = (max / total) * 100;
  track.style.left  = `${pMin}%`;
  track.style.width = `${pMax - pMin}%`;
}

function setGpMax(max) {
  els.gpMinSlider.max    = max;
  els.gpMaxSlider.max    = max;
  els.gpMinInput.max     = max;
  els.gpMaxInput.max     = max;
  els.gpMaxSlider.value  = max;
  els.gpMaxInput.value   = max;
  els.gpMinSlider.value  = 0;
  els.gpMinInput.value   = 0;
  state.gpMin = 0;
  state.gpMax = max;
  updateDualRange();
}


/* ══════════════════════════════════════════════
   SEASON / SEASON TYPE
   ══════════════════════════════════════════════ */

function populateSeasonSelect() {
  els.seasonSelect.innerHTML = '';
  for (const season of state.seasons) {
    const opt = document.createElement('option');
    opt.value       = season;
    opt.textContent = season;
    els.seasonSelect.appendChild(opt);
  }
  if (state.seasons.length) {
    state.currentSeason = state.seasons[0];
    els.seasonSelect.value = state.currentSeason;
  }
}

function updateSeasonTypeBtns() {
  els.btnRegular.classList.toggle('active', state.seasonType === 'Regular Season');
  els.btnPlayoffs.classList.toggle('active', state.seasonType === 'Playoffs');
}

/** Recalculate max GP for the current data and reset GP filter */
function resetGpRange() {
  const players = currentPlayers();
  const maxGP   = players.reduce((m, p) => Math.max(m, p.gp), 1);
  setGpMax(maxGP);
}


/* ══════════════════════════════════════════════
   CLEAR ALL
   ══════════════════════════════════════════════ */

function clearAllFilters() {
  // Player search
  els.playerSearch.value = '';
  state.playerFilter     = '';
  hideAcDropdown();

  // GP range
  resetGpRange();

  // Column filters
  state.columnFilters = {};
  renderColFilterSummary();

  // Re-render
  renderTable();
}


/* ══════════════════════════════════════════════
   EVENT LISTENERS
   ══════════════════════════════════════════════ */

function bindEvents() {
  // Season select
  els.seasonSelect.addEventListener('change', () => {
    state.currentSeason = els.seasonSelect.value;
    resetGpRange();
    state.playerFilter  = '';
    els.playerSearch.value = '';
    renderTable();
  });

  // Season type toggle
  [els.btnRegular, els.btnPlayoffs].forEach(btn => {
    btn.addEventListener('click', () => {
      state.seasonType = btn.dataset.value;
      updateSeasonTypeBtns();
      resetGpRange();
      state.playerFilter  = '';
      els.playerSearch.value = '';
      renderTable();
    });
  });

  // Tabs
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentTab = btn.dataset.tab;
      els.tabBtns.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      renderTable();
    });
  });

  // Player search
  els.playerSearch.addEventListener('input', () => {
    const q          = els.playerSearch.value.trim();
    state.playerFilter = q.toLowerCase();
    showAcDropdown(q);
    renderTable();
  });

  els.playerSearch.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); acMoveSelection(1); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); acMoveSelection(-1); }
    if (e.key === 'Enter') {
      const items = els.acDropdown.querySelectorAll('li');
      if (acFocusIdx >= 0 && items[acFocusIdx]) {
        selectAcItem(items[acFocusIdx].textContent);
      } else {
        hideAcDropdown();
        renderTable();
      }
    }
    if (e.key === 'Escape') { hideAcDropdown(); }
  });

  els.playerSearch.addEventListener('blur', () => {
    // Slight delay so mousedown on item fires first
    setTimeout(hideAcDropdown, 150);
  });

  // GP range sliders
  els.gpMinSlider.addEventListener('input', () => {
    let v = +els.gpMinSlider.value;
    if (v > state.gpMax) { v = state.gpMax; els.gpMinSlider.value = v; }
    state.gpMin = v;
    els.gpMinInput.value = v;
    updateDualRange();
    renderTable();
  });

  els.gpMaxSlider.addEventListener('input', () => {
    let v = +els.gpMaxSlider.value;
    if (v < state.gpMin) { v = state.gpMin; els.gpMaxSlider.value = v; }
    state.gpMax = v;
    els.gpMaxInput.value = v;
    updateDualRange();
    renderTable();
  });

  // GP number inputs
  els.gpMinInput.addEventListener('change', () => {
    let v = Math.max(0, Math.min(+els.gpMinInput.value, state.gpMax));
    els.gpMinInput.value  = v;
    els.gpMinSlider.value = v;
    state.gpMin = v;
    updateDualRange();
    renderTable();
  });

  els.gpMaxInput.addEventListener('change', () => {
    const maxAllowed = +els.gpMaxSlider.max;
    let v = Math.max(state.gpMin, Math.min(+els.gpMaxInput.value, maxAllowed));
    els.gpMaxInput.value  = v;
    els.gpMaxSlider.value = v;
    state.gpMax = v;
    updateDualRange();
    renderTable();
  });

  // Clear all
  els.clearAllFilters.addEventListener('click', clearAllFilters);

  // Column filter popover
  els.cfpApply.addEventListener('click', applyColFilter);
  els.cfpClear.addEventListener('click', clearColFilter);
  els.cfpClose.addEventListener('click', closeColFilter);
  els.popoverBackdrop.addEventListener('click', closeColFilter);

  els.colFilterPopover.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeColFilter();
    if (e.key === 'Enter' && document.activeElement !== els.cfpClear) applyColFilter();
  });

  // Close popover on scroll (repositioning is complex — just close)
  els.tableScrollWrap.addEventListener('scroll', () => {
    if (!els.colFilterPopover.hidden) closeColFilter();
  }, { passive: true });
}


/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */

async function init() {
  // Footer year
  els.footerYear.textContent = new Date().getFullYear();

  const ok = await loadData();
  if (!ok) return;

  populateSeasonSelect();
  updateSeasonTypeBtns();
  resetGpRange();
  bindEvents();
  renderColFilterSummary();
  renderTable();
}

document.addEventListener('DOMContentLoaded', init);
