const express = require('express');
const app = express();
const http = require('http').Server(app);
const io =require('socket.io')(http);
const port = process.env.PORT || 3000;

// --- CONSTANTS ---
const AMBIENT_TEMP = 20;
const MAX_TEMP = 10000;

// --- 1. DATA-DRIVEN ELEMENT DEFINITIONS ---
const ELEMENTS = {
    // Special
    "NONE": { color: "#000000" },
    "ERAS": { name: "Eraser", menu: "Tools" },
    
    // Solids
    "WALL": { name: "Wall", menu: "Solids", state: "solid", density: Infinity, color: "#888", conductivity: 0.01, heatConduct: 5 },
    "GLAS": { name: "Glass", menu: "Solids", state: "solid", density: 2.5, color: "rgba(180, 210, 210, 0.3)", conductivity: 0.05, heatConduct: 2, breakable: 10 },
    "PLNT": { name: "Plant", menu: "Solids", state: "solid", density: 1.2, color: "#00ab41", conductivity: 0.2, heatConduct: 15, flammable: 80 },
    
    // Powders
    "SAND": { name: "Sand", menu: "Powders", state: "powder", density: 1.5, color: "#c2b280", conductivity: 0.1, heatConduct: 20 },
    "STNE": { name: "Stone", menu: "Powders", state: "powder", density: 2.4, color: "#8c8c8c", conductivity: 0.05, heatConduct: 8 },
    "COAL": { name: "Coal", menu: "Powders", state: "powder", density: 1.1, color: "#303030", conductivity: 0.1, heatConduct: 25, flammable: 250 },
    
    // Liquids
    "WATR": { name: "Water", menu: "Liquids", state: "liquid", density: 1, color: "#4466ff", conductivity: 0.8, heatConduct: 90, boilPoint: 100, boilInto: "STEA" },
    "OIL": { name: "Oil", menu: "Liquids", state: "liquid", density: 0.8, color: "#8b4513", conductivity: 0.3, heatConduct: 40, flammable: 150 },
    "LAVA": { name: "Lava", menu: "Liquids", state: "liquid", density: 2.8, color: "#ff4500", temperature: 1200, conductivity: 0.5, heatConduct: 60 },

    // Gases
    "GAS": { name: "Gas", menu: "Gases", state: "gas", density: -0.6, color: "#aaccaa", conductivity: 0.1, heatConduct: 20 },
    "STEA": { name: "Steam", menu: "Gases", state: "gas", density: -0.5, color: "#a0a0a0", temperature: 110, conductivity: 0.2, heatConduct: 30 },

    // Energy
    "FIRE": { name: "Fire", menu: "Energy", state: "gas", density: -0.5, color: "#ff8000", temperature: 1000, life: 50, flammable: 0 }
};

// --- 2. ADVANCED PARTICLE & WORLD ENGINE ---
const world = new Map();
const getPixelKey = (x, y) => `${x},${y}`;

