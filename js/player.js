/**
 * NBA Consistency Stats — player.js
 * Individual player page: search, histogram, stat summary panel.
 */

'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════ */

const DATA_URL = 'data/web/stats.json';

/** Template for game log file URLs.  Spaces in season_type become underscores. */
const GAMELOG_URL = (season, seasonType) =>
  `data/web/gamelogs/${season}_${seasonType.replace(/ /g, '_')}.json`;

const STAT_LABELS = {
  PTS: 'Points', FGM: 'FGM', FGA: 'FGA', FG_PCT: 'FG%',
  FG3M: '3PM', FG3_PCT: '3P%', FTM: 'FTM', FTA: 'FTA', FT_PCT: 'FT%',
  OREB: 'OREB', DREB: 'DREB', REB: 'Rebounds',
  MIN: 'Minutes', AST: 'Assists', STL: 'Steals', BLK: 'Blocks',
  TOV: 'Turnovers', PF: 'Fouls', PLUS_MINUS: 'Plus/Minus',
};

/* ══════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════ */

const state = {
  allData:          null,   // full stats.json payload
  seasons:          [],
  currentSeason:    '',
  seasonType:       'Regular Season',
  selectedPlayer:   null,   // { id, name }
  comparePlayer:    null,   // optional second player { id, name }
  selectedStat:     'PTS',
  showNormalTrendline: true,

  // Loaded game log for current season+type: { "playerId": { "STAT": [v1, v2, ...] } }
  gameLogs:         null,
  gameLogSeason:    '',     // season for which gameLogs was last loaded
  gameLogType:      '',     // seasonType for which gameLogs was last loaded

  // Histogram overrides (null = auto)
  xMin: null, xMax: null, yMax: null,
  binMode:  'count',   // 'count' | 'width'
  binCount: 10,
  binWidth: 5,
};

/* ══════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

const els = {
  playerSearchInput:   $('playerSearchInput'),
  playerAcDropdown:    $('playerAcDropdown'),
  playerSeasonSelect:  $('playerSeasonSelect'),
  pBtnRegular:         $('pBtnRegular'),
  pBtnPlayoffs:        $('pBtnPlayoffs'),
  statSelect:          $('statSelect'),

  histogramCanvas:     $('histogramCanvas'),
  histEmpty:           $('histEmpty'),
  histogramTitle:      $('histogramTitle'),

  binModeSelect:       $('binModeSelect'),
  binCountGroup:       $('binCountGroup'),
  binWidthGroup:       $('binWidthGroup'),
  binCountInput:       $('binCountInput'),
  binWidthInput:       $('binWidthInput'),
  xMinInput:           $('xMinInput'),
  xMaxInput:           $('xMaxInput'),
  yMaxInput:           $('yMaxInput'),
  applyHistBtn:        $('applyHistBtn'),
  resetHistBtn:        $('resetHistBtn'),
  comparePlayerSelect: $('comparePlayerSelect'),
  comparePlayerBtn:    $('comparePlayerBtn'),
  normalTrendlineToggle: $('normalTrendlineToggle'),

  statsPanelTitle:     $('statsPanelTitle'),
  statsPanelGrid:      $('statsPanelGrid'),

  footerYear:          $('footerYear'),
};

/* ══════════════════════════════════════════════
   CHART INSTANCE
   ══════════════════════════════════════════════ */

let chartInstance = null;

/* ══════════════════════════════════════════════
   DATA LOADING
   ══════════════════════════════════════════════ */

async function loadStatsData() {
  try {
    const res  = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.allData = await res.json();
    state.seasons = state.allData.seasons || [];
    return true;
  } catch (err) {
    console.error('Failed to load stats data:', err);
    return false;
  }
}

