import { catalogManager } from './catalog-manager.js';

async function test() {
    const testQueries = [
        'двери в ванную',
        'белые двери',
        'двери со стеклом',
        'скрытые двери инвиз',
        'входные сейф-двери',
        'эмалированные двери',
        'черный дуб',
        'двери с терморазрывом'
    ];

    console.log('Testing Sitemap Collection Mapping:\n');
    for (const q of testQueries) {
        const result = catalogManager.getCollectionUrl(q);
        console.log(`Query: "${q}"`);
        if (result) {
            console.log(`Found: ${result.title} -> ${result.url}`);
        } else {
            console.log('Not found');
        }
        console.log('---');
    }
}

test();
