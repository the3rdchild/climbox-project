# ClimBox Sensor Data API

API PHP untuk mengakses data sensor ClimBox dari berbagai lokasi monitoring lingkungan laut.

## 📁 File yang Dibuat

1. **[api-sensor-data.php](api-sensor-data.php)** - File API utama
2. **[API_DOCUMENTATION.md](API_DOCUMENTATION.md)** - Dokumentasi lengkap API
3. **[api-test.html](api-test.html)** - Halaman test/demo API
4. **README_API.md** - File ini

## 🚀 Quick Start

### 1. Testing API

Buka browser dan akses:
```
http://localhost/pages/api-test.html
```
atau
```
https://your-domain.com/pages/api-test.html
```

### 2. Akses API Langsung

```
# Semua data terbaru
https://your-domain.com/pages/api-sensor-data.php?latest=true

# Data dari Climbox1 saja
https://your-domain.com/pages/api-sensor-data.php?location=Climbox1&latest=true

# 10 data terakhir
https://your-domain.com/pages/api-sensor-data.php?limit=10
```

## 📊 Data yang Tersedia

API ini mengekstrak data dari file JSON dan menyediakan parameter sensor berikut:

### 🌤️ Meteorologi
- `suhu_udara` - Suhu udara (°C)
- `kelembaban_udara` - Kelembaban udara (%)
- `arah_angin` - Arah angin
- `kecepatan_angin` - Kecepatan angin (km/h)

### 🌧️ Presipitasi
- `intensitas_hujan` - Intensitas hujan (mm/jam)
- `jarak_permukaan_air` - Jarak ke permukaan air laut (cm)

### 🌡️ Kualitas Fisika Air
- `suhu_air` - Suhu air (°C)
- `ec` - Electrical Conductivity (mS/cm)

### ⚗️ Kualitas Kimia Dasar
- `tds` - Total Dissolved Solids (ppm)
- `ph` - pH air

### 🧪 Kualitas Kimia Lanjut
- `do` - Dissolved Oxygen (mg/L)
- `pompa` - Status pompa

### 💧 Kualitas Turbiditas
- `tss` - Total Suspended Solids (mg/L)

### 📍 Koordinat
- `latitude` - Koordinat lintang
- `longitude` - Koordinat bujur

## 💡 Contoh Implementasi

### JavaScript Fetch API

```javascript
async function getLatestData() {
  const response = await fetch('/pages/api-sensor-data.php?latest=true');
  const data = await response.json();

  if (data.success) {
    data.data.forEach(location => {
      console.log(`Lokasi: ${location.location.name}`);
      const reading = location.readings[0];
      console.log(`Suhu Air: ${reading.suhu_air}°C`);
      console.log(`pH: ${reading.ph}`);
      console.log(`DO: ${reading.do} mg/L`);
    });
  }
}

getLatestData();
```

### PHP

```php
<?php
$url = 'http://localhost/pages/api-sensor-data.php?location=Climbox1&latest=true';
$json = file_get_contents($url);
$data = json_decode($json, true);

if ($data['success']) {
    $reading = $data['data'][0]['readings'][0];
    echo "Suhu Air: " . $reading['suhu_air'] . "°C\n";
    echo "pH: " . $reading['ph'] . "\n";
    echo "EC: " . $reading['ec'] . " mS/cm\n";
}
?>
```

### Python

```python
import requests

url = 'http://localhost/pages/api-sensor-data.php?latest=true'
response = requests.get(url)
data = response.json()

if data['success']:
    for location in data['data']:
        reading = location['readings'][0]
        print(f"Lokasi: {location['location']['name']}")
        print(f"Suhu Air: {reading.get('suhu_air')}°C")
        print(f"pH: {reading.get('ph')}")
        print(f"DO: {reading.get('do')} mg/L")
```

## 🔧 Konfigurasi

### Path Data

Default path untuk data adalah `../data/`. Jika struktur folder berbeda, edit di `api-sensor-data.php`:

```php
$rawData = getLocationData($locationId, '../data/');
```

### CORS

API sudah dikonfigurasi untuk menerima request dari domain mana saja. Untuk membatasi akses, edit header di `api-sensor-data.php`:

