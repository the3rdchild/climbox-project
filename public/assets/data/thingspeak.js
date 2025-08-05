function readData() {
    const url = 'https://api.thingspeak.com/channels/3021276/fields/1.json?api_key=94J2VUTG68TS5RM4&results=2';
  
    fetch(url)
      .then(response => response.json())
      .then(data => {
        const feeds = data.feeds.map(feed => `Waktu: ${feed.created_at}, Nilai: ${feed.field1}`).join('<br>');
        document.getElementById('thingspeak-data').innerHTML = feeds;
      })
      .catch(error => {
        console.error('Error fetching ThingSpeak data:', error);
        document.getElementById('thingspeak-data').innerText = 'Failed to load data.';
      });
  }
  
  // Call the function when the page loads
  window.onload = readData;