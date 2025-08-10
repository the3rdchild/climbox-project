// /backend/services/cacheWriter.js
const fs = require('fs');
const path = require('path');

/**
 * Append new sensor data to a daily JSON file in /public/data/
 * @param {Object} data - Sensor data to append
 */
function appendToCache(data) {
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filePath = path.join(__dirname, '../../public/data', `sensorData_${dateStr}.json`);

  let fileData = [];

  // Load existing file if it exists
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      fileData = JSON.parse(raw);
    } catch (err) {
      console.error(`Error reading existing cache file: ${err.message}`);
    }
  }

  // Append the new data
  fileData.push({
    ...data,
    cachedAt: new Date().toISOString()
  });

  // Write back to file
  try {
    fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf8');
    console.log(`Cached data appended to ${filePath}`);
  } catch (err) {
    console.error(`Error writing cache file: ${err.message}`);
  }
}

module.exports = { appendToCache };
