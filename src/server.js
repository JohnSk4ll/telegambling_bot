import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
// (no import needed for fetch in Node.js v18+)
import * as storage from './storage.js';
import xml2js from 'xml2js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(__dirname, 'public', 'uploads');

// Ensure uploads directory exists
if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
}

export function setupServer(port = 5051) {
    const app = express();
    // Импорт пользователей из XML
    app.post('/api/users/import', express.text({ type: 'application/xml' }), async (req, res) => {
        try {
            const xml = req.body;
            if (!xml || typeof xml !== 'string') return res.status(400).json({ error: 'No XML provided' });
            const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
            let users = parsed.users && parsed.users.user ? parsed.users.user : [];
            if (!Array.isArray(users)) users = [users];
            // Преобразуем пользователей
            const cleanUsers = users.map(u => ({
                id: u.id || u.telegramId || String(Date.now()),
                telegramId: Number(u.telegramId) || 0,
                username: u.username || '',
                firstName: u.firstName || '',
                coins: Number(u.coins) || 0,
                xp: Number(u.xp) || 0,
                level: Number(u.level) || 1,
                earnedMilestones: Number(u.earnedMilestones) || 0,
                inventory: (u.inventory && u.inventory.item ? (Array.isArray(u.inventory.item) ? u.inventory.item : [u.inventory.item]) : []).map(it => ({
                    name: it.name || '',
                    value: Number(it.value) || 0,
                    rarity: it.rarity || '',
                    instanceId: it.instanceId || '',
                    image: it.image || ''
                }))
            }));
            await storage.setAllUsers(cleanUsers);
            res.json({ success: true });
        } catch (err) {
            console.error('User import error:', err);
            res.status(400).json({ error: 'Invalid XML or import error: ' + err.message });
        }
    });

    // Импорт кейсов из XML
    app.post('/api/cases/import-xml', express.text({ type: 'application/xml' }), async (req, res) => {
        try {
            const xml = req.body;
            if (!xml || typeof xml !== 'string') return res.status(400).json({ error: 'No XML provided' });
            const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
            let casesData = parsed.cases && parsed.cases.case ? parsed.cases.case : [];
            if (!Array.isArray(casesData)) casesData = [casesData];
            
            // Преобразуем кейсы
            const cleanCases = casesData.map(c => {
                let items = c.item ? (Array.isArray(c.item) ? c.item : [c.item]) : [];
                return {
                    id: c.id,
                    name: c.name,
                    price: Number(c.price) || 0,
                    xpReward: c.xpReward !== undefined ? Number(c.xpReward) : 10,
                    items: items.map(it => {
                        const item = {
                            id: it.id,
                            name: it.name,
                            chance: Number(it.chance) || 0,
                            value: Number(it.value) || 0,
                            rarity: it.rarity,
                            image: it.image || ''
                        };
                        // Обрабатываем вариации если есть
                        if (it.variation) {
                            let variations = Array.isArray(it.variation) ? it.variation : [it.variation];
                            item.variations = variations.map(v => ({
                                name: v.name,
                                chance: Number(v.chance) || 0,
                                price: Number(v.price) || 0
                            }));
                        }
                        return item;
                    })
                };
            });
            
            // Валидация шансов
            for (const c of cleanCases) {
                const total = c.items.reduce((s, it) => s + (parseFloat(it.chance) || 0), 0);
                if (Math.abs(total - 100) > 0.1) {
                    return res.status(400).json({ 
                        error: `Case ${c.id || c.name} chances do not sum to 100% (current ${total}%)` 
                    });
                }
            }
            
            await storage.setAllCases(cleanCases);
            res.json({ success: true, imported: cleanCases.length });
        } catch (err) {
            console.error('Cases XML import error:', err);
            res.status(400).json({ error: 'Invalid XML or import error: ' + err.message });
        }
    });
    
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(join(__dirname, 'public')));
    
    // ============ USER ENDPOINTS ============
    
    // Get all users
    app.get('/api/users', (req, res) => {
        const users = storage.getAllUsers();
        res.json(users);
    });
    
    // Get single user
    app.get('/api/users/:telegramId', (req, res) => {
        const user = storage.getUser(parseInt(req.params.telegramId));
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
    
    // Update user coins
    app.patch('/api/users/:telegramId/coins', async (req, res) => {
        const { coins } = req.body;
        if (typeof coins !== 'number') {
            return res.status(400).json({ error: 'Coins must be a number' });
        }
        
        const user = await storage.setUserCoins(parseInt(req.params.telegramId), coins);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
    
    // Update user inventory
    app.patch('/api/users/:telegramId/inventory', async (req, res) => {
        const { inventory } = req.body;
        if (!Array.isArray(inventory)) {
            return res.status(400).json({ error: 'Inventory must be an array' });
        }
        
        const user = await storage.updateUser(parseInt(req.params.telegramId), { inventory });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
    
    // Update user level and xp
    app.patch('/api/users/:telegramId/level', async (req, res) => {
        const { level, xp } = req.body;
        if (typeof level !== 'number' || typeof xp !== 'number') {
            return res.status(400).json({ error: 'Level and XP must be numbers' });
        }
        
        const user = await storage.updateUser(parseInt(req.params.telegramId), { level, xp });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });

    // Ban user
    app.post('/api/users/:telegramId/ban', async (req, res) => {
        const user = await storage.banUser(parseInt(req.params.telegramId));
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });

    // Unban user
    app.post('/api/users/:telegramId/unban', async (req, res) => {
        const user = await storage.unbanUser(parseInt(req.params.telegramId));
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });

    // Reset user to default values
    app.post('/api/users/:telegramId/reset', async (req, res) => {
        const user = await storage.resetUser(parseInt(req.params.telegramId));
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
    
    // Add item to user inventory
    app.post('/api/users/:telegramId/inventory', async (req, res) => {
        const item = req.body;
        if (!item.name || !item.rarity || !item.value) {
            return res.status(400).json({ error: 'Item must have name, rarity, and value' });
        }
        
        const user = await storage.addItemToInventory(parseInt(req.params.telegramId), item);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
    
    // Remove item from user inventory
    app.delete('/api/users/:telegramId/inventory/:instanceId', async (req, res) => {
        const removed = await storage.removeItemFromInventory(
            parseInt(req.params.telegramId),
            req.params.instanceId
        );
        if (!removed) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ success: true, removed });
    });
    
    // ============ SETTINGS ENDPOINTS ============
    
    // Get settings
    app.get('/api/settings', (req, res) => {
        const settings = storage.getSettings();
        res.json(settings);
    });
    
    // Update settings
    app.patch('/api/settings', async (req, res) => {
        try {
            const settings = await storage.updateSettings(req.body);
            res.json(settings);
        } catch (err) {
            res.status(500).json({ error: 'Failed to update settings' });
        }
    });
    
    // Add level reward
    app.post('/api/settings/level-rewards', async (req, res) => {
        try {
            const settings = await storage.addLevelReward(req.body);
            res.json(settings);
        } catch (err) {
            res.status(500).json({ error: 'Failed to add level reward' });
        }
    });
    
    // Remove level reward
    app.delete('/api/settings/level-rewards/:level', async (req, res) => {
        try {
            const settings = await storage.removeLevelReward(parseInt(req.params.level));
            res.json(settings);
        } catch (err) {
            res.status(500).json({ error: 'Failed to remove level reward' });
        }
    });
    
    // ============ CASE ENDPOINTS ============
    
    // Get all cases
    app.get('/api/cases', (req, res) => {
        const cases = storage.getAllCases();
        res.json(cases);
    });
    
    // Get single case
    app.get('/api/cases/:id', (req, res) => {
        const caseItem = storage.getCase(req.params.id);
        if (!caseItem) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json(caseItem);
    });
    
    // Create new case
    app.post('/api/cases', async (req, res) => {
        const { id, name, price, items, xpReward } = req.body;
        
        if (!name || typeof price !== 'number') {
            return res.status(400).json({ error: 'Name and price are required' });
        }
        
        // Validate items if provided
        if (items && items.length > 0) {
            const totalChance = items.reduce((sum, item) => sum + (item.chance || 0), 0);
            if (Math.abs(totalChance - 100) > 0.01) {
                return res.status(400).json({ 
                    error: `Item chances must add up to 100%. Current total: ${totalChance}%` 
                });
            }
        }
        
        // Check if case with same ID exists
        if (id && storage.getCase(id)) {
            return res.status(400).json({ error: 'Case with this ID already exists' });
        }
        
        const newCase = await storage.createCase({ 
            id, 
            name, 
            price, 
            items: items || [],
            xpReward: xpReward !== undefined ? xpReward : 10
        });
        res.status(201).json(newCase);
    });
    
    // Update case
    app.put('/api/cases/:id', async (req, res) => {
        const { name, price, items, xpReward } = req.body;
        
        // Validate items if provided
        if (items && items.length > 0) {
            const totalChance = items.reduce((sum, item) => sum + (item.chance || 0), 0);
            if (Math.abs(totalChance - 100) > 0.01) {
                return res.status(400).json({ 
                    error: `Item chances must add up to 100%. Current total: ${totalChance.toFixed(2)}%` 
                });
            }
        }
        
        const updateData = { name, price, items };
        if (xpReward !== undefined) {
            updateData.xpReward = xpReward;
        }
        
        const updated = await storage.updateCase(req.params.id, updateData);
        if (!updated) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json(updated);
    });
    
    // Delete case
    app.delete('/api/cases/:id', async (req, res) => {
        const deleted = await storage.deleteCase(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Case not found' });
        }
        res.json({ success: true });
    });
    
    // ============ TRADE ENDPOINTS ============
    
    // Get all trades
    app.get('/api/trades', (req, res) => {
        const trades = storage.getAllTrades();
        res.json(trades);
    });
    
    // ============ UTILITY ENDPOINTS ============
    
    // Generate balanced case items
    app.post('/api/cases/generate-items', (req, res) => {
        const { blueItems, purpleItems, pinkItems, redItems, goldItems, contrabandItems } = req.body;
        
        // Default rarity distribution (CS2 standard)
        const rarityChances = {
            blue: 80.07,     // 80.07% total for blue (Mil-Spec)
            purple: 15.98,   // 15.98% total for purple (Restricted)
            pink: 3.20,      // 3.20% total for pink (Classified)
            red: 0.64,       // 0.64% total for red (Covert)
            gold: 0.1,       // 0.1% total for gold (Special Items)
            contraband: 0.01 // 0.01% total for contraband
        };
        
        const items = [];
        
        // Generate blue items
        const blueCount = blueItems?.length || 5;
        const blueChanceEach = rarityChances.blue / blueCount;
        (blueItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `blue_${i + 1}`,
                name: item.name || `🔵 Синий предмет ${i + 1}`,
                rarity: 'blue',
                chance: blueChanceEach,
                value: item.value || 50 + i * 10
            });
        });
        
        // Generate purple items
        const purpleCount = purpleItems?.length || 3;
        const purpleChanceEach = rarityChances.purple / purpleCount;
        (purpleItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `purple_${i + 1}`,
                name: item.name || `🟣 Фиолетовый предмет ${i + 1}`,
                rarity: 'purple',
                chance: purpleChanceEach,
                value: item.value || 150 + i * 25
            });
        });
        
        // Generate pink items
        const pinkCount = pinkItems?.length || 3;
        const pinkChanceEach = rarityChances.pink / pinkCount;
        (pinkItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `pink_${i + 1}`,
                name: item.name || `🩷 Розовый предмет ${i + 1}`,
                rarity: 'pink',
                chance: pinkChanceEach,
                value: item.value || 300 + i * 50
            });
        });
        
        // Generate red items
        const redCount = redItems?.length || 2;
        const redChanceEach = rarityChances.red / redCount;
        (redItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `red_${i + 1}`,
                name: item.name || `🔴 Красный предмет ${i + 1}`,
                rarity: 'red',
                chance: redChanceEach,
                value: item.value || 600 + i * 150
            });
        });
        
        // Generate gold items
        const goldCount = goldItems?.length || 2;
        const goldChanceEach = rarityChances.gold / goldCount;
        (goldItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `gold_${i + 1}`,
                name: item.name || `🌟 Золотой предмет ${i + 1}`,
                rarity: 'gold',
                chance: goldChanceEach,
                value: item.value || 2000 + i * 1000
            });
        });
        
        // Generate contraband items
        const contrabandCount = contrabandItems?.length || 1;
        const contrabandChanceEach = rarityChances.contraband / contrabandCount;
        (contrabandItems || []).forEach((item, i) => {
            items.push({
                id: item.id || `contraband_${i + 1}`,
                name: item.name || `❗ Контрабанда ${i + 1}`,
                rarity: 'contraband',
                chance: contrabandChanceEach,
                value: item.value || 10000 + i * 5000
            });
        });
        
        res.json({ items, totalChance: items.reduce((sum, i) => sum + i.chance, 0) });
    });

    // Export cases as JSON/text
    app.get('/api/cases/export', (req, res) => {
        // Экспортируем только валидные кейсы и предметы, поддерживаем image, формат XML
        let cases = storage.getAllCases();
        if (!Array.isArray(cases)) cases = [];
        const filtered = cases.filter(c => c && c.id && c.name && Array.isArray(c.items));
        function escapeXml(str) {
            return String(str).replace(/[<>&"']/g, function (c) {
                return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;','\'':'&apos;'}[c];
            });
        }
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<cases>\n';
        for (const c of filtered) {
            xml += `  <case id="${escapeXml(c.id)}" name="${escapeXml(c.name)}" price="${c.price}">\n`;
            for (const it of (c.items || []).filter(it => it && it.id && it.name && it.rarity)) {
                const hasVariations = it.variations && Array.isArray(it.variations) && it.variations.length > 0;
                if (hasVariations) {
                    xml += `    <item id="${escapeXml(it.id)}" name="${escapeXml(it.name)}" chance="${it.chance}" value="${it.value}" rarity="${escapeXml(it.rarity)}"`;
                    if (it.image) xml += ` image="${escapeXml(it.image)}"`;
                    xml += '>\n';
                    for (const v of it.variations) {
                        xml += `      <variation name="${escapeXml(v.name)}" chance="${v.chance}" price="${v.price}" />\n`;
                    }
                    xml += '    </item>\n';
                } else {
                    xml += `    <item id="${escapeXml(it.id)}" name="${escapeXml(it.name)}" chance="${it.chance}" value="${it.value}" rarity="${escapeXml(it.rarity)}"`;
                    if (it.image) xml += ` image="${escapeXml(it.image)}"`;
                    xml += ' />\n';
                }
            }
            xml += '  </case>\n';
        }
        xml += '</cases>\n';
        res.setHeader('Content-Disposition', 'attachment; filename="cases.xml"');
        res.type('application/xml');
        res.send(xml);
    });

    // Import cases - supports JSON body: { mode: 'replace'|'merge', cases: [...] }
    app.post('/api/cases/import', async (req, res) => {
        const { mode, cases } = req.body;
        if (!cases || !Array.isArray(cases)) {
            return res.status(400).json({ error: 'cases must be an array' });
        }
        // Фильтруем и валидируем поля, поддерживаем image и вариации
        const cleanCases = cases.map(c => ({
            id: c.id,
            name: c.name,
            price: c.price,
            items: (c.items || []).map(it => {
                const item = {
                    id: it.id,
                    name: it.name,
                    chance: Number(it.chance) || 0,
                    value: Number(it.value) || 0,
                    rarity: it.rarity,
                    image: typeof it.image === 'string' ? it.image : ''
                };
                // Добавляем вариации если они есть
                if (it.variations && Array.isArray(it.variations) && it.variations.length > 0) {
                    item.variations = it.variations.map(v => ({
                        name: v.name,
                        chance: Number(v.chance) || 0,
                        price: Number(v.price) || 0
                    }));
                }
                return item;
            })
        }));
        // Validate chances for each case
        for (const c of cleanCases) {
            if (!c.items || !Array.isArray(c.items)) continue;
            const total = c.items.reduce((s, it) => s + (parseFloat(it.chance) || 0), 0);
            if (Math.abs(total - 100) > 0.1) {
                return res.status(400).json({ error: `Case ${c.id || c.name} chances do not sum to 100% (current ${total}%)` });
            }
        }
        try {
            if (mode === 'replace') {
                await storage.setAllCases(cleanCases);
            } else {
                await storage.upsertCases(cleanCases);
            }
            return res.json({ success: true });
        } catch (err) {
            return res.status(500).json({ error: 'Failed to import cases' });
        }
    });

    // Promo endpoints
    app.get('/api/promos', async (req, res) => {
        const promos = await storage.getAllPromos();
        res.json(promos);
    });

    app.post('/api/promos', async (req, res) => {
        try {
            const { code, amount, maxUses } = req.body;
            if (!code) return res.status(400).json({ error: 'code required' });
            const promo = await storage.createPromo({ code, amount, maxUses });
            res.json(promo);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.put('/api/promos/:id', async (req, res) => {
        try {
            const updated = await storage.updatePromo(req.params.id, req.body);
            res.json(updated);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.delete('/api/promos/:id', async (req, res) => {
        try {
            await storage.deletePromo(req.params.id);
            res.json({ ok: true });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // Redeem promo (user)
    app.post('/api/promos/redeem', async (req, res) => {
        try {
            const { telegramId, code } = req.body;
            if (!telegramId || !code) return res.status(400).json({ error: 'telegramId and code required' });
            const result = await storage.redeemPromo(String(telegramId), code);
            if (!result.success) return res.status(400).json({ error: result.message });
            res.json({ ok: true, amount: result.amount });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    
    // ============ IMAGE UPLOAD ENDPOINT ============
    
    // Upload image for item
    app.post('/api/upload-image', async (req, res) => {
        const { imageData, filename } = req.body;
    if (!imageData || !filename) return res.status(400).json({ error: 'No image data' });
    try {
        // imageData: data:image/png;base64,...
        const base64 = imageData.split(',')[1];
        // Postimages API: https://postimages.org/doc/api
        const form = new URLSearchParams();
        form.append('key', 'anonymous');
        form.append('upload', base64);
        form.append('format', 'json');
        const response = await fetch('https://api.postimages.org/1/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString()
        });
        const result = await response.json();
        if (!result.url || !result.url) throw new Error('Postimages upload failed');
        // result.url gives the direct image link
        res.json({ url: result.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
    });
    
    // Delete image
    app.delete('/api/delete-image', (req, res) => {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL required' });
        }
        
        try {
            const filename = url.split('/').pop();
            const filepath = join(uploadsDir, filename);
            
            if (existsSync(filepath)) {
                unlinkSync(filepath);
            }
            
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete image' });
        }
    });
    
    app.listen(port, () => {
        console.log(`🌐 Web UI running at http://localhost:${port}`);
    });
    
    return app;
}
