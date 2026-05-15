/**
 * NBA Consistency Stats — app.js
 * Interactive database viewer: filtering, sorting, grouped stat columns, tooltips, column filters.
 */

'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════ */

const DATA_URL = 'data/web/stats.json';

/** Width (px) of the column-filter popover — must match CSS `.col-filter-popover` width */
const POPOVER_WIDTH = 240;
const METRIC_MENU_WIDTH = 196;

const STAT_GROUPS = {
  scoring: ['PTS', 'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3_PCT', 'FTM', 'FTA', 'FT_PCT'],
  rebounds: ['OREB', 'DREB', 'REB'],
  other: ['MIN', 'AST', 'STL', 'BLK', 'TOV', 'PF', 'PLUS_MINUS'],
};

const ALL_STATS = [...STAT_GROUPS.scoring, ...STAT_GROUPS.rebounds, ...STAT_GROUPS.other];
const DEFAULT_SELECTED_STATS = [...STAT_GROUPS.scoring];

const METRIC_ORDER = ['cr', 'avg', 'std', 'rank', 'pct'];
const ASSOCIATED_METRICS = ['avg', 'std', 'rank', 'pct'];

const METRIC_DEF = {
  cr:   { suffix: 'CR',   key: 'cr',   filterStep: '0.01' },
  avg:  { suffix: 'AVG',  key: 'avg',  filterStep: '0.01' },
  std:  { suffix: 'SD',   key: 'std',  filterStep: '0.01' },
  rank: { suffix: 'Rank', key: 'rank', filterStep: '1' },
  pct:  { suffix: 'Pct',  key: 'pct',  filterStep: '1' },
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
  rawData:         null,
  seasons:         [],
  currentSeason:   '',
  seasonType:      'Regular Season',

  selectedStats:   new Set(DEFAULT_SELECTED_STATS),
  associatedCols:  {},      // { [stat]: Set<'avg'|'std'|'rank'|'pct'> }

  playerFilter:    '',
  gpMin:           0,
  gpMax:           82,

  columnFilters:   {},      // { [colKey]: { min, max } }

  sortColumn:      'name',  // 'name' | 'gp' | colKey
  sortDir:         'asc',

  activeColFilterKey: null,
  activeMetricMenuStat: null,
};

ALL_STATS.forEach(stat => { state.associatedCols[stat] = new Set(); });


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
  statCheckboxList:    $('statCheckboxList'),

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

  metricMenu:          $('metricMenu'),

  footerYear:          $('footerYear'),
};


/* ══════════════════════════════════════════════
   COLUMN HELPERS
   ══════════════════════════════════════════════ */

function makeColKey(stat, metric) {
  return `${stat}__${metric}`;
}

function parseColKey(colKey) {
  if (colKey === null || colKey === undefined) return null;
  const [stat, metric] = String(colKey).split('__');
  if (!stat || !metric || !METRIC_DEF[metric]) return null;
  return { stat, metric };
}

function getMetricLabel(metric) {
  return METRIC_DEF[metric]?.suffix || metric.toUpperCase();
}

function getStatLabel(stat) {
  return COL_LABEL[stat] ?? stat;
}

function buildColDef(stat, metric) {
  return {
    key: makeColKey(stat, metric),
    stat,
    metric,
    label: `${getStatLabel(stat)} ${getMetricLabel(metric)}`,
  };
}

function getVisibleColumns() {
  const cols = [];
  for (const stat of ALL_STATS) {
    if (!state.selectedStats.has(stat)) continue;
    cols.push(buildColDef(stat, 'cr'));
    for (const metric of METRIC_ORDER) {
      if (metric === 'cr') continue;
      if (state.associatedCols[stat]?.has(metric)) cols.push(buildColDef(stat, metric));
    }
  }
  return cols;
}

function getColDefByKey(colKey) {
  const parsed = parseColKey(colKey);
  if (!parsed) return null;
  return buildColDef(parsed.stat, parsed.metric);
}

