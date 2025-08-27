const express = require('express');
const app = express();
const http = require('http').Server(app);
const io =require('socket.io')(http);
const port = process.env.PORT || 3000;

// --- CONSTANTS ---
const AMBIENT_TEMP = 20;
const MAX_TEMP = 10000;

// --- 1. THE EXTENSIVE ELEMENT LIBRARY ---
const ELEMENTS = {
    // Special
    "NONE": { color: "#000" },
    "ERAS": { name: "Eraser", menu: "Tools" },
    
    // Solids
    "WALL": { name: "Wall", menu: "Solids", state: "solid", density: Infinity, color: "#888", heatConduct: 5 },
    "GLAS": { name: "Glass", menu: "Solids", state: "solid", density: 2.5, color: "rgba(180, 210, 210, 0.3)", heatConduct: 2 },
    "PLNT": { name: "Plant", menu: "Solids", state: "solid", density: 1.2, color: "#00ab41", heatConduct: 15, flammable: 80 },
    "INSL": { name: "Insulator", menu: "Solids", state: "solid", density: 1.5, color: "#404040", heatConduct: 0.1, conductivity: 0 },
    "FILT": { name: "Filter", menu: "Solids", state: "solid", density: 1.8, color: "#d3d3d3", heatConduct: 10 },
    
    // Powders
    "SAND": { name: "Sand", menu: "Powders", state: "powder", density: 1.5, color: "#c2b280", heatConduct: 20 },
    "STNE": { name: "Stone", menu: "Powders", state: "powder", density: 2.4, color: "#8c8c8c", heatConduct: 8 },
    "COAL": { name: "Coal", menu: "Powders", state: "powder", density: 1.1, color: "#303030", heatConduct: 25, flammable: 250, conductivity: 1 },
    
    // Liquids
    "WATR": { name: "Water", menu: "Liquids", state: "liquid", density: 1, color: "#4466ff", heatConduct: 90, boilPoint: 100, boilInto: "STEA", conductivity: 5 },
    "OIL": { name: "Oil", menu: "Liquids", state: "liquid", density: 0.8, color: "#8b4513", heatConduct: 40, flammable: 150 },
    "LAVA": { name: "Lava", menu: "Liquids", state: "liquid", density: 2.8, color: "#ff4500", temperature: 1200, heatConduct: 60 },
    "ACID": { name: "Acid", menu: "Liquids", state: "liquid", density: 1.2, color: "#80ff00", heatConduct: 70 },

    // Gases
    "GAS": { name: "Gas", menu: "Gases", state: "gas", density: -0.6, color: "#aaccaa", heatConduct: 20 },
    "STEA": { name: "Steam", menu: "Gases", state: "gas", density: -0.5, color: "#a0a0a0", temperature: 110, heatConduct: 30 },
    "SMKE": { name: "Smoke", menu: "Gases", state: "gas", density: -0.4, color: "#606060", life: 150, heatConduct: 15 },

    // Energy & Special
    "FIRE": { name: "Fire", menu: "Energy", state: "gas", density: -0.5, color: "#ff8000", temperature: 1000, life: 50 },
    "SPRK": { name: "Spark", menu: "Energy", state: "energy", color: "#ffff00", life: 4 },
    "LIGH": { name: "Lightning", menu: "Energy", state: "energy", color: "#f0f8ff", life: 6 },
    "PHOT": { name: "Photon", menu: "Energy", state: "energy", color: "#fff" },
    "NEUT": { name: "Neutron", menu: "Energy", state: "energy", color: "#ff00ff", life: 100 }
};

// --- 2. THE REWORKED ENGINE ---
const world = new Map();
const getPixelKey = (x, y) => `${x},${y}`;

class Particle {
    constructor(type, ctype) {
        this.type = type;
        const def = ELEMENTS[type];
        this.temperature = def.temperature || AMBIENT_TEMP;
        this.life = def.life ? def.life + Math.floor(Math.random()*10) : -1;
        // ctype is a flexible property, often for color (photons) or type variations
        this.ctype = ctype || 0; 
        this.vx = 0; this.vy = 0;
    }
}

