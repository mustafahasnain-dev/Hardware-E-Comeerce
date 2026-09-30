// Fetches every product from imsons.com.pk via the public WooCommerce Store API
// and writes a normalized list to data/products.json.
//
//   node scripts/scrape.js

const fs = require('fs');
const path = require('path');
const { convert } = require('html-to-text');

const BASE = 'https://imsons.com.pk/wp-json/wc/store/v1/products';
const PER_PAGE = 100; // Store API maximum
const OUT = path.join(__dirname, '..', 'data', 'products.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page, attempt = 1) {
  const url = `${BASE}?per_page=${PER_PAGE}&page=${page}&orderby=id&order=asc`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      items: await res.json(),
      total: Number(res.headers.get('x-wp-total')),
      totalPages: Number(res.headers.get('x-wp-totalpages')),
    };
  } catch (err) {
    if (attempt >= 5) throw new Error(`page ${page}: ${err.message}`);
    console.warn(`  page ${page} failed (${err.message}), retry ${attempt}...`);
    await sleep(2000 * attempt);
    return fetchPage(page, attempt + 1);
  }
}

// Titles and SKUs come back HTML-encoded (&#8243;, &amp;, ...).
const decode = (s) => (s ? convert(s, { wordwrap: false }).trim() : '');

const toText = (html) =>
  html
    ? convert(html, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'h1', options: { uppercase: false } },
          { selector: 'h2', options: { uppercase: false } },
          { selector: 'h3', options: { uppercase: false } },
          { selector: 'h4', options: { uppercase: false } },
          { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
          { selector: 'hr', format: 'skip' },
        ],
      })
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';

function money(value, minorUnit) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value) / 10 ** (minorUnit || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalize(p) {
  const pr = p.prices || {};
  const mu = pr.currency_minor_unit;
  const range = pr.price_range || null;
  const img = (p.images || [])[0] || {};
  return {
    id: p.id,
    name: decode(p.name),
    sku: decode(p.sku),
    type: p.type,
    category: (p.categories || []).map((c) => decode(c.name)).join(', '),
    shortDescription: toText(p.short_description),
    description: toText(p.description),
    currency: pr.currency_code || 'PKR',
    price: money(range ? range.min_amount : pr.price, mu),
    maxPrice: range ? money(range.max_amount, mu) : null,
    regularPrice: money(pr.regular_price, mu),
    salePrice: p.on_sale ? money(pr.sale_price, mu) : null,
    onSale: !!p.on_sale,
    inStock: p.is_in_stock !== false,
    imageUrl: img.src || '',
    thumbnailUrl: img.thumbnail || img.src || '',
    productUrl: p.permalink,
  };
}

(async () => {
  console.log('Fetching page 1...');
  const first = await fetchPage(1);
  console.log(`Store reports ${first.total} products across ${first.totalPages} pages.`);

  const raw = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) {
    await sleep(400); // be polite to the server
    const { items } = await fetchPage(page);
    raw.push(...items);
    console.log(`  page ${page}/${first.totalPages} -> ${raw.length} products`);
  }

  // Guard against duplicates if the catalogue shifted while paging.
  const seen = new Set();
  const products = raw.filter((p) => !seen.has(p.id) && seen.add(p.id)).map(normalize);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(products, null, 2));
  console.log(`Saved ${products.length} products to ${path.relative(process.cwd(), OUT)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