function pruneHiddenColumnState() {
  const visibleKeys = new Set(getVisibleColumns().map(c => c.key));

  for (const key of Object.keys(state.columnFilters)) {
    if (!visibleKeys.has(key)) delete state.columnFilters[key];
  }

  if (state.sortColumn !== 'name' && state.sortColumn !== 'gp' && !visibleKeys.has(state.sortColumn)) {
    state.sortColumn = 'name';
    state.sortDir = 'asc';
  }

  if (state.activeColFilterKey && !visibleKeys.has(state.activeColFilterKey)) closeColFilter();

  if (state.activeMetricMenuStat && !state.selectedStats.has(state.activeMetricMenuStat)) closeMetricMenu();
}

function clearStatDerivedState(stat) {
  const prefix = `${stat}__`;
  for (const key of Object.keys(state.columnFilters)) {
    if (key.startsWith(prefix)) delete state.columnFilters[key];
  }
  state.associatedCols[stat] = new Set();
  if (String(state.sortColumn).startsWith(prefix)) {
    state.sortColumn = 'name';
    state.sortDir = 'asc';
  }
}

function removeAssociatedColumn(stat, metric) {
  if (!state.associatedCols[stat]) return;
  state.associatedCols[stat].delete(metric);

  const key = makeColKey(stat, metric);
  delete state.columnFilters[key];
  if (state.sortColumn === key) {
    state.sortColumn = 'name';
    state.sortDir = 'asc';
  }

  pruneHiddenColumnState();
  closeMetricMenu();
  renderColFilterSummary();
  renderTable();
}


/* ══════════════════════════════════════════════
   DATA LOADING
   ══════════════════════════════════════════════ */

async function loadData() {
  try {
    const res = await fetch(DATA_URL);
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
   METRIC VALUE / FORMATTERS
   ══════════════════════════════════════════════ */

function getRawMetricValue(statObj, metric) {
  if (!statObj) return null;
  if (metric === 'cr') return statObj.cr ?? null;
  if (metric === 'avg') return statObj.avg ?? null;
  if (metric === 'std') return statObj.std ?? null;
  if (metric === 'rank') return statObj.rank ?? null;
  if (metric === 'pct') return statObj.pct ?? null;
  return null;
}

function getDisplayMetricValue(statObj, metric) {
  const v = getRawMetricValue(statObj, metric);
  if (v === null || v === undefined) return null;
  if (metric === 'pct') return Math.round(v);
  return v;
}

function formatMetricValue(statObj, metric) {
  const v = getDisplayMetricValue(statObj, metric);
  if (v === null || v === undefined) return null;
  if (metric === 'cr' || metric === 'avg' || metric === 'std') return Number(v).toFixed(2);
  if (metric === 'rank') return `#${v}`;
  if (metric === 'pct') return `${v}%`;
  return String(v);
}

function formatMetricValueForHint(metric, value) {
  if (value === null || value === undefined) return 'N/A';
  if (metric === 'cr' || metric === 'avg' || metric === 'std') return Number(value).toFixed(2);
  if (metric === 'rank') return `#${Math.round(value)}`;
  if (metric === 'pct') return `${Math.round(value)}%`;
  return String(value);
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

  // Column filters
  for (const [colKey, { min, max }] of Object.entries(state.columnFilters)) {
    const parsed = parseColKey(colKey);
    if (!parsed) continue;

    players = players.filter(p => {
      const statObj = p.stats[parsed.stat];
      const val = getDisplayMetricValue(statObj, parsed.metric);
      if (val === null || val === undefined) return false;
      if (min !== null && min !== '' && val < min) return false;
      if (max !== null && max !== '' && val > max) return false;
      return true;
    });
  }

  return players;
}


/* ══════════════════════════════════════════════
   SORTING
   ══════════════════════════════════════════════ */

function compareNullableNumbers(a, b, dir) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a === b) return 0;
  return dir === 'asc' ? (a < b ? -1 : 1) : (a > b ? -1 : 1);
}

