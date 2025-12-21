import db, { debouncedWrite, forceWrite } from './db.js';

// Cache for frequently accessed data
const userCache = new Map();
const CACHE_TTL = 5000; // 5 seconds

// Helper to get cached user
function getCachedUser(telegramId) {
    const cached = userCache.get(telegramId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.user;
    }
    return null;
}

// Helper to update cache
function updateUserCache(telegramId, user) {
    userCache.set(telegramId, {
        user,
        timestamp: Date.now()
    });
}

// Helper to invalidate cache
function invalidateUserCache(telegramId) {
    userCache.delete(telegramId);
}

// User functions
export function getUser(telegramId) {
    const cached = getCachedUser(telegramId);
    if (cached) return cached;
    
    const user = db.data.users.find(u => u.telegramId === telegramId);
    if (user) {
        updateUserCache(telegramId, user);
    }
    return user;
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
        lastDaily: null,
        xp: 0,
        level: 1,
        earnedMilestones: 0, // Track how many times user earned 10000 coins
        maxCaseOpenings: 1, // Maximum cases that can be opened at once
        createdAt: new Date().toISOString()
    };
    
    db.data.users.push(newUser);
    updateUserCache(telegramId, newUser);
    await debouncedWrite();
    
    return { success: true, user: newUser };
}

export async function updateUserCoins(telegramId, amount) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    const newBalance = user.coins + amount;
    // Предотвращаем отрицательный баланс
    if (newBalance < 0) {
        return null;
    }
    
    user.coins = newBalance;
    updateUserCache(telegramId, user);
    await debouncedWrite();
    return user;
}

export async function setUserCoins(telegramId, amount) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    // Предотвращаем отрицательный баланс
    if (amount < 0) {
        return null;
    }
    
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
    invalidateUserCache(telegramId);
    await debouncedWrite();
    return user;
}

export async function removeItemFromInventory(telegramId, instanceId) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    const itemIndex = user.inventory.findIndex(i => i.instanceId === instanceId);
    if (itemIndex === -1) return null;
    
    const removed = user.inventory.splice(itemIndex, 1)[0];
    invalidateUserCache(telegramId);
    await debouncedWrite();
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

export async function resetUser(telegramId) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    // Reset to default values
    user.coins = 1000;
    user.inventory = [];
    user.banned = false;
    await db.write();
    return user;
}

export function claimDaily(telegramId) {
    const user = getUser(telegramId);
    if (!user) return { success: false, message: 'Пользователь не найден' };
    
    const now = new Date();
    const DAILY_AMOUNT = 1000;
    const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in ms
    
    // Check if lastDaily exists and if cooldown has passed
    if (user.lastDaily) {
        const lastDaily = new Date(user.lastDaily);
        const timePassed = now - lastDaily;
        
        if (timePassed < DAILY_COOLDOWN) {
            const timeLeft = DAILY_COOLDOWN - timePassed;
            const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
            const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
            
            return {
                success: false,
                message: `Вы уже получили ежедневный бонус!`,
                timeLeft,
                hoursLeft,
                minutesLeft
            };
        }
    }
    
    // Claim daily bonus
    user.coins += DAILY_AMOUNT;
    user.lastDaily = now.toISOString();
    db.write();
    
    return {
        success: true,
        amount: DAILY_AMOUNT,
        newBalance: user.coins
    };
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
    const caseItem = db.data.cases.find(c => c.id === caseId);
    // Ensure xpReward exists for backwards compatibility
    if (caseItem && caseItem.xpReward === undefined) {
        caseItem.xpReward = 10;
    }
    return caseItem;
}

