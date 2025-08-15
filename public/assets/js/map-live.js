(function () {
  const cfg = Object.assign({
    MQTT_WS: 'wss://broker.emqx.io:8084/mqtt',
    MQTT_TOPIC_BASE: 'climbox',
    MQTT_SUBSCRIBE_WILDCARD: false,
    MQTT_RECONNECT_MS: 5000
  }, window.CLIMBOX_MAP_CONFIG || {});

  if (!Array.isArray(window.locations)) {
    console.warn('map-live: global "locations" array not found. Create it before loading map-live.js');
    window.locations = window.locations || [];
  }

  // Render static list (basic layout matching bootstrap list-group)
  function renderStaticLocationList() {
    const ul = document.getElementById('location-list');
    if (!ul) {
      console.warn('map-live: #location-list not found in DOM');
      return;
    }
    ul.innerHTML = '';
    window.locations.forEach(loc => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center list-group-item-action';
      li.setAttribute('data-location-id', loc.locationId);
      li.innerHTML = `
        <div>
          <strong class="loc-title">${loc.name}</strong><br>
          <small class="text-muted loc-sub">${loc.country || ''}</small>
        </div>
        <div class="text-end" style="min-width:120px">
          <div class="small text-muted live-ts">--</div>
          <div class="small fw-bold live-summary">--</div>
        </div>
      `;
      // default click: go to graph with query param
      li.addEventListener('click', () => {
        window.location.href = `/pages/graph.html?location=${encodeURIComponent(loc.locationId)}`;
      });
      ul.appendChild(li);
    });
  }

  function getListItemEl(locationId) {
    try {
      return document.querySelector(`#location-list [data-location-id="${CSS.escape(locationId)}"]`);
    } catch (e) {
      // CSS.escape may not exist in very old browsers
      return Array.from(document.querySelectorAll('#location-list [data-location-id]'))
        .find(el => el.getAttribute('data-location-id') === locationId);
    }
  }

  // Heuristik ekstrak temperatur
  function extractTempsFromRow(row) {
    if (!row || typeof row !== 'object') return { water: null, air: null };
    let water = null, air = null;

    const toNum = v => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim().replace(',', '.').replace(/[^\d\.\-]/g, '');
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    for (const key of Object.keys(row)) {
      const lk = key.toLowerCase();
      const raw = row[key];

      if (lk.includes('water') && lk.includes('temp')) {
        const n = toNum(raw); if (n !== null) water = n;
      } else if (lk.includes('sst') || (lk.includes('sea') && lk.includes('temp'))) {
        const n = toNum(raw); if (n !== null && water === null) water = n;
      } else if ((lk.includes('temp') && lk.includes('udara')) || lk.includes('temp_udara') || lk === 'temp') {
        const n = toNum(raw); if (n !== null) air = n;
      } else if (lk.includes('air') && lk.includes('temp')) {
        const n = toNum(raw); if (n !== null && air === null) air = n;
      }

      // fallback exact-ish matches often seen
      if (water === null && (lk === 'water temp (c)' || lk === 'water_temp_c')) {
        const n = toNum(raw); if (n !== null) water = n;
      }
      if (air === null && (lk === 'temp udara' || lk === 'temp_udara')) {
        const n = toNum(raw); if (n !== null) air = n;
      }
    }
    return { water, air };
  }

  // Update DOM list entry
  function updateListLive(locationId, payload) {
    try {
      const li = getListItemEl(locationId);
      if (!li) return;
      const tsEl = li.querySelector('.live-ts');
      const sumEl = li.querySelector('.live-summary');

      const ts = payload.timestamp || (payload.rows && payload.rows.length ? (payload.rows[payload.rows.length - 1].Timestamp || payload.rows[payload.rows.length - 1].timestamp) : null);
      if (ts) {
        try { tsEl.textContent = new Date(ts).toLocaleString(); } catch (e) { tsEl.textContent = String(ts); }
      } else tsEl.textContent = '--';

      let rows = null;
      if (Array.isArray(payload.rows)) rows = payload.rows;
      else if (Array.isArray(payload.data)) rows = payload.data;
      else if (Array.isArray(payload)) rows = payload;
      else if (payload && payload.Timestamp) rows = [payload];

      if (rows && rows.length) {
        const lastRow = rows[rows.length - 1];
        const { water, air } = extractTempsFromRow(lastRow);
        let txt = '';
        if (water !== null && water !== undefined) txt += `W:${water}°C `;
        if (air !== null && air !== undefined) txt += `A:${air}°C`;
        if (!txt) txt = `rows:${payload.rowCount || rows.length}`;
        sumEl.textContent = txt;
      } else {
        sumEl.textContent = `rows:${payload.rowCount || '-'}`;
      }
    } catch (e) {
      console.warn('map-live updateListLive error', e);
    }
  }

  // -------------- MQTT client --------------
  const mqttScriptUrl = 'https://unpkg.com/mqtt/dist/mqtt.min.js';
  let mqttClient = null;
  function loadMqttLib() {
    return new Promise((resolve, reject) => {
      if (window.mqtt) return resolve(window.mqtt);
      if (document.querySelector(`script[src="${mqttScriptUrl}"]`)) {
        const check = () => { if (window.mqtt) resolve(window.mqtt); else setTimeout(check, 100); };
        return check();
      }
      const s = document.createElement('script');
      s.src = mqttScriptUrl;
      s.async = true;
      s.onload = () => resolve(window.mqtt);
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  async function initMqtt() {
    if (!cfg.MQTT_WS) {
      console.log('map-live: MQTT disabled (MQTT_WS empty)');
      return;
    }
    try {
      await loadMqttLib();
    } catch (e) {
      console.warn('map-live: failed to load mqtt lib', e);
      return;
    }

    try {
      mqttClient = window.mqtt.connect(cfg.MQTT_WS, { reconnectPeriod: cfg.MQTT_RECONNECT_MS || 5000, connectTimeout: 10000 });

      mqttClient.on('connect', () => {
        console.log('map-live: mqtt connected');
        if (cfg.MQTT_SUBSCRIBE_WILDCARD) {
          const wildcard = `${cfg.MQTT_TOPIC_BASE}/+/latest`;
          mqttClient.subscribe(wildcard, { qos: 1 }, (err) => {
            if (err) console.warn('map-live subscribe wildcard error', err);
            else console.log('map-live subscribed', wildcard);
          });
        } else {
          window.locations.forEach(loc => {
            const topic = `${cfg.MQTT_TOPIC_BASE}/${loc.locationId}/latest`;
            mqttClient.subscribe(topic, { qos: 1 }, (err) => {
              if (err) console.warn('map-live subscribe err', topic, err);
              else console.log('map-live subscribed', topic);
            });
          });
        }
      });

      mqttClient.on('message', (topic, message) => {
        try {
          const txt = message.toString();
          let payload = null;
          try { payload = JSON.parse(txt); } catch (e) { console.warn('map-live: invalid json mqtt msg', txt); return; }

          const parts = String(topic).split('/');
          const topicLoc = (parts.length >= 2) ? parts[1] : null;
          const locId = (payload && payload.locationId) ? payload.locationId : topicLoc;
          if (!locId) return;
          updateListLive(locId, payload);
        } catch (e) {
          console.warn('map-live mqtt message handler error', e);
        }
      });

      mqttClient.on('error', (e) => console.warn('map-live mqtt error', e));
      mqttClient.on('close', () => console.log('map-live mqtt closed'));
    } catch (e) {
      console.warn('map-live initMqtt error', e);
    }
  }

  // ------------- Graph link update (marker click helper) -------------
  function findGraphLinkEl() {
    // prefer explicit id
    let el = document.querySelector('#graph-link');
    if (el) return el;
    // fallback: find first anchor that contains text "lihat"
    el = Array.from(document.querySelectorAll('a')).find(a => (a.textContent || '').trim().toLowerCase().startsWith('lihat data'));
    return el || null;
  }

  function setGraphLink(locationId, displayName) {
    const a = findGraphLinkEl();
    if (!a) return;
    a.href = `/pages/graph.html?location=${encodeURIComponent(locationId)}`;
    a.textContent = `Lihat Data [${displayName || locationId}] Lebih Lanjut...`;
  }

  // Expose small API for marker click wiring
  const API = {
    onMarkerClicked: function (loc) {
      // loc = location object from locations array
      try {
        setGraphLink(loc.locationId, loc.name || loc.displayName || loc.locationId);
        // optional: navigate immediately to graph page if desired
        // window.location.href = `/pages/graph.html?location=${encodeURIComponent(loc.locationId)}`;
      } catch (e) { console.warn('map-live onMarkerClicked error', e); }
    },
    client: function () { return mqttClient; },
    cfg
  };

  // init on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    renderStaticLocationList();
    initMqtt();
    // attach API globally
    window.MAP_LIVE = Object.assign(window.MAP_LIVE || {}, API);
  });
})();
