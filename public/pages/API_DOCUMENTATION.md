# ClimBox Sensor Data API Documentation

API untuk mengakses data sensor ClimBox dari berbagai lokasi monitoring lingkungan.

## Base URL

```
https://your-domain.com/pages/api-sensor-data.php
```

## Endpoints

### GET /api-sensor-data.php

Mengambil data sensor dari semua lokasi atau lokasi tertentu.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `location` | string | No | - | Filter berdasarkan locationId atau nama lokasi (contoh: `Climbox1`) |
| `limit` | integer | No | - | Membatasi jumlah data readings per lokasi |
| `latest` | boolean | No | false | Jika `true`, hanya ambil data terbaru per lokasi |
| `format` | string | No | json | Format output (saat ini hanya mendukung `json`) |

#### Response Format

```json
{
  "success": true,
  "timestamp": "2025-10-21T10:30:00+00:00",
  "data": [
    {
      "location": {
        "id": "Climbox1",
        "name": "Climbox1",
        "coordinates": {
          "latitude": -8.525,
          "longitude": 119.501
        },
        "country": "Indonesia"
      },
      "readings": [
        {
          "timestamp": "2025-10-21T10:00:00",
          "suhu_udara": 28.5,
          "kelembaban_udara": 75.2,
          "arah_angin": "Timur Laut",
          "kecepatan_angin": 12.5,
          "intensitas_hujan": 0.0,
          "jarak_permukaan_air": 150.5,
          "suhu_air": 26.3,
          "ec": 52.5,
          "tds": 35000,
          "ph": 8.1,
          "do": 6.5,
          "pompa": "ON",
          "tss": 45.2,
          "latitude": -8.525,
          "longitude": 119.501
        }
      ],
      "total_readings": 1
    }
  ]
}
```

#### Data Fields

##### Meteorologi
- `suhu_udara` (float): Suhu udara dalam Celsius (°C)
- `kelembaban_udara` (float): Kelembaban udara dalam persen (%)
- `arah_angin` (string): Arah angin
- `kecepatan_angin` (float): Kecepatan angin dalam km/jam

##### Presipitasi
- `intensitas_hujan` (float): Intensitas hujan dalam mm/jam
- `jarak_permukaan_air` (float): Jarak ke permukaan air laut dalam cm

##### Kualitas Fisika Air
- `suhu_air` (float): Suhu air dalam Celsius (°C)
- `ec` (float): Electrical Conductivity dalam mS/cm

##### Kualitas Kimia Dasar
- `tds` (float): Total Dissolved Solids dalam ppm
- `ph` (float): pH air (7.5 - 8.4 normal untuk air laut)

##### Kualitas Kimia Lanjut
- `do` (float): Dissolved Oxygen dalam mg/L atau µg/L
- `pompa` (string): Status pompa

##### Kualitas Turbiditas
- `tss` (float): Total Suspended Solids dalam mg/L atau V

##### Koordinat
- `latitude` (float): Koordinat lintang
- `longitude` (float): Koordinat bujur

## Contoh Penggunaan

### 1. Ambil Semua Data

```bash
curl "https://your-domain.com/pages/api-sensor-data.php"
```

### 2. Ambil Data dari Lokasi Tertentu

```bash
curl "https://your-domain.com/pages/api-sensor-data.php?location=Climbox1"
```

### 3. Ambil Data Terbaru Saja

```bash
curl "https://your-domain.com/pages/api-sensor-data.php?latest=true"
```

### 4. Ambil 10 Data Terakhir per Lokasi

```bash
curl "https://your-domain.com/pages/api-sensor-data.php?limit=10"
```

### 5. Kombinasi Filter

```bash
curl "https://your-domain.com/pages/api-sensor-data.php?location=Climbox1&latest=true"
```

## Implementasi di Website

### JavaScript (Vanilla)

```javascript
// Ambil data terbaru
fetch('https://your-domain.com/pages/api-sensor-data.php?latest=true')
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      data.data.forEach(location => {
        console.log('Lokasi:', location.location.name);
        console.log('Suhu Air:', location.readings[0]?.suhu_air, '°C');
        console.log('pH:', location.readings[0]?.ph);
        console.log('DO:', location.readings[0]?.do, 'mg/L');
      });
    }
  })
  .catch(error => console.error('Error:', error));
```