const setPixel = (x, y, particle, changes) => {
    const key = getPixelKey(x, y);
    if (particle === null) { world.delete(key); } 
    else { world.set(key, particle); }
    if(changes) changes.push({ x, y, particle });
};
const getPixel = (x, y) => world.get(getPixelKey(x, y));
const swapPixels = (x1, y1, p1, x2, y2, p2, changes) => {
    setPixel(x1, y1, p2, changes);
    setPixel(x2, y2, p1, changes);
};
// Check neighbors for a specific type
const checkNeighbors = (x, y, type) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (getPixel(x + dx, y + dy)?.type === type) return true;
    }
    return false;
};

// --- 3. THE MULTI-PHASE SERVER TICK ---
const TICK_RATE = 30;
setInterval(() => {
    const changes = [];
    const keys = Array.from(world.keys());

    // --- MOVEMENT PHASE ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;
        const def = ELEMENTS[p.type];

        // Movement is now state-driven
        if (def.state === "powder") {
            const down = getPixel(x, y + 1);
            if (!down) { swapPixels(x, y, p, x, y + 1, down, changes); }
            else {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const downSide = getPixel(x + dir, y + 1);
                if (!downSide) { swapPixels(x, y, p, x + dir, y + 1, downSide, changes); }
            }
        } else if (def.state === "liquid") {
            const down = getPixel(x, y + 1);
            if (!down) { swapPixels(x, y, p, x, y + 1, down, changes); }
            else {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const side = getPixel(x + dir, y);
                if (!side) { swapPixels(x, y, p, x + dir, y, side, changes); }
            }
        } else if (def.state === "gas") {
            const dirX = Math.floor(Math.random() * 3) - 1;
            const dirY = Math.floor(Math.random() * 3) - 1;
            const target = getPixel(x + dirX, y + dirY);
            if (!target) { swapPixels(x, y, p, x + dirX, y + dirY, target, changes); }
        } else if (p.type === 'PHOT') {
             const nextX = x + p.vx;
             const nextY = y + p.vy;
             const target = getPixel(nextX, nextY);
             if(!target) {
                 swapPixels(x, y, p, nextX, nextY, target, changes);
             } else {
                 if(target.type === 'WALL') { p.vx *= -1; p.vy *= -1; }
                 else if(target.type === 'GLAS') { /* Pass through */ }
                 else if(target.type === 'FILT') {
                     // Simple filter logic: absorb some color channels
                     const r = (p.ctype >> 16) & 0xFF;
                     const g = (p.ctype >> 8) & 0xFF;
                     const b = p.ctype & 0xFF;
                     p.ctype = (g << 16) | (b << 8) | r; // Cycle colors
                 }
                 else { setPixel(x, y, null, changes); } // Absorbed
             }
        }
    }

    // --- INTERACTION & STATE CHANGE PHASE ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;
        const def = ELEMENTS[p.type];

        // Handle life
        if (p.life > 0) p.life--;
        if (p.life === 0) { setPixel(x, y, null, changes); continue; }

        // Interactions
        if (p.type === 'FIRE') {
            p.temperature = def.temperature;
            if(Math.random() < 0.2) setPixel(x, y-1, new Particle('SMKE'), changes);
        }
        if (p.type === 'LAVA') {
            if(checkNeighbors(x,y,'WATR')) {
                setPixel(x,y, new Particle('STNE'), changes);
                setPixel(x,y-1, new Particle('STEA'), changes);
            }
        }
        if (p.type === 'ACID') {
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const neighbor = getPixel(x + dx, y + dy);
                if (neighbor && neighbor.type !== 'GLAS' && neighbor.type !== 'WALL' && neighbor.type !== 'ACID') {
                    setPixel(x + dx, y + dy, null, changes);
                }
            }
        }
        
        // Heat Transfer & State Changes from Heat
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const neighbor = getPixel(x + dx, y + dy);
            if (neighbor) {
                const neighborDef = ELEMENTS[neighbor.type];
                // Transfer heat
                const tempDiff = p.temperature - neighbor.temperature;
                if (tempDiff > 0) {
                    const heatToTransfer = tempDiff * (def.heatConduct / 100);
                    p.temperature -= heatToTransfer;
                    neighbor.temperature += heatToTransfer;
                }
                // Check for ignition
                if (neighborDef.flammable && neighbor.temperature > neighborDef.flammable) {
                    setPixel(x + dx, y + dy, new Particle('FIRE'), changes);
                }
            }
        }
        if (def.boilPoint && p.temperature >= def.boilPoint) {
            setPixel(x, y, new Particle(def.boilInto), changes);
        }
    }

    if (changes.length > 0) {
        io.emit('worldUpdate', changes);
    }
}, 1000 / TICK_RATE);


