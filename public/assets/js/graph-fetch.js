/* graph-fetch.js
  Usage:
    <script src="../assets/js/graph-fetch.js"></script>
  Configure by editing the constants below or set them before loading script:
    window.CLIMBOX_CONFIG = { BACKEND_BASE_URL, LOCATION_ID, POLL_SECONDS };
*/

(() => {
    // default config (override by setting window.CLIMBOX_CONFIG before this script)
    const cfg = Object.assign({
      BACKEND_BASE_URL: "http://localhost:3000",
      LOCATION_ID: "pulau_komodo",
      POLL_SECONDS: 60,
      CACHE_PREFIX: "climbox_cache",
      // sensor groups (label -> array of sheet header names)
      SENSOR_GROUPS: {
        meteorologi: ["Timestamp","Wind Direction","Wind Speed (km/h)","Temp udara"],
        presipitasi: ["Rainfall (mm)","Distance (mm)"],
        kualitas_fisika: ["Water Temp (C)","EC (ms/cm)"],
        kualitas_kimia_dasar: ["TDS (ppm)","pH"],
        kualitas_kimia_lanjut: ["DO (ug/L)"],
        kualitas_turbiditas: ["TSS (V)"]
      }
    }, window.CLIMBOX_CONFIG || {});
  
    // Helpers
    function normalizeKey(key){
      return String(key || "")
        .trim()
        .toLowerCase()
        .replace(/\(.*?\)/g, '')     // remove parentheses
        .replace(/[^a-z0-9]+/g, '_') // non-alnum -> underscore
        .replace(/^_+|_+$/g, '');    // trim underscores
    }
  
    function fetchSensorRows(locationId) {
        const url = `${cfg.BACKEND_BASE_URL.replace(/\/+$/,'')}/sensors/${encodeURIComponent(locationId)}`;
        return fetch(url, { cache: "no-store" })
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then(data => {
            // pastikan data dalam bentuk array of rows
            if (Array.isArray(data)) return data;
            if (Array.isArray(data.rows)) return data.rows; // kalau backend kirim { rows: [...] }
            throw new Error("Invalid backend data format");
          });
      }
      
      function startPolling() {
        fetchAndRenderOnce(); // run pertama
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(fetchAndRenderOnce, 10 * 1000); // update setiap 10 detik
      }
      
  
    // Build grouped object from a raw sheet row (header keys)
    function buildGroupForRow(rawRow){
      const flat = {};
      Object.keys(rawRow).forEach(k=>{
        flat[ normalizeKey(k) ] = rawRow[k];
      });
  
      const grouped = { timestamp: flat['timestamp'] || flat['timestamp_iso'] || flat['time'] || null, groups: {} };
      Object.entries(cfg.SENSOR_GROUPS).forEach(([groupName, fields])=>{
        grouped.groups[groupName] = {};
        fields.forEach(fieldLabel=>{
          const nk = normalizeKey(fieldLabel);
          // parse numeric values where possible
          let rawVal = flat[nk] !== undefined ? flat[nk] : null;
          if (rawVal !== null && rawVal !== '' && !Number.isNaN(Number(String(rawVal).replace(/,/g,'')))) {
            rawVal = Number(String(rawVal).replace(/,/g,''));
          }
          grouped.groups[groupName][nk] = rawVal;
        });
      });
      return grouped;
    }
  
    // UI helpers: find cards, render group into a card
    function getTargetCards(){
      const container = document.querySelector('.container-fluid.py-4 .row.g-3');
      if(!container) return [];
      // prefer explicit data-group attribute on cards
      const cardsByAttr = Array.from(container.querySelectorAll('[data-group]'));
      if(cardsByAttr.length >= 6) return cardsByAttr;
      // fallback: take first 6 .card elements inside the row (preserve order)
      const cols = Array.from(container.children).filter(c => c.querySelector && c.querySelector('.card'));
      return cols.slice(0,6).map(col => col.querySelector('.card'));
    }
  
    function humanizeKey(k){ return String(k).replace(/_/g,' ').toUpperCase(); }
  
    function renderGroupToCard(cardEl, groupName, groupData, timestamp){
      if(!cardEl) return;
      const titleEl = cardEl.querySelector('.title');
      if(titleEl) titleEl.textContent = humanizeKey(groupName);
  
      // choose main metric: first numeric value
      const entries = Object.entries(groupData || {});
      let main = entries.find(([k,v]) => typeof v === 'number');
      if(!main) main = entries[0] || [null, null];
      const [mainKey, mainVal] = main;
  
      const bigN = cardEl.querySelector('.big-n') || cardEl.querySelector('.h3') || cardEl.querySelector('.h2');
      if(bigN){
        bigN.textContent = (mainVal !== null && mainVal !== undefined) ? String(mainVal) : '-';
        // heuristic unit labels
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
  
      // last update text
      const lastEls = Array.from(cardEl.querySelectorAll('.muted'));
      if(lastEls.length){
        const lastEl = lastEls[lastEls.length-1];
        if(timestamp) lastEl.textContent = `Last data received: ${timestamp}`;
      }
  
      // metrics list area
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
  
    // localStorage caching
    function cacheKeyForLocation(loc) {
      return `${cfg.CACHE_PREFIX}_sensor_${loc}`;
    }
    function saveCache(locationId, payload) {
      try {
        localStorage.setItem(cacheKeyForLocation(locationId), JSON.stringify(payload));
      } catch (e) { console.warn('saveCache error', e); }
    }
    function loadCache(locationId) {
      try {
        const s = localStorage.getItem(cacheKeyForLocation(locationId));
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    }
    // download cache as file
    function downloadCache(locationId){
      const payload = loadCache(locationId);
      if(!payload) return alert('No cache available');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${locationId}_sensor_cache_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
    }
    // expose download function globally
    window.CLIMBOX_DOWNLOAD_CACHE = () => downloadCache(cfg.LOCATION_ID || cfg.locationId);
  
    // main fetch & update routine
    async function fetchAndRenderOnce(){
      try {
        const rows = await fetchSensorRows(cfg.LOCATION_ID || cfg.locationId);
        if(!Array.isArray(rows) || rows.length === 0) {
          console.warn('no rows returned');
          return;
        }
        // choose last row as most recent (or backend could sort)
        const lastRow = rows[rows.length - 1];
        const grouped = buildGroupForRow(lastRow);
  
        // check lastTimestamp to avoid unnecessary DOM updates
        const cache = loadCache(cfg.LOCATION_ID || cfg.locationId) || {};
        const lastTs = cache.lastTimestamp || null;
        if(grouped.timestamp && lastTs && String(grouped.timestamp) === String(lastTs)) {
          // no new data
          return;
        }
  
        // update cards
        const cards = getTargetCards();
        const order = ['meteorologi','presipitasi','kualitas_fisika','kualitas_kimia_dasar','kualitas_kimia_lanjut','kualitas_turbiditas'];
        order.forEach((grpName, i) => {
          const cardEl = cards[i];
          const groupData = grouped.groups[grpName] || {};
          renderGroupToCard(cardEl, grpName, groupData, grouped.timestamp);
        });
  
        // save cache (raw rows + grouped + lastTimestamp)
        saveCache(cfg.LOCATION_ID || cfg.locationId, { fetchedAt: new Date().toISOString(), lastTimestamp: grouped.timestamp, raw: rows, grouped });
  
      } catch (err) {
        console.error('fetchAndRenderOnce error', err);
      }
    }

    async function loadSensorDataAdapter() {
        const base = (cfg && (cfg.BACKEND_BASE_URL || cfg.BACKEND)) ? cfg.BACKEND_BASE_URL.replace(/\/+$/,'') : 'http://localhost:3000';
        const location = cfg.LOCATION_ID || cfg.locationId || 'pulau_komodo';
      
        // try canonical endpoint first
        const endpoints = [
          `${base}/sensors/${encodeURIComponent(location)}`, // preferred
          `${base}/api/sensors` // legacy (optional)
        ];
      
        for (const url of endpoints) {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            // if not ok, try next
            if (!res.ok) {
              // 404 / 500 -> skip to next endpoint
              console.warn(`fetch ${url} returned ${res.status}`);
              continue;
            }
      
            // try parse JSON
            const payload = await res.json();
      
            // payload may be either:
            // - array of rows (preferred)
            // - { success: true, data: [...] } (legacy)
            if (Array.isArray(payload)) {
              return payload; // array-of-objects expected
            }
            if (payload && payload.success && Array.isArray(payload.data)) {
              return payload.data;
            }
      
            // Unexpected body shape -> log and continue to next endpoint
            console.warn('Unexpected payload shape from', url, payload);
          } catch (err) {
            // network error or parse error => try next endpoint
            console.warn('Error fetching', url, err.message || err);
            continue;
          }
        }
      
        // if both attempts fail, throw so caller can handle
        throw new Error('No reachable sensors endpoint');
      }
      
      // Replace calls to fetchSensorRows(...) in this file with loadSensorDataAdapter() OR
      // make fetchSensorRows call this adapter internally. For minimal change, update fetchSensorRows:
      
  
  
    // periodic poll
    let pollTimer = null;
    function startPolling() {
      // run once immediately
      fetchAndRenderOnce();
      if(pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(fetchAndRenderOnce, (cfg.POLL_SECONDS || 60) * 1000);
    }

    function renderFromCacheIfAvailable() {
        const cache = loadCache(cfg.LOCATION_ID || cfg.locationId);
        if (cache && cache.grouped) {
          console.log(`💾 Rendering from cache for ${cfg.LOCATION_ID}`, cache);
          const cards = getTargetCards();
          const order = ['meteorologi','presipitasi','kualitas_fisika','kualitas_kimia_dasar','kualitas_kimia_lanjut','kualitas_turbiditas'];
          order.forEach((grpName, i) => {
            const cardEl = cards[i];
            const groupData = cache.grouped.groups[grpName] || {};
            renderGroupToCard(cardEl, grpName, groupData, cache.grouped.timestamp);
          });
        }
      }
      
      function init(){
        if(window.CLIMBOX_CONFIG) Object.assign(cfg, window.CLIMBOX_CONFIG);
      
        // 🔹 1. Render dari cache dulu
        renderFromCacheIfAvailable();
      
        // 🔹 2. Lalu mulai polling ke backend
        startPolling();
      
        console.log('graph-fetch initialized', cfg);
      }
      
    // init after DOM ready
    function init(){
      // allow override via global before script load
      if(window.CLIMBOX_CONFIG) Object.assign(cfg, window.CLIMBOX_CONFIG);
      startPolling();
      console.log('graph-fetch initialized', cfg);
    }
  
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  
    // expose some utils for debug
    window.CLIMBOX = {
      fetchNow: fetchAndRenderOnce,
      downloadCache: () => downloadCache(cfg.LOCATION_ID || cfg.locationId),
      loadCache: () => loadCache(cfg.LOCATION_ID || cfg.locationId)
    };
  })();
  