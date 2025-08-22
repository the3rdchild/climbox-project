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
      air_temp: ['Temp udara','Air Temp (C)','air temp','air_temp','temperature'],
      humidity: ['Air Humidity (%)','Humidity','humidity','humid','Air Humidity'],
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
    meteorologi: [
      "Wind Direction",
      "Wind Speed (km/h)",
      "Air Temp (C)",
      "Air Humidity (%)"
    ],
    presipitasi: [
      "Rainfall (mm)",
      "Distance (mm)"
    ],
    kualitas_fisika: [
      "Water Temp (C)",
      "EC (ms/cm)",
      "Latitude",
      "Longitude"
    ],
    kualitas_kimia_dasar: [
      "TDS (ppm)",
      "pH"
    ],
    kualitas_kimia_lanjut: [
      "DO (ug/L)",
      "Pompa Air Laut",
      "Pompa Bilas"
    ],
    kualitas_turbiditas: [
      "TSS (V)"
    ]
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

  // Try MM/DD/YYYY HH:MM:SS style
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
// safe text setter
function setSafeText(el, txt) {
  if (!el) return;
  el.textContent = (txt === null || txt === undefined || txt === '') ? '--' : String(txt);
}

// format number with optional unit
function fmtNumber(v, unit) {
  if (v === null || v === undefined) return '--';
  if (typeof v === 'number') {
    // round nicely
    const n = Math.round(v * 100) / 100;
    return (unit ? `${n}${unit}` : String(n));
  }
  // if string containing number-like value, try to convert
  const num = Number(String(v).replace(/,/g,''));
  if (!Number.isNaN(num)) {
    const n = Math.round(num * 100) / 100;
    return (unit ? `${n}${unit}` : String(n));
  }
  // otherwise return raw string (e.g., ON/OFF)
  return String(v);
}

  function renderGroupToCard(cardEl, groupName, groupData, timestamp, meta = {}) {
    if(!cardEl) return;
  
    // write last-updated (timestamp) if present
    const lastEls = Array.from(cardEl.querySelectorAll('.last-updated'));
    if (lastEls.length && timestamp) {
      lastEls.forEach(le => setSafeText(le, `Last data received: ${timestamp}`));
    }
  
    // Fill group-metrics: list top entries (up to 4)
    let listEl = cardEl.querySelector('.group-metrics');
    if(!listEl){
      listEl = document.createElement('div');
      listEl.className = 'group-metrics mt-3';
      const body = cardEl.querySelector('.card-body') || cardEl;
      body.appendChild(listEl);
    }
    listEl.innerHTML = '';
    const entries = Object.entries(groupData || {});
    // sort numeric first then strings so numeric appears as primary
    const sorted = entries.sort((a,b) => {
      const an = (typeof a[1] === 'number') ? 0 : 1;
      const bn = (typeof b[1] === 'number') ? 0 : 1;
      return an - bn;
    });
  
    // Build map of first values to populate the specific selectors in each card
    const values = {};
    entries.forEach(([k,v]) => { values[k] = v; });
  
    // Card-specific placements based on data-group attribute
    const group = (groupName || '').toLowerCase();
  
    // METEOROLOGI card (timestamp placed BEFORE .ms-auto)
    if (group === 'meteorologi') {
      const bigN = cardEl.querySelector('.big-n');
      // big metric -> Air Temp (°C) if available, else Wind Speed
      const air = values[ normalizeKey('Air Temp (C)') ] ?? values[ normalizeKey('Temp udara') ];
      const windSpeed = values[ normalizeKey('Wind Speed (km/h)') ];
      setSafeText(bigN, fmtNumber(asNumberOrNull(air) ?? asNumberOrNull(windSpeed), '°C'));

      // small fields
      setSafeText(cardEl.querySelector('.field-surface-temp'), values[ normalizeKey('Wind Direction') ] ?? '-');
      setSafeText(cardEl.querySelector('.field-historical-max'), fmtNumber(asNumberOrNull(windSpeed), ' km/h'));
      setSafeText(cardEl.querySelector('.field-note'), (values[ normalizeKey('Air Humidity (%)') ] ? `RH ${fmtNumber(asNumberOrNull(values[ normalizeKey('Air Humidity (%)') ]), '%')}` : '--'));

      // --- last-updated: create/find element and insert BEFORE .ms-auto ---
      let lastEl = cardEl.querySelector('.last-updated');
      // prefer a dedicated small wrapper so styling matches others
      if (!lastEl) {
        lastEl = document.createElement('div');
        lastEl.className = 'muted last-updated';
        lastEl.style.marginTop = '8px';
        // insert before ms-auto if exists, otherwise append to card-body
        const barStrip = cardEl.querySelector('.ms-auto2');
        if (barStrip && barStrip.parentNode) {
          barStrip.parentNode.insertBefore(lastEl, barStrip);
        } else {
          const body = cardEl.querySelector('.card-body') || cardEl;
          body.appendChild(lastEl);
        }
      }

      // Format timestamp nicely (use parseMaybeGvizDate if available), show in Indonesian locale
      if (timestamp) {
        let dt = null;
        try {
          if (typeof parseMaybeGvizDate === 'function') dt = parseMaybeGvizDate(timestamp);
          if (!dt) dt = new Date(timestamp);
        } catch (e) { dt = new Date(timestamp); }
        const tsText = (dt && !isNaN(dt.getTime())) ? dt.toLocaleString('id-ID') : String(timestamp);
        setSafeText(lastEl, `Last data received: ${tsText}`);
      } else {
        setSafeText(lastEl, 'Last data received: --');
      }
    }
  
    // PRESIPITASI card
    else if (group === 'presipitasi') {
      const big = cardEl.querySelector('.big-n');
      const alt = cardEl.querySelector('.field-alt');
      const rainfall = values[ normalizeKey('Rainfall (mm)') ];
      const dist = values[ normalizeKey('Distance (mm)') ];
      setSafeText(big, fmtNumber(asNumberOrNull(rainfall), ' mm'));
      setSafeText(alt, fmtNumber(asNumberOrNull(dist), ' mm'));
    }
  
    // KUALITAS FISIKA
    else if (group === 'kualitas_fisika') {
      const big = cardEl.querySelector('.big-n');
      const ecBig = cardEl.querySelector('.field-ec-big');
      const coordsEl = cardEl.querySelector('.field-coords');
      const last = cardEl.querySelector('.last-updated');
    
      // values from normalized map (values keys are normalized)
      const waterTemp = groupData[ normalizeKey('Water Temp (C)') ] ?? groupData[ normalizeKey('WaterTemp') ];
      const ec = groupData[ normalizeKey('EC (ms/cm)') ] ?? groupData[ normalizeKey('EC') ];
      const lat = groupData[ normalizeKey('Latitude') ];
      const lon = groupData[ normalizeKey('Longitude') ];
      updateArrowFromWaterTemp(waterTemp);
      function updateArrowFromWaterTemp(waterTemp) {
        const min = 20, max = 38;
        const clamped = Math.max(min, Math.min(max, waterTemp));
        const t = (clamped - min) / (max - min); // 0..1
      
        // MAPPING utama: kiri = 0°, kanan = 180°
        const startAngle = -90;   // kiri
        const endAngle   = 180; // kanan
      
        let angle = startAngle + t * (endAngle - startAngle);
      
        // normalisasi agar nilai rotasi tetap rapi (-180..180)
        angle = ((angle + 180) % 360) - 180;
      
        // Jika panah default menghadap "atas", set orientationOffset = -90
        // Jika panah default menghadap "kanan", biarkan 0
        const orientationOffset = 0;
        angle += orientationOffset;
      
        const arrow = document.getElementById("arrow-pointer");
        if (arrow) arrow.setAttribute("transform", `rotate(${angle} 21 21)`);
      }
      

      // big metrics
      setSafeText(big, fmtNumber(asNumberOrNull(waterTemp), '°C'));
      if (ecBig) setSafeText(ecBig, fmtNumber(asNumberOrNull(ec), ''));
    
      // coords (small)
      if (coordsEl) {
        const latTxt = (lat === undefined || lat === null || lat === '') ? '-' : String(lat);
        const lonTxt = (lon === undefined || lon === null || lon === '') ? '-' : String(lon);
        setSafeText(coordsEl, `Lat: ${latTxt}, Lon: ${lonTxt}`);
      }
    
      // timestamp - keep at bottom
      if (last && timestamp) {
        setSafeText(last, `Last data received: ${timestamp}`);
      }
    }
  
    // KUALITAS KIMIA DASAR
    else if (group === 'kualitas_kimia_dasar') {
      const big = cardEl.querySelector('.big-n');
      const detailA = cardEl.querySelector('.field-detail-a');
      const tds = values[ normalizeKey('TDS (ppm)') ];
      const ph = values[ normalizeKey('pH') ];
      setSafeText(big, fmtNumber(asNumberOrNull(tds), ' ppm'));
      setSafeText(detailA, fmtNumber(asNumberOrNull(ph), ''));
      // populate group-metrics with top entries
      listEl.innerHTML = '';
      [['pH', ph], ['TDS', tds]].forEach(([k,v])=>{
        const row = document.createElement('div');
        row.className = 'd-flex justify-content-between';
        row.innerHTML = `<div class="muted small">${k}</div><div class="fw-bold small">${v===null||v===undefined?'-':fmtNumber(asNumberOrNull(v), (k==='pH'?'':' ppm'))}</div>`;
        listEl.appendChild(row);
      });
    }
  
    // KUALITAS KIMIA LANJUT (tweak: do NOT render group-metrics; only primary/secondary + timestamp)
    else if (group === 'kualitas_kimia_lanjut') {
      const primaryEl = cardEl.querySelector('.field-primary') || cardEl.querySelector('.big-n');
      const secondaryEl = cardEl.querySelector('.field-secondary');
      const last = cardEl.querySelector('.last-updated');

      // normalized keys
      const doVal = groupData[ normalizeKey('DO (ug/L)') ];
      const pump1 = groupData[ normalizeKey('Pompa Air Laut') ];
      const pump2 = groupData[ normalizeKey('Pompa Bilas') ];

      // primary: DO (numeric preferred)
      setSafeText(primaryEl, fmtNumber(asNumberOrNull(doVal), ' mg/L'));

      // secondary: show pumps as single compact string (or fallback '--')
      const pumps = [];
      if (pump1 !== undefined && pump1 !== null && String(pump1).trim() !== '') pumps.push(`Pompa Laut: ${pump1}`);
      if (pump2 !== undefined && pump2 !== null && String(pump2).trim() !== '') pumps.push(`Pompa Bilas: ${pump2}`);
      setSafeText(secondaryEl, pumps.length ? pumps.join(' ') : '--');

      // hide / clear the group-metrics container for this card so injected rows won't show
      const listEl = cardEl.querySelector('.group-metrics');
      if (listEl) {
        listEl.innerHTML = '';
        listEl.style.display = 'none'; // keep element in DOM but hidden (safe)
      }

      // timestamp: keep at bottom
      if (last && timestamp) {
        setSafeText(last, `Last data received: ${timestamp}`);
      }
    }
 
    // KUALITAS TURBIDITAS
    else if (group === 'kualitas_turbiditas') {
      const big = cardEl.querySelector('.big-n');
      const fieldDepth = cardEl.querySelector('.field-depth');
      const tss = values[ normalizeKey('TSS (V)') ];
      setSafeText(big, fmtNumber(asNumberOrNull(tss), ''));
      setSafeText(fieldDepth, fmtNumber(asNumberOrNull(tss), ''));
    }
  
    // Generic fallback: if group not matched, fill group-metrics
    if (!group) {
      listEl.innerHTML = '';
      entries.slice(0,4).forEach(([k,v])=>{
        const row = document.createElement('div');
        row.className = 'd-flex justify-content-between';
        row.innerHTML = `<div class="muted small">${k}</div><div class="fw-bold small">${v===null||v===undefined?'-':v}</div>`;
        listEl.appendChild(row);
      });
    }
  }

  function processRowsAndRenderCards(rows, meta = {}) {
    if (!rows || !Array.isArray(rows) || rows.length === 0) return;
    // take latest row (real-time snapshot)
    const lastRow = rows[rows.length - 1];
  
    // flatten keys: normalizeKey used by pickField; but renderer expects normalized-key lookup
    const flat = {};
    Object.keys(lastRow || {}).forEach(k => {
      flat[ normalizeKey(k) ] = lastRow[k];
    });
  
    // create grouped object
    const grouped = { timestamp: pickField(lastRow, cfg.KEYS.timestamp) || (lastRow.Timestamp||lastRow.timestamp||null), groups: {} };
    for (const [gname, fields] of Object.entries(SENSOR_GROUPS)) {
      grouped.groups[gname] = {};
      for (const field of fields) {
        const nk = normalizeKey(field);
        grouped.groups[gname][nk] = (flat[nk] !== undefined ? flat[nk] : null);
      }
    }
  
    // render each card by data-group attribute
    const order = ['meteorologi','presipitasi','kualitas_fisika','kualitas_kimia_dasar','kualitas_kimia_lanjut','kualitas_turbiditas'];
    order.forEach((grpName) => {
      const cardEl = document.querySelector(`[data-group="${grpName}"]`);
      if (cardEl) {
        try {
          renderGroupToCard(cardEl, grpName, grouped.groups[grpName] || {}, grouped.timestamp, meta);
        } catch (e) {
          console.warn('renderGroupToCard error', grpName, e);
        }
      }
    });
  
    // cache the last raw rows for offline fallback (existing behavior)
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
    cfg.LOCATION_ID = cfg.LOCATION_ID || qloc ;

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
