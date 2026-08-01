import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Selbsttest-Haken fuer die Bewegtbild-Qualitaetstore.
//
// Nur aktiv mit `?selftest=1` — bewusst kein Dev-Flag, damit sich GENAU der
// Code pruefen laesst, der auch ausgeliefert wird. Die Naht wird auf den rohen
// Frames gemessen, nicht am fertigen Video: Frame 0 ist ein Keyframe, Frame
// N-1 ein P-Frame, und deren Quantisierungsunterschied ist groesser als jeder
// echte Nahtfehler. Genau daran ist die erste Messreihe der ffmpeg-Fassung um
// Faktor 17 bis 75 gescheitert.
if (new URLSearchParams(window.location.search).get('selftest') === '1') {
  import('./services/motionRenderer').then((m) => {
    (window as any).__motion = m;
    console.info('[motion] Selbsttest bereit: window.__motion');
  });
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