function sortPlayers(players) {
  const { sortColumn, sortDir } = state;

  return [...players].sort((a, b) => {
    if (sortColumn === 'name') {
      return sortDir === 'asc'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    }

    if (sortColumn === 'gp') {
      const cmp = compareNullableNumbers(a.gp ?? null, b.gp ?? null, sortDir);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    }

    const parsed = parseColKey(sortColumn);
    if (!parsed) return a.name.localeCompare(b.name);

    const aStat = a.stats[parsed.stat];
    const bStat = b.stats[parsed.stat];

    if (parsed.metric === 'pct') {
      const aPct = getDisplayMetricValue(aStat, 'pct');
      const bPct = getDisplayMetricValue(bStat, 'pct');

      let cmp = compareNullableNumbers(aPct, bPct, sortDir);
      if (cmp !== 0) return cmp;

      // Tie-break rounded percentile with rank so ordering aligns with rank.
      const aRank = getRawMetricValue(aStat, 'rank');
      const bRank = getRawMetricValue(bStat, 'rank');
      const rankDir = sortDir === 'desc' ? 'asc' : 'desc';
      cmp = compareNullableNumbers(aRank, bRank, rankDir);
      if (cmp !== 0) return cmp;

      return a.name.localeCompare(b.name);
    }

    const aVal = getDisplayMetricValue(aStat, parsed.metric);
    const bVal = getDisplayMetricValue(bStat, parsed.metric);
    const cmp = compareNullableNumbers(aVal, bVal, sortDir);
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
  });
}


/* ══════════════════════════════════════════════
   COLOUR HEAT-MAP
   ══════════════════════════════════════════════ */

function buildColRanges(players, columns) {
  const ranges = {};
  for (const col of columns) {
    let mn = Infinity;
    let mx = -Infinity;

    for (const p of players) {
      const statObj = p.stats[col.stat];
      const value = getDisplayMetricValue(statObj, col.metric);
      if (value === null || value === undefined) continue;
      if (value < mn) mn = value;
      if (value > mx) mx = value;
    }

    ranges[col.key] = {
      min: mn === Infinity ? 0 : mn,
      max: mx === -Infinity ? 1 : mx,
    };
  }
  return ranges;
}

function valueCellColor(value, range, metric) {
  if (value === null || value === undefined) return null;
  const { min, max } = range;
  const span = max - min;
  let norm = span > 0 ? (value - min) / span : 0.5;

  // Lower rank is better.
  if (metric === 'rank') norm = 1 - norm;

  const hue = Math.round(norm * 120);
  return `hsl(${hue}, 65%, 91%)`;
}


/* ══════════════════════════════════════════════
   TABLE RENDERING
   ══════════════════════════════════════════════ */

function renderTable() {
  pruneHiddenColumnState();

  const columns = getVisibleColumns();
  const filtered = getFilteredData();
  const sorted = sortPlayers(filtered);
  const ranges = buildColRanges(sorted, columns);

  renderHead(columns);
  renderBody(sorted, columns, ranges);

  const total = currentPlayers().length;
  els.rowCount.textContent =
    sorted.length === total
      ? `${total} players`
      : `${sorted.length} of ${total} players`;

  els.tableLoading.hidden = true;
  els.tableEmpty.hidden = sorted.length > 0;
  els.statsTable.hidden = sorted.length === 0;
}

function makeSortableLabel(label, onSort, tooltipHandlers) {
  const labelDiv = document.createElement('div');
  labelDiv.className = 'th-label';
  labelDiv.setAttribute('role', 'button');
  labelDiv.setAttribute('tabindex', '0');
  labelDiv.setAttribute('aria-label', `Sort by ${label}`);

  const nameSpan = document.createElement('span');
  nameSpan.textContent = label;
  labelDiv.appendChild(nameSpan);

  const sortIco = document.createElement('span');
  sortIco.className = 'sort-icon';
  sortIco.setAttribute('aria-hidden', 'true');
  sortIco.innerHTML = `
    <svg class="sort-asc-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M4 0L8 5H0L4 0Z" fill="currentColor"/></svg>
    <svg class="sort-desc-arrow" width="8" height="5" viewBox="0 0 8 5"><path d="M4 5L0 0H8L4 5Z" fill="currentColor"/></svg>`;
  labelDiv.appendChild(sortIco);

  labelDiv.addEventListener('click', onSort);
  labelDiv.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort();
    }
  });

  if (tooltipHandlers) {
    labelDiv.addEventListener('mouseenter', tooltipHandlers.enter);
    labelDiv.addEventListener('mousemove', tooltipHandlers.move);
    labelDiv.addEventListener('mouseleave', tooltipHandlers.leave);
  }

  return labelDiv;
}