async function loadGameLogs(season, seasonType) {
  // Return from cache if already loaded for this season+type
  if (state.gameLogs && state.gameLogSeason === season && state.gameLogType === seasonType) {
    return true;
  }
  try {
    const url = GAMELOG_URL(season, seasonType);
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        state.gameLogs = {};
        state.gameLogSeason = season;
        state.gameLogType = seasonType;
        return true;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    state.gameLogs = await res.json();
    state.gameLogSeason = season;
    state.gameLogType = seasonType;
    return true;
  } catch (err) {
    console.error('Failed to load game logs:', err);
    state.gameLogs = {};
    state.gameLogSeason = season;
    state.gameLogType = seasonType;
    return false;
  }
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */

function getAllPlayerNames() {
  if (!state.allData) return [];
  const names = new Set();
  for (const players of Object.values(state.allData.data)) {
    for (const p of players) names.add(p.name);
  }
  return [...names].sort();
}

function findPlayerInSeason(name, season, seasonType) {
  if (!state.allData) return null;
  const key = `${season}|${seasonType}`;
  const players = state.allData.data[key] || [];
  return players.find(p => p.name === name) || null;
}

function getPlayerValues() {
  if (!state.selectedPlayer || !state.gameLogs) return null;
  const pid = String(state.selectedPlayer.id);
  const logs = state.gameLogs[pid];
  if (!logs) return null;
  return logs[state.selectedStat] || null;
}

function getValuesForPlayer(player) {
  if (!player || !state.gameLogs) return null;
  const pid = String(player.id);
  const logs = state.gameLogs[pid];
  if (!logs) return null;
  return logs[state.selectedStat] || null;
}

function getCurrentSeasonPlayers() {
  const key = `${state.currentSeason}|${state.seasonType}`;
  return state.allData?.data[key] || [];
}

function findCurrentSeasonPlayerByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return getCurrentSeasonPlayers().find(p => p.name.toLowerCase() === normalized) || null;
}

function updateCompareButtonLabel() {
  if (!els.comparePlayerBtn) return;
  if (state.comparePlayer) {
    els.comparePlayerBtn.textContent = `Remove Compare (${state.comparePlayer.name})`;
  } else {
    els.comparePlayerBtn.textContent = 'Compare Selected';
  }
  const hasPrimary = !!state.selectedPlayer;
  const hasSelection = !!els.comparePlayerSelect?.value;
  els.comparePlayerBtn.disabled = !hasPrimary || (!state.comparePlayer && !hasSelection);
}

function populateComparePlayerSelect() {
  if (!els.comparePlayerSelect) return;
  const players = getCurrentSeasonPlayers()
    .map(p => p.name)
    .sort((a, b) => a.localeCompare(b));
  const selectedName = state.selectedPlayer?.name || '';
  const compareName = state.comparePlayer?.name || '';

  els.comparePlayerSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = selectedName ? 'Select player…' : 'Select primary player first';
  els.comparePlayerSelect.appendChild(placeholder);

  players
    .filter(name => name !== selectedName)
    .forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      els.comparePlayerSelect.appendChild(opt);
    });

  if (compareName && players.includes(compareName) && compareName !== selectedName) {
    els.comparePlayerSelect.value = compareName;
  } else {
    els.comparePlayerSelect.value = '';
  }
  updateCompareButtonLabel();
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════
   AUTOCOMPLETE
   ══════════════════════════════════════════════ */

let acFocusIdx = -1;

function showAcDropdown(query) {
  const dd = els.playerAcDropdown;
  dd.innerHTML = '';
  acFocusIdx = -1;

  if (!query) { hideAcDropdown(); return; }

  const q = query.toLowerCase();
  const matches = getAllPlayerNames().filter(n => n.toLowerCase().includes(q)).slice(0, 12);

  if (!matches.length) { hideAcDropdown(); return; }

  for (const name of matches) {
    const li = document.createElement('li');
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
      selectPlayer(name);
    });
    dd.appendChild(li);
  }

  dd.hidden = false;
  els.playerSearchInput.setAttribute('aria-expanded', 'true');
}

function hideAcDropdown() {
  els.playerAcDropdown.hidden = true;
  els.playerSearchInput.setAttribute('aria-expanded', 'false');
  acFocusIdx = -1;
}

function acMoveSelection(dir) {
  const items = els.playerAcDropdown.querySelectorAll('li');
  if (!items.length) return;
  items[acFocusIdx]?.setAttribute('aria-selected', 'false');
  acFocusIdx = Math.max(0, Math.min(items.length - 1, acFocusIdx + dir));
  items[acFocusIdx].setAttribute('aria-selected', 'true');
  items[acFocusIdx].scrollIntoView({ block: 'nearest' });
}

