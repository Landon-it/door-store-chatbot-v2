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
            console.error('Error updating catalog:', error);
        }
    }

    parseCatalog(rawData) {
        // Map XLS columns to our product structure
        this.products = rawData
            .filter(item => item['ID товара'] || item['Название товара или услуги'])
            .map(item => {
                return {
                    id: item['ID товара'],
                    title: item['Название товара или услуги'],
                    price: item['Цена продажи'] || item['Цена'],
                    url: item['URL'],
                    description: item['Описание'] || item['Дополнительное описание'] || '',
                    category: item['Категория'],
                    // Store all properties for deep search
                    properties: Object.keys(item)
                        .filter(key => key.startsWith('Параметр:'))
                        .reduce((acc, key) => {
                            acc[key.replace('Параметр: ', '')] = item[key];
                            return acc;
                        }, {})
                };
            });
    }

    search(query, limit = 5) {
        if (!query) return [];
        const lowerQuery = query.toLowerCase();

        // Advanced search: check title, category, and properties
        return this.products
            .map(p => {
                let score = 0;
                if (p.title && p.title.toLowerCase().includes(lowerQuery)) score += 10;
                if (p.category && p.category.toLowerCase().includes(lowerQuery)) score += 5;
                if (JSON.stringify(p.properties).toLowerCase().includes(lowerQuery)) score += 3;
                return { ...p, score };
            })
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    getProductById(id) {
        return this.products.find(p => p.id === id);
    }
}

export const catalogManager = new CatalogManager();
