// backend/index.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Initialize admin SDK with service account JSON (download from Firebase console)
const serviceAccount = require("./serviceAccount.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// CONFIG: thresholds per sensorType or per sensorId (fallback)
const DEFAULT_THRESHOLDS = {
  sst: 30 // °C
};

// Helper: write sensorData
async function addSensorData(payload) {
  const docRef = db.collection("sensorData").doc();
  const docData = {
    locationId: payload.locationId,
    sensorId: payload.sensorId,
    sensorType: payload.sensorType,
    value: payload.value,
    unit: payload.unit || null,
    source: payload.source || "sim",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await docRef.set(docData);
  return { id: docRef.id, ...docData };
}

// Helper: threshold check and create notification
async function checkThresholdAndNotify(entry) {
  // determine threshold: prefer location's sensor config in locations collection
  try {
    const locDoc = await db.collection("locations").doc(entry.locationId).get();
    let threshold = DEFAULT_THRESHOLDS[entry.sensorType] ?? null;
    if (locDoc.exists) {
      const loc = locDoc.data();
      if (Array.isArray(loc.sensors)) {
        const s = loc.sensors.find(x => x.sensorId === entry.sensorId || x.sensorType === entry.sensorType);
        if (s && s.threshold !== undefined) threshold = s.threshold;
      }
    }

    if (threshold !== null && entry.value > threshold) {
      // create notification doc
      const notif = {
        sensorId: entry.sensorId,
        locationId: entry.locationId,
        sensorType: entry.sensorType,
        value: entry.value,
        threshold,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "unread",
        sentTo: [] // later fill with user ids
      };
      await db.collection("notifications").add(notif);

      // optionally, call WA/email service here to notify users --- stubbed
      console.log(`ALERT: ${entry.locationId} ${entry.sensorType}=${entry.value} > ${threshold}`);
      return true;
    }
  } catch (err) {
    console.error("checkThreshold error:", err);
  }
  return false;
}

// Endpoint: ingest sensor reading
// POST /ingest { locationId, sensorId, sensorType, value, unit?, source? }
app.post("/ingest", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.locationId || !payload.sensorId || !payload.sensorType || payload.value === undefined) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const added = await addSensorData(payload);
    // run threshold check asynchronously (no need to await for client)
    checkThresholdAndNotify(added).catch(err => console.error(err));

    res.json({ ok: true, id: added.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error" });
  }
});

// health
app.get("/", (req, res) => res.send("ClimBox backend running"));

// start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
