-- ==========================================
-- Smart Farm Database Schema (Custom Auth)
-- ==========================================

-- ==================== USERS TABLE ====================
-- Custom table for family use (Username/Password)
CREATE TABLE IF NOT EXISTS app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user', -- 'admin', 'user'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== DEVICES TABLE ====================
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone TEXT DEFAULT 'garden',
  zone_label TEXT DEFAULT '🌳 สวน',
  ip TEXT,
  status TEXT DEFAULT 'offline',
  temperature REAL DEFAULT 0,
  humidity REAL DEFAULT 0,
  soil_moisture INTEGER DEFAULT 0,
  pump_active BOOLEAN DEFAULT FALSE,
  mode TEXT DEFAULT 'auto',
  owner_id UUID REFERENCES app_users(id), -- Owner of the device
  last_update TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== SENSOR HISTORY TABLE ====================
CREATE TABLE IF NOT EXISTS sensor_history (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
  temperature REAL,
  humidity REAL,
  soil_moisture INTEGER,
  pump_active BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_devices_owner_id ON devices(owner_id);
CREATE INDEX IF NOT EXISTS idx_sensor_history_device_id ON sensor_history(device_id);
CREATE INDEX IF NOT EXISTS idx_sensor_history_recorded_at ON sensor_history(recorded_at DESC);

-- ==================== DEFAULT DATA ====================
-- Insert default device
INSERT INTO devices (id, name, zone, zone_label, ip, status, temperature, humidity, soil_moisture)
VALUES ('device_001', 'สวนหน้าบ้าน', 'garden', '🌳 สวน', '192.168.0.110', 'online', 32.5, 65, 78)
ON CONFLICT (id) DO NOTHING;