```php
// Ganti * dengan domain yang diizinkan
header('Access-Control-Allow-Origin: https://your-allowed-domain.com');
```

## 📝 Response Format

### Success Response

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
          "suhu_air": 26.3,
          "ec": 52.5,
          "tds": 35000,
          "ph": 8.1,
          "do": 6.5,
          "tss": 45.2
        }
      ],
      "total_readings": 1
    }
  ]
}
```

### Error Response

```json
{
  "success": false,
  "error": "Locations file not found",
  "timestamp": "2025-10-21T10:30:00+00:00"
}
```

## 🎯 Use Cases

### 1. Dashboard Website Eksternal

Gunakan API ini untuk menampilkan data ClimBox di website pihak ketiga:

```html
<div id="climbox-data"></div>

<script>
fetch('https://your-domain.com/pages/api-sensor-data.php?latest=true')
  .then(r => r.json())
  .then(data => {
    const html = data.data.map(loc => `
      <div class="sensor-card">
        <h3>${loc.location.name}</h3>
        <p>Suhu Air: ${loc.readings[0].suhu_air}°C</p>
        <p>pH: ${loc.readings[0].ph}</p>
      </div>
    `).join('');
    document.getElementById('climbox-data').innerHTML = html;
  });
</script>
```

### 2. Aplikasi Mobile

Gunakan API untuk mengambil data di aplikasi mobile (React Native, Flutter, dll):

```javascript
// React Native example
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';

const ClimBoxWidget = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('https://your-domain.com/pages/api-sensor-data.php?latest=true')
      .then(r => r.json())
      .then(setData);
  }, []);

  if (!data) return <Text>Loading...</Text>;

  return (
    <View>
      {data.data.map((loc, i) => (
        <View key={i}>
          <Text>{loc.location.name}</Text>
          <Text>Suhu Air: {loc.readings[0].suhu_air}°C</Text>
        </View>
      ))}
    </View>
  );
};
```

### 3. Data Analytics

Gunakan untuk analisis data dengan Python/R:

```python
import pandas as pd
import requests

# Ambil data historis
response = requests.get('http://localhost/pages/api-sensor-data.php?limit=100')
data = response.json()

# Convert ke DataFrame
readings_list = []
for location in data['data']:
    for reading in location['readings']:
        reading['location_name'] = location['location']['name']
        readings_list.append(reading)

df = pd.DataFrame(readings_list)

# Analisis
print(df.describe())
print(df.groupby('location_name')['suhu_air'].mean())
```

## 🔐 Security Considerations

1. **Rate Limiting**: Pertimbangkan menambahkan rate limiting untuk mencegah abuse
2. **Authentication**: Untuk data sensitif, tambahkan API key authentication
3. **HTTPS**: Selalu gunakan HTTPS di production
4. **Input Validation**: API sudah melakukan validasi dasar, tapi bisa ditambahkan

## 🐛 Troubleshooting

### Data tidak muncul

1. Pastikan file `locations.json` ada di `/public/assets/data/`
2. Cek apakah folder `/public/data/{locationId}/` memiliki file JSON
3. Periksa permission file (harus readable oleh web server)
4. Cek PHP error log

### CORS Error

Jika mendapat CORS error saat mengakses dari domain lain:
```php
// Pastikan header ini ada di api-sensor-data.php
header('Access-Control-Allow-Origin: *');
```

### Nilai null/missing

- API akan skip field yang null untuk menghemat bandwidth
- Selalu cek `field.hasOwnProperty()` atau gunakan optional chaining

## 📚 Dokumentasi Lengkap

Lihat [API_DOCUMENTATION.md](API_DOCUMENTATION.md) untuk dokumentasi yang lebih detail.

## 🤝 Contributing

Untuk menambahkan field sensor baru:

1. Edit fungsi `extractSensorData()` di `api-sensor-data.php`
2. Tambahkan mapping field baru
3. Update dokumentasi

## 📄 License

Sesuai dengan license proyek ClimBox utama.

---

**Created**: 2025-10-21
**Version**: 1.0.0
**Maintainer**: ClimBox Team
