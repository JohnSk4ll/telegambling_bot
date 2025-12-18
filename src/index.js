import 'dotenv/config';
import { setupBot } from './bot.js';
import { setupServer } from './server.js';

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