async function selectPlayer(name) {
  hideAcDropdown();
  els.playerSearchInput.value = name;

  // Find the player record to get their id
  const key = `${state.currentSeason}|${state.seasonType}`;
  const players = state.allData?.data[key] || [];
  const found = players.find(p => p.name === name);
  if (found) {
    state.selectedPlayer = { id: found.id, name: found.name };
  } else {
    // Player may exist in a different season — find their id from any season
    let foundId = null;
    for (const pl of Object.values(state.allData?.data || {})) {
      const match = pl.find(p => p.name === name);
      if (match) { foundId = match.id; break; }
    }
    state.selectedPlayer = foundId !== null ? { id: foundId, name } : { id: null, name };
  }

  if (state.comparePlayer && state.comparePlayer.name === state.selectedPlayer?.name) {
    state.comparePlayer = null;
    updateCompareButtonLabel();
  }

  await refreshView();
}

/* ══════════════════════════════════════════════
   VIEW REFRESH
   ══════════════════════════════════════════════ */

async function refreshView() {
  if (!state.selectedPlayer) return;

  // Ensure game logs are loaded for the current season+type
  await loadGameLogs(state.currentSeason, state.seasonType);

  if (state.comparePlayer && !findCurrentSeasonPlayerByName(state.comparePlayer.name)) {
    state.comparePlayer = null;
  }
  populateComparePlayerSelect();

  renderHistogram();
  renderStatsPanel();
}

/* ══════════════════════════════════════════════
   HISTOGRAM
   ══════════════════════════════════════════════ */

/**
 * Compute histogram bins from an array of numeric values.
 * Returns an array of { x0, x1, count } objects.
 */
function computeBins(values) {
  if (!values || !values.length) return [];

  // Determine range from overrides or data
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const xMin = state.xMin !== null ? state.xMin : dataMin;
  const xMax = state.xMax !== null ? state.xMax : dataMax;

  if (xMin >= xMax) return [];

  // Determine bin edges
  let edges;
  if (state.binMode === 'width') {
    const w = state.binWidth > 0 ? state.binWidth : 1;
    edges = [];
    for (let e = xMin; e <= xMax + w * 0.0001; e += w) {
      edges.push(parseFloat(e.toFixed(10)));
    }
  } else {
    const n = Math.max(2, Math.min(50, state.binCount));
    const w = (xMax - xMin) / n;
    edges = Array.from({ length: n + 1 }, (_, i) => xMin + i * w);
  }

  if (edges.length < 2) return [];

  return computeBinsFromEdges(values, edges);
}

function computeBinsFromEdges(values, edges) {
  if (!values || !values.length || !edges || edges.length < 2) return [];

  // Count values in each bin
  const bins = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const isLast = i === edges.length - 2;
    const count = values.filter(v => v >= lo && (isLast ? v <= hi : v < hi)).length;
    bins.push({ x0: lo, x1: hi, count });
  }

  return bins;
}

/**
 * Approximate Normal(μ, σ) cumulative probability P(X <= x).
 * @param {number} x Value to evaluate.
 * @param {number} mean Distribution mean (μ).
 * @param {number} std Distribution standard deviation (σ).
 * @returns {number} Probability in [0, 1].
 */
function normalCdf(x, mean, std) {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) {
    if (x < mean) return 0;
    if (x > mean) return 1;
    return 0.5;
  }
  const z = (x - mean) / (std * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26 approximation coefficients for erf(x).
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
  return sign * y;
}

function computeNormalTrendline(values, bins) {
  if (!values?.length || !bins?.length) return [];
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  if (!Number.isFinite(std) || std <= 0) {
    return [];
  }

  return bins.map(bin => {
    const p = Math.max(0, normalCdf(bin.x1, mean, std) - normalCdf(bin.x0, mean, std));
    return p * n;
  });
}

