const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data', 'players.json');
if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
if (!fs.existsSync(file)) {
  fs.writeFileSync(file, JSON.stringify([
    { id: "1", name: "Faker", game: "League of Legends", score: 9550, createdAt: new Date().toISOString() },
    { id: "2", name: "Mango", game: "Smash Bros Melee", score: 8400, createdAt: new Date().toISOString() },
    { id: "3", name: "Shroud", game: "Valorant", score: 8100, createdAt: new Date().toISOString() },
    { id: "4", name: "SonicFox", game: "Mortal Kombat 1", score: 7900, createdAt: new Date().toISOString() }
  ], null, 2));
}
