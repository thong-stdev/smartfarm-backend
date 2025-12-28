/**
 * Smart Farm Backend Server with Supabase
 * =========================================
 * 
 * API Endpoints:
 * - GET  /api/devices         - รายการอุปกรณ์ทั้งหมด
 * - GET  /api/devices/:id     - ข้อมูลอุปกรณ์แต่ละตัว
 * - POST /api/devices         - เพิ่มอุปกรณ์ใหม่
 * - DELETE /api/devices/:id   - ลบอุปกรณ์
 * - POST /api/devices/:id/pump - ควบคุมปั๊ม
 * - POST /api/devices/:id/data - รับข้อมูลจาก ESP32
 * 
 * Real-time: Socket.io สำหรับอัพเดท Dashboard
 * MQTT: สำหรับสื่อสารกับ ESP32
 * Database: Supabase (PostgreSQL)
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Create Express app
const app = express();
const server = http.createServer(app);

// Socket.io for real-time updates
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
const publicPath = path.join(__dirname, 'public');
const dashboardPath = path.join(__dirname, '../SmartFarm_Dashboard');
app.use(express.static(fs.existsSync(publicPath) ? publicPath : dashboardPath));

// ==================== Supabase Configuration ====================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
let useDatabase = false;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    useDatabase = true;
    console.log('✅ Supabase connected!');
} else {
    console.log('⚠️ Supabase not configured - using in-memory storage');
}

// ==================== In-Memory Fallback ====================
let memoryDevices = [
    {
        id: "device_001",
        name: "สวนหน้าบ้าน",
        zone: "garden",
        zone_label: "🌳 สวน",
        ip: "192.168.0.110",
        status: "online",
        temperature: 32.5,
        humidity: 65,
        soil_moisture: 78,
        pump_active: false,
        mode: "auto",
        last_update: new Date()
    }
];

let memorySensorHistory = {};

// ==================== Offline Detection ====================
const OFFLINE_TIMEOUT = 20000; // 20 seconds without data = offline
let deviceLastSeen = {}; // Track when each device last sent data

function checkOfflineDevices() {
    const now = Date.now();

    memoryDevices.forEach(async (device) => {
        const lastSeen = deviceLastSeen[device.id];

        if (lastSeen && (now - lastSeen) > OFFLINE_TIMEOUT) {
            if (device.status !== 'offline') {
                device.status = 'offline';
                console.log(`⚠️ Device ${device.id} marked as OFFLINE (no data for 60s)`);

                // Update database if using Supabase
                if (useDatabase && supabase) {
                    await supabase
                        .from('devices')
                        .update({ status: 'offline', last_update: new Date().toISOString() })
                        .eq('id', device.id);
                }

                // Notify dashboard
                io.emit('deviceUpdate', { ...device, status: 'offline' });
            }
        }
    });
}

// Check for offline devices every 30 seconds
setInterval(checkOfflineDevices, 30000);

// Auth moved to Auth Routes section

// ==================== Database Functions ====================

// Get all devices
async function getDevices() {
    if (useDatabase) {
        const { data, error } = await supabase
            .from('devices')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('DB Error:', error);
            return memoryDevices;
        }
        return data.map(mapDeviceFromDB);
    }
    return memoryDevices;
}

// Get single device
async function getDevice(id) {
    if (useDatabase) {
        const { data, error } = await supabase
            .from('devices')
            .select('*')
            .eq('id', id)
            .single();

        if (error) return null;
        return mapDeviceFromDB(data);
    }
    return memoryDevices.find(d => d.id === id);
}

// Create device
async function createDevice(device) {
    if (useDatabase) {
        const dbDevice = mapDeviceToDB(device);
        const { data, error } = await supabase
            .from('devices')
            .insert(dbDevice)
            .select()
            .single();

        if (error) {
            console.error('DB Error:', error);
            return null;
        }
        return mapDeviceFromDB(data);
    }
    memoryDevices.push(device);
    return device;
}

// Update device
async function updateDevice(id, updates) {
    if (useDatabase) {
        const dbUpdates = {};
        if (updates.temperature !== undefined) dbUpdates.temperature = updates.temperature;
        if (updates.humidity !== undefined) dbUpdates.humidity = updates.humidity;
        if (updates.soilMoisture !== undefined) dbUpdates.soil_moisture = updates.soilMoisture;
        if (updates.pumpActive !== undefined) dbUpdates.pump_active = updates.pumpActive;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.mode !== undefined) dbUpdates.mode = updates.mode;
        dbUpdates.last_update = new Date().toISOString();

        const { data, error } = await supabase
            .from('devices')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('DB Error:', error);
            return null;
        }
        return mapDeviceFromDB(data);
    }

    const device = memoryDevices.find(d => d.id === id);
    if (device) {
        Object.assign(device, updates, { lastUpdate: new Date() });
    }
    return device;
}

// Delete device
async function deleteDevice(id) {
    if (useDatabase) {
        const { error } = await supabase
            .from('devices')
            .delete()
            .eq('id', id);

        return !error;
    }
    const index = memoryDevices.findIndex(d => d.id === id);
    if (index !== -1) {
        memoryDevices.splice(index, 1);
        return true;
    }
    return false;
}

// Store sensor history
async function storeSensorHistory(deviceId, data) {
    if (useDatabase) {
        const { error } = await supabase
            .from('sensor_history')
            .insert({
                device_id: deviceId,
                temperature: data.temperature,
                humidity: data.humidity,
                soil_moisture: data.soilPercent,
                pump_active: data.pumpActive
            });

        if (error) console.error('History Error:', error);
    } else {
        if (!memorySensorHistory[deviceId]) {
            memorySensorHistory[deviceId] = [];
        }
        memorySensorHistory[deviceId].push({
            timestamp: new Date(),
            temperature: data.temperature,
            humidity: data.humidity,
            soilMoisture: data.soilPercent
        });
        // Keep only last 720 records
        if (memorySensorHistory[deviceId].length > 720) {
            memorySensorHistory[deviceId].shift();
        }
    }
}

// Get sensor history with optional date filtering
async function getSensorHistory(deviceId, options = {}) {
    const { limit = 1000, startDate, endDate } = options;

    if (useDatabase) {
        let query = supabase
            .from('sensor_history')
            .select('*')
            .eq('device_id', deviceId)
            .order('recorded_at', { ascending: false });

        // Apply date filters if provided
        if (startDate) {
            query = query.gte('recorded_at', startDate);
        }
        if (endDate) {
            query = query.lte('recorded_at', endDate);
        }

        // Apply limit
        query = query.limit(limit);

        const { data, error } = await query;

        if (error) return [];
        return data.map(h => ({
            timestamp: h.recorded_at,
            temperature: h.temperature,
            humidity: h.humidity,
            soilMoisture: h.soil_moisture
        })).reverse();
    }

    // Memory fallback with date filtering
    let history = memorySensorHistory[deviceId] || [];
    if (startDate || endDate) {
        history = history.filter(h => {
            const ts = new Date(h.timestamp).getTime();
            if (startDate && ts < new Date(startDate).getTime()) return false;
            if (endDate && ts > new Date(endDate).getTime()) return false;
            return true;
        });
    }
    return history.slice(-limit);
}

// Map device from DB to API format
function mapDeviceFromDB(dbDevice) {
    return {
        id: dbDevice.id,
        name: dbDevice.name,
        zone: dbDevice.zone,
        zoneLabel: dbDevice.zone_label,
        ip: dbDevice.ip,
        status: dbDevice.status,
        temperature: dbDevice.temperature,
        humidity: dbDevice.humidity,
        soilMoisture: dbDevice.soil_moisture,
        pumpActive: dbDevice.pump_active,
        mode: dbDevice.mode,
        lastUpdate: dbDevice.last_update
    };
}

// Map device to DB format
function mapDeviceToDB(device) {
    return {
        id: device.id,
        name: device.name,
        zone: device.zone || 'garden',
        zone_label: device.zoneLabel || '🌳 สวน',
        ip: device.ip,
        status: device.status || 'offline',
        temperature: device.temperature || 0,
        humidity: device.humidity || 0,
        soil_moisture: device.soilMoisture || 0,
        pump_active: device.pumpActive || false,
        mode: device.mode || 'auto'
    };
}

// ==================== MQTT Configuration ====================
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const MQTT_TOPIC_PREFIX = 'smartfarm';

let mqttClient = null;

function connectMQTT() {
    console.log('📡 Connecting to MQTT broker:', MQTT_BROKER);

    mqttClient = mqtt.connect(MQTT_BROKER);

    mqttClient.on('connect', () => {
        console.log('✅ MQTT Connected!');
        mqttClient.subscribe(`${MQTT_TOPIC_PREFIX}/+/data`);
        mqttClient.subscribe(`${MQTT_TOPIC_PREFIX}/+/status`);
        console.log(`📥 Subscribed to ${MQTT_TOPIC_PREFIX}/+/data`);
    });

    mqttClient.on('message', async (topic, message) => {
        try {
            const parts = topic.split('/');
            const deviceId = parts[1];
            const messageType = parts[2];
            const data = JSON.parse(message.toString());

            console.log(`📨 MQTT: ${topic}`, data);

            if (messageType === 'data') {
                await handleDeviceData(deviceId, data);
            } else if (messageType === 'status') {
                await handleDeviceStatus(deviceId, data);
            }
        } catch (error) {
            console.error('MQTT Parse Error:', error);
        }
    });

    mqttClient.on('error', (error) => {
        console.error('❌ MQTT Error:', error);
    });
}

async function handleDeviceData(deviceId, data) {
    // Track last seen time for offline detection
    deviceLastSeen[deviceId] = Date.now();

    const updates = {
        temperature: data.temperature,
        humidity: data.humidity,
        soilMoisture: data.soilPercent,
        pumpActive: data.pumpActive || false,
        status: data.pumpActive ? 'watering' : 'online'
    };

    const device = await updateDevice(deviceId, updates);
    if (device) {
        await storeSensorHistory(deviceId, data);
        io.emit('deviceUpdate', device);
    }
}

async function handleDeviceStatus(deviceId, data) {
    const device = await updateDevice(deviceId, { status: data.status });
    if (device) {
        io.emit('deviceUpdate', device);
    }
}

// ==================== API Routes ====================

// ==================== Authentication ====================
const bcrypt = require('bcryptjs');

// Simple token store
let activeTokens = {};

function generateToken() {
    return 'token_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// In-Memory Users Fallback
let memoryUsers = [
    {
        id: 'user_admin',
        username: 'admin',
        passwordHash: bcrypt.hashSync('admin123', 8),
        role: 'admin',
        createdAt: new Date()
    }
];

// ==================== Auth Routes ====================

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    let user = null;

    // 1. Try Supabase Custom Table
    if (useDatabase && supabase) {
        const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .eq('username', username)
            .single();

        if (!error && data) {
            // Check password
            const isValid = bcrypt.compareSync(password, data.password_hash);
            if (isValid) {
                user = { id: data.id, username: data.username, role: data.role };
            }
        }
    }

    // 2. Fallback to Memory
    if (!user) {
        const memUser = memoryUsers.find(u => u.username === username);
        if (memUser && bcrypt.compareSync(password, memUser.passwordHash)) {
            user = { id: memUser.id, username: memUser.username, role: memUser.role };
        }
    }

    if (!user) {
        return res.status(401).json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const token = generateToken();
    activeTokens[token] = user;

    res.json({
        success: true,
        token,
        user
    });
});

// Register
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ' });
    }

    if (password.length < 4) {
        return res.status(400).json({ success: false, error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' });
    }

    const passwordHash = bcrypt.hashSync(password, 8);

    // 1. Try Supabase Custom Table
    if (useDatabase && supabase) {
        // Check duplicate
        const { data: existing } = await supabase.from('app_users').select('id').eq('username', username).single();
        if (existing) {
            return res.status(400).json({ success: false, error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
        }

        const { error } = await supabase.from('app_users').insert({
            username,
            password_hash: passwordHash,
            role: 'user'
        });

        if (error) {
            return res.status(500).json({ success: false, error: 'สมัครสมาชิกไม่สำเร็จ: ' + error.message });
        }

        return res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
    }

    // 2. Fallback to Memory
    if (memoryUsers.find(u => u.username === username)) {
        return res.status(400).json({ success: false, error: 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
    }

    memoryUsers.push({
        id: `user_${Date.now()}`,
        username,
        passwordHash,
        role: 'user',
        createdAt: new Date()
    });

    res.json({ success: true, message: 'สมัครสมาชิกสำเร็จ' });
});

// Verify
app.get('/api/auth/verify', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !activeTokens[token]) {
        return res.status(401).json({ success: false, error: 'Token Invalid' });
    }
    res.json({ success: true, user: activeTokens[token] });
});

// ==================== Device Routes ====================

// Get all devices
app.get('/api/devices', async (req, res) => {
    const devices = await getDevices();
    res.json({
        success: true,
        data: devices,
        count: devices.length
    });
});

// Get single device
app.get('/api/devices/:id', async (req, res) => {
    const device = await getDevice(req.params.id);

    if (!device) {
        return res.status(404).json({
            success: false,
            error: 'Device not found'
        });
    }

    res.json({
        success: true,
        data: device
    });
});

// Add new device
app.post('/api/devices', async (req, res) => {
    const { name, zone, ip } = req.body;

    if (!name || !ip) {
        return res.status(400).json({
            success: false,
            error: 'Name and IP are required'
        });
    }

    const zoneLabels = {
        garden: '🌳 สวน',
        balcony: '🏠 ระเบียง',
        greenhouse: '🏡 โรงเรือน',
        indoor: '🪴 ในร่ม'
    };

    const newDevice = {
        id: `device_${Date.now()}`,
        name,
        zone: zone || 'garden',
        zoneLabel: zoneLabels[zone] || '🌳 สวน',
        ip,
        status: 'offline',
        temperature: 0,
        humidity: 0,
        soilMoisture: 0,
        pumpActive: false,
        mode: 'auto'
    };

    const created = await createDevice(newDevice);
    if (!created) {
        return res.status(500).json({
            success: false,
            error: 'Failed to create device'
        });
    }

    io.emit('deviceAdded', created);
    console.log('➕ Device added:', created.name);

    res.status(201).json({
        success: true,
        data: created
    });
});

// Delete device
app.delete('/api/devices/:id', async (req, res) => {
    const device = await getDevice(req.params.id);
    if (!device) {
        return res.status(404).json({
            success: false,
            error: 'Device not found'
        });
    }

    const deleted = await deleteDevice(req.params.id);
    if (!deleted) {
        return res.status(500).json({
            success: false,
            error: 'Failed to delete device'
        });
    }

    io.emit('deviceDeleted', { id: req.params.id });
    console.log('🗑️ Device deleted:', device.name);

    res.json({
        success: true,
        message: 'Device deleted'
    });
});

// Control pump
app.post('/api/devices/:id/pump', async (req, res) => {
    const { action } = req.body;
    const device = await getDevice(req.params.id);

    if (!device) {
        return res.status(404).json({
            success: false,
            error: 'Device not found'
        });
    }

    const turnOn = action === 'on';

    // Send command via MQTT
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(
            `${MQTT_TOPIC_PREFIX}/${device.id}/command`,
            JSON.stringify({ pump: turnOn })
        );
        console.log(`📤 MQTT: Sent pump ${action} to ${device.name}`);
    }

    // Update database
    const updated = await updateDevice(req.params.id, {
        pumpActive: turnOn,
        status: turnOn ? 'watering' : 'online'
    });

    io.emit('deviceUpdate', updated);

    res.json({
        success: true,
        message: `Pump turned ${action}`,
        data: updated
    });
});

// Set device mode
app.post('/api/devices/:id/mode', async (req, res) => {
    const { mode } = req.body;
    const device = await getDevice(req.params.id);

    if (!device) {
        return res.status(404).json({
            success: false,
            error: 'Device not found'
        });
    }

    // Send mode change via MQTT
    if (mqttClient && mqttClient.connected) {
        mqttClient.publish(
            `${MQTT_TOPIC_PREFIX}/${device.id}/command`,
            JSON.stringify({ mode })
        );
    }

    const updated = await updateDevice(req.params.id, { mode });
    io.emit('deviceUpdate', updated);

    res.json({
        success: true,
        message: `Mode set to ${mode}`,
        data: updated
    });
});

// Receive data from ESP32 (HTTP fallback)
app.post('/api/devices/:id/data', async (req, res) => {
    await handleDeviceData(req.params.id, req.body);
    res.json({ success: true });
});

// Get sensor history with optional date filtering
// Query params: limit, startDate, endDate
app.get('/api/devices/:id/history', async (req, res) => {
    const { limit, startDate, endDate } = req.query;

    const options = {
        limit: limit ? parseInt(limit) : 1000,
        startDate: startDate || null,
        endDate: endDate || null
    };

    const history = await getSensorHistory(req.params.id, options);
    res.json({
        success: true,
        data: history,
        count: history.length,
        filters: {
            limit: options.limit,
            startDate: options.startDate,
            endDate: options.endDate
        }
    });
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    const devices = await getDevices();
    const stats = {
        total: devices.length,
        online: devices.filter(d => d.status !== 'offline').length,
        watering: devices.filter(d => d.status === 'watering' || d.pumpActive).length,
        alerts: devices.filter(d => d.soilMoisture < 30 && d.status !== 'offline').length
    };

    res.json({
        success: true,
        data: stats
    });
});

// Serve Login page as default
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// ==================== Socket.io Events ====================
io.on('connection', async (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Send current devices list
    const devices = await getDevices();
    socket.emit('initialData', { devices });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });

    // Listen for pump control from client
    socket.on('pumpControl', async ({ deviceId, action }) => {
        const turnOn = action === 'on';

        // Send via MQTT
        if (mqttClient && mqttClient.connected) {
            mqttClient.publish(
                `${MQTT_TOPIC_PREFIX}/${deviceId}/command`,
                JSON.stringify({ pump: turnOn })
            );
        }

        const updated = await updateDevice(deviceId, {
            pumpActive: turnOn,
            status: turnOn ? 'watering' : 'online'
        });

        if (updated) {
            io.emit('deviceUpdate', updated);
        }
    });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  🌱 Smart Farm Backend Server Started! 🌱     ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('');
    console.log(`   🌐 Dashboard:  http://localhost:${PORT}`);
    console.log(`   📡 API:        http://localhost:${PORT}/api`);
    console.log(`   💾 Database:   ${useDatabase ? 'Supabase' : 'In-Memory'}`);
    console.log('');

    // Connect to MQTT
    connectMQTT();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    if (mqttClient) mqttClient.end();
    server.close();
    process.exit(0);
});
