import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import firebaseConfig from './firebaseConfig.js';
import { createStore } from './lib/store.js';

async function start() {
  const demo = import.meta.env.MODE === 'single';
  const seed = demo ? (await import('./seed.json')).default : null;
  const store = await createStore({ firebaseConfig: demo ? null : firebaseConfig, seed });
  createRoot(document.getElementById('root')).render(<App store={store} />);
  if (!demo && 'serviceWorker' in navigator && window.top === window.self) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
start();
