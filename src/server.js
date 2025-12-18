import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import * as storage from './storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(__dirname, 'public', 'uploads');

// Ensure uploads directory exists
if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
}

export function setupServer(port = 5051) {
    const app = express();
    
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
        const { id, name, price, items } = req.body;
        
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
        
        const newCase = await storage.createCase({ id, name, price, items: items || [] });
        res.status(201).json(newCase);
    });
    
    // Update case
    app.put('/api/cases/:id', async (req, res) => {
        const { name, price, items } = req.body;
        
        // Validate items if provided
        if (items && items.length > 0) {
            const totalChance = items.reduce((sum, item) => sum + (item.chance || 0), 0);
            if (Math.abs(totalChance - 100) > 0.01) {
                return res.status(400).json({ 
                    error: `Item chances must add up to 100%. Current total: ${totalChance.toFixed(2)}%` 
                });
            }
        }
        
        const updated = await storage.updateCase(req.params.id, { name, price, items });
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
        const { blueItems, purpleItems, pinkItems, redItems, goldItems } = req.body;
        
        // Default rarity distribution
        const rarityChances = {
            blue: 50,    // 50% total for blue
            purple: 25,  // 25% total for purple
            pink: 15,    // 15% total for pink
            red: 8,      // 8% total for red
            gold: 2      // 2% total for gold
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
        
        res.json({ items, totalChance: items.reduce((sum, i) => sum + i.chance, 0) });
    });
    
    // ============ IMAGE UPLOAD ENDPOINT ============
    
    // Upload image for item
    app.post('/api/upload-image', (req, res) => {
        const { imageData, filename } = req.body;
        
        if (!imageData || !filename) {
            return res.status(400).json({ error: 'Image data and filename required' });
        }
        
        try {
            // Remove data:image/xxx;base64, prefix
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            
            // Generate unique filename
            const ext = filename.split('.').pop() || 'png';
            const uniqueFilename = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
            const filepath = join(uploadsDir, uniqueFilename);
            
            writeFileSync(filepath, buffer);
            
            res.json({ success: true, url: `/uploads/${uniqueFilename}` });
        } catch (err) {
            res.status(500).json({ error: 'Failed to save image' });
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
