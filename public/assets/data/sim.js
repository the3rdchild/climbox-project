let lastValue = 50; // nilai awal, bisa kamu ubah

export async function getSimulatedData(length = 10) {
  const values = [];
  const labels = [];

  const now = new Date();

  for (let i = 0; i < length; i++) {
    // Timestamp mundur (misalnya: 10 detik terakhir)
    const t = new Date(now.getTime() - (length - i) * 1000);
    labels.push(`${t.getHours()}:${t.getMinutes()}:${t.getSeconds()}`);

    // Simulasi nilai baru berdasarkan nilai sebelumnya + noise kecil
    const change = Math.floor(Math.random() * 11) - 5; // -5 sampai +5
    lastValue = Math.min(100, Math.max(0, lastValue + change)); // jaga di antara 0–100

    values.push(lastValue);
  }

  return { labels, values };
}
