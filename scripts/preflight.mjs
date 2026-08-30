import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const isCi = process.argv.includes('--ci');
const isRelease = process.argv.includes('--release');
const results = [];

function add(level, name, detail) {
  results.push({ level, name, detail });
}

function run(command, args = []) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function commandExists(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return run(locator, [command]).status === 0;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readLocalEnv() {
  const values = {};
  for (const path of ['.env.local', '.env']) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { ...values, ...process.env };
}

const packageJson = readJson('package.json');
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (nodeMajor >= 22) {
  add('ok', 'Node.js', process.versions.node);
} else {
  add('fail', 'Node.js', `Se requiere Node 22 o superior; actual: ${process.versions.node}`);
}

const expoVersion = packageJson?.dependencies?.expo;
if (typeof expoVersion === 'string' && /^~54\./.test(expoVersion)) {
  add('ok', 'Expo SDK', expoVersion);
} else {
  add('fail', 'Expo SDK', `Se esperaba una versión ~54.x; actual: ${expoVersion ?? 'ausente'}`);
}

const requiredFiles = [
  'app.json',
  'eas.json',
  '.env.example',
  'legal/privacidad.html',
  'legal/terminos.html',
  'supabase/config.toml',
  'supabase/README.md',
  'e2e/smoke.yaml',
];
const missingFiles = requiredFiles.filter((path) => !existsSync(path));
if (missingFiles.length === 0) {
  add('ok', 'Archivos requeridos', `${requiredFiles.length} presentes`);
} else {
  add('fail', 'Archivos requeridos', `Faltan: ${missingFiles.join(', ')}`);
}

const env = readLocalEnv();
const publicUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const publicKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
if (publicUrl && publicKey) {
  if (!isCi && /example\.supabase\.co/i.test(publicUrl)) {
    add('warn', 'Supabase público', 'La URL todavía apunta al valor de ejemplo.');
  } else {
    add('ok', 'Supabase público', 'URL y publishable key configuradas');
  }
} else {
  add('warn', 'Supabase público', 'Falta URL o publishable key en el entorno local.');
}

if (!isCi) {
  const remote = run('git', ['remote']);
  const remotes = remote.status === 0 ? remote.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  add(
    remotes.length > 0 ? 'ok' : 'warn',
    'Remoto Git',
    remotes.length > 0 ? remotes.join(', ') : 'No hay remoto configurado; el proyecto no tiene respaldo externo.'
  );

  const status = run('git', ['status', '--porcelain=v1']);
  const changes = status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;
  add(
    changes === 0 ? 'ok' : 'warn',
    'Workspace Git',
    changes === 0 ? 'Limpio' : `${changes} entradas pendientes de revisar y versionar`
  );
}

if (isRelease) {
  for (const tool of ['eas', 'docker', 'supabase', 'maestro']) {
    const available = commandExists(tool);
    add(
      available ? 'ok' : 'warn',
      `Herramienta ${tool}`,
      available ? 'Disponible' : 'No encontrada en PATH'
    );
  }

  const paymentSource = existsSync('database/payment-validation.ts')
    ? readFileSync('database/payment-validation.ts', 'utf8')
    : '';
  add(
    /DemoPaymentValidationAdapter|provider:\s*['"]demo['"]/.test(paymentSource) ? 'warn' : 'ok',
    'Pagos digitales',
    /DemoPaymentValidationAdapter|provider:\s*['"]demo['"]/.test(paymentSource)
      ? 'Yape/Plin continúan usando validación demostrativa.'
      : 'No se detectó el adaptador de demostración.'
  );

  const productSource = existsSync('PRODUCT.md') ? readFileSync('PRODUCT.md', 'utf8') : '';
  add(
    /marcadores genéricos de Expo|maestro limpio.*pendiente/is.test(productSource) ? 'warn' : 'ok',
    'Marca publicable',
    /marcadores genéricos de Expo|maestro limpio.*pendiente/is.test(productSource)
      ? 'PRODUCT.md todavía registra logo/iconos provisionales.'
      : 'No se detectó una advertencia de marca provisional.'
  );
}

for (const result of results) {
  const label = result.level === 'ok' ? 'OK' : result.level === 'warn' ? 'AVISO' : 'FALLO';
  console.log(`[${label}] ${result.name}: ${result.detail}`);
}

const failures = results.filter(({ level }) => level === 'fail').length;
const warnings = results.filter(({ level }) => level === 'warn').length;
console.log(`\nResumen: ${failures} fallo(s), ${warnings} aviso(s).`);

if (failures > 0 || (isRelease && warnings > 0)) {
  process.exitCode = 1;
}
