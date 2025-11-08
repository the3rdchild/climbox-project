async function init() {
    const response = await fetch('/assets/js/config.json');
    const config = await response.json();
    const exportConfig = config.export_page;

    const options = {
        host: exportConfig.host,
        port: exportConfig.port,
        protocol: exportConfig.protocol,
        path: exportConfig.path,
        clientId: 'mqttx_' + Math.random().toString(16).substr(2, 8),
        reconnectPeriod: exportConfig.reconnectPeriod
    };

    const client = mqtt.connect(`${options.protocol}://${options.host}:${options.port}${options.path}`, options);

    client.on('connect', function () {
        client.subscribe(exportConfig.topic, function (err) {
            if (!err) {
                console.log(`${exportConfig.topic}`);
            }
        });
    });

    client.on('message', function (topic, message) {
        try {
            const data = JSON.parse(message.toString());
            const tableBody = document.querySelector('#sensor-data-table tbody');
            if (Array.isArray(data)) {
                data.forEach(row => appendRow(tableBody, row));
            } else if (data && typeof data === 'object') {
                appendRow(tableBody, data);
            }
        } catch (error) {
            // Ignore messages that are not valid JSON
        }
    });

    function appendRow(tableBody, row) {
        const timestamp = row.Timestamp || row.timestamp || new Date().toLocaleString();
        for (const key in row) {
            if (key.toLowerCase() !== 'timestamp') {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${timestamp}</td><td>${key}</td><td>${row[key]}</td>`;
                tableBody.prepend(tr);
            }
        }
    }
}

init();
