import sharp from 'sharp';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Informe o caminho da imagem.');
const image = await sharp(inputPath, { limitInputPixels: 30000000 })
  .rotate()
  .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
  .png()
  .toBuffer();
if (image.length > 12 * 1024 * 1024) throw new Error('Imagem normalizada excede 12 MB.');
process.stdout.write(image.toString('base64'));
