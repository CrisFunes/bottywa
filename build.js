const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Ejecutar ncc
exec('ncc build app.js -o dist', (error, stdout, stderr) => {
  if (error) {
    console.error(`Error al ejecutar ncc: ${error}`);
    return;
  }
  console.log('ncc completado exitosamente');

  // Leer el contenido del archivo generado por ncc
  const distPath = path.join(__dirname, 'dist', 'index.js');
  let content = fs.readFileSync(distPath, 'utf8');

  // Modificar el contenido para manejar los imports
  content = `
const require = module.require;
const fs = require('fs');
const path = require('path');

// Manejar axios explícitamente
const axiosPath = path.join(__dirname, 'node_modules', 'axios', 'dist', 'node', 'axios.cjs');
if (fs.existsSync(axiosPath)) {
  global.axios = require(axiosPath);
} else {
  console.error('No se pudo encontrar axios.cjs');
}

// Manejar ffmpeg explícitamente
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpegDir = path.dirname(ffmpegPath);
const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe');
if (fs.existsSync(ffmpegExe)) {
  process.env.FFMPEG_PATH = ffmpegExe;
} else {
  console.error('No se pudo encontrar ffmpeg.exe');
}

${content}
`;

  // Escribir el contenido modificado de vuelta al archivo
  fs.writeFileSync(distPath, content);

  console.log('Archivo dist/index.js modificado exitosamente');

  exec(`pkg . --public-packages=* --public`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error al ejecutar pkg: ${error}`);
      return;
    }
    console.log('pkg completado exitosamente');
  });
});