### JavaScript (Fetch dengan async/await)

```javascript
async function getClimBoxData(locationId = null) {
  try {
    const url = locationId
      ? `https://your-domain.com/pages/api-sensor-data.php?location=${locationId}&latest=true`
      : 'https://your-domain.com/pages/api-sensor-data.php?latest=true';

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      return data.data;
    } else {
      throw new Error(data.error || 'Failed to fetch data');
    }
  } catch (error) {
    console.error('Error fetching ClimBox data:', error);
    return null;
  }
}

// Penggunaan
const data = await getClimBoxData('Climbox1');
console.log(data);
```

### jQuery

```javascript
$.ajax({
  url: 'https://your-domain.com/pages/api-sensor-data.php',
  method: 'GET',
  data: {
    location: 'Climbox1',
    latest: 'true'
  },
  success: function(response) {
    if (response.success) {
      const readings = response.data[0].readings[0];
      $('#suhu-air').text(readings.suhu_air + ' °C');
      $('#ph').text(readings.ph);
      $('#ec').text(readings.ec + ' mS/cm');
      $('#tds').text(readings.tds + ' ppm');
    }
  },
  error: function(error) {
    console.error('Error:', error);
  }
});
```

### PHP

```php
<?php
$apiUrl = 'https://your-domain.com/pages/api-sensor-data.php?location=Climbox1&latest=true';
$response = file_get_contents($apiUrl);
$data = json_decode($response, true);

if ($data['success']) {
    $readings = $data['data'][0]['readings'][0];
    echo "Suhu Air: " . $readings['suhu_air'] . " °C<br>";
    echo "pH: " . $readings['ph'] . "<br>";
    echo "EC: " . $readings['ec'] . " mS/cm<br>";
    echo "TDS: " . $readings['tds'] . " ppm<br>";
}
?>
```

### Python

```python
import requests

# Ambil data terbaru
response = requests.get('https://your-domain.com/pages/api-sensor-data.php?latest=true')
data = response.json()

if data['success']:
    for location in data['data']:
        print(f"Lokasi: {location['location']['name']}")
        if location['readings']:
            reading = location['readings'][0]
            print(f"Suhu Air: {reading.get('suhu_air')} °C")
            print(f"pH: {reading.get('ph')}")
            print(f"EC: {reading.get('ec')} mS/cm")
            print(f"TDS: {reading.get('tds')} ppm")
            print("---")
```

### React

```javascript
import React, { useState, useEffect } from 'react';

function ClimBoxData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('https://your-domain.com/pages/api-sensor-data.php?latest=true')
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          setData(data.data);
        }
        setLoading(false);
      })
      .catch(error => {
        console.error('Error:', error);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!data) return <div>No data available</div>;

  return (
    <div>
      {data.map((location, index) => (
        <div key={index}>
          <h3>{location.location.name}</h3>
          {location.readings[0] && (
            <ul>
              <li>Suhu Air: {location.readings[0].suhu_air} °C</li>
              <li>pH: {location.readings[0].ph}</li>
              <li>EC: {location.readings[0].ec} mS/cm</li>
              <li>TDS: {location.readings[0].tds} ppm</li>
              <li>DO: {location.readings[0].do} mg/L</li>
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default ClimBoxData;
```

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Error message here",
  "timestamp": "2025-10-21T10:30:00+00:00"
}
```

### HTTP Status Codes

- `200 OK`: Request berhasil
- `500 Internal Server Error`: Terjadi error di server

## CORS

API ini sudah dikonfigurasi dengan CORS headers untuk memungkinkan akses dari domain lain:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Rate Limiting

Saat ini belum ada rate limiting. Gunakan dengan bijak dan pertimbangkan untuk menambahkan caching di aplikasi Anda.

## Data Availability

- Data diambil dari file JSON yang di-cache dari Google Sheets
- Data mungkin tidak real-time, tergantung pada frekuensi update cache
- Jika tidak ada data untuk lokasi tertentu, lokasi tersebut tidak akan muncul di response

## Support

Untuk pertanyaan atau dukungan, silakan hubungi tim ClimBox.

---

**Version**: 1.0.0
**Last Updated**: 2025-10-21
