// ==================== Configuration ====================
const API_URL = window.location.origin; // ใช้ URL เดียวกับ Dashboard
const REFRESH_INTERVAL = 5000;

// ==================== State ====================
let devices = [];
let selectedDevice = null;
let historyChart = null;
let socket = null;

// ==================== Initialize ====================
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  fetchDevices();
  startAutoRefresh();
});

// ==================== Socket.io Connection ====================
function initSocket() {
  // Load Socket.io from server
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.onload = () => {
    socket = io();

    socket.on('connect', () => {
      console.log('🔌 Socket connected');
    });

    socket.on('initialData', (data) => {
      devices = data.devices;
      renderDevices();
      updateStats();
    });

    socket.on('deviceUpdate', (device) => {
      const index = devices.findIndex(d => d.id === device.id);
      if (index !== -1) {
        devices[index] = device;
      }
      renderDevices();
      updateStats();
    });

    socket.on('deviceAdded', (device) => {
      devices.push(device);
      renderDevices();
      updateStats();
      showNotification('✅ เพิ่มอุปกรณ์สำเร็จ', 'success');
    });

    socket.on('deviceDeleted', ({ id }) => {
      devices = devices.filter(d => d.id !== id);
      renderDevices();
      updateStats();
    });
  };
  document.head.appendChild(script);
}

// ==================== API Functions ====================
async function fetchDevices() {
  try {
    const response = await fetch(`${API_URL}/api/devices`);
    const result = await response.json();

    if (result.success) {
      devices = result.data;
      renderDevices();
      updateStats();
    }
  } catch (error) {
    console.error('Failed to fetch devices:', error);
    // Use demo data if API fails
    useDemoData();
  }
}

async function fetchStats() {
  try {
    const response = await fetch(`${API_URL}/api/stats`);
    const result = await response.json();

    if (result.success) {
      document.getElementById('total-devices').textContent = result.data.total;
      document.getElementById('online-devices').textContent = result.data.online;
      document.getElementById('watering-devices').textContent = result.data.watering;
      document.getElementById('alert-devices').textContent = result.data.alerts;
    }
  } catch (error) {
    updateStats();
  }
}

// ==================== Render Devices ====================
function renderDevices() {
  const container = document.getElementById('devices-container');
  container.innerHTML = devices.map(device => createDeviceCard(device)).join('');
}

function createDeviceCard(device) {
  const statusClass = getStatusClass(device.status);
  const statusText = getStatusText(device.status);
  const soilClass = getSoilClass(device.soilMoisture);

  return `
    <div class="device-card" onclick="openDeviceDetail('${device.id}')">
      <div class="device-header">
        <div class="device-info">
          <h3>${device.name}</h3>
          <span class="device-zone">${device.zoneLabel} • ${device.ip || 'N/A'}</span>
        </div>
        <span class="device-status ${statusClass}">
          ${statusText}
        </span>
      </div>
      
      <div class="device-sensors">
        <div class="sensor-item">
          <span class="sensor-icon">🌡️</span>
          <span class="sensor-value">${device.status === 'offline' ? '--' : device.temperature?.toFixed(1) || '--'}°C</span>
          <span class="sensor-label">อุณหภูมิ</span>
        </div>
        <div class="sensor-item">
          <span class="sensor-icon">💧</span>
          <span class="sensor-value">${device.status === 'offline' ? '--' : device.humidity?.toFixed(0) || '--'}%</span>
          <span class="sensor-label">ความชื้น</span>
        </div>
        <div class="sensor-item">
          <span class="sensor-icon">🌱</span>
          <span class="sensor-value">${device.status === 'offline' ? '--' : device.soilMoisture || '--'}%</span>
          <span class="sensor-label">ดิน</span>
        </div>
      </div>
      
      <div class="soil-bar-container">
        <div class="soil-bar-label">
          <span>ความชื้นดิน</span>
          <span>${device.status === 'offline' ? '--' : (device.soilMoisture || 0) + '%'}</span>
        </div>
        <div class="soil-bar">
          <div class="soil-bar-fill ${soilClass}" style="width: ${device.status === 'offline' ? 0 : device.soilMoisture || 0}%"></div>
        </div>
      </div>
      
      <div class="device-actions" onclick="event.stopPropagation()">
        <button class="btn btn-success" onclick="togglePump('${device.id}', true)" ${device.status === 'offline' ? 'disabled' : ''}>
          💦 เปิด
        </button>
        <button class="btn btn-danger" onclick="togglePump('${device.id}', false)" ${device.status === 'offline' ? 'disabled' : ''}>
          🛑 ปิด
        </button>
        <button class="btn btn-secondary" onclick="deleteDevice('${device.id}')" title="ลบอุปกรณ์">
          🗑️
        </button>
      </div>
    </div>
  `;
}

