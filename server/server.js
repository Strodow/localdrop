const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;

// Serve the client-side files
const clientPath = path.join(__dirname, '../public');
console.log(`Serving static files from: ${clientPath}`);
app.use(express.static(clientPath));

// A map to store connected clients (peers)
const clients = new Map();

const adjectives = ["Clever", "Brave", "Wise", "Swift", "Gentle", "Silent", "Witty", "Keen"];
const nouns = ["Fox", "Badger", "Owl", "Eagle", "Lion", "Tiger", "Bear", "Wolf"];

function getLanIp() {
    // Allow overriding the IP via an environment variable for Docker
    if (process.env.HOST_IP) {
        return process.env.HOST_IP;
    }

    const nets = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                candidates.push({ name, address: net.address });
            }
        }
    }

    if (candidates.length === 0) return '0.0.0.0';

    // Prefer interfaces that don't seem virtual (like 'vEthernet' or 'VirtualBox')
    const physical = candidates.filter(c => !/virtual|vethernet/i.test(c.name));
    if (physical.length > 0) {
        return physical[0].address;
    }

    // If all interfaces seem virtual, just return the first one found.
    return candidates[0].address;
}

function generateUniqueId() {
    return Math.random().toString(36).substring(2, 9);
}

function generateRandomName() {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

wss.on('connection', (ws) => {
    const id = generateUniqueId();
    const name = generateRandomName();
    const metadata = { id, name };

    clients.set(ws, metadata);
    console.log(`New client connected: ${name} (${id})`);

    // Send the new client their generated info and the list of current users
    const currentUsers = Array.from(clients.values());
    const serverIp = getLanIp();
    ws.send(JSON.stringify({ type: 'welcome', user: metadata, allUsers: currentUsers, serverIp }));

    // Notify all other clients that a new user has joined
    const joinMessage = JSON.stringify({ type: 'user-joined', user: metadata });
    for (const [client, clientMeta] of clients.entries()) {
        if (client !== ws && client.readyState === ws.OPEN) {
            client.send(joinMessage);
        }
    }

    ws.on('message', (messageAsString) => {
        const message = JSON.parse(messageAsString);
        console.log(`Received message from ${metadata.name}:`, message);

        // When a message is received, forward it to the intended recipient
        const recipientSocket = [...clients.entries()].find(([ws, user]) => user.id === message.to)?.[0];

        if (recipientSocket && recipientSocket.readyState === recipientSocket.OPEN) {
            // Add the sender's ID to the message so the recipient knows who it's from
            message.from = metadata.id;
            recipientSocket.send(JSON.stringify(message));
            console.log(`Forwarded message to user with id: ${message.to}`);
        } else {
            console.log(`Could not find or send to recipient: ${message.to}`);
        }
    });

    ws.on('close', () => {
        const clientThatLeft = clients.get(ws);
        console.log(`Client disconnected: ${clientThatLeft.name} (${clientThatLeft.id})`);
        clients.delete(ws);
        const leaveMessage = JSON.stringify({ type: 'user-left', id: clientThatLeft.id });
        for (const [client] of clients.entries()) {
            client.send(leaveMessage);
        }
    });
});

server.listen(PORT, () => {
    const ip = getLanIp();
    console.log(`Server is listening on http://localhost:${PORT} and on your network at http://${ip}:${PORT}`);
});