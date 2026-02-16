import fetch from 'node-fetch';

class BitrixBot {
    constructor(domain, clientId, clientSecret) {
        this.domain = domain;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    async callMethod(method, params, auth) {
        let url;
        let body = { ...params };

        // Support for static webhooks (no OAuth needed)
        // If auth contains a full webhook URL (starts with http)
        if (auth && auth.webhook_url) {
            // Remove trailing slash if any
            const baseUrl = auth.webhook_url.replace(/\/$/, '');
            url = `${baseUrl}/${method}.json`;
            // For webhooks, we don't need 'auth' token in body usually, 
            // as it's already in the URL path (rest/ID/TOKEN/method)
        } else {
            // standard OAuth flow
            const targetDomain = (auth && auth.domain) ? auth.domain : this.domain;
            if (!targetDomain) {
                throw new Error(`BitrixBot: Domain is undefined. (method=${method})`);
            }
            url = `https://${targetDomain}/rest/${method}.json`;
            if (auth && auth.access_token) {
                body.auth = auth.access_token;
            }
        }

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
            'TYPE': 'H', // Humanized type for better Open Lines compatibility
            'EVENT_HANDLER': webhookUrl,
            'OPENLINE': 'Y', // Dual-provision for compatibility
            'PROPERTIES': {
                'NAME': 'Виртуальный консультант',
                'COLOR': 'GREEN',
                'EMAIL': 'bot@dveri-ekat.ru',
                'PERSONAL_BIRTHDAY': '2024-02-15',
                'PERSONAL_WWW': 'https://dveri-ekat.ru',
                'PERSONAL_GENDER': 'M',
                'PERSONAL_PHOTO': '',
                'OPENLINE': 'Y',
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

    async getBotList(auth) {
        return await this.callMethod('imbot.bot.list', {}, auth);
    }

    async updateBot(botId, params, auth) {
        return await this.callMethod('imbot.update', {
            'BOT_ID': botId,
            ...params
        }, auth);
    }

    async unregisterBot(botId, auth) {
        return await this.callMethod('imbot.unregister', {
            'BOT_ID': botId
        }, auth);
    }

    async appInfo(auth) {
        return await this.callMethod('app.info', {}, auth);
    }

    async registerEvent(event, url, auth) {
        return await this.callMethod('event.bind', {
            'EVENT': event,
            'HANDLER': url
        }, auth);
    }
}

export default BitrixBot;