// --- 4. NETWORKING & CLIENT HOSTING ---
io.on('connection', (socket) => {
    console.log('A user connected.');
    socket.emit('elementsDefinition', ELEMENTS);
    
    const fullWorld = Array.from(world.entries()).map(([key, particle]) => {
        const [x, y] = key.split(',').map(Number); return { x, y, particle };
    });
    socket.emit('fullWorld', fullWorld);

    socket.on('clientDraw', (data) => {
        const changes = [];
        const { x, y, radius, element } = data;
        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
                if (Math.sqrt(i*i + j*j) <= radius) {
                    const newX = x + i;
                    const newY = y + j;
                    if (element === 'ERAS') {
                        if (getPixel(newX, newY)) setPixel(newX, newY, null, changes);
                    } else {
                        let p = new Particle(element);
                        // Special creation logic
                        if (element === 'PHOT') {
                            const angle = Math.random() * 2 * Math.PI;
                            p.vx = Math.cos(angle);
                            p.vy = Math.sin(angle);
                            p.ctype = 0xFFFFFF; // White light
                        }
                        setPixel(newX, newY, p, changes);
                    }
                }
            }
        }
        if (changes.length > 0) { io.emit('worldUpdate', changes); }
    });
    socket.on('disconnect', () => { console.log('User disconnected.'); });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Deep Physics Simulation Engine</title>
        <style>
          body, html { margin: 0; overflow: hidden; font-family: Arial, sans-serif; user-select: none; background-color: #333; }
          #game-canvas { border: 1px solid black; cursor: crosshair; background-color: #000; }
          #controls {
            position: fixed; top: 10px; left: 10px; padding: 8px;
            background-color: rgba(255, 255, 255, 0.9); border-radius: 5px;
            display: flex; align-items: center; z-index: 10;
          }
        </style>
      </head>
      <body>
        <div id="controls">
          <label for="elementPicker">Element:</label>
          <select id="elementPicker"></select>
          <label for="brushSize" style="margin-left: 15px;">Brush:</label>
          <input type="range" id="brushSize" min="1" max="10" value="3">
        </div>
        <canvas id="game-canvas"></canvas>
        <script src="/socket.io/socket.io.js"></script>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            const socket = io();
            const canvas = document.getElementById('game-canvas');
            const context = canvas.getContext('2d');
            const elementPicker = document.getElementById('elementPicker');
            const brushSizeSlider = document.getElementById('brushSize');
            canvas.width = window.innerWidth; canvas.height = window.innerHeight;

            let ELEMENTS = {};
            const localWorld = new Map();
            const getPixelKey = (x, y) => \`\${x},\${y}\`;
            let currentElement = 'SAND'; let brushSize = 3;
            let cameraX = 0, cameraY = 0, zoom = 5;
            let isPanning = false, lastPanX = 0, lastPanY = 0; let isDrawing = false;
            
            const toWorldCoords = (screenX, screenY) => ({ 
                x: Math.floor((screenX - cameraX) / zoom),
                y: Math.floor((screenY - cameraY) / zoom)
            });

            const redrawCanvas = () => {
                context.save();
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.translate(cameraX, cameraY); context.scale(zoom, zoom);

                for (const [key, p] of localWorld.entries()) {
                    const [x, y] = key.split(',').map(Number);
                    const def = ELEMENTS[p.type];
                    if (def) {
                        if (p.type === 'PHOT') {
                            const r = (p.ctype >> 16) & 0xFF;
                            const g = (p.ctype >> 8) & 0xFF;
                            const b = p.ctype & 0xFF;
                            context.fillStyle = \`rgb(\${r},\${g},\${b})\`;
                        } else {
                            context.fillStyle = def.color;
                        }
                        context.fillRect(x, y, 1, 1);
                    }
                }
                context.restore();
            };

            let lastFrameTime = 0;
            function renderLoop(time) {
                if(time - lastFrameTime > 16) { // Cap rendering at ~60fps
                    redrawCanvas();
                    lastFrameTime = time;
                }
                requestAnimationFrame(renderLoop);
            }
            requestAnimationFrame(renderLoop);

            // --- SOCKET LISTENERS ---
            socket.on('elementsDefinition', (definitions) => {
                ELEMENTS = definitions;
                elementPicker.innerHTML = '';
                const menus = {};
                for(const key in ELEMENTS) {
                    const def = ELEMENTS[key];
                    if(def.menu) {
                        if(!menus[def.menu]) menus[def.menu] = [];
                        menus[def.menu].push({ key, name: def.name });
                    }
                }
                for(const menuName in menus) {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = menuName;
                    menus[menuName].sort((a,b) => a.name.localeCompare(b.name)).forEach(el => {
                        const option = document.createElement('option');
                        option.value = el.key;
                        option.textContent = el.name;
                        optgroup.appendChild(option);
                    });
                    elementPicker.appendChild(optgroup);
                }
                currentElement = elementPicker.value;
            });

            socket.on('fullWorld', (fullWorld) => {
                localWorld.clear();
                for(const item of fullWorld) { localWorld.set(getPixelKey(item.x, item.y), item.particle); }
            });

            socket.on('worldUpdate', (changes) => {
                for (const change of changes) {
                    const key = getPixelKey(change.x, change.y);
                    if (change.particle === null) { localWorld.delete(key); } 
                    else { localWorld.set(key, change.particle); }
                }
            });

            // --- EVENT HANDLERS ---
            elementPicker.addEventListener('change', (e) => currentElement = e.target.value);
            brushSizeSlider.addEventListener('input', (e) => brushSize = parseInt(e.target.value));
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const worldPosBefore = toWorldCoords(e.offsetX, e.offsetY);
                zoom *= Math.exp(-e.deltaY * 0.005);
                zoom = Math.max(0.5, Math.min(40, zoom));
                cameraX = e.offsetX - worldPosBefore.x * zoom;
                cameraY = e.offsetY - worldPosBefore.y * zoom;
            });
            const handleDrawing = (e) => {
                if (!isDrawing) return;
                const pos = toWorldCoords(e.offsetX, e.offsetY);
                socket.emit('clientDraw', { x: pos.x, y: pos.y, radius: brushSize, element: currentElement });
            };
            canvas.addEventListener('mousedown', (e) => {
                if (e.button === 2) { isPanning = true; lastPanX = e.clientX; lastPanY = e.clientY; canvas.style.cursor = 'grabbing'; } 
                else if (e.button === 0) { isDrawing = true; handleDrawing(e); }
            });
            canvas.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    cameraX += e.clientX - lastPanX;
                    cameraY += e.clientY - lastPanY;
                    lastPanX = e.clientX;
                    lastPanY = e.clientY;
                } else if (isDrawing) { handleDrawing(e); }
            });
            canvas.addEventListener('mouseup', (e) => {
                if (e.button === 2) { isPanning = false; canvas.style.cursor = 'crosshair'; } 
                else if (e.button === 0) { isDrawing = false; }
            });
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
          });
        </script>
      </body>
    </html>
  `);
});

http.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
