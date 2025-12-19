// Глобальный вывод ошибок для диагностики
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
});

import 'dotenv/config';
import { setupBot } from './bot.js';
import { setupServer } from './server.js';
import * as storage from './storage.js';
import { forceWrite } from './db.js';

// Graceful shutdown - force write pending data
const shutdown = async (signal) => {
    console.log(`\n${signal} received. Saving data...`);
    try {
        await forceWrite();
        console.log('Data saved successfully');
        process.exit(0);
    } catch (error) {
        console.error('Error saving data:', error);
        process.exit(1);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN не найден в .env файле!');
    console.error('Создайте файл .env и добавьте туда ваш токен:');
    console.error('TELEGRAM_BOT_TOKEN=ваш_токен_бота');
    process.exit(1);
}

// Start the bot
const bot = setupBot(TOKEN);

// Start the web server
const app = setupServer(5051);

console.log('✅ Бот запущен!');
console.log('📱 Telegram бот активен');
console.log('🌐 Веб-интерфейс: http://localhost:5051');

// Scheduler: every minute check Kyiv time and give daily coins at 00:00
function getKyivDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function getKyivTimeHM(date = new Date()) {
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    const [hour, minute] = s.split(':').map(v => parseInt(v, 10));
    return { hour, minute };
}

async function checkDailyReward() {
    try {
        const now = new Date();
        const { hour, minute } = getKyivTimeHM(now);
        const kyivDate = getKyivDateString(now); // YYYY-MM-DD
        const last = await storage.getLastDailyRewardDate();
        const lastDate = last ? new Date(last) : null;
        const lastKyivDate = lastDate ? getKyivDateString(lastDate) : null;

        if (hour === 0 && minute === 0 && kyivDate !== lastKyivDate) {
            console.log('[Scheduler] Distributing daily coins to all users...');
            const res = await storage.giveDailyCoinsToAll(1000);
            console.log(`[Scheduler] Given 1000 coins to ${res.count} users`);
        }
    } catch (err) {
        console.error('Error in daily reward scheduler:', err);
    }
}

// run immediately and then every 60 seconds
checkDailyReward();
setInterval(checkDailyReward, 60 * 1000);
