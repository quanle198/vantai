const ORS_API_KEY = '5b3ce3597851110001cf624890d06adad991446084ec1827f4f2b67d';
const map = L.map('map').setView([16, 106], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let warehouses = [];
let vehicles = [];
let vietnamPolygons = [];
let geoReady = false;
let isLoading = false;
let isSimulating = false; // Biến để theo dõi trạng thái giả lập

// Haversine Formula
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r) * Math.cos(lat2*r) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Point-in-Polygon Check
function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Check if Point is in Vietnam
function isInVietnam(lat, lon) {
  if (!geoReady) return false;
  return vietnamPolygons.some(polygon => isPointInPolygon([lon, lat], polygon));
}

// Load Vietnam GeoJSON
async function loadVietnamGeoJSON() {
  try {
    const response = await fetch('/vietnam.geojson');
    const geojson = await response.json();
    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach(f => extractPolygons(f.geometry));
    } else {
      extractPolygons(geojson.geometry || geojson);
    }
    geoReady = true;
    drawVietnamBorder();
    console.log('✅ Loaded Vietnam GeoJSON');
  } catch (e) {
    console.error('❌ Failed to load GeoJSON:', e);
    showToast('Failed to load Vietnam borders', 'error');
  }
}

// Extract Polygons
function extractPolygons(geometry) {
  if (geometry.type === "Polygon") {
    vietnamPolygons.push(geometry.coordinates[0]);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(poly => vietnamPolygons.push(poly[0]));
  }
}

// Draw Vietnam Border
function drawVietnamBorder() {
  vietnamPolygons.forEach(polygon => {
    L.polygon(polygon.map(([x, y]) => [y, x]), {
      color: 'red', weight: 1, fill: false
    }).addTo(map);
  });
}

