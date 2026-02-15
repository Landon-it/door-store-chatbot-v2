import BitrixBot from './bitrix-bot.js';
import dotenv from 'dotenv';
dotenv.config();

const bitrixBot = new BitrixBot(
    process.env.BITRIX24_DOMAIN,
    process.env.BITRIX24_CLIENT_ID,
    process.env.BITRIX24_CLIENT_SECRET
);

const WEBHOOK_URL = process.argv[2];

if (!WEBHOOK_URL) {
    console.error('Usage: node register-bitrix-bot.js <YOUR_PUBLIC_SERVER_URL>/api/bitrix/webhook');
    process.exit(1);
}

// NOTE: In a real "Local App" scenario, Bitrix24 provides the 'auth' object in the query params 
// when you open the app in Bitrix24 UI. This script is a template. 
// For a one-time registration, you can use a Bitrix24 Webhook Token if you don't want to deal with OAuth.
console.log('--- Bitrix24 Bot Registration Template ---');
console.log('To register the bot, you need to call imbot.register via REST API.');
console.log('If you are using a Local Application, run this logic within the app installation handler.');
console.log('Target Webhook URL:', WEBHOOK_URL);
console.log('\nSuggested setup:');
console.log('1. Go to Bitrix24 -> Applications -> Developer Resources -> Other -> Local Application.');
console.log('2. Select "Server-side" (using API).');
console.log('3. Permissions: im, imbot.');
console.log('4. Install handler URL: ' + WEBHOOK_URL);
console.log('------------------------------------------');
