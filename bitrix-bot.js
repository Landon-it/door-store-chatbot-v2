import fetch from 'node-fetch';

class BitrixBot {
    constructor(domain, clientId, clientSecret) {
        this.domain = domain;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    async callMethod(method, params, auth) {
        // Use domain from auth if available (for multi-tenant or fallback), otherwise use default
        const targetDomain = (auth && auth.domain) ? auth.domain : this.domain;

        if (!targetDomain) {
            throw new Error(`BitrixBot: Domain is undefined. (method=${method}, auth.domain=${auth ? auth.domain : 'undefined'}, this.domain=${this.domain})`);
        }

        const url = `https://${targetDomain}/rest/${method}.json`;
        const body = {
            ...params,
            auth: auth.access_token
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        return await response.json();
    }

    /**
     * Registers the bot in Bitrix24
     * @param {string} webhookUrl - Public URL of the bot's endpoint
     */
    async registerBot(webhookUrl, auth) {
        return await this.callMethod('imbot.register', {
            'CODE': 'door_store_bot',
            'TYPE': 'B',
            'EVENT_MESSAGE_ADD': webhookUrl,
            'EVENT_WELCOME_MESSAGE': webhookUrl,
            'EVENT_BOT_DELETE': webhookUrl,
            'PROPERTIES': {
                'NAME': 'Виртуальный консультант',
                'COLOR': 'GREEN',
                'EMAIL': 'bot@dveri-ekat.ru',
                'PERSONAL_BIRTHDAY': '2024-02-15',
                'PERSONAL_WWW': 'https://dveri-ekat.ru',
                'PERSONAL_GENDER': 'M',
                'PERSONAL_PHOTO': '',
            }
        }, auth);
    }

    /**
     * Sends a message back to the chat
     */
    async sendMessage(botId, chatId, message, auth) {
        return await this.callMethod('imbot.message.add', {
            'BOT_ID': botId,
            'DIALOG_ID': chatId,
            'MESSAGE': message,
        }, auth);
    }
}

export default BitrixBot;
