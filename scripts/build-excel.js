// Builds data/products.xlsx from data/products.json, embedding a small
// thumbnail of each product image in the "Image" column.
//
//   node scripts/build-excel.js
//
// Downloaded thumbnails are cached in .cache/images so reruns are fast.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data', 'products.json');
const OUT = path.join(ROOT, 'data', 'products.xlsx');
const CACHE = path.join(ROOT, '.cache', 'images');
const IMG_PX = 96; // embedded thumbnail size
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns a JPEG buffer (IMG_PX square, white background) or null.
async function getThumb(product) {
  const url = product.thumbnailUrl || product.imageUrl;
  if (!url) return null;
  const file = path.join(CACHE, `${product.id}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
        .flatten({ background: '#ffffff' })
        .resize(IMG_PX, IMG_PX, { fit: 'contain', background: '#ffffff' })
        .jpeg({ quality: 80 })
        .toBuffer();
      fs.writeFileSync(file, jpeg);
      return jpeg;
    } catch (err) {
      if (attempt === 4) {
        console.warn(`  image failed for #${product.id}: ${err.message}`);
        return null;
      }
      await sleep(1000 * attempt);
    }
  }
}

async function downloadAll(products) {
  fs.mkdirSync(CACHE, { recursive: true });
  const thumbs = new Array(products.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < products.length) {
      const i = next++;
      thumbs[i] = await getThumb(products[i]);
      if (++done % 250 === 0 || done === products.length) console.log(`  images ${done}/${products.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return thumbs;
}

(async () => {
  const products = JSON.parse(fs.readFileSync(IN, 'utf8'));
  console.log(`Downloading thumbnails for ${products.length} products...`);
  const thumbs = await downloadAll(products);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hardware E-Commerce';
  wb.created = new Date();
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });

  // Header names are what index.html reads, so keep them in sync.
  ws.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Image', key: 'image', width: 15 },
    { header: 'Product Name', key: 'name', width: 45 },
    { header: 'SKU', key: 'sku', width: 18 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Price (PKR)', key: 'price', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Max Price (PKR)', key: 'maxPrice', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Regular Price (PKR)', key: 'regularPrice', width: 13, style: { numFmt: '#,##0' } },
    { header: 'On Sale', key: 'onSale', width: 9 },
    { header: 'Stock', key: 'stock', width: 12 },
    { header: 'Short Description', key: 'shortDescription', width: 50 },
    { header: 'Description', key: 'description', width: 70 },
    { header: 'Image URL', key: 'imageUrl', width: 50 },
    { header: 'Product URL', key: 'productUrl', width: 50 },
  ];

  const header = ws.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  });

  products.forEach((p, i) => {
    const row = ws.addRow({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      price: p.price,
      maxPrice: p.maxPrice && p.maxPrice !== p.price ? p.maxPrice : null,
      regularPrice: p.regularPrice,
      onSale: p.onSale ? 'Yes' : 'No',
      stock: p.inStock ? 'In stock' : 'Out of stock',
      shortDescription: p.shortDescription,
      description: p.description,
      imageUrl: p.imageUrl ? { text: p.imageUrl, hyperlink: p.imageUrl } : '',
      productUrl: p.productUrl ? { text: p.productUrl, hyperlink: p.productUrl } : '',
    });
    row.height = 78; // ~104px, fits the 96px thumbnail
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell('imageUrl').font = { color: { argb: 'FF2563EB' }, underline: true };
    row.getCell('productUrl').font = { color: { argb: 'FF2563EB' }, underline: true };

    if (thumbs[i]) {
      const imageId = wb.addImage({ buffer: thumbs[i], extension: 'jpeg' });
      ws.addImage(imageId, {
        tl: { col: 1.08, row: row.number - 1 + 0.04 },
        ext: { width: IMG_PX, height: IMG_PX },
        editAs: 'oneCell',
      });
    }
  });

  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };

  await wb.xlsx.writeFile(OUT);
  const embedded = thumbs.filter(Boolean).length;
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`Saved ${products.length} products (${embedded} with images) to ${path.relative(process.cwd(), OUT)} [${mb} MB]`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
