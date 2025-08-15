(() => {
  const cfg = Object.assign({
    LOCATION_ID: "pulau_komodo",
    CACHE_PREFIX: "climbox_cache",
    // sensor groups (label -> array of sheet header names)
    SENSOR_GROUPS: {
      meteorologi: ["Timestamp","Wind Direction","Wind Speed (km/h)","Temp udara"],
      presipitasi: ["Rainfall (mm)","Distance (mm)"],
      kualitas_fisika: ["Water Temp (C)","EC (ms/cm)"],
      kualitas_kimia_dasar: ["TDS (ppm)","pH"],
      kualitas_kimia_lanjut: ["DO (ug/L)"],
      kualitas_turbiditas: ["TSS (V)"]
    },

    // MQTT settings (override via window.CLIMBOX_CONFIG)
    MQTT_WS: 'wss://broker.emqx.io:8084/mqtt', // REQUIRED for MQTT; e.g. 'wss://broker.emqx.io:8084/mqtt'
    MQTT_USERNAME: '',
    MQTT_PASSWORD: '',
    MQTT_TOPIC_BASE: 'climbox',
    MQTT_SUBSCRIBE_WILDCARD: true, // subscribe to climbox/{loc}/# if true, else climbox/{loc}/latest
    MQTT_AUTO_DISABLE_POLL: true, // kept for parity - no effect here (no polling)
    MQTT_RECONNECT_PERIOD_MS: 5000
  }, window.CLIMBOX_CONFIG || {});

  // ---------- helpers ----------
  function normalizeKey(key){
    return String(key || "")
      .trim()
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function buildGroupForRow(rawRow){
    const flat = {};
    Object.keys(rawRow || {}).forEach(k=>{
      flat[ normalizeKey(k) ] = rawRow[k];
    });

    const grouped = { timestamp: flat['timestamp'] || flat['timestamp_iso'] || flat['time'] || null, groups: {} };
    Object.entries(cfg.SENSOR_GROUPS).forEach(([groupName, fields])=>{
      grouped.groups[groupName] = {};
      fields.forEach(fieldLabel=>{
        const nk = normalizeKey(fieldLabel);
        let rawVal = flat[nk] !== undefined ? flat[nk] : null;
        if (rawVal !== null && rawVal !== '' && !Number.isNaN(Number(String(rawVal).replace(/,/g,'')))) {
          rawVal = Number(String(rawVal).replace(/,/g,''));
        }
        grouped.groups[groupName][nk] = rawVal;
      });
    });
    return grouped;
  }

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

  // localStorage caching
  function cacheKeyForLocation(loc) { return `${cfg.CACHE_PREFIX}_sensor_${loc}`; }
  function saveCache(locationId, payload) {
    try { localStorage.setItem(cacheKeyForLocation(locationId), JSON.stringify(payload)); }
    catch (e) { console.warn('saveCache error', e); }
  }
  function loadCache(locationId) {
    try {
      const s = localStorage.getItem(cacheKeyForLocation(locationId));
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function downloadCache(locationId){
    const payload = loadCache(locationId);
    if(!payload) return alert('No cache available');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${locationId}_sensor_cache_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  window.CLIMBOX_DOWNLOAD_CACHE = () => downloadCache(cfg.LOCATION_ID || cfg.locationId);

  // Process incoming rows (array of row objects)

  function processRowsAndRender(rows) {
    if (!rows || !Array.isArray(rows) || rows.length === 0) return;
    const lastRow = rows[rows.length - 1];
    const grouped = buildGroupForRow(lastRow);
    // update UI
    const cards = getTargetCards();
    const order = ['meteorologi','presipitasi','kualitas_fisika','kualitas_kimia_dasar','kualitas_kimia_lanjut','kualitas_turbiditas'];
    order.forEach((grpName, i) => {
        const cardEl = cards[i];
        const groupData = grouped.groups[grpName] || {};
        renderGroupToCard(cardEl, grpName, groupData, grouped.timestamp);
    });
    // Update grafik dengan data
    chart1.data.labels.push(grouped.timestamp); // Tambahkan timestamp ke label
    chart1.data.datasets[0].data.push(grouped.groups.kualitas_fisika['water_temp']); // Water Temp
    chart1.data.datasets[1].data.push(grouped.groups.meteorologi['humidity']); // Humidity
    chart1.data.datasets[2].data.push(grouped.groups.meteorologi['air_temp']); // Air Temp
    chart1.update();
    chart2.data.labels.push(grouped.timestamp); // Tambahkan timestamp ke label
    chart2.data.datasets[0].data.push(grouped.groups.kualitas_turbiditas['tss']); // TSS
    chart2.data.datasets[1].data.push(grouped.groups.kualitas_kimia_dasar['ph']); // pH
    chart2.update();
    chart3.data.labels.push(grouped.timestamp); // Tambahkan timestamp ke label
    chart3.data.datasets[0].data.push(grouped.groups.kualitas_kimia_lanjut['do']); // DO
    chart3.data.datasets[1].data.push(grouped.groups.kualitas_fisika['ec']); // EC
    chart3.data.datasets[2].data.push(grouped.groups.kualitas_kimia_dasar['tds']); // TDS
    chart3.update();
    saveCache(cfg.LOCATION_ID || cfg.locationId, {
      fetchedAt: new Date().toISOString(),
      lastTimestamp: grouped.timestamp,
      raw: rows,
      grouped
  });
}

  // ---------- MQTT (browser) ----------
  // Menggunakan versi spesifik yang stabil atau yang paling baru jika tidak ada masalah
  const mqttScriptUrl = 'https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js'; // Menggunakan versi spesifik
  let mqttClient = null;
  let mqttConnected = false;
  let mqttSubscribed = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Cek apakah skrip sudah ada di DOM
      if (document.querySelector(`script[src="${src}"]`)) {
        console.log(`Script already loaded: ${src}`);
        // Jika sudah ada, pastikan window.mqtt tersedia sebelum resolve
        if (window.mqtt) {
          resolve();
        } else {
          // Jika skrip sudah ada tapi window.mqtt belum, tunggu sebentar atau reject
          // Ini bisa terjadi jika skrip dimuat oleh bagian lain dari HTML
          const checkInterval = setInterval(() => {
            if (window.mqtt) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100); // Cek setiap 100ms
          setTimeout(() => {
            if (!window.mqtt) {
              clearInterval(checkInterval);
              reject(new Error('mqtt lib not available after script load check'));
            }
          }, 5000); // Timeout setelah 5 detik
        }
        return;
      }

      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => {
        console.log(`Script loaded: ${src}`);
        if (window.mqtt) {
          resolve();
        } else {
          // Jika skrip dimuat tapi window.mqtt belum tersedia, mungkin ada masalah inisialisasi di library itu sendiri
          console.warn('mqtt script loaded, but window.mqtt is not defined immediately.');
          // Tambahkan sedikit delay untuk memastikan window.mqtt terinisialisasi
          setTimeout(() => {
            if (window.mqtt) {
              resolve();
            } else {
              reject(new Error('mqtt lib not available after script load and short delay'));
            }
          }, 100);
        }
      };
      s.onerror = (e) => {
        console.error(`Failed to load script: ${src}`, e);
        reject(e);
      };
      document.head.appendChild(s);
    });
  }

  async function initMqttIfEnabled() {
    if (!cfg.MQTT_WS) {
      console.log('MQTT disabled (MQTT_WS not provided) — only cache rendering active');
      return;
    }

    try {
      console.log('Attempting to load MQTT client script...');
      await loadScript(mqttScriptUrl);
      console.log('MQTT client script loaded.');
    } catch (e) {
      console.warn('Failed to load mqtt client script:', e);
      return;
    }

    if (!window.mqtt) {
      console.warn('mqtt lib missing after load - window.mqtt is still undefined.');
      return;
    }

    const opts = {
      username: cfg.MQTT_USERNAME || undefined,
      password: cfg.MQTT_PASSWORD || undefined,
      reconnectPeriod: cfg.MQTT_RECONNECT_PERIOD_MS || 5000,
      connectTimeout: 10 * 1000
    };

    try {
      mqttClient = window.mqtt.connect(cfg.MQTT_WS, opts);

      mqttClient.on('connect', () => {
        mqttConnected = true;
        console.log('MQTT connected (browser)');
        ensureSubscribe();
      });
      mqttClient.on('reconnect', () => console.log('MQTT reconnecting...'));
      mqttClient.on('error', (err) => console.warn('MQTT error', err && err.message ? err.message : err));
      mqttClient.on('close', () => { mqttConnected = false; mqttSubscribed = false; console.log('MQTT closed'); });
      mqttClient.on('offline', () => { mqttConnected = false; });

      mqttClient.on('message', (topic, message) => {
        try {
          const txt = message.toString();
          let payload = null;
          try { payload = JSON.parse(txt); } catch (e) {
            // sometimes broker may wrap messages weirdly; try to salvage as single-line object
            console.warn('Unable to JSON.parse mqtt message, raw text:', txt);
            return;
          }

          // Determine rows:
          let rows = null;
          if (Array.isArray(payload)) {
            rows = payload;
          } else if (payload && Array.isArray(payload.rows)) {
            rows = payload.rows;
          } else if (payload && Array.isArray(payload.data)) {
            rows = payload.data;
          } else if (payload && typeof payload === 'object' && Object.keys(payload).length > 0 && payload.Timestamp) {
            // single-row object (looks like sheet row) -> wrap
            rows = [payload];
          } else if (payload && typeof payload === 'object' && Object.values(payload).some(v=>Array.isArray(v))) {
            // sometimes payload may be { something: { rows: [...] } } - try to find first array
            for (const val of Object.values(payload)) {
              if (Array.isArray(val)) { rows = val; break; }
            }
          }

          if (!rows || !Array.isArray(rows) || rows.length === 0) {
            console.warn('MQTT message received but no usable rows found. topic:', topic);
            return;
          }

          processRowsAndRender(rows);
        } catch (e) {
          console.error('Error handling mqtt message', e);
        }
      });
    } catch (e) {
      console.warn('initMqttIfEnabled failed', e);
    }
  }

  function ensureSubscribe() {
    if (!mqttClient || !mqttConnected || mqttSubscribed) return;
    const topic = cfg.MQTT_SUBSCRIBE_WILDCARD
      ? `${(cfg.MQTT_TOPIC_BASE||'climbox')}/${cfg.LOCATION_ID}/#`
      : `${(cfg.MQTT_TOPIC_BASE||'climbox')}/${cfg.LOCATION_ID}/latest`;

    mqttClient.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.warn('mqtt subscribe error', err);
      else { mqttSubscribed = true; console.log('Subscribed to', topic); }
    });
  }

  // ---------- init ----------
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

  async function init(){
    if(window.CLIMBOX_CONFIG) Object.assign(cfg, window.CLIMBOX_CONFIG);

    // Pastikan LOCATION_ID di cfg sudah terupdate dari window.CLIMBOX_CONFIG
    // sebelum digunakan oleh renderFromCacheIfAvailable dan initMqttIfEnabled
    cfg.LOCATION_ID = window.CLIMBOX_CONFIG.LOCATION_ID || cfg.LOCATION_ID;
    cfg.MQTT_WS = window.CLIMBOX_CONFIG.MQTT_WS || cfg.MQTT_WS; // Pastikan MQTT_WS juga terupdate

    renderFromCacheIfAvailable();

    // MQTT-only mode: try to init MQTT
    await initMqttIfEnabled();

    console.log('graph-fetch (MQTT-only) initialized', cfg);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose debug helpers
  window.CLIMBOX = Object.assign(window.CLIMBOX || {}, {
    downloadCache: () => downloadCache(cfg.LOCATION_ID || cfg.locationId),
    loadCache: () => loadCache(cfg.LOCATION_ID || cfg.locationId),
    mqttClient: () => mqttClient,
    cfg
  });
})();
