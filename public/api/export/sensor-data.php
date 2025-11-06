<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$vendor_autoload = __DIR__ . '/../../../vendor/autoload.php';
if (!file_exists($vendor_autoload)) {
    header("HTTP/1.1 500 Internal Server Error");
    echo json_encode(['error' => 'MQTT client library not found. Please run "composer require php-mqtt/client" in your project root.']);
    exit;
}
require($vendor_autoload);

use \PhpMqtt\Client\MqttClient;
use \PhpMqtt\Client\ConnectionSettings;

// MQTT Broker settings from your config.json
$server   = 'test.mosquitto.org';
$port     = 8081; // Correct WebSocket port
$clientId = 'php-mqtt-client-' . uniqid();
$username = ''; // your MQTT username
$password = ''; // your MQTT password
$clean_session = false;

// Connection settings
$connectionSettings = (new ConnectionSettings)
    ->setUsername($username)
    ->setPassword($password)
    ->setUseTls(true) // Use TLS for wss
    ->setTlsSelfSigned(true) // Allow self-signed certificates
    ->setKeepAliveInterval(60);

$mqtt = new MqttClient($server, $port, $clientId, MqttClient::MQTT_3_1, null, new \Psr\Log\NullLogger());

try {
    $mqtt->connect($connectionSettings, $clean_session);

    // Subscribe to the topic from your config
    $topic = 'climbox/Climbox1/#';
    $mqtt->subscribe($topic, function ($topic, $message) use ($mqtt) {
        // Set header to JSON
        header('Content-Type: application/json');
        // Echo the received message
        echo $message;
        // Disconnect after receiving the first message
        $mqtt->disconnect();
        // Stop the script
        exit();
    }, 0);

    // Loop to wait for a message, with a timeout of 10 seconds
    $mqtt->loop(true, true, 10);

    // If no message is received within the timeout, disconnect
    $mqtt->disconnect();

} catch (\Exception $e) {
    // In case of an error, return a 500 status code
    header("HTTP/1.1 500 Internal Server Error");
    echo json_encode(['error' => $e->getMessage()]);
}
