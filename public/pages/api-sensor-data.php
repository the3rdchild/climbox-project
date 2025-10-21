<?php
/**
 * ClimBox Sensor Data API
 *
 * Endpoint untuk mengambil semua data sensor dari berbagai lokasi ClimBox
 *
 * Usage:
 * - Semua data: api-sensor-data.php
 * - Filter lokasi: api-sensor-data.php?location=Climbox1
 * - Limit data: api-sensor-data.php?limit=10
 * - Data terbaru: api-sensor-data.php?latest=true
 * - Format JSON: api-sensor-data.php?format=json (default)
 */

// Set header untuk CORS (agar bisa diakses dari website lain)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Fungsi untuk membaca data dari file JSON
function getLocationData($locationId, $dataPath = '../data/') {
    $data = [];

    // Coba baca file latest.json dulu
    $latestFile = $dataPath . $locationId . '/latest.json';
    if (file_exists($latestFile)) {
        $latestContent = file_get_contents($latestFile);
        $latest = json_decode($latestContent, true);

        if ($latest && isset($latest['sheetName'])) {
            $sheetFile = $dataPath . $locationId . '/' . $latest['sheetName'] . '.json';
            if (file_exists($sheetFile)) {
                $sheetContent = file_get_contents($sheetFile);
                $data = json_decode($sheetContent, true);
                if (is_array($data)) {
                    return $data;
                }
            }
        }
    }

    // Fallback: cari file sensorData dengan tanggal
    $pattern = $dataPath . $locationId . '/sensorData_*.json';
    $files = glob($pattern);

    if ($files) {
        // Sort berdasarkan tanggal (newest first)
        rsort($files);

        foreach ($files as $file) {
            $content = file_get_contents($file);
            $fileData = json_decode($content, true);
            if (is_array($fileData)) {
                $data = array_merge($data, $fileData);
            }
        }
    }

    return $data;
}

// Fungsi untuk normalisasi field names
function normalizeFieldName($fieldName) {
    $normalized = strtolower(trim($fieldName));
    $normalized = preg_replace('/\s+/', '_', $normalized);
    $normalized = preg_replace('/[^\w]/', '', $normalized);
    return $normalized;
}

// Fungsi untuk mengekstrak data sensor dari row
function extractSensorData($row) {
    $sensorData = [
        'timestamp' => $row['Timestamp'] ?? $row['timestamp'] ?? $row['time'] ?? $row['cachedAt'] ?? null,

        // Meteorologi
        'suhu_udara' => parseNumericValue($row['Air Temp (C)'] ?? $row['air_temp'] ?? $row['Temp udara'] ?? $row['temperature'] ?? null),
        'kelembaban_udara' => parseNumericValue($row['Air Humidity (%)'] ?? $row['Humidity'] ?? $row['humidity'] ?? null),
        'arah_angin' => $row['Wind Direction'] ?? $row['wind_direction'] ?? $row['Arah Angin'] ?? null,
        'kecepatan_angin' => parseNumericValue($row['Wind Speed (km/h)'] ?? $row['wind_speed'] ?? $row['Kecepatan Angin'] ?? null),

        // Presipitasi
        'intensitas_hujan' => parseNumericValue($row['Rain Intensity (mm/h)'] ?? $row['rain_intensity'] ?? $row['Intensitas Hujan'] ?? null),
        'jarak_permukaan_air' => parseNumericValue($row['Water Surface Distance (cm)'] ?? $row['water_surface'] ?? $row['Jarak Permukaan Air'] ?? null),

        // Kualitas Fisika
        'suhu_air' => parseNumericValue($row['Water Temp (C)'] ?? $row['water_temp'] ?? $row['water temp'] ?? $row['WaterTemp'] ?? null),
        'ec' => parseNumericValue($row['EC (ms/cm)'] ?? $row['EC (mS/cm)'] ?? $row['ec'] ?? $row['EC'] ?? null),

        // Kualitas Kimia Dasar
        'tds' => parseNumericValue($row['TDS (ppm)'] ?? $row['tds'] ?? $row['TDS'] ?? null),
        'ph' => parseNumericValue($row['pH'] ?? $row['ph'] ?? null),

        // Kualitas Kimia Lanjut
        'do' => parseNumericValue($row['DO (ug/L)'] ?? $row['DO (mg/L)'] ?? $row['do'] ?? $row['DO'] ?? null),
        'pompa' => $row['Pump Status'] ?? $row['pompa'] ?? $row['pump'] ?? null,

        // Kualitas Turbiditas
        'tss' => parseNumericValue($row['TSS (V)'] ?? $row['TSS (mg/l)'] ?? $row['tss'] ?? $row['TSS'] ?? null),

        // Koordinat
        'latitude' => parseNumericValue($row['Latitude'] ?? $row['lat'] ?? null),
        'longitude' => parseNumericValue($row['Longitude'] ?? $row['lon'] ?? $row['long'] ?? null),
    ];

    // Remove null values untuk menghemat bandwidth
    return array_filter($sensorData, function($value) {
        return $value !== null;
    });
}

