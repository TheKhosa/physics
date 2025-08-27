const express = require('express');
const app = express();
const http = require('http').Server(app);
const io =require('socket.io')(http);
const port = process.env.PORT || 3000;

// --- SERVER-SIDE SIMULATION ---

const world = new Map();
const getPixelKey = (x, y) => `${x},${y}`;

class Particle {
    constructor(type) {
        this.type = type;
        this.updatedThisTick = false;
        // New properties for complex interactions
        this.life = -1; // -1 is infinite. Used for fire.
        this.pressure = 0;
    }
}

const setPixel = (x, y, particle, changes) => {
    const key = getPixelKey(x, y);
    if (particle === null) {
        world.delete(key);
    } else {
        world.set(key, particle);
    }
    // Track the change to broadcast to clients
    changes.push({ x, y, particle });
};

const getPixel = (x, y) => world.get(getPixelKey(x, y));

const TICK_RATE = 20; // Updates per second
setInterval(() => {
    const changes = [];
    
    // Reset update flags and pressure for this tick
    world.forEach(p => { p.updatedThisTick = false; p.pressure = 0; });
    
    // Use a copy of keys to avoid issues with modification during iteration
    const keys = Array.from(world.keys());

    // --- PRESSURE CALCULATION PHASE ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        let pressure = 0;
        let currentY = y - 1;
        // Check column above for particles
        while(getPixel(x, currentY)) {
            pressure++;
            currentY--;
        }
        const pixel = getPixel(x,y);
        if(pixel) pixel.pressure = pressure;
    }
    
    // --- PHYSICS & INTERACTION PHASE ---
    for (const key of keys) {
        const [x, y] = key.split(',').map(Number);
        const pixel = getPixel(x, y);

        if (!pixel || pixel.updatedThisTick) continue;

        // --- Element-specific logic ---
        if (pixel.type === 'sand') {
            const down = getPixel(x, y + 1);
            if (!down) {
                pixel.updatedThisTick = true;
                setPixel(x, y, null, changes);
                setPixel(x, y + 1, pixel, changes);
            } else {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const downSide = getPixel(x + dir, y + 1);
                if (!downSide) {
                    pixel.updatedThisTick = true;
                    setPixel(x, y, null, changes);
                    setPixel(x + dir, y + 1, pixel, changes);
                }
            }
        } 
        else if (pixel.type === 'water') {
            const down = getPixel(x, y + 1);
            if (!down) {
                 pixel.updatedThisTick = true;
                 setPixel(x, y, null, changes);
                 setPixel(x, y + 1, pixel, changes);
            } else {
                const dir = Math.random() < 0.5 ? 1 : -1;
                const side = getPixel(x + dir, y);
                if(!side) {
                    pixel.updatedThisTick = true;
                    setPixel(x, y, null, changes);
                    setPixel(x + dir, y, pixel, changes);
                }
            }
        }
        else if (pixel.type === 'plant') {
            let waterNearby = false;
            // Check adjacent cells for water
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const neighbor = getPixel(x + dx, y + dy);
                    if (neighbor && neighbor.type === 'water') {
                        waterNearby = true;
                        break;
                    }
                }
                if(waterNearby) break;
            }

            // If water is nearby, small chance to grow
            if (waterNearby && Math.random() < 0.01) {
                const growX = x + Math.floor(Math.random() * 3) - 1;
                const growY = y + Math.floor(Math.random() * 3) - 1;
                if (!getPixel(growX, growY)) {
                    setPixel(growX, growY, new Particle('plant'), changes);
                }
            }
        }
        else if (pixel.type === 'fire') {
            pixel.life--;
            if (pixel.life <= 0) {
                setPixel(x, y, null, changes);
                continue;
            }
            
            // Spread to neighbors
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const neighbor = getPixel(x + dx, y + dy);
                    if (neighbor) {
                        if (neighbor.type === 'plant' && Math.random() < 0.25) {
                            const fireParticle = new Particle('fire');
                            fireParticle.life = Math.floor(Math.random() * 20) + 40; // New fire life
                            setPixel(x + dx, y + dy, fireParticle, changes);
                        } else if (neighbor.type === 'water' && Math.random() < 0.1) {
                            setPixel(x, y, null, changes); // Doused by water
                        }
                    }
                }
            }
        }
    }

    // Broadcast the collected changes to all clients
    if (changes.length > 0) {
        io.emit('worldUpdate', changes);
    }
}, 1000 / TICK_RATE);

// --- SERVER-SIDE NETWORKING ---
io.on('connection', (socket) => {
    console.log('A user connected.');
    
    // When a new user joins, send them the entire world state
    const fullWorld = Array.from(world.entries()).map(([key, particle]) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y, particle };
    });
    socket.emit('fullWorld', fullWorld);

    // Listen for drawing actions from clients
    socket.on('clientDraw', (data) => {
        const changes = [];
        const { x, y, radius, element } = data;
        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
                if (Math.sqrt(i*i + j*j) <= radius) {
                    const newX = x + i;
                    const newY = y + j;

                    // Handle eraser as a special case to delete particles
                    if (element === 'eraser') {
                        if (getPixel(newX, newY)) { // only delete if something is there
                           setPixel(newX, newY, null, changes);
                        }
                    } else {
                        // Create the new particle
                        const particle = new Particle(element);
                        if (element === 'fire') {
                            particle.life = Math.floor(Math.random() * 50) + 50; // Initial fire life
                        }
                        setPixel(newX, newY, particle, changes);
                    }
                }
            }
        }
        // Immediately broadcast newly drawn pixels so drawing feels responsive
        if (changes.length > 0) {
            io.emit('worldUpdate', changes);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected.');
    });
});


