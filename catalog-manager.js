import axios from 'axios';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_URL = 'https://dveri-ekat.ru/marketplace/2629822.xls';
const CACHE_FILE = path.join(__dirname, 'catalog_cache.json');

class CatalogManager {
    constructor() {
        this.products = [];
        this.categories = {};
        this.lastUpdate = null;
    }

    async init() {
        // Load from cache if exists
        try {
            if (fs.existsSync(CACHE_FILE)) {
                console.log('Loading catalog from cache...');
                const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                this.products = cachedData.products;
                this.categories = cachedData.categories;
                this.lastUpdate = cachedData.lastUpdate;
                console.log(`Loaded ${this.products.length} products from cache.`);
            } else {
                await this.updateCatalog();
            }
        } catch (error) {
            console.error('Error initializing catalog:', error);
        }
    }

    async updateCatalog() {
        console.log('Fetching catalog from:', CATALOG_URL);
        try {
            const response = await axios.get(CATALOG_URL, { responseType: 'arraybuffer' });
            const workbook = XLSX.read(response.data, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet);

            console.log(`Fetched ${rawData.length} raw items. Parsing...`);
            this.parseCatalog(rawData);

            // Save to cache
            fs.writeFileSync(CACHE_FILE, JSON.stringify({
                products: this.products,
                categories: this.categories,
                lastUpdate: new Date()
            }, null, 2));

            console.log(`Catalog updated: ${this.products.length} products.`);
        } catch (error) {
            console.error('Error updating catalog:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
            }
        }
    }

    parseCatalog(rawData) {
        if (!rawData || rawData.length === 0) {
            console.error('No data found in XLS');
            this.products = [];
            return;
        }

        // Log keys of the first non-empty item to debug
        const firstItem = rawData.find(item => Object.keys(item).length > 0);
        if (firstItem) {
            console.log('Detected XLS columns:', Object.keys(firstItem));
        }

        // Map XLS columns to our product structure
        this.products = rawData
            .map(item => {
                // Try different possible column names
                const title = item['Название товара или услуги'] || item['Название'] || item['Наименование'] || item['Name'];
                const id = item['ID товара'] || item['ID'] || item['Артикул'];
                const price = item['Цена продажи'] || item['Цена'] || item['Price'];
                const url = item['URL'] || item['Ссылка'];

                if (!title) return null;

                return {
                    id: id || `item_${Math.random().toString(36).substr(2, 9)}`,
                    title: title,
                    price: price || 'по запросу',
                    url: url || '',
                    description: item['Описание'] || item['Дополнительное описание'] || '',
                    category: item['Категория'] || '',
                    // Store all properties for deep search
                    properties: Object.keys(item)
                        .filter(key => key.startsWith('Параметр:') || key.startsWith('Характеристика:'))
                        .reduce((acc, key) => {
                            acc[key.replace(/^Параметр: |^Характеристика: /, '')] = item[key];
                            return acc;
                        }, {})
                };
            })
            .filter(item => item !== null);

        console.log(`Parsed ${this.products.length} valid products.`);
    }