// ==================== Status Helpers ====================
function getStatusClass(status) {
  switch (status) {
    case 'online': return 'status-online';
    case 'offline': return 'status-offline';
    case 'watering': return 'status-watering';
    default: return 'status-online';
  }
}

function getStatusText(status) {
  switch (status) {
    case 'online': return '🟢 ออนไลน์';
    case 'offline': return '🔴 ออฟไลน์';
    case 'watering': return '💦 กำลังรด';
    default: return '🟢 ออนไลน์';
  }
}

function getSoilClass(moisture) {
  if (moisture < 30) return 'soil-low';
  if (moisture < 70) return 'soil-medium';
  return 'soil-high';
}

// ==================== Update Stats ====================
function updateStats() {
  const total = devices.length;
  const online = devices.filter(d => d.status !== 'offline').length;
  const watering = devices.filter(d => d.status === 'watering' || d.pumpActive).length;
  const alerts = devices.filter(d => d.soilMoisture < 30 && d.status !== 'offline').length;

  document.getElementById('total-devices').textContent = total;
  document.getElementById('online-devices').textContent = online;
  document.getElementById('watering-devices').textContent = watering;
  document.getElementById('alert-devices').textContent = alerts;
}

// ==================== Pump Control ====================
async function togglePump(deviceId, turnOn) {
  try {
    const response = await fetch(`${API_URL}/api/devices/${deviceId}/pump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: turnOn ? 'on' : 'off' })
    });

    const result = await response.json();

    if (result.success) {
      showNotification(turnOn ? '💦 เปิดปั๊มแล้ว' : '🛑 ปิดปั๊มแล้ว', 'success');

      // Update local state
      const device = devices.find(d => d.id === deviceId);
      if (device) {
        device.pumpActive = turnOn;
        device.status = turnOn ? 'watering' : 'online';
        renderDevices();
        updateStats();
      }
    }
  } catch (error) {
    console.error('Pump control failed:', error);
    showNotification('❌ ไม่สามารถควบคุมปั๊มได้', 'error');
  }
}

// ==================== Add Device ====================
function openAddDeviceModal() {
  document.getElementById('add-device-modal').classList.add('active');
}

function closeAddDeviceModal() {
  document.getElementById('add-device-modal').classList.remove('active');
  document.getElementById('device-name').value = '';
  document.getElementById('device-ip').value = '';
}

async function addDevice(event) {
  event.preventDefault();

  const name = document.getElementById('device-name').value;
  const ip = document.getElementById('device-ip').value;
  const zone = document.getElementById('device-zone').value;

  try {
    const response = await fetch(`${API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip, zone })
    });

    const result = await response.json();

    if (result.success) {
      closeAddDeviceModal();
      // Socket will handle the update
    } else {
      showNotification('❌ ' + result.error, 'error');
    }
  } catch (error) {
    console.error('Add device failed:', error);
    showNotification('❌ ไม่สามารถเพิ่มอุปกรณ์ได้', 'error');
  }
}

