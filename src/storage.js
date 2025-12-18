import db from './db.js';

// User functions
export function getUser(telegramId) {
    return db.data.users.find(u => u.telegramId === telegramId);
}

export function getUserByUsername(username) {
    return db.data.users.find(u => u.username?.toLowerCase() === username?.toLowerCase());
}

export async function createUser(telegramId, username, firstName) {
    const existingUser = getUser(telegramId);
    if (existingUser) {
        return { success: false, message: 'Вы уже зарегистрированы!' };
    }
    
    const newUser = {
        id: Date.now().toString(),
        telegramId,
        username: username || null,
        firstName: firstName || 'Пользователь',
        coins: 1000,
        inventory: [],
        createdAt: new Date().toISOString()
    };
    
    db.data.users.push(newUser);
    await db.write();
    
    return { success: true, user: newUser };
}

export async function updateUserCoins(telegramId, amount) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    user.coins += amount;
    await db.write();
    return user;
}

export async function setUserCoins(telegramId, amount) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    user.coins = amount;
    await db.write();
    return user;
}

export async function addItemToInventory(telegramId, item) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    user.inventory.push({
        ...item,
        instanceId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
    });
    await db.write();
    return user;
}

export async function removeItemFromInventory(telegramId, instanceId) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    const itemIndex = user.inventory.findIndex(i => i.instanceId === instanceId);
    if (itemIndex === -1) return null;
    
    const removed = user.inventory.splice(itemIndex, 1)[0];
    await db.write();
    return removed;
}

export function getAllUsers() {
    return db.data.users;
}

export async function updateUser(telegramId, updates) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    Object.assign(user, updates);
    await db.write();
    return user;
}

// Case functions
export function getAllCases() {
    return db.data.cases;
}

export function getCase(caseId) {
    return db.data.cases.find(c => c.id === caseId);
}

export async function createCase(caseData) {
    const newCase = {
        id: caseData.id || Date.now().toString(),
        name: caseData.name,
        price: caseData.price,
        items: caseData.items || []
    };
    
    db.data.cases.push(newCase);
    await db.write();
    return newCase;
}

export async function updateCase(caseId, updates) {
    const caseItem = getCase(caseId);
    if (!caseItem) return null;
    
    Object.assign(caseItem, updates);
    await db.write();
    return caseItem;
}

export async function deleteCase(caseId) {
    const index = db.data.cases.findIndex(c => c.id === caseId);
    if (index === -1) return false;
    
    db.data.cases.splice(index, 1);
    await db.write();
    return true;
}

export function rollCase(caseId) {
    const caseItem = getCase(caseId);
    if (!caseItem || caseItem.items.length === 0) return null;
    
    const random = Math.random() * 100;
    let cumulative = 0;
    
    for (const item of caseItem.items) {
        cumulative += item.chance;
        if (random <= cumulative) {
            return item;
        }
    }
    
    // Fallback to last item
    return caseItem.items[caseItem.items.length - 1];
}

// Trade functions
export function getAllTrades() {
    return db.data.trades;
}

export function getTradesForUser(telegramId) {
    return db.data.trades.filter(t => t.toUserId === telegramId && t.status === 'pending');
}

export function getTradeById(tradeId) {
    return db.data.trades.find(t => t.id === tradeId);
}

export async function createTrade(fromUserId, toUserId, fromItems, toItems, fromCoins, toCoins) {
    const trade = {
        id: Date.now().toString(),
        fromUserId,
        toUserId,
        fromItems, // items offered by initiator
        toItems,   // items requested from target
        fromCoins, // coins offered by initiator
        toCoins,   // coins requested from target
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    db.data.trades.push(trade);
    await db.write();
    return trade;
}

export async function updateTradeStatus(tradeId, status) {
    const trade = getTradeById(tradeId);
    if (!trade) return null;
    
    trade.status = status;
    await db.write();
    return trade;
}

export async function executeTrade(tradeId) {
    const trade = getTradeById(tradeId);
    if (!trade || trade.status !== 'pending') return { success: false, message: 'Обмен не найден или уже завершён' };
    
    const fromUser = getUser(trade.fromUserId);
    const toUser = getUser(trade.toUserId);
    
    if (!fromUser || !toUser) {
        return { success: false, message: 'Пользователь не найден' };
    }
    
    // Check if initiator has enough coins
    if (trade.fromCoins > 0 && fromUser.coins < trade.fromCoins) {
        return { success: false, message: 'У инициатора недостаточно монет' };
    }
    
    // Check if target has enough coins
    if (trade.toCoins > 0 && toUser.coins < trade.toCoins) {
        return { success: false, message: 'У вас недостаточно монет' };
    }
    
    // Check if initiator has all offered items
    for (const item of trade.fromItems) {
        const hasItem = fromUser.inventory.some(i => i.instanceId === item.instanceId);
        if (!hasItem) {
            return { success: false, message: 'У инициатора нет предложенных предметов' };
        }
    }
    
    // Check if target has all requested items
    for (const item of trade.toItems) {
        const hasItem = toUser.inventory.some(i => i.instanceId === item.instanceId);
        if (!hasItem) {
            return { success: false, message: 'У вас нет запрошенных предметов' };
        }
    }
    
    // Execute trade
    // Transfer coins
    fromUser.coins -= trade.fromCoins;
    fromUser.coins += trade.toCoins;
    toUser.coins -= trade.toCoins;
    toUser.coins += trade.fromCoins;
    
    // Transfer items from initiator to target
    for (const item of trade.fromItems) {
        const idx = fromUser.inventory.findIndex(i => i.instanceId === item.instanceId);
        if (idx !== -1) {
            const [removed] = fromUser.inventory.splice(idx, 1);
            toUser.inventory.push(removed);
        }
    }
    
    // Transfer items from target to initiator
    for (const item of trade.toItems) {
        const idx = toUser.inventory.findIndex(i => i.instanceId === item.instanceId);
        if (idx !== -1) {
            const [removed] = toUser.inventory.splice(idx, 1);
            fromUser.inventory.push(removed);
        }
    }
    
    trade.status = 'completed';
    await db.write();
    
    return { success: true, trade };
}

export async function cancelTrade(tradeId) {
    const trade = getTradeById(tradeId);
    if (!trade) return false;
    
    trade.status = 'cancelled';
    await db.write();
    return true;
}