    search(query, limit = 7) {
        if (!query || typeof query !== 'string') return [];
        let lowerQuery = query.toLowerCase();

        // ── Price range detection ──────────────────────────────────────────
        // Supports: "до 15000", "до 15 тыс", "от 10000", "10000-20000"
        let minPrice = 0, maxPrice = Infinity;
        const priceRange = lowerQuery.match(/(\d[\d\s]*)[-–](\d[\d\s]*)\s*(тыс|т\.р|руб)?/);
        const priceUpTo = lowerQuery.match(/до\s+(\d[\d\s]*)\s*(тыс|т\.р|руб)?/);
        const priceFrom = lowerQuery.match(/от\s+(\d[\d\s]*)\s*(тыс|т\.р|руб)?/);

        if (priceRange) {
            const mult = (priceRange[3] === 'тыс') ? 1000 : 1;
            minPrice = parseInt(priceRange[1].replace(/\s/g, '')) * mult;
            maxPrice = parseInt(priceRange[2].replace(/\s/g, '')) * mult;
        } else {
            if (priceFrom) {
                const mult = (priceFrom[2] === 'тыс') ? 1000 : 1;
                minPrice = parseInt(priceFrom[1].replace(/\s/g, '')) * mult;
            }
            if (priceUpTo) {
                const mult = (priceUpTo[2] === 'тыс') ? 1000 : 1;
                maxPrice = parseInt(priceUpTo[1].replace(/\s/g, '')) * mult;
            }
        }

        // Remove price tokens from text query
        lowerQuery = lowerQuery
            .replace(/от\s+\d[\d\s]*(тыс|т\.р|руб)?/g, '')
            .replace(/до\s+\d[\d\s]*(тыс|т\.р|руб)?/g, '')
            .replace(/\d[\d\s]*[-–]\d[\d\s]*(тыс|т\.р|руб)?/g, '')
            .replace(/\s+/g, ' ').trim();

        const hasPriceFilter = minPrice > 0 || maxPrice < Infinity;

        // ── Aliases / Synonyms ────────────────────────────────────────────
        const aliases = {
            'вфд': 'владимирская фабрика дверей',
            'скрытые двери': 'invisible',
            'скрытая дверь': 'invisible',
            'скрытого монтажа': 'invisible',
            'сейф-двери': 'входные двери',
            'сейф двери': 'входные двери',
            'сейф': 'входные двери',
            'сейфы': 'входные двери'
        };

        for (const [alias, realName] of Object.entries(aliases)) {
            if (lowerQuery.includes(alias)) {
                lowerQuery = lowerQuery.replace(alias, realName);
            }
        }

        // ── Brand context ─────────────────────────────────────────────────
        const brandKeywords = ['фабрика', 'производитель', 'изготовитель', 'бренд'];
        let isBrandSearch = false;
        if (brandKeywords.some(k => lowerQuery.includes(k))) {
            isBrandSearch = true;
            brandKeywords.forEach(k => { lowerQuery = lowerQuery.replace(k, '').trim(); });
        }

        if (!lowerQuery && isBrandSearch) return [];

        // ── Ensure products array ─────────────────────────────────────────
        if (!Array.isArray(this.products)) {
            console.error('CatalogManager: products is not an array!');
            return [];
        }

        try {
            // Pre-filter by price (numeric comparison)
            let pool = this.products;
            if (hasPriceFilter) {
                pool = pool.filter(p => {
                    const numPrice = parseFloat(String(p.price).replace(/\s/g, '').replace(',', '.'));
                    return !isNaN(numPrice) && numPrice >= minPrice && numPrice <= maxPrice;
                });
            }

            // If only price was given (no text), return price-sorted products with URLs
            if (!lowerQuery && hasPriceFilter) {
                return pool
                    .filter(p => p && p.url)
                    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
                    .slice(0, limit);
            }

            // Text search with scoring
            return pool
                .map(p => {
                    if (!p) return { score: 0 };
                    let score = 0;

                    const titleLower = p.title ? p.title.toLowerCase() : '';
                    const categoryLower = p.category ? p.category.toLowerCase() : '';

                    if (titleLower.includes(lowerQuery)) score += 10;
                    if (categoryLower.includes(lowerQuery)) score += 5;

                    // Boost brand matches in properties
                    if (p.properties) {
                        try {
                            const propsStr = JSON.stringify(p.properties).toLowerCase();
                            if (propsStr.includes(lowerQuery)) {
                                score += isBrandSearch ? 15 : 3;
                            }
                        } catch (e) { }
                    }
                    return { ...p, score };
                })
                .filter(p => p.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

        } catch (error) {
            console.error('CatalogManager Search Error:', error);
            return [];
        }
    }

    getProductById(id) {
        return this.products.find(p => p.id === id);
    }
}

export const catalogManager = new CatalogManager();
