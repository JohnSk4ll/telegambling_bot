import TelegramBot from 'node-telegram-bot-api';
import * as storage from './storage.js';

export function setupBot(token) {
    const bot = new TelegramBot(token, { polling: true });
    
    // Set bot commands (must use Latin characters only)
    bot.setMyCommands([
        { command: 'connect', description: 'Зарегистрироваться в боте (/подключиться)' },
        { command: 'balance', description: 'Проверить баланс (/баланс)' },
        { command: 'cases', description: 'Список кейсов (/кейсы)' },
        { command: 'open', description: 'Открыть кейс (/открыть [id])' },
        { command: 'inventory', description: 'Инвентарь (/инвентарь)' },
        { command: 'sell', description: 'Продать предмет (/продать [id])' },
        { command: 'trade', description: 'Обмен (/обмен)' },
        { command: 'trades', description: 'Входящие обмены (/обмены)' },
        { command: 'help', description: 'Справка (/помощь)' }
    ]);
    
    // /подключиться or /connect - Register
    bot.onText(/\/(подключиться|connect)/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const username = msg.from.username;
        const firstName = msg.from.first_name;
        
        const result = await storage.createUser(telegramId, username, firstName);
        
        if (result.success) {
            bot.sendMessage(chatId, 
                `🎰 Добро пожаловать, ${firstName}!\n\n` +
                `Вы успешно зарегистрировались!\n` +
                `💰 Ваш начальный баланс: 1000 монет\n\n` +
                `Используйте /помощь для просмотра команд.`
            );
        } else {
            bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    });
    
    // /баланс or /balance - Check balance
    bot.onText(/\/(баланс|balance)/, (msg) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
            return;
        }
        
        bot.sendMessage(chatId,
            `💰 Ваш баланс: ${user.coins} монет\n` +
            `📦 Предметов в инвентаре: ${user.inventory.length}`
        );
    });
    
    // /кейсы or /cases - List cases
    bot.onText(/\/(кейсы|cases)/, (msg) => {
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
        message += `Для открытия используйте: /открыть [id]`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
    
    // /открыть or /open - Open case
    bot.onText(/\/(открыть|open)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
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
        
        const messageText = `🎰 Вы открыли **${caseItem.name}**!\n\n` +
            `${rarityEmojis[wonItem.rarity] || '🎁'} Вы выиграли: **${wonItem.name}**\n` +
            `📊 Редкость: ${rarityNames[wonItem.rarity] || wonItem.rarity}\n` +
            `💎 Стоимость: ${wonItem.value} монет\n\n` +
            `💰 Ваш баланс: ${user.coins - caseItem.price} монет`;
        
        // Send with image if available
        if (wonItem.image) {
            bot.sendPhoto(chatId, wonItem.image.startsWith('http') ? wonItem.image : `${process.env.BOT_URL || 'http://localhost:5051'}${wonItem.image}`, {
                caption: messageText,
                parse_mode: 'Markdown'
            }).catch(() => {
                // Fallback to text if image fails
                bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });
            });
        } else {
            bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown' });
        }
    });
    
    // /инвентарь or /inventory - View inventory
    bot.onText(/\/(инвентарь|inventory)/, (msg) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
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
                    message += `  • ${item.name} (${item.value} монет)\n`;
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
    
    // /обмен or /trade - Create trade
    // Format: /обмен @username мои_предметы:id1,id2 их_предметы:id1,id2 мои_монеты:100 их_монеты:50
    bot.onText(/\/(обмен|trade)(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const user = storage.getUser(msg.from.id);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы! Используйте /подключиться');
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
