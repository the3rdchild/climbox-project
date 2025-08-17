/* graph-fetch.js
   GViz (history only) + MQTT (cards only)
   - Expects window.chart1/chart2/chart3 to exist (created in graph.html)
   - Expects window.CLIMBOX_CONFIG override available before load (optional)
   - Reads sheetId from CLIMBOX_CONFIG.SHEET_ID or from locations.json mapping
*/
(() => {
  const DEFAULTS = {
    LOCATION_ID: 'pulau_komodo',
    HISTORY_POINTS: 20,
    LOCATIONS_JSON: '../assets/data/locations.json',
    GVIZ_RANGE: 'A:Z',
    SHEET_NAME_TOKEN_DATE: '{date}',
    CACHE_PREFIX: 'climbox_cache',
    // keys used for chart extraction (candidate labels, lower-cased variants ok)
    KEYS: {
      timestamp: ['Timestamp','timestamp','time','date'],
      water_temp: ['Water Temp (C)','water temp','water_temp','water temp (c)'],
      air_temp: ['Temp udara','air temp','air_temp','temperature'],
      humidity: ['Humidity','humidity','humid'],
      tss: ['TSS (V)','tss','tss_v'],
      ph: ['pH','ph'],
      do_: ['DO (ug/L)','do','do_ug_l'],
      ec: ['EC (ms/cm)','ec','ec_ms_cm'],
      tds: ['TDS (ppm)','tds','tds_ppm']
    },

    // MQTT defaults (browser)
    MQTT_WS: '', // e.g. 'wss://broker.emqx.io:8084/mqtt' (set via CLIMBOX_CONFIG)
    MQTT_USERNAME: '',
    MQTT_PASSWORD: '',
    MQTT_TOPIC_BASE: 'climbox',
    MQTT_SUBSCRIBE_WILDCARD: true,
    MQTT_RECONNECT_PERIOD_MS: 5000
  };

  const cfg = Object.assign({}, DEFAULTS, window.CLIMBOX_CONFIG || {});

  // ---------- helpers ----------
  function normalizeKey(key) {
    if (key === undefined || key === null) return '';
    return String(key).trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function todayDateString() {
    return new Date().toISOString().slice(0,10);
  }

  function resolveSheetNameFromMapping(mapping, explicit) {
    if (explicit && String(explicit).trim()) {
      const s = String(explicit).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `data_${s}`;
      return s;
    }
    const mapped = mapping && mapping.sheetName ? String(mapping.sheetName) : '';
    if (mapped.includes(cfg.SHEET_NAME_TOKEN_DATE)) {
      return mapped.replace(cfg.SHEET_NAME_TOKEN_DATE, todayDateString());
    }
    if (/^data_\d{4}-\d{2}-\d{2}$/.test(mapped)) {
      return `data_${todayDateString()}`;
    }
    return mapped || `data_${todayDateString()}`;
  }

  // fetch text with no-store
  async function fetchTextNoStore(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`fetch ${url} failed ${resp.status}`);
    return resp.text();
  }

  // parse GViz wrapper -> JSON
  function parseGvizText(text) {
    const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)\s*;?$/);
    if (!m || !m[1]) throw new Error('Unexpected GViz response');
    return JSON.parse(m[1]);
  }

  // table -> array of objects
  function tableToRows(table) {
    if (!table || !Array.isArray(table.cols)) return [];
    const headers = table.cols.map(c => (c.label || c.id || '').toString());
    const rows = (table.rows || []).map(r => {
      const obj = {};
      for (let i=0;i<headers.length;i++){
        const cell = r.c && r.c[i] ? r.c[i] : null;
        const val = cell ? (cell.v !== undefined && cell.v !== null ? cell.v : (cell.f !== undefined ? cell.f : null)) : null;
        obj[headers[i] || `col_${i}`] = val;
      }
      return obj;
    });
    return rows;
  }

  // Try to find field value in a raw row using candidate labels
  function pickField(row, candidates) {
    if (!row || !candidates) return null;
    for (const cand of candidates) {
      const norm = normalizeKey(cand);
      const key = Object.keys(row).find(k => normalizeKey(k) === norm);
      if (key) return row[key];
    }
    // fallback: case-insensitive substring match
    const lowcands = candidates.map(c=>normalizeKey(c));
    for (const k of Object.keys(row)) {
      const nk = normalizeKey(k);
      for (const lc of lowcands) {
        if (nk.includes(lc) || lc.includes(nk)) return row[k];
      }
    }
    return null;
  }

  function asNumberOrNull(v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim()==='')) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).replace(/,/g,'').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Build grouped object (for cards) based on SENSOR_GROUPS mapping
  const SENSOR_GROUPS = {
    meteorologi: ["Wind Direction","Wind Speed (km/h)","Temp udara"],
    presipitasi: ["Rainfall (mm)","Distance (mm)"],
    kualitas_fisika: ["Water Temp (C)","EC (ms/cm)"],
    kualitas_kimia_dasar: ["TDS (ppm)","pH"],
    kualitas_kimia_lanjut: ["DO (ug/L)"],
    kualitas_turbiditas: ["TSS (V)"]
  };

  function buildGroupForRow(rawRow) {
    const flat = {};
    Object.keys(rawRow || {}).forEach(k => {
      flat[ normalizeKey(k) ] = rawRow[k];
    });
    const grouped = { timestamp: flat['timestamp'] || flat['time'] || flat['timestamp_iso'] || null, groups: {} };
    for (const [gname, fields] of Object.entries(SENSOR_GROUPS)) {
      grouped.groups[gname] = {};
      for (const field of fields) {
        const nk = normalizeKey(field);
        let val = flat[nk] !== undefined ? flat[nk] : null;
        if (val !== null && val !== '' && !Number.isNaN(Number(String(val).replace(/,/g,'')))) {
          val = Number(String(val).replace(/,/g,''));
        }
        grouped.groups[gname][nk] = val;
      }
    }
    return grouped;
  }

  // ---------- charts: prepare arrays ----------