// ==================== Delete Device ====================
async function deleteDevice(deviceId) {
  if (!confirm('ต้องการลบอุปกรณ์นี้?')) return;

  try {
    const response = await fetch(`${API_URL}/api/devices/${deviceId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      showNotification('🗑️ ลบอุปกรณ์แล้ว', 'success');
    }
  } catch (error) {
    console.error('Delete device failed:', error);
    showNotification('❌ ไม่สามารถลบอุปกรณ์ได้', 'error');
  }
}

// ==================== Device Detail Modal ====================
async function openDeviceDetail(deviceId) {
  selectedDevice = devices.find(d => d.id === deviceId);
  if (!selectedDevice) return;

  document.getElementById('detail-device-name').textContent = selectedDevice.name;
  document.getElementById('detail-temp').textContent = (selectedDevice.temperature?.toFixed(1) || '--') + '°C';
  document.getElementById('detail-humidity').textContent = (selectedDevice.humidity?.toFixed(0) || '--') + '%';
  document.getElementById('detail-soil').textContent = (selectedDevice.soilMoisture || '--') + '%';

  // Update mode buttons
  document.getElementById('mode-auto').classList.toggle('active', selectedDevice.mode === 'auto');
  document.getElementById('mode-manual').classList.toggle('active', selectedDevice.mode === 'manual');

  document.getElementById('device-detail-modal').classList.add('active');

  // Fetch and display history
  await fetchDeviceHistory(deviceId);
}

function closeDetailModal() {
  document.getElementById('device-detail-modal').classList.remove('active');
  selectedDevice = null;
}

async function fetchDeviceHistory(deviceId, startDate = null, endDate = null) {
  try {
    let url = `${API_URL}/api/devices/${deviceId}/history?limit=10000`;

    if (startDate) {
      url += `&startDate=${encodeURIComponent(startDate)}`;
    }
    if (endDate) {
      url += `&endDate=${encodeURIComponent(endDate)}`;
    }

    const response = await fetch(url);
    const result = await response.json();

    if (result.success && result.data.length > 0) {
      // Sample data to show max 60 points for readability
      const sampledData = sampleData(result.data, 60);
      initHistoryChart(sampledData);
    } else {
      initHistoryChart([]);
    }
  } catch (error) {
    initHistoryChart([]);
  }
}

// Sample data to reduce points for chart readability
function sampleData(data, maxPoints) {
  if (data.length <= maxPoints) return data;

  const step = Math.ceil(data.length / maxPoints);
  const sampled = [];

  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[i]);
  }

  // Always include the last point
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]);
  }

  return sampled;
}

// Apply preset time range filter
function applyHistoryPreset() {
  const preset = document.getElementById('history-preset').value;

  if (!selectedDevice) return;

  const now = new Date();
  let startDate;

  switch (preset) {
    case '1h':
      startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
      break;
    case '6h':
      startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      break;
    case '24h':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  fetchDeviceHistory(selectedDevice.id, startDate.toISOString(), now.toISOString());
}

function controlPump(turnOn) {
  if (!selectedDevice) return;
  togglePump(selectedDevice.id, turnOn);
}

// ==================== Mode Control ====================
async function setMode(mode) {
  if (!selectedDevice) return;

  try {
    const response = await fetch(`${API_URL}/api/devices/${selectedDevice.id}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });

    const result = await response.json();

    if (result.success) {
      selectedDevice.mode = mode;
      document.getElementById('mode-auto').classList.toggle('active', mode === 'auto');
      document.getElementById('mode-manual').classList.toggle('active', mode === 'manual');
      showNotification(mode === 'auto' ? '🔄 โหมดอัตโนมัติ' : '✋ โหมดควบคุมเอง', 'info');
    }
  } catch (error) {
    console.error('Set mode failed:', error);
  }
}

// Event listeners for mode buttons
document.getElementById('mode-auto')?.addEventListener('click', () => setMode('auto'));
document.getElementById('mode-manual')?.addEventListener('click', () => setMode('manual'));

// ==================== History Chart ====================
function initHistoryChart(historyData) {
  const ctx = document.getElementById('historyChart');
  if (!ctx) return;

  if (historyChart) {
    historyChart.destroy();
  }

  let labels, tempData, soilData;

  if (historyData.length > 0) {
    labels = historyData.map(d => {
      const date = new Date(d.timestamp);
      return date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    });
    tempData = historyData.map(d => d.temperature);
    soilData = historyData.map(d => d.soilMoisture);
  } else {
    // Generate demo data
    labels = [];
    tempData = [];
    soilData = [];

    for (let i = 23; i >= 0; i--) {
      const hour = new Date();
      hour.setHours(hour.getHours() - i);
      labels.push(hour.getHours() + ':00');
      tempData.push(28 + Math.random() * 6);
      soilData.push(30 + Math.random() * 60);
    }
  }

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'อุณหภูมิ (°C)',
          data: tempData,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          tension: 0.4,
          fill: true
        },
        {
          label: 'ความชื้นดิน (%)',
          data: soilData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// ==================== Auto Refresh ====================
function startAutoRefresh() {
  setInterval(() => {
    if (!socket || !socket.connected) {
      fetchDevices();
    }
  }, REFRESH_INTERVAL);
}

// ==================== Demo Data (Fallback) ====================
function useDemoData() {
  devices = [
    {
      id: "demo_001",
      name: "สวนหน้าบ้าน",
      zone: "garden",
      zoneLabel: "🌳 สวน",
      ip: "192.168.0.110",
      status: "online",
      temperature: 32.5,
      humidity: 65,
      soilMoisture: 78,
      pumpActive: false,
      mode: "auto"
    },
    {
      id: "demo_002",
      name: "สวนหลังบ้าน",
      zone: "garden",
      zoneLabel: "🌳 สวน",
      ip: "192.168.0.111",
      status: "watering",
      temperature: 30.2,
      humidity: 58,
      soilMoisture: 25,
      pumpActive: true,
      mode: "auto"
    }
  ];

  renderDevices();
  updateStats();
}

// ==================== View Toggle ====================
function setView(view, e) {
  const buttons = document.querySelectorAll('.view-toggle button');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (e && e.target) e.target.classList.add('active');

  const grid = document.getElementById('devices-container');
  if (view === 'list') {
    grid.style.gridTemplateColumns = '1fr';
  } else {
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(320px, 1fr))';
  }
}

// ==================== Notifications ====================
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 16px 24px;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 8px;
    font-weight: 500;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    z-index: 2000;
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = message;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ==================== Keyboard & Click Events ====================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAddDeviceModal();
    closeDetailModal();
  }
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAddDeviceModal();
      closeDetailModal();
    }
  });
});