// Fetch ORS Route via Backend
async function fetchRouteORS(orig, dest) {
  if (!isInVietnam(orig[0], orig[1]) || !isInVietnam(dest[0], dest[1])) {
    console.warn('Điểm ngoài Việt Nam, dùng đường thẳng');
    return [orig, dest];
  }

  const body = {
    coordinates: [[orig[1], orig[0]], [dest[1], dest[0]]],
    preference: 'recommended',
    geometry_simplify: true,
    options: {
      avoid_borders: 'all',
      avoid_countries: [11, 193]
    }
  };

  while (true) {
    try {
      const resp = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ORS_API_KEY
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        throw new Error(await resp.text());
      }

      const geo = await resp.json();
      let path = geo.features[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      path = path.filter(([lat, lon]) => isInVietnam(lat, lon));
      return path.length >= 2 ? path : [orig, dest];
    } catch (e) {
      console.error('❌ ORS lỗi, thử lại:', e);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Load Warehouses
async function loadWarehouses() {
  try {
    warehouses = await fetch('/api/warehouses').then(r => r.json());
    const select = document.getElementById('destWarehouse');
    const originSelect = document.getElementById('tripOriginWarehouse');
    const destSelect = document.getElementById('tripDestWarehouse');
    select.innerHTML = '<option value="">All Warehouses</option>';
    originSelect.innerHTML = '<option value="">Select Origin</option>';
    destSelect.innerHTML = '<option value="">Select Destination</option>';

    warehouses.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.WarehouseID;
      opt.textContent = w.WarehouseName;
      select.appendChild(opt);
      originSelect.appendChild(opt.cloneNode(true));
      destSelect.appendChild(opt.cloneNode(true));
    });

    originSelect.addEventListener('change', updateCoordsDisplay);
    destSelect.addEventListener('change', updateCoordsDisplay);
  } catch (e) {
    console.error('❌ Failed to load warehouses:', e);
    showToast('Failed to load warehouses', 'error');
  }
}

// Load Vehicles
async function loadVehicles() {
  try {
    vehicles = await fetch('/api/vehicles').then(r => r.json());
    const select = document.getElementById('tripVehicleType');
    select.innerHTML = '<option value="">Select Vehicle</option>';
    vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.UnitID;
      opt.textContent = v.LicensePlate;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('❌ Failed to load vehicles:', e);
    showToast('Failed to load vehicles', 'error');
  }
}

// Update Coordinates Display
function updateCoordsDisplay(e) {
  const select = e.target;
  const warehouseID = select.value;
  const isOrigin = select.id === 'tripOriginWarehouse';
  const coordsDisplay = document.getElementById(isOrigin ? 'originCoords' : 'destCoords');
  const warehouse = warehouses.find(w => w.WarehouseID.toString() === warehouseID);
  if (warehouse && warehouse.Lat && warehouse.Lng) {
    coordsDisplay.textContent = `Coordinates: ${warehouse.Lat.toFixed(6)}, ${warehouse.Lng.toFixed(6)}`;
  } else {
    coordsDisplay.textContent = warehouseID ? 'Coordinates: No data' : 'Coordinates: Not selected';
  }
}

// Reset Trip Form
function resetTripForm() {
  document.getElementById('createTripForm').reset();
  document.getElementById('originCoords').textContent = 'Coordinates: Not selected';
  document.getElementById('destCoords').textContent = 'Coordinates: Not selected';
}

// Create Trip
async function createTrip(event) {
  event.preventDefault();
  if (!geoReady) {
    showToast('Please wait for Vietnam borders to load', 'error');
    return;
  }

  const originWarehouseID = document.getElementById('tripOriginWarehouse').value;
  const destWarehouseID = document.getElementById('tripDestWarehouse').value;
  const vehicleID = document.getElementById('tripVehicleType').value;
  const tripDate = document.getElementById('tripDate').value;
  const weight = Number(document.getElementById('tripWeight').value);

  if (!originWarehouseID) return showToast('Please select origin warehouse', 'error');
  if (!destWarehouseID) return showToast('Please select destination warehouse', 'error');
  if (!vehicleID) return showToast('Please select vehicle', 'error');
  if (!tripDate) return showToast('Please select trip date', 'error');
  if (!weight || weight <= 0) return showToast('Please enter a valid weight', 'error');

  const originWarehouse = warehouses.find(w => w.WarehouseID.toString() === originWarehouseID);
  const destWarehouse = warehouses.find(w => w.WarehouseID.toString() === destWarehouseID);

  if (!originWarehouse || !originWarehouse.Lat || !originWarehouse.Lng) {
    return showToast('Invalid origin warehouse or missing coordinates', 'error');
  }
  if (!destWarehouse || !destWarehouse.Lat || !destWarehouse.Lng) {
    return showToast('Invalid destination warehouse or missing coordinates', 'error');
  }

  const origin = [originWarehouse.Lat, originWarehouse.Lng];
  const dest = [destWarehouse.Lat, destWarehouse.Lng];

  if (!isInVietnam(origin[0], origin[1]) || !isInVietnam(dest[0], dest[1])) {
    return showToast('Origin or destination warehouse is outside Vietnam', 'error');
  }

  setLoading(true);
  const path = await fetchRouteORS(origin, dest);
  if (path.length < 2) {
    setLoading(false);
    return showToast('Unable to create a valid route', 'error');
  }

  const shipment = {
    OriginWarehouseID: parseInt(originWarehouseID),
    DestWarehouseID: parseInt(destWarehouseID),
    VehicleID: parseInt(vehicleID),
    ShipmentDate: tripDate,
    Weight: weight
  };

  try {
    const resp = await fetch('/api/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shipment)
    });
    if (!resp.ok) throw new Error(await resp.text());
    showToast('Trip created successfully', 'success');
    resetTripForm();
  } catch (e) {
    console.error('❌ Failed to create trip:', e);
    showToast(`Failed to create trip: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// Update Shipment Status and TotalDistance
async function updateShipmentStatus(shipmentId, status, totalDistance) {
  try {
    const resp = await fetch(`/api/shipments/${shipmentId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, totalDistance })
    });
    if (!resp.ok) throw new Error(await resp.text());
    console.log(`✅ Shipment ${shipmentId} updated: Status=${status}, TotalDistance=${totalDistance}`);
  } catch (e) {
    console.error(`❌ Failed to update shipment ${shipmentId}:`, e);
    showToast(`Failed to update shipment: ${e.message}`, 'error');
  }
}

// Fetch Shipment History
async function fetchShipmentHistory(shipmentId) {
  try {
    const resp = await fetch(`/api/shipments/${shipmentId}/history`);
    if (!resp.ok) throw new Error(await resp.text());
    return await resp.json();
  } catch (e) {
    console.error(`❌ Failed to fetch history for shipment ${shipmentId}:`, e);
    showToast(`Failed to fetch shipment history: ${e.message}`, 'error');
    return [];
  }
}

