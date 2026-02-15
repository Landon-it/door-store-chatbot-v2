// ===== InSales Data Bridge =====
// Этот скрипт отвечает за получение данных о товарах с сайта InSales

class InSalesBridge {
    constructor() {
        this.cacheKey = 'insales_catalog_cache';
        this.cacheExpiry = 3600000; // 1 час
        this.catalog = null;
        this.isLoading = false;
    }

    /**
     * Инициализация моста и загрузка каталога
     */
    async init() {
        const cached = localStorage.getItem(this.cacheKey);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < this.cacheExpiry) {
                this.catalog = data;
                console.log('InSales Bridge: Загружен каталог из кэша (%d товаров)', this.catalog.length);
                return;
            }
        }
        await this.syncCatalog();
    }

    /**
     * Синхронизация каталога с JSON API сайта
     */
    async syncCatalog() {
        if (this.isLoading) return;
        this.isLoading = true;

        console.log('InSales Bridge: Синхронизация каталога...');

        const endpoints = [
            '/collection/all.json?page_size=100', // Самый надежный для InSales
            '/products.json',
            '/search.json?q='
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint);
                if (response.ok) {
                    const data = await response.json();
                    const products = Array.isArray(data) ? data : (data.products || []);

                    if (products.length > 0) {
                        this.catalog = products.map(p => {
                            const handle = p.handle || p.permalink || p.id;
                            return {
                                id: p.id,
                                title: p.title,
                                handle: handle,
                                price: p.variants?.[0]?.price || p.price,
                                url: `/product/${handle}`,
                                image: p.images?.[0]?.original_url || p.first_image?.original_url,
                                category: p.category_id,
                                description: this.stripHtml(p.description || '').substring(0, 150)
                            };
                        });

                        localStorage.setItem(this.cacheKey, JSON.stringify({
                            data: this.catalog,
                            timestamp: Date.now()
                        }));

                        console.log('InSales Bridge: Синхронизация завершена. Найдено %d товаров', this.catalog.length);
                        this.isLoading = false;
                        return;
                    }
                }
            } catch (e) {
                console.warn(`InSales Bridge: Ошибка при запросе к ${endpoint}:`, e);
            }
        }

        console.error('InSales Bridge: Не удалось загрузить каталог ни с одного эндпоинта.');
        this.isLoading = false;
    }

    /**
     * Поиск подходящих товаров по запросу пользователя
     */
    findProducts(query, limit = 3) {
        if (!this.catalog || !query) return [];

        const searchTerms = query.toLowerCase()
            .replace(/[.,!?;:]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2);

        if (searchTerms.length === 0) return [];

        return this.catalog
            .map(product => {
                let score = 0;
                const text = (product.title + ' ' + (product.description || '')).toLowerCase();

                searchTerms.forEach(term => {
                    if (text.includes(term)) score += 1;
                });

                return { ...product, score };
            })
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Форматирование найденных товаров для контекста ИИ
     */
    formatProductsForAI(products) {
        if (products.length === 0) return "К сожалению, в нашем каталоге по вашему запросу ничего не найдено.";

        return "Найденные товары в нашем каталоге:\n" + products.map(p =>
            `- ${p.title} (Цена: ${p.price} руб.). Ссылка: ${window.location.origin}${p.url}`
        ).join('\n');
    }

    stripHtml(html) {
        const tmp = document.createElement("DIV");
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || "";
    }
}

// Global instance
const INSALES_BRIDGE = new InSalesBridge();
INSALES_BRIDGE.init();