// ---- add helper: parse GViz Date(...) or ISO or common MM/DD/YYYY HH:MM:SS
function pad(n) { return String(n).padStart(2, '0'); }

function parseMaybeGvizDate(v) {
  if (v === null || v === undefined) return null;

  // If GViz produced a Date(...) string (common)
  if (typeof v === 'string' && v.trim().startsWith('Date(')) {
    const m = /Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/.exec(v);
    if (m) {
      // Note: month in GViz Date(...) is zero-based already
      return new Date(
        Number(m[1]), Number(m[2]), Number(m[3]),
        Number(m[4]), Number(m[5]), Number(m[6] || 0)
      );
    }
  }

  // If it's already a Date object
  if (v instanceof Date) {
    if (!isNaN(v.getTime())) return v;
  }

  // If numeric timestamp
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }

  // Try ISO / common string parse
  try {
    const d = new Date(String(v));
    if (!isNaN(d.getTime())) return d;
  } catch(e){}

  // Try MM/DD/YYYY HH:MM:SS style (e.g. "8/14/2025 23:59:05")
  try {
    const s = String(v).trim();
    const parts = s.split(' ');
    if (parts.length >= 1 && parts[0].includes('/')) {
      const dparts = parts[0].split('/');
      if (dparts.length === 3) {
        const month = parseInt(dparts[0], 10);
        const day = parseInt(dparts[1], 10);
        const year = parseInt(dparts[2], 10);
        const timePart = parts[1] || '00:00:00';
        const t = timePart.split(':').map(x => parseInt(x, 10) || 0);
        const dt = new Date(year, month - 1, day, t[0] || 0, t[1] || 0, t[2] || 0);
        if (!isNaN(dt.getTime())) return dt;
      }
    }
  } catch(e){}

  return null;
}