// Show Shipment History Modal
async function showShipmentHistory(shipmentId, vehicleCode) {
  const history = await fetchShipmentHistory(shipmentId);
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="modal-close">&times;</span>
      <h3>Shipment History for Vehicle ${vehicleCode}</h3>
      <table class="history-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Total Distance (km)</th>
            <th>Change Time</th>
          </tr>
        </thead>
        <tbody>
          ${history.length ? history.map(h => `
            <tr>
              <td>${h.Status}</td>
              <td>${h.TotalDistance.toFixed(2)}</td>
              <td>${new Date(h.ChangeTime).toLocaleString('vi-VN', { timeZone: 'UTC' })}</td>
            </tr>
          `).join('') : '<tr><td colspan="3">No history available</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-close').addEventListener('click', () => {
    modal.remove();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Update Status Table
function updateStatusTable(byVeh) {
  const table = document.getElementById('statusTable');
  if (!table) {
    const tableContainer = document.createElement('div');
    tableContainer.id = 'statusTableContainer';
    tableContainer.innerHTML = `
      <h3>Vehicle Status</h3>
      <table id="statusTable">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Status</th>
            <th>Current Segment</th>
            <th>Total Distance (km)</th>
            <th>Current Weight (kg)</th>
            <th>History</th>
          </tr>
        </thead>
        <tbody id="statusTableBody"></tbody>
      </table>
    `;
    document.getElementById('info').prepend(tableContainer);
  }

  const tbody = document.getElementById('statusTableBody');
  tbody.innerHTML = '';

  Object.entries(byVeh).forEach(([code, v]) => {
    const shipmentId = v.segments[v.currentSegment || 0]?.shipmentId || '';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${v.plate}</td>
      <td id="status-${v.plate}">${v.status || 'Idle'}</td>
      <td id="segment-${v.plate}">${v.currentSegment !== null ? v.currentSegment + 1 : '-'}</td>
      <td id="distance-${v.plate}">${v.totalDist.toFixed(2)}</td>
      <td id="weight-${v.plate}">${v.currentWeight || 0}</td>
      <td><button class="history-btn" data-shipment-id="${shipmentId}" data-vehicle-code="${v.plate}" ${!shipmentId ? 'disabled' : ''}>View History</button></td>
    `;
    tbody.appendChild(row);
  });

  document.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const shipmentId = btn.getAttribute('data-shipment-id');
      const vehicleCode = btn.getAttribute('data-vehicle-code');
      if (shipmentId) showShipmentHistory(shipmentId, vehicleCode);
    });
  });
}

// Load and Visualize Shipments
async function loadData() {
  if (!geoReady) {
    showToast('Please wait for Vietnam borders to load', 'error');
    return;
  }
  if (isSimulating) {
    showToast('Simulation is still running. Please wait until completion.', 'info');
    return;
  }

  const date = document.getElementById('date').value;
  const vehicleType = document.getElementById('vehicleType').value;
  const destWarehouse = document.getElementById('destWarehouse').value;

  if (!date) {
    showToast('Please select date', 'error');
    return;
  }

  // Khóa nút Load Data
  const loadDataBtn = document.getElementById('loadData');
  loadDataBtn.disabled = true;
  loadDataBtn.style.background = '#ccc';
  loadDataBtn.style.cursor = 'not-allowed';
  isSimulating = true;

  setLoading(true);
  const query = new URLSearchParams({ date, vehicleType, destWarehouse }).toString();
  let shipments;
  try {
    shipments = await fetch(`/api/shipments?${query}`).then(r => r.json());
    if (shipments.length === 0) {
      showToast('No shipments found for the selected criteria', 'info');
      setLoading(false);
      resetLoadDataButton();
      return;
    }
  } catch (e) {
    showToast('Failed to load shipments', 'error');
    setLoading(false);
    resetLoadDataButton();
    return;
  }

  const byVeh = {};
  shipments.forEach(s => {
    const code = s.LicensePlate;
    if (!byVeh[s.ShipmentID]) {
      byVeh[s.ShipmentID] = {
        plate: s.LicensePlate,
        segments: [],
        totalDist: s.TotalDistance || 0,
        div: null,
        marker: null,
        status: 'Idle',
        currentSegment: null,
        currentWeight: 0
      };
    }
    byVeh[s.ShipmentID].segments.push({
      shipmentId: s.ShipmentID,
      origin: [s.OriginLat, s.OriginLng],
      dest: [s.DestLat, s.DestLng],
      weight: s.Weight,
      date: s.ShipmentDate,
      status: s.Status,
      totalDistance: s.TotalDistance || 0
    });
  });

  // Clear Map Layers
  map.eachLayer(l => {
    if (l instanceof L.Polyline || l instanceof L.Marker) map.removeLayer(l);
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  document.getElementById('info').innerHTML = '';

  const allPts = [];
  Object.entries(byVeh).forEach(([code, v]) => {
    const box = document.createElement('div');
    box.className = 'vehicle-info';
    box.innerHTML = `<b>Vehicle ${v.plate}</b><br><span id="mv-${code}">Not started</span>`;
    document.getElementById('info').append(box);
    v.div = document.getElementById(`mv-${code}`);

    const [lat0, lon0] = v.segments[0].origin;
    v.marker = L.marker([lat0, lon0]).addTo(map).bindTooltip(`Vehicle ${v.plate}`, {
      permanent: true,
      direction: 'right'
    });

    v.segments.forEach(seg => allPts.push(seg.origin, seg.dest));
  });

  if (allPts.length) {
    map.fitBounds(L.latLngBounds(allPts).pad(0.2));
  }

  // Initialize Status Table
  updateStatusTable(byVeh);

  // Theo dõi số lượng chuyến đi chưa hoàn tất
  let pendingShipments = Object.keys(byVeh).length;

  // Animate Routes for Pending/Moving Shipments
  for (const [code, v] of Object.entries(byVeh)) {
    let acc = 0;
    v.currentSegment = 0;
    for (let segIdx = 0; segIdx < v.segments.length; segIdx++) {
      const seg = v.segments[segIdx];
      if (seg.status === 'Completed') {
        // Vẽ đường cho Completed nhưng không chạy giả lập
        const path = await fetchRouteORS(seg.origin, seg.dest);
        L.polyline(path, { color: 'green', weight: seg.weight / 1000 + 1, dashArray: '5, 10' }).addTo(map);
        v.currentWeight = seg.weight;
        v.status = 'Completed';
        v.currentSegment = segIdx;
        v.totalDist = seg.totalDistance;
        updateStatusTable(byVeh);
        // Giảm số lượng chuyến đi chưa hoàn tất
        pendingShipments--;
        if (pendingShipments === 0) {
          // Tất cả các chuyến đi đã hoàn tất, mở khóa nút
          resetLoadDataButton();
          showToast('All shipments completed', 'success');
        }
        continue;
      }

      v.currentWeight = seg.weight;
      v.status = 'Moving';
      if (seg.status === 'Pending') {
        await updateShipmentStatus(seg.shipmentId, 'Moving', v.totalDist);
        seg.status = 'Moving';
      }

      const path = await fetchRouteORS(seg.origin, seg.dest);
      L.polyline(path, { color: 'blue', weight: seg.weight / 1000 + 1 }).addTo(map);
      drawVietnamBorder();
      let segmentDistance = 0;
      for (let i = 1; i < path.length; i++) {
        const [lat1, lon1] = path[i - 1], [lat2, lon2] = path[i];
        const d = haversine(lat1, lon1, lat2, lon2);
        segmentDistance += d;
        const speed = Math.random() * 30 + 30;
        const t = (d / speed * 3600 * 1000) / 100;
        v.totalDist += d;
        acc += t;

        setTimeout(() => {
          v.marker.setLatLng(path[i]);
          v.div.innerText = `Speed: ${speed.toFixed(1)} km/h | Segment: ${d.toFixed(2)} km | Total: ${v.totalDist.toFixed(2)} km | Weight: ${seg.weight} kg`;
        }, acc);
      }
      seg.totalDistance = segmentDistance;
      updateStatusTable(byVeh);

      if (segIdx === v.segments.length - 1) {
        setTimeout(async () => {
          v.status = 'Completed';
          v.currentSegment = null;
          v.currentWeight = 0;
          await updateShipmentStatus(seg.shipmentId, 'Completed', v.totalDist);
          updateStatusTable(byVeh);

          // Giảm số lượng chuyến đi chưa hoàn tất
          pendingShipments--;
          if (pendingShipments === 0) {
            // Tất cả các chuyến đi đã hoàn tất, mở khóa nút
            resetLoadDataButton();
            showToast('All shipments completed', 'success');
          }
        }, acc);
      } else {
        v.currentSegment = segIdx + 1;
      }
    }
  }

  setLoading(false);
}

// Hàm để reset trạng thái nút Load Data
function resetLoadDataButton() {
  const loadDataBtn = document.getElementById('loadData');
  loadDataBtn.disabled = false;
  loadDataBtn.style.background = '#007bff';
  loadDataBtn.style.cursor = 'pointer';
  isSimulating = false;
}

// Update Chart
function updateChart(shipments) {
  const daily = {};
  shipments.forEach(s => {
    const day = s.ShipmentDate.substr(0, 10);
    daily[day] = (daily[day] || 0) + s.Weight;
  });

  const labels = Object.keys(daily).sort();
  const values = labels.map(d => daily[d]);

  new Chart(document.getElementById('chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Total Weight (kg)', data: values, backgroundColor: 'rgba(40, 167, 69, 0.5)' }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Weight (kg)' } },
        x: { title: { display: true, text: 'Date' } }
      }
    }
  });
}

// Show Toast Notification
function showToast(message, type = 'info') {
  Toastify({
    text: message,
    duration: 3000,
    gravity: 'top',
    position: 'right',
    backgroundColor: type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#007bff',
    stopOnFocus: true
  }).showToast();
}

// Set Loading State
function setLoading(state) {
  isLoading = state;
  document.getElementById('loading').style.display = state ? 'flex' : 'none';
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadVietnamGeoJSON();
  await Promise.all([loadWarehouses(), loadVehicles()]);
  document.getElementById('createTripForm').addEventListener('submit', createTrip);
  document.getElementById('resetTripForm').addEventListener('click', resetTripForm);
  document.getElementById('loadData').addEventListener('click', loadData);
  document.getElementById('refreshPage').addEventListener('click', () => {
    location.reload();
  });
});