function renderHead(columns) {
  const { sortColumn, sortDir } = state;

  const topRow = document.createElement('tr');
  const subRow = document.createElement('tr');

  const makeLockedTh = (key, label, isPlayer = false) => {
    const th = document.createElement('th');
    th.dataset.col = key;
    th.className = isPlayer ? 'col-player' : 'col-gp-head';
    th.setAttribute('rowspan', '2');
    if (sortColumn === key) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');

    const inner = document.createElement('div');
    inner.className = 'th-inner th-inner-simple';
    inner.appendChild(makeSortableLabel(label, () => handleSort(key)));
    th.appendChild(inner);
    return th;
  };

  topRow.appendChild(makeLockedTh('name', 'Player', true));
  topRow.appendChild(makeLockedTh('gp', 'GP'));

  for (const stat of ALL_STATS) {
    if (!state.selectedStats.has(stat)) continue;

    const statCols = columns.filter(col => col.stat === stat);
    if (!statCols.length) continue;

    const groupTh = document.createElement('th');
    groupTh.className = 'stat-group-th';
    groupTh.setAttribute('colspan', String(statCols.length));
    groupTh.textContent = getStatLabel(stat);
    topRow.appendChild(groupTh);

    statCols.forEach((colDef, idx) => {
      const th = document.createElement('th');
      th.dataset.col = colDef.key;
      th.className = 'metric-th';
      if (idx === 0) th.classList.add('group-start');
      if (idx === statCols.length - 1) th.classList.add('group-end');

      if (sortColumn === colDef.key) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      if (state.columnFilters[colDef.key]) th.classList.add('has-col-filter');

      const inner = document.createElement('div');
      inner.className = 'th-inner';

      const labelDiv = makeSortableLabel(colDef.label, () => handleSort(colDef.key), {
        enter: e => showHeaderTooltip(colDef, e),
        move: e => moveTooltip(els.headerTooltip, e),
        leave: () => hideTooltip(els.headerTooltip),
      });
      inner.appendChild(labelDiv);

      const actions = document.createElement('div');
      actions.className = 'th-actions';

      const filterBtn = document.createElement('button');
      filterBtn.className = `th-action-btn th-filter-btn${state.columnFilters[colDef.key] ? ' active' : ''}`;
      filterBtn.setAttribute('aria-label', `Filter ${colDef.label}`);
      filterBtn.setAttribute('title', `Filter ${colDef.label}`);
      filterBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1 3h14M3 8h10M6 13h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
      filterBtn.addEventListener('click', e => {
        e.stopPropagation();
        closeMetricMenu();
        openColFilter(colDef.key, filterBtn);
      });
      actions.appendChild(filterBtn);

      if (colDef.metric === 'cr') {
        const addBtn = document.createElement('button');
        addBtn.className = 'th-action-btn th-add-btn';
        addBtn.setAttribute('aria-label', `Add associated columns for ${getStatLabel(colDef.stat)}`);
        addBtn.setAttribute('title', `Add associated columns for ${getStatLabel(colDef.stat)}`);
        addBtn.textContent = '+';
        addBtn.addEventListener('click', e => {
          e.stopPropagation();
          closeColFilter();
          openMetricMenu(colDef.stat, addBtn);
        });
        actions.appendChild(addBtn);
      } else {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'th-action-btn th-remove-btn';
        removeBtn.setAttribute('aria-label', `Remove ${colDef.label}`);
        removeBtn.setAttribute('title', `Remove ${colDef.label}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          removeAssociatedColumn(colDef.stat, colDef.metric);
        });
        actions.appendChild(removeBtn);
      }

      inner.appendChild(actions);
      th.appendChild(inner);
      subRow.appendChild(th);
    });
  }

  els.tableHead.innerHTML = '';
  els.tableHead.appendChild(topRow);
  els.tableHead.appendChild(subRow);
}

function renderBody(players, columns, ranges) {
  const frag = document.createDocumentFragment();

  for (const player of players) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'col-player';
    tdName.title = player.name;
    const playerLink = document.createElement('a');
    playerLink.href = `player.html?player=${encodeURIComponent(player.name)}`;
    playerLink.textContent = player.name;
    playerLink.className = 'player-name-link';
    tdName.appendChild(playerLink);
    tr.appendChild(tdName);

    const tdGP = document.createElement('td');
    tdGP.className = 'col-gp';
    tdGP.textContent = player.gp;
    tr.appendChild(tdGP);

    for (let idx = 0; idx < columns.length; idx += 1) {
      const colDef = columns[idx];
      const td = document.createElement('td');
      td.className = 'metric-cell';
      if (idx === 0 || columns[idx - 1].stat !== colDef.stat) td.classList.add('group-start');
      if (idx === columns.length - 1 || columns[idx + 1].stat !== colDef.stat) td.classList.add('group-end');

      const statObj = player.stats[colDef.stat];
      const displayVal = getDisplayMetricValue(statObj, colDef.metric);

      if (!statObj || displayVal === null || displayVal === undefined) {
        td.classList.add('cr-null');
        td.textContent = '—';
      } else if (colDef.metric === 'cr' && getRawMetricValue(statObj, 'cr') < 0) {
        td.classList.add('cr-neg');
        td.textContent = Number(getRawMetricValue(statObj, 'cr')).toFixed(2);
      } else {
        const bg = valueCellColor(displayVal, ranges[colDef.key], colDef.metric);
        if (bg) td.style.backgroundColor = bg;
        td.textContent = formatMetricValue(statObj, colDef.metric);
      }

      td.addEventListener('mouseenter', e => showCellTooltip(player.name, colDef, statObj, e));
      td.addEventListener('mousemove', e => moveTooltip(els.cellTooltip, e));
      td.addEventListener('mouseleave', () => hideTooltip(els.cellTooltip));

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

function getDefaultSortDir(column) {
  if (column === 'name') return 'asc';
  if (column === 'gp') return 'desc';
  const parsed = parseColKey(column);
  if (!parsed) return 'desc';
  return parsed.metric === 'rank' ? 'asc' : 'desc';
}

function handleSort(column) {
  if (state.sortColumn === column) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortColumn = column;
    state.sortDir = getDefaultSortDir(column);
  }
  renderTable();
}


/* ══════════════════════════════════════════════
   COLUMN FILTER POPOVER
   ══════════════════════════════════════════════ */

function openColFilter(colKey, triggerEl) {
  const colDef = getColDefByKey(colKey);
  if (!colDef) return;

  state.activeColFilterKey = colKey;

  els.cfpTitle.textContent = `Filter: ${colDef.label}`;

  const existing = state.columnFilters[colKey] || {};
  els.cfpMin.value = existing.min ?? '';
  els.cfpMax.value = existing.max ?? '';

  const values = getFilteredData()
    .map(p => getDisplayMetricValue(p.stats[colDef.stat], colDef.metric))
    .filter(v => v !== null && v !== undefined);

  if (values.length) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    els.cfpRangeHint.textContent = `Data range: ${formatMetricValueForHint(colDef.metric, lo)} – ${formatMetricValueForHint(colDef.metric, hi)}`;
  } else {
    els.cfpRangeHint.textContent = '';
  }

  const step = METRIC_DEF[colDef.metric]?.filterStep || '0.01';
  els.cfpMin.step = step;
  els.cfpMax.step = step;

  const rect = triggerEl.getBoundingClientRect();
  const pop = els.colFilterPopover;
  pop.hidden = false;
  els.popoverBackdrop.hidden = false;

  let left = rect.left;
  if (left + POPOVER_WIDTH > window.innerWidth - 8) left = window.innerWidth - POPOVER_WIDTH - 8;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${rect.bottom + 4}px`;

  els.cfpMin.focus();
}

function closeColFilter() {
  els.colFilterPopover.hidden = true;
  els.popoverBackdrop.hidden = true;
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
  renderColFilterSummary();
  renderTable();
}

function clearColFilter() {
  const col = state.activeColFilterKey;
  if (col) delete state.columnFilters[col];
  closeColFilter();
  renderColFilterSummary();
  renderTable();
}

function removeColFilter(col) {
  delete state.columnFilters[col];
  renderColFilterSummary();
  renderTable();
}

function renderColFilterSummary() {
  const entries = Object.entries(state.columnFilters);
  els.colFilterSummaryGrp.hidden = entries.length === 0;
  els.colFilterSummary.innerHTML = '';

  for (const [colKey, { min, max }] of entries) {
    const def = getColDefByKey(colKey);
    if (!def) continue;

    const lo = min !== null ? min : '…';
    const hi = max !== null ? max : '…';
    const li = document.createElement('li');
    li.className = 'col-filter-tag';
    li.innerHTML = `
      <span>${def.label}: ${lo} – ${hi}</span>
      <button class="col-filter-tag-remove" aria-label="Remove ${def.label} filter" data-col="${colKey}">&#x2715;</button>`;
    els.colFilterSummary.appendChild(li);
  }

  els.colFilterSummary.querySelectorAll('.col-filter-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeColFilter(btn.dataset.col));
  });
}


/* ══════════════════════════════════════════════
   ASSOCIATED COLUMN MENU
   ══════════════════════════════════════════════ */

function openMetricMenu(stat, triggerEl) {
  const menu = els.metricMenu;
  const selected = state.associatedCols[stat] || new Set();
  const available = ASSOCIATED_METRICS.filter(metric => !selected.has(metric));

  state.activeMetricMenuStat = stat;

  menu.innerHTML = '';

  if (!available.length) {
    const empty = document.createElement('div');
    empty.className = 'metric-menu-empty';
    empty.textContent = 'All associated columns already added.';
    menu.appendChild(empty);
  } else {
    for (const metric of available) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'metric-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = `${getStatLabel(stat)} ${getMetricLabel(metric)}`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        state.associatedCols[stat].add(metric);
        closeMetricMenu();
        pruneHiddenColumnState();
        renderColFilterSummary();
        renderTable();
      });
      menu.appendChild(btn);
    }
  }

  const rect = triggerEl.getBoundingClientRect();
  let left = rect.left;
  if (left + METRIC_MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - METRIC_MENU_WIDTH - 8;

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.hidden = false;
}

function closeMetricMenu() {
  els.metricMenu.hidden = true;
  state.activeMetricMenuStat = null;
}


/* ══════════════════════════════════════════════
   TOOLTIPS
   ══════════════════════════════════════════════ */

function showHeaderTooltip(colDef, e) {
  const desc = COL_DESC[colDef.stat];
  if (!desc) return;

  let detail = '';
  if (colDef.metric === 'cr') {
    detail = 'Consistency Rating (CR) = Average ÷ Standard Deviation.';
  } else if (colDef.metric === 'avg') {
    detail = 'Average game-by-game value for this stat.';
  } else if (colDef.metric === 'std') {
    detail = 'Standard deviation for this stat (lower means less variation).';
  } else if (colDef.metric === 'rank') {
    detail = 'League rank for consistency (lower rank is better).';
  } else if (colDef.metric === 'pct') {
    detail = 'Percentile rank for consistency (higher percentile is better).';
  }

  els.headerTooltip.innerHTML =
    `<strong>${colDef.label}</strong>
     <div class="tt-stat">${desc}</div>
     <div class="tt-stat" style="margin-top:6px">${detail}</div>`;

  els.headerTooltip.hidden = false;
  els.headerTooltip.style.opacity = '1';
  moveTooltip(els.headerTooltip, e);
}

function showCellTooltip(playerName, colDef, statObj, e) {
  if (!statObj) {
    els.cellTooltip.innerHTML =
      `<strong>${playerName}</strong><div class="tt-stat">No data available for ${colDef.label}</div>`;
  } else {
    const primary = formatMetricValue(statObj, colDef.metric) || 'N/A';
    const crRaw = getRawMetricValue(statObj, 'cr');
    const avgRaw = getRawMetricValue(statObj, 'avg');
    const stdRaw = getRawMetricValue(statObj, 'std');
    const crStr = crRaw !== null ? Number(crRaw).toFixed(4) : 'N/A';
    const avgStr = avgRaw !== null ? Number(avgRaw).toFixed(4) : 'N/A';
    const stdStr = stdRaw !== null ? Number(stdRaw).toFixed(4) : 'N/A';
    const rankRaw = getRawMetricValue(statObj, 'rank');
    const pctRaw = getRawMetricValue(statObj, 'pct');
    const rankStr = rankRaw !== null ? `#${rankRaw}` : 'N/A';
    const pctStr = pctRaw !== null ? `${Math.round(pctRaw)}%` : 'N/A';

    els.cellTooltip.innerHTML =
      `<strong>${playerName}</strong>
       <div class="tt-stat">${colDef.label}: <strong style="color:#f7a528">${primary}</strong></div>
       <div class="tt-stat">CR: ${crStr} &nbsp;|&nbsp; Rank: ${rankStr}</div>
       <div class="tt-stat">Pct: ${pctStr} &nbsp;|&nbsp; Avg: ${avgStr}</div>
       <div class="tt-stat">Std Dev: ${stdStr}</div>`;
  }

  els.cellTooltip.hidden = false;
  els.cellTooltip.style.opacity = '1';
  moveTooltip(els.cellTooltip, e);
}

function moveTooltip(el, e) {
  const margin = 14;
  const tw = el.offsetWidth || 180;
  const th = el.offsetHeight || 80;
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - margin;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - margin;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
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
  acFocusIdx = -1;

  if (!query) { hideAcDropdown(); return; }

  const q = query.toLowerCase();
  const matches = getPlayerNames().filter(n => n.toLowerCase().includes(q)).slice(0, 12);

  if (!matches.length) { hideAcDropdown(); return; }

  for (const name of matches) {
    const li = document.createElement('li');
    li.id = `ac-${name.replace(/\s+/g, '-')}`;
    li.role = 'option';
    li.setAttribute('aria-selected', 'false');

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
      e.preventDefault();
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
  state.playerFilter = name.toLowerCase();
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* ══════════════════════════════════════════════
   GP RANGE SLIDER (dual range)
   ══════════════════════════════════════════════ */

function updateDualRange() {
  const track = els.dualRangeFill;
  const min = +els.gpMinSlider.value;
  const max = +els.gpMaxSlider.value;
  const total = +els.gpMinSlider.max;
  const pMin = (min / total) * 100;
  const pMax = (max / total) * 100;
  track.style.left = `${pMin}%`;
  track.style.width = `${pMax - pMin}%`;
}

function setGpMax(max) {
  els.gpMinSlider.max = max;
  els.gpMaxSlider.max = max;
  els.gpMinInput.max = max;
  els.gpMaxInput.max = max;
  els.gpMaxSlider.value = max;
  els.gpMaxInput.value = max;
  els.gpMinSlider.value = 0;
  els.gpMinInput.value = 0;
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
    opt.value = season;
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

function resetGpRange() {
  const players = currentPlayers();
  const maxGP = players.reduce((m, p) => Math.max(m, p.gp), 1);
  setGpMax(maxGP);
}


/* ══════════════════════════════════════════════
   SIDEBAR STAT CHECKBOXES
   ══════════════════════════════════════════════ */

function renderStatCheckboxes() {
  const container = els.statCheckboxList;
  container.innerHTML = '';

  const addStatOption = stat => {
    const id = `statChk-${stat}`;
    const row = document.createElement('label');
    row.className = 'stat-checkbox-item';
    row.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = state.selectedStats.has(stat);
    input.dataset.stat = stat;

    const text = document.createElement('span');
    text.textContent = getStatLabel(stat);

    row.appendChild(input);
    row.appendChild(text);
    container.appendChild(row);
  };

  const addGroup = (title, stats) => {
    const heading = document.createElement('div');
    heading.className = 'stat-checkbox-group-title';
    heading.textContent = title;
    container.appendChild(heading);
    stats.forEach(addStatOption);
  };

  addGroup('Scoring', STAT_GROUPS.scoring);
  addGroup('Rebounds', STAT_GROUPS.rebounds);
  addGroup('Other', STAT_GROUPS.other);

  container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const stat = chk.dataset.stat;
      if (chk.checked) {
        state.selectedStats.add(stat);
      } else {
        state.selectedStats.delete(stat);
        clearStatDerivedState(stat);
      }
      pruneHiddenColumnState();
      closeMetricMenu();
      closeColFilter();
      renderColFilterSummary();
      renderTable();
    });
  });
}


/* ══════════════════════════════════════════════
   CLEAR ALL
   ══════════════════════════════════════════════ */

function clearAllFilters() {
  els.playerSearch.value = '';
  state.playerFilter = '';
  hideAcDropdown();

  resetGpRange();

  state.columnFilters = {};
  renderColFilterSummary();

  renderTable();
}


/* ══════════════════════════════════════════════
   EVENT LISTENERS
   ══════════════════════════════════════════════ */

function bindEvents() {
  els.seasonSelect.addEventListener('change', () => {
    state.currentSeason = els.seasonSelect.value;
    resetGpRange();
    state.playerFilter = '';
    els.playerSearch.value = '';
    renderTable();
  });

  [els.btnRegular, els.btnPlayoffs].forEach(btn => {
    btn.addEventListener('click', () => {
      state.seasonType = btn.dataset.value;
      updateSeasonTypeBtns();
      resetGpRange();
      state.playerFilter = '';
      els.playerSearch.value = '';
      renderTable();
    });
  });

  els.playerSearch.addEventListener('input', () => {
    const q = els.playerSearch.value.trim();
    state.playerFilter = q.toLowerCase();
    showAcDropdown(q);
    renderTable();
  });

  els.playerSearch.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); acMoveSelection(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); acMoveSelection(-1); }
    if (e.key === 'Enter') {
      const items = els.acDropdown.querySelectorAll('li');
      if (acFocusIdx >= 0 && items[acFocusIdx]) {
        selectAcItem(items[acFocusIdx].textContent);
      } else {
        hideAcDropdown();
        renderTable();
      }
    }
    if (e.key === 'Escape') hideAcDropdown();
  });

  els.playerSearch.addEventListener('blur', () => {
    setTimeout(hideAcDropdown, 150);
  });

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

  els.gpMinInput.addEventListener('change', () => {
    let v = Math.max(0, Math.min(+els.gpMinInput.value, state.gpMax));
    els.gpMinInput.value = v;
    els.gpMinSlider.value = v;
    state.gpMin = v;
    updateDualRange();
    renderTable();
  });

  els.gpMaxInput.addEventListener('change', () => {
    const maxAllowed = +els.gpMaxSlider.max;
    let v = Math.max(state.gpMin, Math.min(+els.gpMaxInput.value, maxAllowed));
    els.gpMaxInput.value = v;
    els.gpMaxSlider.value = v;
    state.gpMax = v;
    updateDualRange();
    renderTable();
  });

  els.clearAllFilters.addEventListener('click', clearAllFilters);

  els.cfpApply.addEventListener('click', applyColFilter);
  els.cfpClear.addEventListener('click', clearColFilter);
  els.cfpClose.addEventListener('click', closeColFilter);
  els.popoverBackdrop.addEventListener('click', closeColFilter);

  els.colFilterPopover.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeColFilter();
    if (e.key === 'Enter' && document.activeElement !== els.cfpClear) applyColFilter();
  });

  els.tableScrollWrap.addEventListener('scroll', () => {
    if (!els.colFilterPopover.hidden) closeColFilter();
    if (!els.metricMenu.hidden) closeMetricMenu();
  }, { passive: true });

  document.addEventListener('click', e => {
    if (!els.metricMenu.hidden && !els.metricMenu.contains(e.target)) closeMetricMenu();
  });

  window.addEventListener('resize', () => {
    if (!els.colFilterPopover.hidden) closeColFilter();
    if (!els.metricMenu.hidden) closeMetricMenu();
  });
}


/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */

async function init() {
  els.footerYear.textContent = new Date().getFullYear();

  const ok = await loadData();
  if (!ok) return;

  populateSeasonSelect();
  updateSeasonTypeBtns();
  resetGpRange();
  renderStatCheckboxes();
  bindEvents();
  renderColFilterSummary();
  renderTable();
}

document.addEventListener('DOMContentLoaded', init);
