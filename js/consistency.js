'use strict';

const DATA_URL = 'data/web/stats.json';
const GAMELOG_URL = (season, seasonType) => `data/web/gamelogs/${season}_${seasonType.replace(/ /g, '_')}.json`;

const PLAYER_A = 'DeMar DeRozan';
const PLAYER_B = 'Scottie Barnes';
const STAT = 'PTS';
const SEASON_TYPE = 'Regular Season';
const PREFERRED_SEASONS = ['2025-26', '2024-25', '2023-24'];

const FIXED_SETTINGS = {
  xMin: 0,
  xMax: 50,
  binCount: 10,
};

const els = {
  footerYear: document.getElementById('footerYear'),
  seasonText: document.getElementById('caseStudySeasonText'),
  histTitle: document.getElementById('consistencyHistogramTitle'),
  histEmpty: document.getElementById('consistencyHistEmpty'),
  canvas: document.getElementById('consistencyHistogramCanvas'),
  demarAvg: document.getElementById('demarAvg'),
  demarStd: document.getElementById('demarStd'),
  demarCr: document.getElementById('demarCr'),
  barnesAvg: document.getElementById('barnesAvg'),
  barnesStd: document.getElementById('barnesStd'),
  barnesCr: document.getElementById('barnesCr'),
};

let chartInstance = null;

function formatOneDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function formatTwoDecimals(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

function erf(x) {
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

function normalCdf(x, mean, std) {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) {
    if (x < mean) return 0;
    if (x > mean) return 1;
    return 0.5;
  }
  const z = (x - mean) / (std * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

function computeBins(values, xMin, xMax, binCount) {
  if (!values?.length || xMin >= xMax || binCount < 2) return [];
  const width = (xMax - xMin) / binCount;
  const edges = Array.from({ length: binCount + 1 }, (_, i) => xMin + i * width);
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

function computeNormalTrendline(values, bins) {
  if (!values?.length || !bins?.length) return [];
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std <= 0) return [];

  return bins.map(bin => {
    const p = Math.max(0, normalCdf(bin.x1, mean, std) - normalCdf(bin.x0, mean, std));
    return p * n;
  });
}

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

function updateStatCards(aRecord, bRecord) {
  const aPts = aRecord?.stats?.[STAT] || {};
  const bPts = bRecord?.stats?.[STAT] || {};

  els.demarAvg.textContent = formatOneDecimal(aPts.avg);
  els.demarStd.textContent = formatOneDecimal(aPts.std);
  els.demarCr.textContent = formatTwoDecimals(aPts.cr);

  els.barnesAvg.textContent = formatOneDecimal(bPts.avg);
  els.barnesStd.textContent = formatOneDecimal(bPts.std);
  els.barnesCr.textContent = formatTwoDecimals(bPts.cr);
}

function showHistogramMessage(message) {
  destroyChart();
  els.histEmpty.hidden = false;
  els.histEmpty.textContent = message;
}

function renderHistogram(season, valuesA, valuesB) {
  const binsA = computeBins(valuesA, FIXED_SETTINGS.xMin, FIXED_SETTINGS.xMax, FIXED_SETTINGS.binCount);
  const binsB = computeBins(valuesB, FIXED_SETTINGS.xMin, FIXED_SETTINGS.xMax, FIXED_SETTINGS.binCount);

  if (!binsA.length || !binsB.length) {
    showHistogramMessage('Game log data for this case study is currently unavailable.');
    return;
  }

  els.histEmpty.hidden = true;

  const labels = binsA.map(b => `${b.x0.toFixed(0)}–${b.x1.toFixed(0)}`);

  destroyChart();
  chartInstance = new Chart(els.canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `${PLAYER_A} Games`,
          data: binsA.map(b => b.count),
          backgroundColor: 'rgba(29, 53, 87, 0.72)',
          borderColor: 'rgba(29, 53, 87, 0.95)',
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: `${PLAYER_B} Games`,
          data: binsB.map(b => b.count),
          backgroundColor: 'rgba(247, 165, 40, 0.55)',
          borderColor: 'rgba(247, 165, 40, 0.95)',
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          type: 'line',
          label: `${PLAYER_A} Normal Trend`,
          data: computeNormalTrendline(valuesA, binsA),
          borderColor: 'rgba(42, 157, 143, 0.95)',
          backgroundColor: 'rgba(42, 157, 143, 0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
        {
          type: 'line',
          label: `${PLAYER_B} Normal Trend`,
          data: computeNormalTrendline(valuesB, binsB),
          borderColor: 'rgba(230, 111, 81, 0.95)',
          backgroundColor: 'rgba(230, 111, 81, 0.15)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
      },
      scales: {
        x: {
          title: { display: true, text: 'Points' },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Games' },
          ticks: { stepSize: 1 },
        },
      },
    },
  });

  els.histTitle.textContent = `${PLAYER_A} vs ${PLAYER_B} — Points Distribution (${season} ${SEASON_TYPE})`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function findCaseStudyData() {
  const stats = await fetchJson(DATA_URL);
  if (!stats) return null;

  const seasonsToTry = [...PREFERRED_SEASONS, ...(stats.seasons || [])].filter((season, idx, arr) => arr.indexOf(season) === idx);

  for (const season of seasonsToTry) {
    const key = `${season}|${SEASON_TYPE}`;
    const players = stats.data?.[key] || [];
    const aRecord = players.find(p => p.name === PLAYER_A);
    const bRecord = players.find(p => p.name === PLAYER_B);
    if (!aRecord || !bRecord) continue;

    const gameLogs = await fetchJson(GAMELOG_URL(season, SEASON_TYPE));
    if (!gameLogs) continue;

    const valuesA = gameLogs[String(aRecord.id)]?.[STAT] || [];
    const valuesB = gameLogs[String(bRecord.id)]?.[STAT] || [];

    if (valuesA.length && valuesB.length) {
      return { season, aRecord, bRecord, valuesA, valuesB };
    }
  }

  const fallbackKey = `${PREFERRED_SEASONS[0]}|${SEASON_TYPE}`;
  const fallbackPlayers = stats.data?.[fallbackKey] || [];
  return {
    season: PREFERRED_SEASONS[0],
    aRecord: fallbackPlayers.find(p => p.name === PLAYER_A) || null,
    bRecord: fallbackPlayers.find(p => p.name === PLAYER_B) || null,
    valuesA: [],
    valuesB: [],
  };
}

async function init() {
  if (els.footerYear) {
    els.footerYear.textContent = new Date().getFullYear();
  }

  const caseStudy = await findCaseStudyData();
  if (!caseStudy) {
    els.seasonText.textContent = 'Unable to load case study data at the moment.';
    showHistogramMessage('Unable to load case study chart data.');
    return;
  }

  const { season, aRecord, bRecord, valuesA, valuesB } = caseStudy;
  updateStatCards(aRecord, bRecord);

  if (aRecord?.stats?.[STAT] && bRecord?.stats?.[STAT]) {
    els.seasonText.textContent =
      `In ${season} ${SEASON_TYPE}, both players produced similar scoring averages, but their variability differed meaningfully.`;
  } else {
    els.seasonText.textContent = `Case study values are partially unavailable for ${season} ${SEASON_TYPE}.`;
  }

  renderHistogram(season, valuesA, valuesB);
}

document.addEventListener('DOMContentLoaded', init);
