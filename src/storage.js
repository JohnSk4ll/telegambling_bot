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
        banned: false,
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

    // Если у предмета есть variation, сохраняем её отдельно
    const itemToAdd = { ...item };
    if (item.variation) {
        itemToAdd.variation = { ...item.variation };
    }
    itemToAdd.instanceId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    user.inventory.push(itemToAdd);
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

export async function setAllUsers(usersArr) {
    db.data.users = usersArr || [];
    await db.write();
    return db.data.users;
}

export async function updateUser(telegramId, updates) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    Object.assign(user, updates);
    await db.write();
    return user;
}

export async function banUser(telegramId) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    user.banned = true;
    await db.write();
    return user;
}

export async function unbanUser(telegramId) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    user.banned = false;
    await db.write();
    return user;
}

// Case functions
export function getAllCases() {
    return db.data.cases;
}


export async function getAllPromos() {
    return db.data.promos || [];
}

export async function createPromo(promo) {
    // Ensure promos array exists
    if (!Array.isArray(db.data.promos)) db.data.promos = [];
    const code = promo.code;
    const existing = db.data.promos.find(p => p.code === code);
    if (existing) throw new Error('Promo code already exists');
    const newPromo = {
        id: code.toLowerCase(),
        code: code,
        amount: Number(promo.amount) || 0,
        maxUses: Number(promo.maxUses) || 1,
        uses: 0,
        usedBy: [],
        createdAt: new Date().toISOString(),
        active: true
    };
    db.data.promos.push(newPromo);
    await db.write();
    return newPromo;
}

export async function updatePromo(id, changes) {
    const promo = (db.data.promos || []).find(p => p.id === id);
    if (!promo) throw new Error('Promo not found');
    Object.assign(promo, changes);
    await db.write();
    return promo;
}

export async function deletePromo(id) {
    db.data.promos = (db.data.promos || []).filter(p => p.id !== id);
    await db.write();
    return true;
}

export async function redeemPromo(telegramId, code) {
    if (!Array.isArray(db.data.promos)) db.data.promos = [];
    const promo = db.data.promos.find(p => p.code.toLowerCase() === String(code).toLowerCase());
    if (!promo) return { success: false, message: 'Промокод не найден' };
    if (!promo.active) return { success: false, message: 'Промокод неактивен' };
    if (!Array.isArray(promo.usedBy)) promo.usedBy = [];
    if (promo.usedBy.includes(telegramId)) return { success: false, message: 'Вы уже использовали этот промокод' };
    if (promo.uses >= promo.maxUses) return { success: false, message: 'Промокод исчерпан' };
    // apply
    await updateUserCoins(telegramId, promo.amount);
    promo.usedBy.push(telegramId);
    promo.uses = (promo.uses || 0) + 1;
    await db.write();
    return { success: true, amount: promo.amount };
}

export async function giveDailyCoinsToAll(amount = 1000) {
    const users = db.data.users || [];
    for (const u of users) {
        await updateUserCoins(u.telegramId, amount);
    }
    if (!db.data.meta) db.data.meta = {};
    db.data.meta.lastDailyRewardDate = new Date().toISOString();
    await db.write();
    return { count: users.length };
}

export async function getLastDailyRewardDate() {
    return db.data.meta?.lastDailyRewardDate || null;
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

    // Выбираем предмет по шансам
    const random = Math.random() * 100;
    let cumulative = 0;
    let selectedItem = null;
    for (const item of caseItem.items) {
        cumulative += item.chance;
        if (random <= cumulative && !selectedItem) {
            selectedItem = item;
        }
    }
    if (!selectedItem) selectedItem = caseItem.items[caseItem.items.length - 1];

    // Если у предмета есть вариации, выбираем вариацию по шансам
    if (selectedItem.variations && Array.isArray(selectedItem.variations) && selectedItem.variations.length > 0) {
        const varRand = Math.random() * 100;
        let varCumulative = 0;
        let selectedVar = null;
        for (const v of selectedItem.variations) {
            varCumulative += Number(v.chance) || 0;
            if (varRand < varCumulative && !selectedVar) {
                selectedVar = v;
                break;
            }
        }
        if (!selectedVar) selectedVar = selectedItem.variations[selectedItem.variations.length - 1];
        // Возвращаем предмет с вариацией (имя, цена, картинка берутся из вариации)
        return {
            ...selectedItem,
            name: `${selectedItem.name} (${selectedVar.name})`,
            value: Number(selectedVar.price) || selectedItem.value,
            image: selectedVar.image || selectedItem.image,
            variation: {
                name: selectedVar.name,
                price: selectedVar.price,
                image: selectedVar.image,
                chance: selectedVar.chance
            }
        };
    }
    // Если вариаций нет, возвращаем обычный предмет
    return selectedItem;
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

// Overwrite all cases (replacement import)
export async function setAllCases(casesArr) {
    db.data.cases = casesArr || [];
    await db.write();
    return db.data.cases;
}

// Merge/upsert cases: update existing by id or add new ones
export async function upsertCases(casesArr) {
    for (const c of casesArr) {
        const existing = getCase(c.id);
        if (existing) {
            Object.assign(existing, c);
        } else {
            db.data.cases.push(c);
        }
    }
    await db.write();
    return db.data.cases;
}
