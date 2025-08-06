export async function fetchThingSpeakData(results = 10) {
  const url = `https://api.thingspeak.com/channels/3021276/fields/1.json?api_key=94J2VUTG68TS5RM4&results=${results}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const feeds = json.feeds;

    // Parse data jadi: { labels: [...], values: [...] }
    const labels = feeds.map(item => {
      const d = new Date(item.created_at);
      return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
    });

    const values = feeds.map(item => Number(item.field1));

    return { labels, values };
  } catch (error) {
    console.error("Gagal ambil data ThingSpeak:", error);
    return { labels: [], values: [] };
  }
}
