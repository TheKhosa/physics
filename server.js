const express = require('express');
const app = express();
const http = require('http').Server(app);
const io =require('socket.io')(http);
const port = process.env.PORT || 3000;

// --- 1. DATA-DRIVEN ELEMENT DEFINITIONS ---
// Based on https://mrprocom.github.io/projects/tptreference/
const ELEMENTS = {
    "NONE": { color: "#000000" },
    "WALL": { 
        name: "Wall", menu: "Solids", state: "solid", density: Infinity, color: "#888888", conductivity: 0.01 
    },
    "SAND": { 
        name: "Sand", menu: "Powders", state: "powder", density: 1.5, color: "#c2b280", conductivity: 0.1 
    },
    "WATR": { 
        name: "Water", menu: "Liquids", state: "liquid", density: 1, color: "#4466ff", conductivity: 0.8 
    },
    "OIL": {
        name: "Oil", menu: "Liquids", state: "liquid", density: 0.8, color: "#8b4513", flammable: 150, conductivity: 0.3
    },
    "FIRE": {
        name: "Fire", menu: "Energy", state: "gas", density: -0.5, color: "#ff8000", temperature: 1000, life: 50, flammable: 0
    },
    "PLNT": {
        name: "Plant", menu: "Special", state: "solid", density: 1.2, color: "#00ab41", flammable: 120, conductivity: 0.2
    },
    "GAS": {
        name: "Gas", menu: "Gases", state: "gas", density: -0.6, color: "#aaccaa", conductivity: 0.1
    },
    "GLAS": {
        name: "Glass", menu: "Solids", state: "solid", density: 2.5, color: "#b0d0d0", conductivity: 0.05, breakable: 2
    }
    // Add more elements here by just defining their properties!
};

// --- 2. ADVANCED PARTICLE & WORLD ENGINE ---
const world = new Map();
const getPixelKey = (x, y) => `${x},${y}`;

class Particle {
    constructor(type) {
        this.type = type;
        this.vx = 0;
        this.vy = 0;
        this.temperature = 20; // Room temp
        
        // Custom properties used by specific elements
        this.props = {}; 
        if(ELEMENTS[type].life) this.props.life = ELEMENTS[type].life;
    }
}

const setPixel = (x, y, particle, changes) => {
    const key = getPixelKey(x, y);
    if (particle === null) { world.delete(key); } 
    else { world.set(key, particle); }
    if(changes) changes.push({ x, y, particle });
};

const getPixel = (x, y) => world.get(getPixelKey(x, y));

const swapPixels = (x1, y1, x2, y2, changes) => {
    const p1 = getPixel(x1, y1);
    const p2 = getPixel(x2, y2);
    setPixel(x1, y1, p2, changes);
    setPixel(x2, y2, p1, changes);
}

// --- 3. THE RE-ARCHITECTED SERVER TICK ---
const TICK_RATE = 20;
setInterval(() => {
    const changes = [];
    const keys = Array.from(world.keys());

    // --- PHYSICS PHASES ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const p = getPixel(x, y);
        if (!p) continue;

        const def = ELEMENTS[p.type];
        if (!def) continue;

        // -- Gravity --
        if (def.state === "powder" || def.state === "liquid") {
            p.vy += 0.1; // Apply gravity
        }

        // -- Element-specific updates (before movement) --
        if (p.type === 'FIRE') {
            p.props.life--;
            if(p.props.life <= 0) {
                setPixel(x, y, null, changes);
                continue;
            }
        }
        if (p.type === 'PLNT') {
            if(getPixel(x,y+1)?.type === 'WATR' && Math.random() < 0.01) {
                if(!getPixel(x,y-1)) setPixel(x, y-1, new Particle('PLNT'), changes);
            }
        }

        // -- Movement & Swapping --
        if (p.vx !== 0 || p.vy !== 0) {
            const nextX = Math.round(x + p.vx);
            const nextY = Math.round(y + p.vy);
            
            if (nextX === x && nextY === y) continue;

            const target = getPixel(nextX, nextY);
            if (!target) {
                setPixel(x, y, null); // Move from old spot
                setPixel(nextX, nextY, p); // Move to new spot
                // Add both to changes
                changes.push({x,y,particle:null}, {x:nextX, y:nextY, particle:p});
            } else {
                const targetDef = ELEMENTS[target.type];
                if (def.density > targetDef.density) {
                    swapPixels(x, y, nextX, nextY, changes);
                } else {
                    // Collision
                    p.vx *= -0.5;
                    p.vy *= -0.5;
                }
            }
        }
    }
    
    // --- HEAT & STATE CHANGE PHASE ---
    // (This can be re-added here, using the conductivity property)

    if (changes.length > 0) {
        io.emit('worldUpdate', changes);
    }
}, 1000 / TICK_RATE);


// --- 4. NETWORKING & CLIENT HOSTING ---
io.on('connection', (socket) => {
    console.log('A user connected.');
    // Send the entire ELEMENT definition object to the new client
    socket.emit('elementsDefinition', ELEMENTS);
    
    const fullWorld = Array.from(world.entries()).map(([key, particle]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, particle };
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
                    if (element === 'eraser') {
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
        <title>Data-Driven Physics Game</title>
        <style>
          body, html { margin: 0; overflow: hidden; font-family: Arial, sans-serif; user-select: none; background-color: #333; }
          #game-canvas { border: 1px solid black; cursor: crosshair; background-color: #222; }
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

            let ELEMENTS = {}; // This will be populated by the server
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
                context.fillStyle = '#222'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.translate(cameraX, cameraY); context.scale(zoom, zoom);

                for (const [key, pixel] of localWorld.entries()) {
                    const [x, y] = key.split(',').map(Number);
                    const def = ELEMENTS[pixel.type];
                    if (def) {
                        context.fillStyle = def.color;
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
                console.log("Received element definitions from server.");
                ELEMENTS = definitions;
                // --- DYNAMICALLY BUILD THE UI ---
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
                    menus[menuName].forEach(el => {
                        const option = document.createElement('option');
                        option.value = el.key;
                        option.textContent = el.name;
                        optgroup.appendChild(option);
                    });
                    elementPicker.appendChild(optgroup);
                }
                const eraserOpt = document.createElement('option');
                eraserOpt.value = 'eraser';
                eraserOpt.textContent = 'ERASER';
                eraserOpt.style.color = 'red';
                elementPicker.appendChild(eraserOpt);

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
            // (Other event handlers like mouse, wheel, etc. are unchanged)
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
