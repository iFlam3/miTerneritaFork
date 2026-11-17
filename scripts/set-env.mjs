// Genera src/environments/environment.production.ts desde la variable API_URL.
// angular.json (configuracion production) lo usa en lugar de environment.developer.ts.
// El archivo generado no se versiona: se crea en cada build (prebuild).
import { writeFileSync } from 'node:fs';

// Sin API_URL (p. ej. Vercel sin configurar) se usa el backend actual de Render.
const raw = process.env.API_URL?.trim() || 'https://miterneritaback.onrender.com';
if (!/^https?:\/\//.test(raw)) {
  console.error('set-env: API_URL debe empezar por http(s)://');
  process.exit(1);
}
const api = raw.replace(/\/+$/, '');

const env = {
  prod: true,
  api,
  apiImg: `${api}/assets/img`,
  apiPayments: `${api}/uploads/comprobantes`,
  apiDolar: 'https://ve.dolarapi.com/v1/euros',
};

const out = new URL('../src/environments/environment.production.ts', import.meta.url);
writeFileSync(out, `export const environment = ${JSON.stringify(env, null, 2)};\n`);
console.log(`set-env: environment.production.ts -> ${api}`);
