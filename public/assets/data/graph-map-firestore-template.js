// pages/data/graph-map.js
import express from 'express';          // jika pakai Express
import { getFirestore, collection, getDocs } from 'firebase-admin/firestore'; // jika di fungsi Firebase

const app = express();
const db = getFirestore();

app.get('/data/graph-map', async (req, res) => {
  const loc = req.query.loc; // misal "TabatExposed"
  // 📌 nanti: ambil dokumen Firestore sesuai loc
  const snapshot = await getDocs(collection(db, `historical/${loc}/readings`));
  const data = snapshot.docs.map(doc => ({
    date: doc.id, 
    sst: doc.data().sst, 
    heatStress: doc.data().heatStress
  }));
  res.json(data);
});

export default app;