export async function createCase(caseData) {
    const newCase = {
        id: caseData.id || Date.now().toString(),
        name: caseData.name,
        price: caseData.price,
        xpReward: caseData.xpReward !== undefined ? caseData.xpReward : 10,
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

    // Если у предмета есть вариации, сначала проверяем шанс получить вариацию (как StatTrak в CS:GO ~10%)
    if (selectedItem.variations && Array.isArray(selectedItem.variations) && selectedItem.variations.length > 0) {
        const variationRoll = Math.random() * 100;
        const VARIATION_CHANCE = 10; // 10% шанс получить вариацию (как StatTrak)
        
        // Только если выпала вариация, выбираем конкретную
        if (variationRoll <= VARIATION_CHANCE) {
            const varRand = Math.random() * 100;
            let varCumulative = 0;
            let selectedVar = null;
            for (const v of selectedItem.variations) {
                varCumulative += Number(v.chance) || 0;
                if (varRand <= varCumulative && !selectedVar) {
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
    }
    // Если вариаций нет или не выпала вариация, возвращаем обычный предмет
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

// Coin Toss functions
export function getAllCoinTosses() {
    if (!Array.isArray(db.data.coinTosses)) db.data.coinTosses = [];
    return db.data.coinTosses;
}

export function getCoinTossesForUser(telegramId) {
    if (!Array.isArray(db.data.coinTosses)) db.data.coinTosses = [];
    return db.data.coinTosses.filter(ct => ct.opponentId === telegramId && ct.status === 'pending');
}

export function getCoinTossById(coinTossId) {
    if (!Array.isArray(db.data.coinTosses)) db.data.coinTosses = [];
    return db.data.coinTosses.find(ct => ct.id === coinTossId);
}

export async function createCoinToss(challengerId, opponentId, amount) {
    if (!Array.isArray(db.data.coinTosses)) db.data.coinTosses = [];
    
    const coinToss = {
        id: Date.now().toString(),
        challengerId,
        opponentId,
        amount,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    db.data.coinTosses.push(coinToss);
    await db.write();
    return coinToss;
}

export async function executeCoinToss(coinTossId) {
    const coinToss = getCoinTossById(coinTossId);
    if (!coinToss || coinToss.status !== 'pending') {
        return { success: false, error: 'Игра не найдена или уже завершена' };
    }

    const challenger = getUser(coinToss.challengerId);
    const challenged = getUser(coinToss.opponentId);
    
    if (!challenger || !challenged) {
        return { success: false, error: 'Один из игроков не найден' };
    }

    if (challenger.coins < coinToss.amount || challenged.coins < coinToss.amount) {
        return { success: false, error: 'У одного из игроков недостаточно монет' };
    }
    
    // Подбрасываем монетку (50/50)
    const winnerIsChallenger = Math.random() < 0.5;
    const winner = winnerIsChallenger ? challenger : challenged;
    const loser = winnerIsChallenger ? challenged : challenger;
    
    // Списываем ставки и отдаём выигрыш
    challenger.coins -= coinToss.amount;
    challenged.coins -= coinToss.amount;
    winner.coins += coinToss.amount * 2;
    
    coinToss.status = 'completed';
    coinToss.winnerId = winner.telegramId;
    coinToss.completedAt = new Date().toISOString();
    
    await db.write();
    
    return { 
        success: true, 
        coinToss, 
        winnerId: winner.telegramId,
        loserId: loser.telegramId,
        winner,
        loser,
        winnerIsChallenger,
        isHeads: winnerIsChallenger
    };
}

export async function cancelCoinToss(coinTossId) {
    const coinToss = getCoinTossById(coinTossId);
    if (!coinToss) return false;
    
    coinToss.status = 'cancelled';
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

// Level and XP functions
export function getSettings() {
    if (!db.data.settings) {
        db.data.settings = { levelRewards: [] };
    }
    if (!db.data.settings.levelRewards) {
        db.data.settings.levelRewards = [];
    }
    return db.data.settings;
}

export async function updateSettings(updates) {
    if (!db.data.settings) {
        db.data.settings = { levelRewards: [] };
    }
    Object.assign(db.data.settings, updates);
    await db.write();
    return db.data.settings;
}

export async function addLevelReward(reward) {
    const settings = getSettings();
    if (!settings.levelRewards) settings.levelRewards = [];
    
    // Check if reward for this level already exists
    const existingIndex = settings.levelRewards.findIndex(r => r.level === reward.level);
    if (existingIndex >= 0) {
        settings.levelRewards[existingIndex] = reward;
    } else {
        settings.levelRewards.push(reward);
    }
    
    await db.write();
    return settings;
}

export async function removeLevelReward(level) {
    const settings = getSettings();
    if (!settings.levelRewards) return settings;
    
    settings.levelRewards = settings.levelRewards.filter(r => r.level !== level);
    await db.write();
    return settings;
}

export function getLevelReward(level) {
    const settings = getSettings();
    if (!settings.levelRewards) return null;
    return settings.levelRewards.find(r => r.level === level);
}

export async function addXP(telegramId, amount) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    // Ensure user has XP and level fields
    if (typeof user.xp !== 'number') user.xp = 0;
    if (typeof user.level !== 'number') user.level = 1;
    if (typeof user.maxCaseOpenings !== 'number') user.maxCaseOpenings = 1;
    
    user.xp += amount;
    
    // Check for level up (100 XP per level)
    const XP_PER_LEVEL = 100;
    const levelsGained = [];
    const rewards = [];
    
    while (user.xp >= XP_PER_LEVEL) {
        user.xp -= XP_PER_LEVEL;
        user.level += 1;
        levelsGained.push(user.level);
        
        // Check if there's a reward for this level
        const reward = getLevelReward(user.level);
        if (reward) {
            rewards.push({ level: user.level, reward });
            
            // Apply maxCaseOpenings increase if specified
            if (reward.maxCaseOpenings) {
                user.maxCaseOpenings = Math.max(user.maxCaseOpenings, reward.maxCaseOpenings);
            }
        }
    }
    
    invalidateUserCache(telegramId);
    await debouncedWrite();
    
    return { user, levelsGained, rewards };
}

export async function trackEarningMilestone(telegramId, coinsEarned) {
    const user = getUser(telegramId);
    if (!user) return null;
    
    // Ensure earnedMilestones exists
    if (typeof user.earnedMilestones !== 'number') user.earnedMilestones = 0;
    
    const MILESTONE = 10000;
    if (coinsEarned >= MILESTONE) {
        const milestonesEarned = Math.floor(coinsEarned / MILESTONE);
        
        for (let i = 0; i < milestonesEarned; i++) {
            const currentMilestone = user.earnedMilestones;
            
            // First 5 milestones give 20 XP, after that 5 XP
            const xpToGive = currentMilestone < 5 ? 20 : 5;
            
            user.earnedMilestones += 1;
            await addXP(telegramId, xpToGive);
        }
    }
    
    return user;
}
