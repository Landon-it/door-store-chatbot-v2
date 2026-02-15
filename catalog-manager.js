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

    search(query, limit = 5) {
        if (!query || typeof query !== 'string') return [];
        const lowerQuery = query.toLowerCase();

        // Ensure products is an array
        if (!Array.isArray(this.products)) {
            console.error('CatalogManager: products is not an array!');
            return [];
        }

        try {
            // Advanced search: check title, category, and properties
            return this.products
                .map(p => {
                    if (!p) return { score: 0 };
                    let score = 0;
                    if (p.title && p.title.toLowerCase().includes(lowerQuery)) score += 10;
                    if (p.category && p.category.toLowerCase().includes(lowerQuery)) score += 5;

                    // Safe properties search
                    if (p.properties) {
                        try {
                            if (JSON.stringify(p.properties).toLowerCase().includes(lowerQuery)) score += 3;
                        } catch (e) {
                            // Ignore stringify errors
                        }
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
