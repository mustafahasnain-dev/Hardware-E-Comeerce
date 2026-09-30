# Hardware-E-Comeerce

Product catalogue pulled from [imsons.com.pk](https://imsons.com.pk/) into an Excel workbook, then displayed in an HTML table.

## Files

| Path | What it is |
| --- | --- |
| `data/products.xlsx` | All products: name, SKU, category, prices, stock, descriptions, image URL, product URL, plus an embedded image |
| `data/products.json` | The same data as JSON (intermediate output of the scraper) |
| `index.html` | Reads `data/products.xlsx` in the browser and shows it as a searchable, sortable table (no images) |
| `scripts/scrape.js` | Fetches every product from the site's WooCommerce Store API |
| `scripts/build-excel.js` | Downloads the thumbnails and writes the Excel file |
| `server.js` | Small static server for viewing `index.html` |

## Usage

```bash
npm install
npm start          # open http://localhost:3000
npm run build      # re-scrape the site and rebuild data/products.xlsx
```

`index.html` has to be served over HTTP to load the Excel file automatically. If you open it by double-clicking, it will ask you to choose `products.xlsx` instead.