// Fungsi untuk parsing nilai numerik
function parseNumericValue($value) {
    if ($value === null || $value === '' || $value === undefined) {
        return null;
    }

    $stringValue = strtolower(trim((string)$value));

    // Cek untuk nilai non-numeric
    $invalidValues = ['tidak mengukur', 'tidak_mengukur', 'na', 'n/a', 'not measured', '-', '--', 'null'];
    if (in_array($stringValue, $invalidValues)) {
        return null;
    }

    // Convert comma to dot dan remove non-numeric characters
    $stringValue = str_replace(',', '.', $stringValue);
    $numericValue = filter_var($stringValue, FILTER_SANITIZE_NUMBER_FLOAT, FILTER_FLAG_ALLOW_FRACTION);

    if (is_numeric($numericValue)) {
        return (float)$numericValue;
    }

    return null;
}

// Main execution
try {
    // Get parameters
    $locationFilter = $_GET['location'] ?? null;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : null;
    $latestOnly = isset($_GET['latest']) && $_GET['latest'] === 'true';
    $format = $_GET['format'] ?? 'json';

    // Load locations
    $locationsFile = '../assets/data/locations.json';
    if (!file_exists($locationsFile)) {
        throw new Exception('Locations file not found');
    }

    $locationsContent = file_get_contents($locationsFile);
    $locations = json_decode($locationsContent, true);

    if (!is_array($locations)) {
        throw new Exception('Invalid locations data');
    }

    // Filter locations if needed
    if ($locationFilter) {
        $locations = array_filter($locations, function($loc) use ($locationFilter) {
            return $loc['locationId'] === $locationFilter || $loc['name'] === $locationFilter;
        });
    }

    $result = [
        'success' => true,
        'timestamp' => date('c'),
        'data' => []
    ];

    // Process each location
    foreach ($locations as $location) {
        $locationId = $location['locationId'];
        $rawData = getLocationData($locationId);

        if (empty($rawData)) {
            continue;
        }

        // Sort data by timestamp (newest first)
        usort($rawData, function($a, $b) {
            $timeA = strtotime($a['Timestamp'] ?? $a['timestamp'] ?? $a['time'] ?? 0);
            $timeB = strtotime($b['Timestamp'] ?? $b['timestamp'] ?? $b['time'] ?? 0);
            return $timeB - $timeA; // Descending order
        });

        // Apply limit if latest only
        if ($latestOnly) {
            $rawData = array_slice($rawData, 0, 1);
        } elseif ($limit) {
            $rawData = array_slice($rawData, 0, $limit);
        }

        // Extract sensor data
        $sensorReadings = [];
        foreach ($rawData as $row) {
            $extracted = extractSensorData($row);
            if (!empty($extracted)) {
                $sensorReadings[] = $extracted;
            }
        }

        $result['data'][] = [
            'location' => [
                'id' => $location['locationId'],
                'name' => $location['name'],
                'coordinates' => [
                    'latitude' => $location['coord'][0] ?? null,
                    'longitude' => $location['coord'][1] ?? null
                ],
                'country' => $location['country'] ?? null
            ],
            'readings' => $sensorReadings,
            'total_readings' => count($sensorReadings)
        ];
    }

    // Output result
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'timestamp' => date('c')
    ], JSON_PRETTY_PRINT);
}
?>