// ---- replace prepareChartArraysFromRows with this (returns labels already as "HH:MM:SS")
function prepareChartArraysFromRows(rows, maxPoints = 7) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const slice = rows.slice(-Math.max(1, maxPoints));

  // labels -> formatted time HH:MM:SS
  const labels = slice.map(r => {
    const rawTs = pickField(r, cfg.KEYS.timestamp);
    const dt = parseMaybeGvizDate(rawTs);
    if (dt) {
      return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    }
    // fallback: try string and trim
    if (rawTs !== null && rawTs !== undefined) {
      try {
        const dt2 = new Date(String(rawTs));
        if (!isNaN(dt2.getTime())) return `${pad(dt2.getHours())}:${pad(dt2.getMinutes())}:${pad(dt2.getSeconds())}`;
      } catch(e){}
      return String(rawTs).slice(0, 8); // best-effort
    }
    return '';
  });

  const c1_wt = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.water_temp)));
  const c1_hum = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.humidity)));
  const c1_air = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.air_temp)));

  const c2_tss = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.tss)));
  const c2_ph = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.ph)));

  const c3_do = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.do_)));
  const c3_ec = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.ec)));
  const c3_tds = slice.map(r => asNumberOrNull(pickField(r, cfg.KEYS.tds)));

  return {
    labels,
    chart1: [c1_wt, c1_hum, c1_air],
    chart2: [c2_tss, c2_ph],
    chart3: [c3_do, c3_ec, c3_tds]
  };
}


  // safe chart setter
  function safeSetChart(chart, labels, datasetArrays) {
    if (!chart || !chart.data) return;
    chart.data.labels = Array.isArray(labels) ? labels.slice() : [];
    datasetArrays.forEach((arr, idx) => {
      if (!chart.data.datasets[idx]) return;
      chart.data.datasets[idx].data = Array.isArray(arr) ? arr.slice() : [];
    });
    try { chart.update(); } catch(e){ console.warn('chart update failed', e); }
  }

  // ---------- cards rendering ----------
  function getTargetCards(){
    const container = document.querySelector('.container-fluid.py-4 .row.g-3');
    if(!container) return [];
    const cardsByAttr = Array.from(container.querySelectorAll('[data-group]'));
    if(cardsByAttr.length >= 6) return cardsByAttr;
    const cols = Array.from(container.children).filter(c => c.querySelector && c.querySelector('.card'));
    return cols.slice(0,6).map(col => col.querySelector('.card'));
  }

  function humanizeKey(k){ return String(k).replace(/_/g,' ').toUpperCase(); }

  function renderGroupToCard(cardEl, groupName, groupData, timestamp){
    if(!cardEl) return;
    const titleEl = cardEl.querySelector('.title');
    if(titleEl) titleEl.textContent = humanizeKey(groupName);

    const entries = Object.entries(groupData || {});
    let main = entries.find(([k,v]) => typeof v === 'number');
    if(!main) main = entries[0] || [null, null];
    const [mainKey, mainVal] = main;

    const bigN = cardEl.querySelector('.big-n') || cardEl.querySelector('.h3') || cardEl.querySelector('.h2');
    if(bigN){
      bigN.textContent = (mainVal !== null && mainVal !== undefined) ? String(mainVal) : '-';
      const k = mainKey || '';
      let unit = '';
      if(k.includes('km') || k.includes('speed')) unit = ' km/h';
      if(k.includes('temp') || k.includes('c')) unit = '°C';
      if(k.includes('mm')) unit = ' mm';
      if(k.includes('ppm')) unit = ' ppm';
      if(k.includes('ug') || k.includes('do')) unit = ' µg/L';
      if(k.includes('ec')) unit = ' mS/cm';
      if(unit) bigN.innerHTML = `${bigN.textContent}<small class="muted">${unit}</small>`;
    }

    const lastEls = Array.from(cardEl.querySelectorAll('.muted'));
    if(lastEls.length){
      const lastEl = lastEls[lastEls.length-1];
      if(timestamp) lastEl.textContent = `Last data received: ${timestamp}`;
    }

    let listEl = cardEl.querySelector('.group-metrics');
    if(!listEl){
      listEl = document.createElement('div');
      listEl.className = 'group-metrics mt-3';
      const body = cardEl.querySelector('.card-body') || cardEl;
      body.appendChild(listEl);
    }
    listEl.innerHTML = '';
    entries.slice(0,4).forEach(([k,v])=>{
      const row = document.createElement('div');
      row.className = 'd-flex justify-content-between';
      row.innerHTML = `<div class="muted small">${humanizeKey(k)}</div><div class="fw-bold small">${v===null||v===undefined||v===''?'-':v}</div>`;
      listEl.appendChild(row);
    });
  }

  function processRowsAndRenderCards(rows){
    if (!rows || !Array.isArray(rows) || rows.length === 0) return;
    const lastRow = rows[rows.length - 1];
    const grouped = buildGroupForRow(lastRow);
    const cards = getTargetCards();
    const order = ['meteorologi','presipitasi','kualitas_fisika','kualitas_kimia_dasar','kualitas_kimia_lanjut','kualitas_turbiditas'];
    order.forEach((grpName, i) => {
      const cardEl = cards[i];
      const groupData = grouped.groups[grpName] || {};
      renderGroupToCard(cardEl, grpName, groupData, grouped.timestamp);
    });
    // cache fallback
    try {
      localStorage.setItem(`${cfg.CACHE_PREFIX}_sensor_${cfg.LOCATION_ID}`, JSON.stringify({
        fetchedAt: new Date().toISOString(),
        lastTimestamp: grouped.timestamp,
        raw: rows,
        grouped
      }));
    } catch(e){}
  }

  // ---------- GViz fetch helper ----------
  async function fetchSheetViaGviz(sheetId, sheetName, range=cfg.GVIZ_RANGE) {
    if (!sheetId) throw new Error('sheetId missing');
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&range=${encodeURIComponent(range)}&tqx=out:json`;
    const txt = await fetchTextNoStore(url);
    // detect HTML responses (not JSON) - usually means not public or blocked
    if (txt.trim().startsWith('<')) throw new Error('GViz returned HTML (sheet likely not public or blocked)');
    const parsed = parseGvizText(txt);
    const rows = tableToRows(parsed.table);
    return rows;
  }

  // ---------- MQTT (browser) for cards ----------
  const mqttScriptUrl = 'https://unpkg.com/mqtt/dist/mqtt.min.js';
  let mqttClient = null, mqttConnected = false, mqttSubscribed = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        if (window.mqtt) return resolve();
        const t = setInterval(()=>{ if (window.mqtt){ clearInterval(t); resolve(); } }, 100);
        setTimeout(()=>{ if (!window.mqtt) reject(new Error('mqtt lib not available')); }, 4000);
        return;
      }
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => { if (window.mqtt) resolve(); else setTimeout(()=> window.mqtt ? resolve() : reject(new Error('mqtt lib missing after load')), 50); };
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  async function initMqttIfEnabled() {
    if (!cfg.MQTT_WS) {
      console.log('MQTT disabled (MQTT_WS not provided)');
      return;
    }
    try {
      await loadScript(mqttScriptUrl);
    } catch(e) {
      console.warn('Failed to load mqtt lib', e);
      return;
    }
    if (!window.mqtt) {
      console.warn('mqtt lib not found after load');
      return;
    }
    const opts = {
      username: cfg.MQTT_USERNAME || undefined,
      password: cfg.MQTT_PASSWORD || undefined,
      reconnectPeriod: cfg.MQTT_RECONNECT_PERIOD_MS || 5000,
      connectTimeout: 10*1000
    };
    try {
      mqttClient = window.mqtt.connect(cfg.MQTT_WS, opts);
      mqttClient.on('connect', () => { mqttConnected = true; ensureSubscribe(); console.log('MQTT connected (browser)'); });
      mqttClient.on('reconnect', () => console.log('MQTT reconnecting...'));
      mqttClient.on('close', () => { mqttConnected = false; mqttSubscribed = false; console.log('MQTT closed'); });
      mqttClient.on('offline', () => { mqttConnected = false; });
      mqttClient.on('error', (err) => console.warn('MQTT error', err && err.message ? err.message : err));
      mqttClient.on('message', (topic, message) => {
        try {
          const txt = message.toString();
          let payload = null;
          try { payload = JSON.parse(txt); } catch(e) { console.warn('mqtt msg non-json', topic); return; }
          let rows = null;
          if (Array.isArray(payload)) rows = payload;
          else if (payload && Array.isArray(payload.rows)) rows = payload.rows;
          else if (payload && Array.isArray(payload.data)) rows = payload.data;
          else if (payload && payload.Timestamp) rows = [payload];
          else if (payload && typeof payload === 'object' && Object.values(payload).some(v=>Array.isArray(v))) {
            for (const v of Object.values(payload)) if (Array.isArray(v)) { rows = v; break; }
          }
          if (!rows || !Array.isArray(rows) || rows.length === 0) { console.warn('MQTT message with no usable rows', topic); return; }
          processRowsAndRenderCards(rows);
        } catch(e) { console.error('Error handling mqtt message', e); }
      });
    } catch(e) {
      console.warn('mqtt connect failed', e);
    }
  }

  function ensureSubscribe() {
    if (!mqttClient || !mqttConnected || mqttSubscribed) return;
    const topic = cfg.MQTT_SUBSCRIBE_WILDCARD ? `${cfg.MQTT_TOPIC_BASE}/${cfg.LOCATION_ID}/#` : `${cfg.MQTT_TOPIC_BASE}/${cfg.LOCATION_ID}/latest`;
    mqttClient.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.warn('mqtt subscribe error', err);
      else { mqttSubscribed = true; console.log('Subscribed to', topic); }
    });
  }

  // ---------- load locations map ----------
  async function loadLocationsMap() {
    try {
      const r = await fetch(cfg.LOCATIONS_JSON, { cache: 'no-store' });
      if (!r.ok) throw new Error('locations.json fetch failed');
      return await r.json();
    } catch(e) {
      console.warn('loadLocationsMap failed', e);
      return [];
    }
  }

  // ---------- main init ----------
  async function init() {
    if (window.CLIMBOX_CONFIG) Object.assign(cfg, window.CLIMBOX_CONFIG);
    const urlParams = new URLSearchParams(window.location.search);
    const qloc = urlParams.get('location');
    cfg.LOCATION_ID = cfg.LOCATION_ID || qloc || 'pulau_komodo';

    // load mapping to get sheetId if not set
    const locs = await loadLocationsMap();
    const mapping = (locs || []).find(l => l.locationId === cfg.LOCATION_ID || l.id === cfg.LOCATION_ID) || null;
    const sheetId = cfg.SHEET_ID || (mapping && mapping.sheetId) || null;
    const sheetName = resolveSheetNameFromMapping(mapping, cfg.SHEET_NAME || null);

    // attempt to render from GViz
    if (sheetId) {
      try {
        const rows = await fetchSheetViaGviz(sheetId, sheetName, cfg.GVIZ_RANGE);
        const prepared = prepareChartArraysFromRows(rows, parseInt(cfg.HISTORY_POINTS || 7, 10));
        if (prepared) {
          safeSetChart(window.chart1, prepared.labels, prepared.chart1);
          safeSetChart(window.chart2, prepared.labels, prepared.chart2);
          safeSetChart(window.chart3, prepared.labels, prepared.chart3);
        } else {
          console.warn('No prepared data from GViz');
        }
        // Also update cards from last row if present
        if (Array.isArray(rows) && rows.length) processRowsAndRenderCards(rows);
        console.log('GViz loaded', { locationId: cfg.LOCATION_ID, sheetId, sheetName, rows: Array.isArray(rows)?rows.length:null });
      } catch (e) {
        // GViz may return HTML if sheet not public -> surface clear warning
        console.warn('GViz fetch/render failed (history). Make sure sheet is public if you want GViz. Error:', e && e.message ? e.message : e);
      }
    } else {
      console.warn('No sheetId available for GViz history (set window.CLIMBOX_CONFIG.SHEET_ID or add to locations.json)');
    }

    // init MQTT for cards (does not update charts)
    try {
      await initMqttIfEnabled();
    } catch(e){ console.warn('mqtt init err', e); }

    console.log('graph-fetch initialized', { locationId: cfg.LOCATION_ID, sheetId, sheetName });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose debug API
  window.CLIMBOX_GRAPH_FETCH = Object.assign(window.CLIMBOX_GRAPH_FETCH || {}, {
    cfg,
    fetchSheetViaGviz,
    prepareChartArraysFromRows,
    processRowsAndRenderCards,
    mqttClient: () => mqttClient
  });
})();
