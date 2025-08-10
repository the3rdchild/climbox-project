# test_push.py
import requests, time, random, json

BACKEND = "http://localhost:4000/ingest"

def push(locationId, sensorId, sensorType, value):
    payload = {
        "locationId": locationId,
        "sensorId": sensorId,
        "sensorType": sensorType,
        "value": value,
        "unit": "°C",
        "source": "sim"
    }
    r = requests.post(BACKEND, json=payload)
    print(r.status_code, r.text)

if __name__ == "__main__":
    # push a few samples to Pulau Komodo
    for i in range(10):
        v = round(random.uniform(28.0, 32.5), 2)  # sometimes exceed 30
        push("pulau_komodo", "komodo_sst_01", "sst", v)
        time.sleep(0.5)
