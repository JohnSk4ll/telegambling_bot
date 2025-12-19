import TelegramBot from 'node-telegram-bot-api';
import * as storage from './storage.js';

export function setupBot(token) {
    const bot = new TelegramBot(token, { polling: true });
    
    // Очистка буфера сообщений при старте с retry logic
    const clearBuffer = async () => {
        try {
            await bot.getUpdates({ offset: -1 });
            console.log('Message buffer cleared');
        } catch (error) {
            if (error.response && error.response.body && error.response.body.parameters) {
                const retryAfter = error.response.body.parameters.retry_after;
                if (retryAfter) {
                    console.log(`Rate limited while clearing buffer. Retrying after ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
                    await bot.getUpdates({ offset: -1 });
                    console.log('Message buffer cleared');
                    return;
                }
            }
            console.error('Failed to clear message buffer:', error.message);
        }
    };
    clearBuffer();
    
    // Глобальная обработка ошибок polling
    bot.on('polling_error', (error) => {
        console.error('Polling error:', error);
    });
    
    // Обработка ошибок при отправке сообщений (включая 429)
    const originalSendMessage = bot.sendMessage.bind(bot);
    const originalSendPhoto = bot.sendPhoto.bind(bot);
    
    bot.sendMessage = async (chatId, text, options = {}) => {
        try {
            return await originalSendMessage(chatId, text, options);
        } catch (error) {
            if (error.response && error.response.body && error.response.body.parameters) {
                const retryAfter = error.response.body.parameters.retry_after;
                if (retryAfter) {
                    console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
                    return await originalSendMessage(chatId, text, options);
                }
            }
            console.error('Error sending message:', error.message);
            throw error;
        }
    };
    
    bot.sendPhoto = async (chatId, photo, options = {}) => {
        try {
            return await originalSendPhoto(chatId, photo, options);
        } catch (error) {
            if (error.response && error.response.body && error.response.body.parameters) {
                const retryAfter = error.response.body.parameters.retry_after;
                if (retryAfter) {
                    console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
                    return await originalSendPhoto(chatId, photo, options);
                }
            }
            console.error('Error sending photo:', error.message);
            throw error;
        }
    };
    
    // Хелпер для отправки сообщения с reply
    const sendReply = (chatId, messageId, text, options = {}) => {
        return bot.sendMessage(chatId, text, {
            ...options,
            reply_to_message_id: messageId
        });
    };
    
    const sendPhotoReply = (chatId, messageId, photo, options = {}) => {
        return bot.sendPhoto(chatId, photo, {
            ...options,
            reply_to_message_id: messageId
        });
    };
    
    // Хелпер для упоминания пользователя (создаёт кликабельное упоминание)
    const mentionUser = (userOrMsg) => {
        if (!userOrMsg) return 'пользователь';
        
        // Если это объект сообщения (с msg.from)
        if (userOrMsg.from) {
            const name = userOrMsg.from.first_name || userOrMsg.from.username || 'пользователь';
            const userId = userOrMsg.from.id;
            return `[${name}](tg://user?id=${userId})`;
        }
        // Если это объект пользователя из базы данных
        const name = userOrMsg.firstName || userOrMsg.username || 'пользователь';
        const userId = userOrMsg.telegramId;
        return `[${name}](tg://user?id=${userId})`;
    };
    
    // Обертка для безопасной обработки команд
    const safeHandler = (handler) => async (msg, match) => {
        try {
            await handler(msg, match);
        } catch (error) {
            console.error('Error in command handler:', error);
            const chatId = msg.chat.id;
            const userName = mentionUser(msg);
            sendReply(chatId, msg.message_id, `❌ ${userName}, произошла ошибка при обработке команды. Попробуйте позже.`).catch(() => {});
        }
    };
    
    // Set bot commands (must use Latin characters only)
    bot.setMyCommands([
        { command: 'connect', description: 'Зарегистрироваться в боте (/подключиться)' },
        { command: 'balance', description: 'Проверить баланс (/баланс)' },
        { command: 'cases', description: 'Список кейсов (/кейсы)' },
        { command: 'view', description: 'Посмотреть содержимое кейса (/просмотр [id])' },
        { command: 'open', description: 'Открыть кейс (/открыть [id])' },
        { command: 'inventory', description: 'Инвентарь (/инвентарь)' },
        { command: 'sell', description: 'Продать предмет (/продать [id])' },
        { command: 'promocode', description: 'Активировать промокод (/промокод <код>)' },
        { command: 'cointoss', description: 'Игра в монетку 50/50 (/cointoss @user сумма)' },
        { command: 'trade', description: 'Обмен (/обмен)' },
        { command: 'trades', description: 'Входящие обмены (/обмены)' },
        { command: 'help', description: 'Справка (/помощь)' }
    ]);
        // /промокод or /promocode - Redeem promo code
        bot.onText(/\/(промокод|promocode)(?:\s+(.+))?/i, safeHandler(async (msg, match) => {
            const chatId = msg.chat.id;
            const userName = mentionUser(msg);
            const user = storage.getUser(msg.from.id);
            if (!user) {
                sendReply(chatId, msg.message_id, `❌ ${userName}, вы не зарегистрированы! Используйте /подключиться`);
                return;
            }
            if (user.banned) {
                sendReply(chatId, msg.message_id, `🚫 ${userName}, вы заблокированы и не можете использовать бота.`);
                return;
            }
            const code = match[2]?.trim();
            if (!code) {
                sendReply(chatId, msg.message_id, `${userName}, введите промокод после команды.\nПример: /промокод NEWYEAR2025`);
                return;
            }
            const result = await storage.redeemPromo(msg.from.id, code);
            if (result.success) {
                sendReply(chatId, msg.message_id, `✅ ${userName}, промокод активирован!\n\n💰 Вы получили: ${result.amount} монет`);
            } else {
                sendReply(chatId, msg.message_id, `❌ ${userName}, ${result.message}`);
            }
        }));
    
    // /подключиться or /connect - Register
    bot.onText(/\/(подключиться|connect)/, safeHandler(async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const username = msg.from.username;
        const firstName = msg.from.first_name;
        const userName = mentionUser(msg);
        
        const result = await storage.createUser(telegramId, username, firstName);
        
        if (result.success) {
            sendReply(chatId, msg.message_id,
                `🎰 Добро пожаловать, ${userName}!\n\n` +
                `Вы успешно зарегистрировались!\n` +
                `💰 Ваш начальный баланс: 1000 монет\n\n` +
                `Используйте /помощь для просмотра команд.`
            );
        } else {
            sendReply(chatId, msg.message_id, `❌ ${userName}, ${result.message}`);
        }
    }));
    
    // /баланс or /balance - Check balance
    bot.onText(/\/(баланс|balance)/, safeHandler(async (msg) => {
        const chatId = msg.chat.id;
        const userName = mentionUser(msg);
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            sendReply(chatId, msg.message_id, `❌ ${userName}, вы не зарегистрированы! Используйте /подключиться`);
            return;
        }
        
        if (user.banned) {
            sendReply(chatId, msg.message_id, `🚫 ${userName}, вы заблокированы и не можете использовать бота.`);
            return;
        }
        
        sendReply(chatId, msg.message_id,
            `${userName}, ваш баланс:\n` +
            `💰 Монеты: ${user.coins}\n` +
            `📦 Предметов в инвентаре: ${user.inventory.length}`
        );
    }));
    
    // /кейсы or /cases - List cases
    bot.onText(/\/(кейсы|cases)/, safeHandler(async (msg) => {
        const chatId = msg.chat.id;
        const cases = storage.getAllCases();
        
        if (cases.length === 0) {
            bot.sendMessage(chatId, '📦 Кейсов пока нет.');
            return;
        }
        
        let message = '🎁 **Доступные кейсы:**\n\n';
        cases.forEach(c => {
            message += `📦 **${c.name}**\n`;
            message += `   ID: \`${c.id}\`\n`;
            message += `   💰 Цена: ${c.price} монет\n`;
            message += `   🎲 Предметов: ${c.items.length}\n\n`;
        });
        message += `Для открытия используйте: /открыть [id]\n`;
        message += `Для просмотра содержимого: /просмотр [id]`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }));

    // /просмотр or /view - View case contents
    bot.onText(/\/(просмотр|view)(?:\s+(.+))?/, safeHandler(async (msg, match) => {
        const chatId = msg.chat.id;
        const caseId = match[2]?.trim();
        
        if (!caseId) {
            const cases = storage.getAllCases();
            let message = '🔍 Укажите ID кейса для просмотра:\n\n';
            cases.forEach(c => {
                message += `• \`${c.id}\` - ${c.name}\n`;
            });
            message += '\nПример: /просмотр basic_case';
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }
        
        const caseItem = storage.getCase(caseId);
        if (!caseItem) {
            bot.sendMessage(chatId, '❌ Кейс не найден!');
            return;
        }
        
        const rarityEmojis = {
            blue: '🔵',
            purple: '🟣',
            pink: '🩷',
            red: '🔴',
            gold: '🌟'
        };
        
        const rarityNames = {
            blue: 'Обычный',
            purple: 'Необычный',
            pink: 'Редкий',
            red: 'Эпический',
            gold: 'Легендарный'
        };
        
        let message = `📦 **${caseItem.name}**\n`;
        message += `💰 Цена: ${caseItem.price} монет\n`;
        message += `🎲 Всего предметов: ${caseItem.items.length}\n\n`;
        message += `**Содержимое:**\n\n`;
        
        caseItem.items.forEach((item, idx) => {
            message += `${idx + 1}\. ${rarityEmojis[item.rarity] || '🎁'} **${item.name}**\n`;
            message += `   📊 Редкость: ${rarityNames[item.rarity] || item.rarity}\n`;
            message += `   💎 Стоимость: ${item.value || 0} монет\n`;
            message += `   🎯 Шанс: ${item.chance}%\n`;
            
            // Показать вариации если есть
            if (item.variations && Array.isArray(item.variations) && item.variations.length > 0) {
                message += `   🧩 Вариации: ${item.variations.length}\n`;
                item.variations.forEach((v, vIdx) => {
                    message += `      ${vIdx + 1}\) ${v.name} - ${v.price} монет (${v.chance}%)\n`;
                });
            }
            message += `\n`;
        });
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }));
    
    // /открыть or /open - Open case
    bot.onText(/\/(открыть|open)(?:\s+(.+))?/, safeHandler(async (msg, match) => {
        const chatId = msg.chat.id;
        const userName = mentionUser(msg);
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, `❌ ${userName}, вы не зарегистрированы! Используйте /подключиться`);
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, `🚫 ${userName}, вы заблокированы и не можете использовать бота.`);
            return;
        }
        
        const caseId = match[2]?.trim();
        
        if (!caseId) {
            const cases = storage.getAllCases();
            let message = '📦 Укажите ID кейса для открытия:\n\n';
            cases.forEach(c => {
                message += `• \`${c.id}\` - ${c.name} (${c.price} монет)\n`;
            });
            message += '\nПример: /открыть basic_case';
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }
        
        const caseItem = storage.getCase(caseId);
        if (!caseItem) {
            bot.sendMessage(chatId, '❌ Кейс не найден!');
            return;
        }
        
        if (user.coins < caseItem.price) {
            bot.sendMessage(chatId, `❌ Недостаточно монет! Нужно: ${caseItem.price}, у вас: ${user.coins}`);
            return;
        }
        
        // Deduct coins
        await storage.updateUserCoins(msg.from.id, -caseItem.price);
        
        // Roll
        const wonItem = storage.rollCase(caseId);
        
        if (!wonItem) {
            await storage.updateUserCoins(msg.from.id, caseItem.price); // Refund
            bot.sendMessage(chatId, '❌ Ошибка при открытии кейса!');
            return;
        }
        
        // Add to inventory
        await storage.addItemToInventory(msg.from.id, wonItem);

        const rarityEmojis = {
            blue: '🔵',
            purple: '🟣',
            pink: '🩷',
            red: '🔴',
            gold: '🌟'
        };

        const rarityNames = {
            blue: 'Обычный',
            purple: 'Необычный',
            pink: 'Редкий',
            red: 'Эпический',
            gold: 'Легендарный'
        };

        // Экранирование Markdown для Telegram
        function escapeMarkdown(text) {
            return String(text)
                .replace(/([_\*\[\]()~`>#+=|{}.!-])/g, '\\$1');
        }

        const messageText =
            `${userName}:\n` +
            `🎰 Вы открыли ${escapeMarkdown(caseItem.name)}!\n\n` +
            `${rarityEmojis[wonItem.rarity] || '🎁'} Вы выиграли: ${escapeMarkdown(wonItem.name)}\n` +
            `📊 Редкость: ${escapeMarkdown(rarityNames[wonItem.rarity] || wonItem.rarity)}\n` +
            `💎 Стоимость: ${(wonItem.value || 0)} монет\n` +
            (wonItem.variation ? `🧩 Вариация: ${escapeMarkdown(wonItem.variation.name)}\n` : '') +
            `\n💰 Ваш баланс: ${user.coins - caseItem.price} монет`;

        // Всегда отправлять фото если есть картинка
        if (wonItem.image) {
            let photoUrl = wonItem.image;
            // Если у вариации есть картинка, используем её
            if (wonItem.variation && wonItem.variation.image) {
                photoUrl = wonItem.variation.image;
            }
            // Если путь начинается с /uploads, всегда используем http://localhost:5051
            if (photoUrl.startsWith('/uploads')) {
                photoUrl = `http://localhost:5051${photoUrl}`;
            } else if (!/^https?:\/\//.test(photoUrl)) {
                photoUrl = `${process.env.BOT_URL || 'http://localhost:5051'}${photoUrl}`;
            }
            bot.sendPhoto(chatId, photoUrl, {
                caption: messageText,
                parse_mode: 'Markdown'
            }).catch(() => {
                // Fallback to text if image fails
                bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });
            });
        } else {
            bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });
        }
    }));
    
    // /инвентарь or /inventory - View inventory
    bot.onText(/\/(инвентарь|inventory)/, (msg) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        if (user.inventory.length === 0) {
            bot.sendMessage(chatId, '📦 Ваш инвентарь пуст. Откройте кейс командой /кейсы');
            return;
        }
        
        let message = `📦 **Ваш инвентарь** (${user.inventory.length} предметов):\n\n`;
        
        // Group by rarity
        const byRarity = {};
        user.inventory.forEach(item => {
            if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
            byRarity[item.rarity].push(item);
        });
        
        const rarityOrder = ['gold', 'red', 'pink', 'purple', 'blue'];
        const rarityNames = {
            blue: '🔵 Обычные',
            purple: '🟣 Необычные',
            pink: '🩷 Редкие',
            red: '🔴 Эпические',
            gold: '🌟 Легендарные'
        };
        
        rarityOrder.forEach(rarity => {
            if (byRarity[rarity]) {
                message += `\n${rarityNames[rarity]}:\n`;
                byRarity[rarity].forEach(item => {
                    let itemName = item.name;
                    let itemValue = item.value;
                    if (item.variation) {
                        itemName = `${item.name}`;
                        itemValue = item.value;
                    }
                    message += `  • ${itemName} (${itemValue} монет)\n`;
                    if (item.variation) {
                        message += `    🧩 Вариация: ${item.variation.name}\n`;
                    }
                    message += `    ID: \`${item.instanceId}\`\n`;
                });
            }
        });
        
        message += `\n💰 Общая стоимость: ${user.inventory.reduce((sum, i) => sum + i.value, 0)} монет`;
        message += `\n\n💡 Для продажи используйте: /продать [ID]`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // /продать or /sell - Sell item to bot
    bot.onText(/\/(продать|sell)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const itemId = match[2]?.trim();
        
        if (!itemId) {
            if (user.inventory.length === 0) {
                bot.sendMessage(chatId, '📦 Ваш инвентарь пуст. Нечего продавать!');
                return;
            }
            
            let message = `💰 **Продажа предметов**\n\n`;
            message += `Укажите ID предмета для продажи:\n`;
            message += `/продать [ID]\n\n`;
            message += `Ваши предметы:\n`;
            
            user.inventory.slice(0, 10).forEach(item => {
                message += `• ${item.name} - ${item.value} монет\n`;
                message += `  ID: \`${item.instanceId}\`\n`;
            });
            
            if (user.inventory.length > 10) {
                message += `\n... и ещё ${user.inventory.length - 10} предметов\n`;
                message += `Используйте /инвентарь для полного списка`;
            }
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }
        
        // Handle "all" to sell everything
        if (itemId.toLowerCase() === 'all' || itemId.toLowerCase() === 'все') {
            if (user.inventory.length === 0) {
                bot.sendMessage(chatId, '📦 Ваш инвентарь пуст!');
                return;
            }
            
            const totalValue = user.inventory.reduce((sum, i) => sum + i.value, 0);
            const itemCount = user.inventory.length;
            
            // Clear inventory and add coins
            await storage.updateUser(msg.from.id, { inventory: [] });
            await storage.updateUserCoins(msg.from.id, totalValue);
            
            bot.sendMessage(chatId,
                `✅ Продано ${itemCount} предметов!\n\n` +
                `💰 Получено: ${totalValue} монет\n` +
                `💵 Ваш баланс: ${user.coins + totalValue} монет`
            );
            return;
        }
        
        // Find item in inventory
        const item = user.inventory.find(i => i.instanceId === itemId);
        
        if (!item) {
            bot.sendMessage(chatId, '❌ Предмет не найден в вашем инвентаре!');
            return;
        }
        
        // Remove item and add coins
        await storage.removeItemFromInventory(msg.from.id, itemId);
        await storage.updateUserCoins(msg.from.id, item.value);
        
        bot.sendMessage(chatId,
            `✅ Продано: **${item.name}**\n\n` +
            `💰 Получено: ${item.value} монет\n` +
            `💵 Ваш баланс: ${user.coins + item.value} монет`,
            { parse_mode: 'Markdown' }
        );
    });

    // /cointoss - Create coin toss challenge
    // Format: /cointoss @username amount
    bot.onText(/\/cointoss(?:\s+(.+))?/, safeHandler(async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            await sendReply(chatId, msg.message_id, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            await sendReply(chatId, msg.message_id, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const args = match[1]?.trim();
        
        if (!args) {
            await sendReply(chatId, msg.message_id,
                `🪙 **Орёл и решка**\n\n` +
                `Формат команды:\n` +
                `/cointoss @username сумма\n\n` +
                `Игра 50/50 на монеты. Победитель забирает всё!\n\n` +
                `Пример:\n` +
                `/cointoss @player 100\n\n` +
                `Используйте:\n` +
                `• /tosses - посмотреть входящие вызовы\n` +
                `• /accept ID - принять вызов\n` +
                `• /decline ID - отклонить вызов`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Parse username and amount
        const parts = args.split(/\s+/);
        if (parts.length < 2) {
            await sendReply(chatId, msg.message_id, '❌ Неверный формат! Используйте: /cointoss @username сумма');
            return;
        }
        
        let username = parts[0].replace('@', '');
        const amount = parseInt(parts[1]);
        
        if (isNaN(amount) || amount <= 0) {
            await sendReply(chatId, msg.message_id, '❌ Укажите корректную сумму!');
            return;
        }
        
        if (amount > user.coins) {
            await sendReply(chatId, msg.message_id, `❌ У вас недостаточно монет! Ваш баланс: ${user.coins}`);
            return;
        }
        
        // Find opponent by username
        const allUsers = storage.getAllUsers();
        const opponent = allUsers.find(u => u.username && u.username.toLowerCase() === username.toLowerCase());
        
        if (!opponent) {
            await sendReply(chatId, msg.message_id, '❌ Игрок не найден! Убедитесь, что он использовал команду /подключиться');
            return;
        }
        
        if (opponent.telegramId === msg.from.id) {
            await sendReply(chatId, msg.message_id, '❌ Нельзя вызвать самого себя!');
            return;
        }
        
        if (opponent.banned) {
            await sendReply(chatId, msg.message_id, '❌ Этот игрок заблокирован.');
            return;
        }
        
        if (amount > opponent.coins) {
            await sendReply(chatId, msg.message_id, `❌ У ${mentionUser(opponent)} недостаточно монет!`);
            return;
        }
        
        // Create coin toss
        const toss = await storage.createCoinToss(msg.from.id, opponent.telegramId, amount);
        
        await sendReply(chatId, msg.message_id,
            `🪙 Вызов отправлен!\n\n` +
            `${mentionUser(msg)} бросает вызов ${mentionUser(opponent)}\n` +
            `💰 Ставка: ${amount} монет\n` +
            `🆔 ID вызова: ${toss.id}\n\n` +
            `Ожидаем ответа...`,
            { parse_mode: 'Markdown' }
        );
        
        // Notify opponent
        try {
            await bot.sendMessage(opponent.telegramId,
                `🪙 **Входящий вызов!**\n\n` +
                `${mentionUser(msg)} вызывает вас на орёл и решку!\n` +
                `💰 Ставка: ${amount} монет\n` +
                `🆔 ID: ${toss.id}\n\n` +
                `Используйте:\n` +
                `• /accept ${toss.id} - принять вызов\n` +
                `• /decline ${toss.id} - отклонить вызов\n\n` +
                `Победитель забирает ${amount * 2} монет!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Failed to notify opponent:', error.message);
        }
    }));

    // /tosses - View pending coin tosses
    bot.onText(/\/tosses/, safeHandler(async (msg) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            await sendReply(chatId, msg.message_id, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            await sendReply(chatId, msg.message_id, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const tosses = storage.getCoinTossesForUser(msg.from.id);
        
        if (tosses.length === 0) {
            await sendReply(chatId, msg.message_id, '📭 У вас нет входящих вызовов.');
            return;
        }
        
        let message = '🪙 **Входящие вызовы:**\n\n';
        
        for (const toss of tosses) {
            const challenger = storage.getUser(toss.challengerId);
            if (challenger) {
                message += `🆔 ID: ${toss.id}\n`;
                message += `👤 От: ${mentionUser(challenger)}\n`;
                message += `💰 Ставка: ${toss.amount} монет\n`;
                message += `📅 ${new Date(toss.createdAt).toLocaleString('ru-RU')}\n\n`;
            }
        }
        
        message += `Используйте /accept ID или /decline ID`;
        
        await sendReply(chatId, msg.message_id, message, { parse_mode: 'Markdown' });
    }));

    // /accept - Accept coin toss
    bot.onText(/\/accept(?:\s+(.+))?/, safeHandler(async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            await sendReply(chatId, msg.message_id, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            await sendReply(chatId, msg.message_id, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const tossId = match[1]?.trim();
        
        if (!tossId) {
            await sendReply(chatId, msg.message_id, '❌ Укажите ID вызова! Используйте: /accept ID\n\nСмотрите /tosses для списка вызовов');
            return;
        }
        
        const toss = storage.getCoinTossById(tossId);
        
        if (!toss) {
            await sendReply(chatId, msg.message_id, '❌ Вызов не найден!');
            return;
        }
        
        if (toss.opponentId !== msg.from.id) {
            await sendReply(chatId, msg.message_id, '❌ Это не ваш вызов!');
            return;
        }
        
        // Execute coin toss
        const result = await storage.executeCoinToss(tossId);
        
        if (!result.success) {
            await sendReply(chatId, msg.message_id, `❌ Ошибка: ${result.error}`);
            return;
        }
        
        const challenger = storage.getUser(toss.challengerId);
        const opponent = storage.getUser(toss.opponentId);
        const winner = storage.getUser(result.winnerId);
        const loser = storage.getUser(result.loserId);
        
        const resultMessage =
            `🪙 **Орёл и решка!**\n\n` +
            `${mentionUser(challenger)} VS ${mentionUser(opponent)}\n` +
            `💰 Ставка: ${toss.amount} монет каждый\n\n` +
            `🎲 Подбрасываем монетку...\n\n` +
            `${result.isHeads ? '🔵 Орёл!' : '⚫ Решка!'}\n\n` +
            `🏆 Победитель: ${mentionUser(winner)}\n` +
            `💸 Проигравший: ${mentionUser(loser)}\n\n` +
            `✅ ${mentionUser(winner)} получает ${toss.amount * 2} монет!`;
        
        await sendReply(chatId, msg.message_id, resultMessage, { parse_mode: 'Markdown' });
        
        // Notify challenger
        if (toss.challengerId !== msg.from.id) {
            try {
                await bot.sendMessage(toss.challengerId, resultMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Failed to notify challenger:', error.message);
            }
        }
    }));

    // /decline - Decline coin toss
    bot.onText(/\/decline(?:\s+(.+))?/, safeHandler(async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            await sendReply(chatId, msg.message_id, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            await sendReply(chatId, msg.message_id, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const tossId = match[1]?.trim();
        
        if (!tossId) {
            await sendReply(chatId, msg.message_id, '❌ Укажите ID вызова! Используйте: /decline ID');
            return;
        }
        
        const toss = storage.getCoinTossById(tossId);
        
        if (!toss) {
            await sendReply(chatId, msg.message_id, '❌ Вызов не найден!');
            return;
        }
        
        if (toss.opponentId !== msg.from.id && toss.challengerId !== msg.from.id) {
            await sendReply(chatId, msg.message_id, '❌ Это не ваш вызов!');
            return;
        }
        
        const challenger = storage.getUser(toss.challengerId);
        const opponent = storage.getUser(toss.opponentId);
        
        storage.cancelCoinToss(tossId);
        
        await sendReply(chatId, msg.message_id, '❌ Вызов отклонён.');
        
        // Notify the other party
        const otherUserId = toss.opponentId === msg.from.id ? toss.challengerId : toss.opponentId;
        try {
            await bot.sendMessage(otherUserId,
                `❌ ${mentionUser(user)} отклонил вызов на орёл и решку (${toss.amount} монет)`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Failed to notify other user:', error.message);
        }
    }));
    
    // /обмен or /trade - Create trade
    // Format: /обмен @username мои_предметы:id1,id2 их_предметы:id1,id2 мои_монеты:100 их_монеты:50
    bot.onText(/\/(обмен|trade)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const args = match[2]?.trim();
        
        if (!args) {
            bot.sendMessage(chatId,
                `💱 **Создание обмена**\n\n` +
                `Формат команды:\n` +
                `/обмен @username [параметры]\n\n` +
                `Параметры:\n` +
                `• \`мои_предметы:id1,id2\` - ID ваших предметов для обмена\n` +
                `• \`их_предметы:id1,id2\` - ID запрашиваемых предметов\n` +
                `• \`мои_монеты:100\` - сколько монет вы предлагаете\n` +
                `• \`их_монеты:50\` - сколько монет вы хотите получить\n\n` +
                `Пример:\n` +
                `/обмен @user мои_монеты:500 их_предметы:abc123\n\n` +
                `Используйте /инвентарь чтобы узнать ID своих предметов.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Parse username
        const usernameMatch = args.match(/@(\w+)/);
        if (!usernameMatch) {
            bot.sendMessage(chatId, '❌ Укажите имя пользователя через @');
            return;
        }
        
        const targetUsername = usernameMatch[1];
        const targetUser = storage.getUserByUsername(targetUsername);
        
        if (!targetUser) {
            bot.sendMessage(chatId, '❌ Пользователь не найден или не зарегистрирован');
            return;
        }
        
        if (targetUser.telegramId === msg.from.id) {
            bot.sendMessage(chatId, '❌ Нельзя обмениваться с самим собой!');
            return;
        }
        
        // Parse parameters
        const myItemsMatch = args.match(/мои_предметы:([^\s]+)/);
        const theirItemsMatch = args.match(/их_предметы:([^\s]+)/);
        const myCoinsMatch = args.match(/мои_монеты:(\d+)/);
        const theirCoinsMatch = args.match(/их_монеты:(\d+)/);
        
        const myItemIds = myItemsMatch ? myItemsMatch[1].split(',') : [];
        const theirItemIds = theirItemsMatch ? theirItemsMatch[1].split(',') : [];
        const myCoins = myCoinsMatch ? parseInt(myCoinsMatch[1]) : 0;
        const theirCoins = theirCoinsMatch ? parseInt(theirCoinsMatch[1]) : 0;
        
        // Validate
        if (myItemIds.length === 0 && theirItemIds.length === 0 && myCoins === 0 && theirCoins === 0) {
            bot.sendMessage(chatId, '❌ Укажите хотя бы один параметр обмена');
            return;
        }
        
        // Check if user has enough coins
        if (myCoins > user.coins) {
            bot.sendMessage(chatId, `❌ У вас недостаточно монет! У вас: ${user.coins}`);
            return;
        }
        
        // Find items
        const myItems = [];
        for (const id of myItemIds) {
            const item = user.inventory.find(i => i.instanceId === id);
            if (!item) {
                bot.sendMessage(chatId, `❌ Предмет с ID \`${id}\` не найден в вашем инвентаре`, { parse_mode: 'Markdown' });
                return;
            }
            myItems.push(item);
        }
        
        const theirItems = [];
        for (const id of theirItemIds) {
            const item = targetUser.inventory.find(i => i.instanceId === id);
            if (!item) {
                bot.sendMessage(chatId, `❌ Предмет с ID \`${id}\` не найден у пользователя @${targetUsername}`, { parse_mode: 'Markdown' });
                return;
            }
            theirItems.push(item);
        }
        
        // Create trade
        const trade = await storage.createTrade(
            msg.from.id,
            targetUser.telegramId,
            myItems,
            theirItems,
            myCoins,
            theirCoins
        );
        
        // Build trade summary
        let summary = `💱 **Обмен создан!**\n\n`;
        summary += `🔄 Обмен с @${targetUsername}\n\n`;
        
        if (myItems.length > 0 || myCoins > 0) {
            summary += `📤 Вы предлагаете:\n`;
            myItems.forEach(i => summary += `  • ${i.name}\n`);
            if (myCoins > 0) summary += `  • 💰 ${myCoins} монет\n`;
        }
        
        if (theirItems.length > 0 || theirCoins > 0) {
            summary += `📥 Вы хотите получить:\n`;
            theirItems.forEach(i => summary += `  • ${i.name}\n`);
            if (theirCoins > 0) summary += `  • 💰 ${theirCoins} монет\n`;
        }
        
        summary += `\nID обмена: \`${trade.id}\`\n`;
        summary += `Ожидайте ответа от @${targetUsername}`;
        
        bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
        
        // Notify target user
        try {
            let notification = `💱 **Новое предложение обмена!**\n\n`;
            notification += `От: ${user.firstName} (@${user.username || 'нет username'})\n\n`;
            
            if (myItems.length > 0 || myCoins > 0) {
                notification += `📥 Вам предлагают:\n`;
                myItems.forEach(i => notification += `  • ${i.name}\n`);
                if (myCoins > 0) notification += `  • 💰 ${myCoins} монет\n`;
            }
            
            if (theirItems.length > 0 || theirCoins > 0) {
                notification += `📤 У вас запрашивают:\n`;
                theirItems.forEach(i => notification += `  • ${i.name}\n`);
                if (theirCoins > 0) notification += `  • 💰 ${theirCoins} монет\n`;
            }
            
            notification += `\nИспользуйте /обмены для просмотра и ответа`;
            
            bot.sendMessage(targetUser.telegramId, notification, { parse_mode: 'Markdown' });
        } catch (e) {
            // User might have blocked the bot
        }
    });
    
    // /обмены or /trades - View pending trades
    bot.onText(/\/(обмены|trades)$/, (msg) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const trades = storage.getTradesForUser(msg.from.id);
        
        if (trades.length === 0) {
            bot.sendMessage(chatId, '📭 У вас нет входящих предложений обмена');
            return;
        }
        
        let message = `📬 **Входящие предложения обмена** (${trades.length}):\n\n`;
        
        trades.forEach((trade, index) => {
            const fromUser = storage.getUser(trade.fromUserId);
            message += `**${index + 1}. От ${fromUser?.firstName || 'Неизвестный'}**\n`;
            message += `ID: \`${trade.id}\`\n`;
            
            if (trade.fromItems.length > 0 || trade.fromCoins > 0) {
                message += `📥 Вам предлагают:\n`;
                trade.fromItems.forEach(i => message += `  • ${i.name}\n`);
                if (trade.fromCoins > 0) message += `  • 💰 ${trade.fromCoins} монет\n`;
            }
            
            if (trade.toItems.length > 0 || trade.toCoins > 0) {
                message += `📤 У вас запрашивают:\n`;
                trade.toItems.forEach(i => message += `  • ${i.name}\n`);
                if (trade.toCoins > 0) message += `  • 💰 ${trade.toCoins} монет\n`;
            }
            
            message += `\n`;
        });
        
        message += `\n💡 Команды:\n`;
        message += `• /принять [ID] - принять обмен\n`;
        message += `• /отклонить [ID] - отклонить обмен`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // /принять or /accept - Accept trade
    bot.onText(/\/(принять|accept)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const tradeId = match[2]?.trim();
        if (!tradeId) {
            bot.sendMessage(chatId, '❌ Укажите ID обмена: /принять [ID]');
            return;
        }
        
        const trade = storage.getTradeById(tradeId);
        if (!trade || trade.toUserId !== msg.from.id) {
            bot.sendMessage(chatId, '❌ Обмен не найден или не предназначен для вас');
            return;
        }
        
        if (trade.status !== 'pending') {
            bot.sendMessage(chatId, '❌ Этот обмен уже завершён или отменён');
            return;
        }
        
        const result = await storage.executeTrade(tradeId);
        
        if (result.success) {
            bot.sendMessage(chatId, '✅ Обмен успешно завершён!');
            
            // Notify initiator
            try {
                bot.sendMessage(trade.fromUserId, `✅ Пользователь ${user.firstName} принял ваш обмен!`);
            } catch (e) {}
        } else {
            bot.sendMessage(chatId, `❌ Ошибка: ${result.message}`);
        }
    });
    
    // /отклонить or /decline - Decline trade
    bot.onText(/\/(отклонить|decline)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        if (user.banned) {
            bot.sendMessage(chatId, '🚫 Вы заблокированы и не можете использовать бота.');
            return;
        }
        
        const tradeId = match[2]?.trim();
        if (!tradeId) {
            bot.sendMessage(chatId, '❌ Укажите ID обмена: /отклонить [ID]');
            return;
        }
        
        const trade = storage.getTradeById(tradeId);
        if (!trade || trade.toUserId !== msg.from.id) {
            bot.sendMessage(chatId, '❌ Обмен не найден или не предназначен для вас');
            return;
        }
        
        if (trade.status !== 'pending') {
            bot.sendMessage(chatId, '❌ Этот обмен уже завершён или отменён');
            return;
        }
        
        await storage.cancelTrade(tradeId);
        bot.sendMessage(chatId, '❌ Обмен отклонён');
        
        // Notify initiator
        try {
            bot.sendMessage(trade.fromUserId, `❌ Пользователь ${user.firstName} отклонил ваш обмен`);
        } catch (e) {}
    });
    
    // /помощь - Help
    bot.onText(/\/помощь|\/start|\/help/, (msg) => {
        const chatId = msg.chat.id;
        
        bot.sendMessage(chatId,
            `🎰 **Добро пожаловать в Gambling Bot!**\n\n` +
            `📋 **Основные команды:**\n\n` +
            `👤 **Аккаунт:**\n` +
            `/подключиться - Зарегистрироваться\n` +
            `/баланс - Проверить баланс\n` +
            `/инвентарь - Посмотреть предметы\n\n` +
            `🎁 **Кейсы:**\n` +
            `/кейсы - Список кейсов\n` +
            `/открыть [id] - Открыть кейс\n\n` +
            `� **Продажа:**\n` +
            `/продать [id] - Продать предмет\n` +
            `/продать все - Продать всё\n\n` +
            `�💱 **Обмен:**\n` +
            `/обмен @user [параметры] - Предложить обмен\n` +
            `/обмены - Входящие обмены\n` +
            `/принять [id] - Принять обмен\n` +
            `/отклонить [id] - Отклонить обмен\n\n` +
            `💡 При регистрации вы получаете 1000 монет!`,
            { parse_mode: 'Markdown' }
        );
    });
    
    console.log('🤖 Telegram bot started!');
    return bot;
}
