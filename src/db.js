import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');

// Ensure data directory exists
if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
}

const file = join(dataDir, 'db.json');
const adapter = new JSONFile(file);

const defaultData = {
    users: [],
    cases: [
        {
            id: 'basic_case',
            name: 'Базовый кейс',
            price: 100,
            items: [
                // Blue items (50% total chance) - Common
                { id: 'blue_1', name: '🔵 Синий камень', rarity: 'blue', chance: 10, value: 50 },
                { id: 'blue_2', name: '🔵 Синий кристалл', rarity: 'blue', chance: 10, value: 60 },
                { id: 'blue_3', name: '🔵 Синяя руда', rarity: 'blue', chance: 10, value: 70 },
                { id: 'blue_4', name: '🔵 Синий осколок', rarity: 'blue', chance: 10, value: 80 },
                { id: 'blue_5', name: '🔵 Синий артефакт', rarity: 'blue', chance: 10, value: 90 },
                // Purple items (25% total chance) - Uncommon
                { id: 'purple_1', name: '🟣 Фиолетовый камень', rarity: 'purple', chance: 8.33, value: 150 },
                { id: 'purple_2', name: '🟣 Фиолетовый кристалл', rarity: 'purple', chance: 8.33, value: 175 },
                { id: 'purple_3', name: '🟣 Фиолетовый артефакт', rarity: 'purple', chance: 8.34, value: 200 },
                // Pink items (15% total chance) - Rare
                { id: 'pink_1', name: '🩷 Розовый камень', rarity: 'pink', chance: 5, value: 300 },
                { id: 'pink_2', name: '🩷 Розовый кристалл', rarity: 'pink', chance: 5, value: 350 },
                { id: 'pink_3', name: '🩷 Розовый артефакт', rarity: 'pink', chance: 5, value: 400 },
                // Red items (8% total chance) - Epic
                { id: 'red_1', name: '🔴 Красный камень', rarity: 'red', chance: 4, value: 600 },
                { id: 'red_2', name: '🔴 Красный кристалл', rarity: 'red', chance: 4, value: 750 },
                // Gold items (2% total chance) - Legendary
                { id: 'gold_1', name: '🌟 Золотой артефакт', rarity: 'gold', chance: 1, value: 2000 },
                { id: 'gold_2', name: '🌟 Золотой реликт', rarity: 'gold', chance: 1, value: 3000 }
            ]
        }
    ],
    trades: []
};

const db = new Low(adapter, defaultData);

await db.read();

// Initialize with defaults if empty
if (!db.data) {
    db.data = defaultData;
    await db.write();
}

// Ensure all required fields exist
if (!db.data.users) db.data.users = [];
if (!db.data.cases) db.data.cases = defaultData.cases;
if (!db.data.trades) db.data.trades = [];
await db.write();

export default db;