// --- CLIENT-SIDE HTML AND JAVASCRIPT ---
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Expanded Physics Powder Game</title>
        <style>
          body { margin: 0; overflow: hidden; font-family: Arial, sans-serif; user-select: none; }
          #game-canvas { border: 1px solid black; cursor: crosshair; background-color: #222; }
          #controls {
            position: fixed; top: 15px; left: 15px; padding: 10px;
            background-color: rgba(255, 255, 255, 0.85); border-radius: 5px;
            display: flex; align-items: center; z-index: 10;
          }
          .info-panel {
            position: fixed; bottom: 10px; right: 10px; background-color: rgba(0, 0, 0, 0.5);
            color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; text-align: right;
          }
        </style>
      </head>
      <body>
        <div id="controls">
          <label for="elementPicker">Element:</label>
          <select id="elementPicker">
            <option value="sand">Sand</option>
            <option value="water">Water</option>
            <option value="wall">Wall</option>
            <option value="plant">Plant</option>
            <option value="fire">Fire</option>
            <option value="eraser" style="color:red; font-weight:bold;">ERASER</option>
          </select>
          <label for="brushSize" style="margin-left: 15px;">Brush:</label>
          <input type="range" id="brushSize" min="1" max="10" value="3">
        </div>
        <canvas id="game-canvas"></canvas>
        <div class="info-panel">
          <div>Left-click: Draw | Right-click: Pan</div>
          <div id="zoom-level">Zoom: 100%</div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            const socket = io();
            const canvas = document.getElementById('game-canvas');
            const context = canvas.getContext('2d');
            const elementPicker = document.getElementById('elementPicker');
            const brushSizeSlider = document.getElementById('brushSize');
            const zoomLevelText = document.getElementById('zoom-level');

            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const localWorld = new Map();
            const getPixelKey = (x, y) => \`\${x},\${y}\`;
            let currentElement = 'sand';
            let brushSize = 3;

            let cameraX = 0, cameraY = 0, zoom = 5;
            const MAX_ZOOM = 20, MIN_ZOOM = 0.5;
            let isPanning = false, lastPanX = 0, lastPanY = 0;
            let isDrawing = false;
            
            const toWorldCoords = (screenX, screenY) => {
                return { 
                    x: Math.floor((screenX - cameraX) / zoom),
                    y: Math.floor((screenY - cameraY) / zoom)
                };
            };

            const redrawCanvas = () => {
                context.save();
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = '#222';
                context.fillRect(0, 0, canvas.width, canvas.height);

                context.translate(cameraX, cameraY);
                context.scale(zoom, zoom);

                for (const [key, pixel] of localWorld.entries()) {
                    const [x, y] = key.split(',').map(Number);
                    // Updated renderer for new elements
                    if (pixel.type === 'sand') context.fillStyle = '#c2b280';
                    else if (pixel.type === 'wall') context.fillStyle = '#888';
                    else if (pixel.type === 'water') context.fillStyle = '#4466ff';
                    else if (pixel.type === 'plant') context.fillStyle = '#00ab41';
                    else if (pixel.type === 'fire') {
                        const colors = ['#ff4000', '#ff8000', '#ffbf00'];
                        context.fillStyle = colors[Math.floor(Math.random() * colors.length)];
                    }
                    context.fillRect(x, y, 1, 1);
                }
                context.restore();
            };

            function renderLoop() {
                redrawCanvas();
                requestAnimationFrame(renderLoop);
            }
            requestAnimationFrame(renderLoop);

            elementPicker.addEventListener('change', (e) => currentElement = e.target.value);
            brushSizeSlider.addEventListener('input', (e) => brushSize = parseInt(e.target.value));

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const worldPosBefore = toWorldCoords(e.offsetX, e.offsetY);
                zoom *= Math.exp(-e.deltaY * 0.005);
                zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
                cameraX = e.offsetX - worldPosBefore.x * zoom;
                cameraY = e.offsetY - worldPosBefore.y * zoom;
                zoomLevelText.textContent = \`Zoom: \${Math.round(zoom * 100)}%\`;
            });

            const handleDrawing = (e) => {
                if (!isDrawing) return;
                const pos = toWorldCoords(e.offsetX, e.offsetY);
                socket.emit('clientDraw', { 
                    x: pos.x, y: pos.y, 
                    radius: brushSize, 
                    element: currentElement 
                });
            };

            canvas.addEventListener('mousedown', (e) => {
                if (e.button === 2) { isPanning = true; lastPanX = e.clientX; lastPanY = e.clientY; canvas.style.cursor = 'grabbing'; } 
                else if (e.button === 0) { isDrawing = true; handleDrawing(e); }
            });

            canvas.addEventListener('mousemove', (e) => {
                if (isPanning) {
                    cameraX += e.clientX - lastPanX;
                    cameraY += e.clientY - lastPanY;
                    lastPanX = e.clientX; lastPanY = e.clientY;
                } else if (isDrawing) {
                    handleDrawing(e);
                }
            });
            
            canvas.addEventListener('mouseup', (e) => {
                if (e.button === 2) { isPanning = false; canvas.style.cursor = 'crosshair'; } 
                else if (e.button === 0) { isDrawing = false; }
            });

            canvas.addEventListener('contextmenu', e => e.preventDefault());
            window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });

            socket.on('fullWorld', (fullWorld) => {
                localWorld.clear();
                for(const item of fullWorld) {
                    localWorld.set(getPixelKey(item.x, item.y), item.particle);
                }
            });

            socket.on('worldUpdate', (changes) => {
                for (const change of changes) {
                    const key = getPixelKey(change.x, change.y);
                    if (change.particle === null) {
                        localWorld.delete(key);
                    } else {
                        localWorld.set(key, change.particle);
                    }
                }
            });
          });
        </script>
      </body>
    </html>
  `);
});

http.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