function renderHistogram() {
  const values = getPlayerValues();
  const compareValues = getValuesForPlayer(state.comparePlayer);
  const statLabel = STAT_LABELS[state.selectedStat] || state.selectedStat;
  const playerName = state.selectedPlayer?.name || '';
  const compareName = state.comparePlayer?.name || '';

  els.histogramTitle.textContent =
    playerName
      ? (state.comparePlayer
          ? `${playerName} vs ${compareName} — ${statLabel} (${state.currentSeason} ${state.seasonType})`
          : `${playerName} — ${statLabel} (${state.currentSeason} ${state.seasonType})`)
      : 'Select a player to view their histogram';

  if (!values || !values.length) {
    els.histEmpty.hidden = false;
    els.histEmpty.textContent =
      state.selectedPlayer
        ? `No ${statLabel} game log data available for ${playerName} in ${state.currentSeason} ${state.seasonType}.`
        : 'Select a player to get started';
    destroyChart();
    return;
  }

  els.histEmpty.hidden = true;

  const bins = computeBins(values);

  if (!bins.length) {
    els.histEmpty.hidden = false;
    els.histEmpty.textContent = 'Unable to compute bins with the current settings.';
    destroyChart();
    return;
  }

  // Build Chart.js datasets
  const labels = bins.map(b => {
    const lo = formatBinEdge(b.x0);
    const hi = formatBinEdge(b.x1);
    return `${lo} – ${hi}`;
  });
  const data = bins.map(b => b.count);
  const edges = bins.length ? [...bins.map(b => b.x0), bins[bins.length - 1].x1] : [];
  const compareBins = computeBinsFromEdges(compareValues, edges);
  const compareData = compareBins.map(b => b.count);

  const yMax = state.yMax !== null ? state.yMax : undefined;

  const datasets = [{
    label: `${playerName} Games`,
    data,
    backgroundColor: 'rgba(29, 53, 87, 0.72)',
    borderColor: 'rgba(29, 53, 87, 0.9)',
    borderWidth: 1,
    borderRadius: 3,
  }];

  if (state.comparePlayer && compareData.length) {
    datasets.push({
      label: `${state.comparePlayer.name} Games`,
      data: compareData,
      backgroundColor: 'rgba(247, 165, 40, 0.5)',
      borderColor: 'rgba(247, 165, 40, 0.95)',
      borderWidth: 1,
      borderRadius: 3,
    });
  }

  if (state.showNormalTrendline) {
    datasets.push({
      type: 'line',
      label: `${playerName} Normal Trend`,
      data: computeNormalTrendline(values, bins),
      borderColor: 'rgba(42, 157, 143, 0.95)',
      backgroundColor: 'rgba(42, 157, 143, 0.15)',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
    });
    if (state.comparePlayer && compareValues?.length && compareData.length) {
      datasets.push({
        type: 'line',
        label: `${state.comparePlayer.name} Normal Trend`,
        data: computeNormalTrendline(compareValues, bins),
        borderColor: 'rgba(230, 111, 81, 0.95)',
        backgroundColor: 'rgba(230, 111, 81, 0.15)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
      });
    }
  }

  const chartData = {
    labels,
    datasets,
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: datasets.length > 1 },
      tooltip: {
        callbacks: {
          title(ctx) {
            const idx = ctx[0].dataIndex;
            const b = bins[idx];
            return `${statLabel}: ${formatBinEdge(b.x0)} – ${formatBinEdge(b.x1)}`;
          },
          label(ctx) {
            return `Games: ${ctx.parsed.y}`;
          },
          afterLabel(ctx) {
            const total = values.length;
            const pct = ((ctx.parsed.y / total) * 100).toFixed(1);
            return `${pct}% of ${total} games`;
          },
        },
        backgroundColor: '#1e293b',
        titleColor: '#f7a528',
        bodyColor: '#f1f5f9',
        padding: 10,
        cornerRadius: 6,
      },
    },
    scales: {
      x: {
        title: { display: true, text: statLabel, font: { size: 12 } },
        ticks: { maxRotation: 45, font: { size: 11 } },
      },
      y: {
        title: { display: true, text: 'Games', font: { size: 12 } },
        beginAtZero: true,
        ...(yMax !== undefined ? { max: yMax } : {}),
        ticks: { stepSize: 1, font: { size: 11 } },
      },
    },
  };

  destroyChart();
  chartInstance = new Chart(els.histogramCanvas, { type: 'bar', data: chartData, options });
}