class Particle {
    constructor(type) {
        this.type = type;
        this.vx = 0;
        this.vy = 0;
        
        const def = ELEMENTS[type];
        this.temperature = def.temperature || AMBIENT_TEMP;
        
        this.props = {};
        if(def.life) this.props.life = def.life + Math.floor(Math.random()*10);
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
}

// --- 3. THE RE-ARCHITECTED SERVER TICK ---
const TICK_RATE = 20;
setInterval(() => {
    const changes = [];
    const keys = Array.from(world.keys());

    // --- PHASE 1: ELEMENT-SPECIFIC UPDATES (before movement) ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;
        const def = ELEMENTS[p.type];

        if (p.type === 'FIRE') {
            p.props.life--;
            if (p.props.life <= 0 || Math.random() < 0.05) {
                setPixel(x, y, null, changes);
                continue;
            }
        }
        if (p.type === 'PLNT') {
            // Grow if touching water, but not into water
            const neighbor = getPixel(x, y + 1);
            if(neighbor && neighbor.type === 'WATR' && Math.random() < 0.01) {
                const target = getPixel(x, y - 1);
                if (!target) setPixel(x, y - 1, new Particle('PLNT'), changes);
            }
        }
    }

    // --- PHASE 2: GRAVITY & MOVEMENT ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;
        const def = ELEMENTS[p.type];

        if (def.state === "powder" || def.state === "liquid") {
            const down = getPixel(x, y + 1);
            if (!down) {
                swapPixels(x, y, p, x, y + 1, down, changes);
            } else {
                const downDef = ELEMENTS[down.type];
                if (def.density > downDef.density) {
                    swapPixels(x, y, p, x, y + 1, down, changes);
                } else if (def.state === "liquid") { // Liquids spread
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    const side = getPixel(x + dir, y);
                    if (!side) {
                        swapPixels(x, y, p, x + dir, y, side, changes);
                    }
                }
            }
        } else if (def.state === "gas") {
            const up = getPixel(x, y - 1);
            if (!up) {
                swapPixels(x, y, p, x, y - 1, up, changes);
            } else {
                const upDef = ELEMENTS[up.type];
                if (def.density > upDef.density) {
                    swapPixels(x, y, p, x, y - 1, up, changes);
                } else {
                    const dir = Math.random() < 0.5 ? 1 : -1;
                    const side = getPixel(x + dir, y);
                    if (!side) {
                        swapPixels(x, y, p, x + dir, y, side, changes);
                    }
                }
            }
        }
    }

    // --- PHASE 3: HEAT TRANSFER ---
    const tempChanges = new Map();
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;

        let totalTempDelta = 0;
        const def = ELEMENTS[p.type];
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const neighbor = getPixel(x + dx, y + dy);
                if (neighbor) {
                    const neighborDef = ELEMENTS[neighbor.type];
                    const avgConductivity = (def.heatConduct + neighborDef.heatConduct) / 2;
                    totalTempDelta += (neighbor.temperature - p.temperature) * (avgConductivity / 200);
                }
            }
        }
        // Cooling to ambient
        totalTempDelta += (AMBIENT_TEMP - p.temperature) * (def.conductivity / 10);
        tempChanges.set(key, totalTempDelta);
    }
    for (const [key, delta] of tempChanges.entries()) {
        const p = world.get(key);
        if(p) {
            p.temperature = Math.min(MAX_TEMP, p.temperature + delta);
        }
    }

    // --- PHASE 4: STATE CHANGES ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;
        const def = ELEMENTS[p.type];

        if (def.boilPoint && p.temperature >= def.boilPoint) {
            setPixel(x, y, new Particle(def.boilInto), changes);
        }
        else if (def.flammable && p.temperature >= def.flammable) {
            setPixel(x, y, new Particle('FIRE'), changes);
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
                        setPixel(newX, newY, new Particle(element), changes);
                    }
                }
            }
        }
        if (changes.length > 0) {
            io.emit('worldUpdate', changes);
        }
    });
    socket.on('disconnect', () => { console.log('User disconnected.'); });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Full Data-Driven Physics Game</title>
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

                for (const [key, pixel] of localWorld.entries()) {
                    const [x, y] = key.split(',').map(Number);
                    const def = ELEMENTS[pixel.type];
                    if (def) {
                        const temp = pixel.temperature;
                        // For non-glowing elements, check temperature
                        if (temp > AMBIENT_TEMP + 5 && def.state !== 'gas') {
                             const heatRatio = Math.min((temp - AMBIENT_TEMP) / 1000, 1);
                             let r,g,b;
                             // Quick hex to rgb
                             const hex = def.color.startsWith('rgba') ? '#888888' : def.color;
                             r = parseInt(hex.slice(1,3), 16);
                             g = parseInt(hex.slice(3,5), 16);
                             b = parseInt(hex.slice(5,7), 16);

                             r = Math.floor(r + (255 - r) * heatRatio);
                             g = Math.floor(g + (120 - g) * heatRatio);
                             b = Math.floor(b * (1 - heatRatio));
                             context.fillStyle = \`rgb(\${r},\${g},\${b})\`;
                        } else {
                            context.fillStyle = def.color;
                        }
                        context.fillRect(x, y, 1, 1);
                    }
                }
                context.restore();
            };

            function renderLoop() {
                redrawCanvas();
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
                zoom = Math.max(0.5, Math.min(20, zoom));
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