function formatBinEdge(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

/* ══════════════════════════════════════════════
   STATS PANEL
   ══════════════════════════════════════════════ */

function renderStatsPanel() {
  const statLabel = STAT_LABELS[state.selectedStat] || state.selectedStat;
  const playerName = state.selectedPlayer?.name || '';

  if (!playerName) {
    els.statsPanelTitle.textContent = 'Statistics';
    els.statsPanelGrid.innerHTML = '<p class="stat-metric-empty">Select a player and season to view stats.</p>';
    return;
  }

  els.statsPanelTitle.textContent = `${statLabel} — ${state.currentSeason}`;

  // Get pre-computed stats from stats.json
  const key = `${state.currentSeason}|${state.seasonType}`;
  const players = state.allData?.data[key] || [];
  const playerRecord = players.find(p => p.name === playerName);
  const statRecord = playerRecord?.stats[state.selectedStat] || null;

  // Get raw values for games count confirmation
  const values = getPlayerValues();
  const gp = playerRecord?.gp ?? (values?.length ?? null);

  function metricHtml(label, value, accent = false) {
    const cls = accent ? 'stat-metric-value accent' : 'stat-metric-value';
    return `<div class="stat-metric">
      <span class="stat-metric-label">${label}</span>
      <span class="${cls}">${value ?? '—'}</span>
    </div>`;
  }

  if (!statRecord && !values) {
    els.statsPanelGrid.innerHTML = `<p class="stat-metric-empty">No data for ${playerName} in ${state.currentSeason} ${state.seasonType}.</p>`;
    return;
  }

  const cr   = statRecord?.cr   !== undefined ? (statRecord.cr !== null ? statRecord.cr.toFixed(4) : 'N/A')  : '—';
  const avg  = statRecord?.avg  !== undefined ? statRecord.avg.toFixed(3)  : '—';
  const std  = statRecord?.std  !== undefined ? statRecord.std.toFixed(3)  : '—';
  const rank = statRecord?.rank !== undefined ? `#${statRecord.rank}`      : '—';
  const pct  = statRecord?.pct  !== undefined ? `${statRecord.pct}%`       : '—';

  els.statsPanelGrid.innerHTML =
    metricHtml('Games', gp ?? '—') +
    metricHtml('Average', avg) +
    metricHtml('Std Dev', std) +
    metricHtml('CR', cr, true) +
    metricHtml('Rank', rank, true) +
    metricHtml('Percentile', pct, true);
}

/* ══════════════════════════════════════════════
   SEASON / SEASON TYPE
   ══════════════════════════════════════════════ */

function populateSeasonSelect() {
  els.playerSeasonSelect.innerHTML = '';
  for (const season of state.seasons) {
    const opt = document.createElement('option');
    opt.value = season;
    opt.textContent = season;
    els.playerSeasonSelect.appendChild(opt);
  }
  if (state.seasons.length) {
    state.currentSeason = state.seasons[0];
    els.playerSeasonSelect.value = state.currentSeason;
  }
}

function updateSeasonTypeBtns() {
  els.pBtnRegular.classList.toggle('active', state.seasonType === 'Regular Season');
  els.pBtnPlayoffs.classList.toggle('active', state.seasonType === 'Playoffs');
}

/* ══════════════════════════════════════════════
   EVENT BINDINGS
   ══════════════════════════════════════════════ */

function bindEvents() {
  // Player search input
  els.playerSearchInput.addEventListener('input', () => {
    const q = els.playerSearchInput.value.trim();
    showAcDropdown(q);
  });

  els.playerSearchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); acMoveSelection(1); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); acMoveSelection(-1); }
    if (e.key === 'Enter') {
      const items = els.playerAcDropdown.querySelectorAll('li');
      if (acFocusIdx >= 0 && items[acFocusIdx]) {
        selectPlayer(items[acFocusIdx].textContent.trim());
      } else {
        const q = els.playerSearchInput.value.trim();
        if (q) selectPlayer(q);
        hideAcDropdown();
      }
    }
    if (e.key === 'Escape') hideAcDropdown();
  });

  els.playerSearchInput.addEventListener('blur', () => {
    setTimeout(hideAcDropdown, 150);
  });

  // Season select
  els.playerSeasonSelect.addEventListener('change', async () => {
    state.currentSeason = els.playerSeasonSelect.value;
    await refreshView();
    updateCompareButtonLabel();
  });

  // Season type toggle
  [els.pBtnRegular, els.pBtnPlayoffs].forEach(btn => {
    btn.addEventListener('click', async () => {
      state.seasonType = btn.dataset.value;
      updateSeasonTypeBtns();
      await refreshView();
      updateCompareButtonLabel();
    });
  });

  // Stat select
  els.statSelect.addEventListener('change', () => {
    state.selectedStat = els.statSelect.value;
    resetAxisOverrides();
    renderHistogram();
    renderStatsPanel();
  });

  // Bin mode toggle
  els.binModeSelect.addEventListener('change', () => {
    state.binMode = els.binModeSelect.value;
    els.binCountGroup.hidden = state.binMode !== 'count';
    els.binWidthGroup.hidden = state.binMode !== 'width';
    renderHistogram();
  });

  // Apply histogram settings
  els.applyHistBtn.addEventListener('click', () => {
    state.binCount = parseInt(els.binCountInput.value, 10) || 10;
    state.binWidth = parseFloat(els.binWidthInput.value)  || 5;
    state.xMin = els.xMinInput.value !== '' ? parseFloat(els.xMinInput.value) : null;
    state.xMax = els.xMaxInput.value !== '' ? parseFloat(els.xMaxInput.value) : null;
    state.yMax = els.yMaxInput.value !== '' ? parseFloat(els.yMaxInput.value) : null;
    renderHistogram();
  });

  // Reset histogram settings
  els.resetHistBtn.addEventListener('click', () => {
    resetAxisOverrides();
    state.binCount = 10;
    state.binWidth = 5;
    state.binMode = 'count';
    els.binModeSelect.value = 'count';
    els.binCountGroup.hidden = false;
    els.binWidthGroup.hidden = true;
    els.binCountInput.value = 10;
    els.binWidthInput.value = 5;
    els.xMinInput.value = '';
    els.xMaxInput.value = '';
    els.yMaxInput.value = '';
    renderHistogram();
  });

  els.comparePlayerBtn.addEventListener('click', () => {
    if (!state.selectedPlayer) return;

    if (state.comparePlayer) {
      state.comparePlayer = null;
      if (els.comparePlayerSelect) els.comparePlayerSelect.value = '';
      updateCompareButtonLabel();
      renderHistogram();
      return;
    }

    const selectedName = els.comparePlayerSelect?.value || '';
    if (!selectedName) return;
    const candidate = findCurrentSeasonPlayerByName(selectedName);
    if (!candidate || candidate.name === state.selectedPlayer.name) return;
    state.comparePlayer = { id: candidate.id, name: candidate.name };
    updateCompareButtonLabel();
    renderHistogram();
  });

  els.comparePlayerSelect.addEventListener('change', () => {
    const selectedName = els.comparePlayerSelect?.value || '';
    if (state.comparePlayer && state.comparePlayer.name !== selectedName) {
      state.comparePlayer = null;
      renderHistogram();
    }
    updateCompareButtonLabel();
  });

  els.normalTrendlineToggle.addEventListener('change', () => {
    state.showNormalTrendline = els.normalTrendlineToggle.checked;
    renderHistogram();
  });
}

function resetAxisOverrides() {
  state.xMin = null;
  state.xMax = null;
  state.yMax = null;
  els.xMinInput.value = '';
  els.xMaxInput.value = '';
  els.yMaxInput.value = '';
}

/* ══════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════ */

async function init() {
  els.footerYear.textContent = new Date().getFullYear();
  els.normalTrendlineToggle.checked = state.showNormalTrendline;

  const ok = await loadStatsData();
  if (!ok) {
    els.histogramTitle.textContent = 'Failed to load data. Please refresh the page.';
    return;
  }

  populateSeasonSelect();
  updateSeasonTypeBtns();
  populateComparePlayerSelect();
  updateCompareButtonLabel();
  bindEvents();

  // Check for ?player=Name query param
  const params = new URLSearchParams(window.location.search);
  const playerParam = params.get('player');
  if (playerParam) {
    els.playerSearchInput.value = playerParam;
    await selectPlayer(playerParam);
  }
}

document.addEventListener('DOMContentLoaded', init);
