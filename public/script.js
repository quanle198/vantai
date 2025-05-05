const ORS_API_KEY = '5b3ce3597851110001cf624890d06adad991446084ec1827f4f2b67d';
const map = L.map('map').setView([16, 106], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let warehouses = [];
let vehicles = [];
let vietnamPolygons = [];
let geoReady = false;
let isLoading = false;
let isSimulating = false;

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
    const updateOriginSelect = document.getElementById('updateTripOriginWarehouse');
    const updateDestSelect = document.getElementById('updateTripDestWarehouse');
    select.innerHTML = '<option value="">All Warehouses</option>';
    originSelect.innerHTML = '<option value="">Select Origin</option>';
    destSelect.innerHTML = '<option value="">Select Destination</option>';
    updateOriginSelect.innerHTML = '<option value="">Select Origin</option>';
    updateDestSelect.innerHTML = '<option value="">Select Destination</option>';

    warehouses.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.WarehouseID;
      opt.textContent = w.WarehouseName;
      select.appendChild(opt);
      originSelect.appendChild(opt.cloneNode(true));
      destSelect.appendChild(opt.cloneNode(true));
      updateOriginSelect.appendChild(opt.cloneNode(true));
      updateDestSelect.appendChild(opt.cloneNode(true));
    });

    originSelect.addEventListener('change', updateCoordsDisplay);
    destSelect.addEventListener('change', updateCoordsDisplay);
    updateOriginSelect.addEventListener('change', updateCoordsDisplay);
    updateDestSelect.addEventListener('change', updateCoordsDisplay);
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
    const updateSelect = document.getElementById('updateTripVehicleType');
    select.innerHTML = '<option value="">Select Vehicle</option>';
    updateSelect.innerHTML = '<option value="">Select Vehicle</option>';
    vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.UnitID;
      opt.textContent = v.LicensePlate;
      select.appendChild(opt);
      updateSelect.appendChild(opt.cloneNode(true));
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
  const isOrigin = select.id.includes('Origin');
  const coordsDisplay = document.getElementById(isOrigin ? (select.id.includes('update') ? 'updateOriginCoords' : 'originCoords') : (select.id.includes('update') ? 'updateDestCoords' : 'destCoords'));
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
  clearTripFormErrors();
}

// Reset Update Trip Form
function resetUpdateTripForm() {
  document.getElementById('updateTripForm').reset();
  document.getElementById('updateOriginCoords').textContent = 'Coordinates: Not selected';
  document.getElementById('updateDestCoords').textContent = 'Coordinates: Not selected';
  clearUpdateTripFormErrors();
  document.getElementById('updateTripForm').style.display = 'none';
  document.getElementById('createTripForm').style.display = 'block';
}

// Reset Vehicle Form
function resetVehicleForm() {
  document.getElementById('createVehicleForm').reset();
  clearVehicleFormErrors();
}

// Reset Update Vehicle Form
function resetUpdateVehicleForm() {
  document.getElementById('updateVehicleForm').reset();
  clearUpdateVehicleFormErrors();
  document.getElementById('updateVehicleForm').style.display = 'none';
  document.getElementById('createVehicleForm').style.display = 'block';
}

// Clear Trip Form Errors
function clearTripFormErrors() {
  document.getElementById('tripOriginWarehouseError').textContent = '';
  document.getElementById('tripDestWarehouseError').textContent = '';
  document.getElementById('tripVehicleTypeError').textContent = '';
  document.getElementById('tripDateError').textContent = '';
  document.getElementById('tripWeightError').textContent = '';
}

// Clear Update Trip Form Errors
function clearUpdateTripFormErrors() {
  document.getElementById('updateTripOriginWarehouseError').textContent = '';
  document.getElementById('updateTripDestWarehouseError').textContent = '';
  document.getElementById('updateTripVehicleTypeError').textContent = '';
  document.getElementById('updateTripDateError').textContent = '';
  document.getElementById('updateTripWeightError').textContent = '';
}

// Clear Vehicle Form Errors
function clearVehicleFormErrors() {
  document.getElementById('vehicleCodeError').textContent = '';
  document.getElementById('vehicleTypeError').textContent = '';
  document.getElementById('vehicleCapacityError').textContent = '';
  document.getElementById('vehicleLicensePlateError').textContent = '';
}

// Clear Update Vehicle Form Errors
function clearUpdateVehicleFormErrors() {
  document.getElementById('updateVehicleCodeError').textContent = '';
  document.getElementById('updateVehicleTypeError').textContent = '';
  document.getElementById('updateVehicleCapacityError').textContent = '';
  document.getElementById('updateVehicleLicensePlateError').textContent = '';
}

// Create Vehicle
async function createVehicle(event) {
  event.preventDefault();
  clearVehicleFormErrors();

  const unitCode = document.getElementById('vehicleCode').value.trim();
  const type = document.getElementById('vehicleTypeInput').value;
  const capacity = Number(document.getElementById('vehicleCapacity').value);
  const licensePlate = document.getElementById('vehicleLicensePlate').value.trim();

  let hasError = false;
  if (!unitCode) {
    document.getElementById('vehicleCodeError').textContent = 'Please enter unit code';
    hasError = true;
  }
  if (!type) {
    document.getElementById('vehicleTypeError').textContent = 'Please select vehicle type';
    hasError = true;
  }
  if (!capacity || capacity <= 0) {
    document.getElementById('vehicleCapacityError').textContent = 'Please enter a valid capacity';
    hasError = true;
  }
  if (!licensePlate) {
    document.getElementById('vehicleLicensePlateError').textContent = 'Please enter license plate';
    hasError = true;
  }
  if (hasError) return;

  const vehicle = {
    UnitCode: unitCode,
    Type: type,
    Capacity: capacity,
    LicensePlate: licensePlate
  };

  setLoading(true);
  try {
    const resp = await fetch('/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vehicle)
    });
    if (!resp.ok) {
      const errorData = await resp.json();
      if (errorData.error.includes('Unit code or license plate already exists')) {
        document.getElementById('vehicleCodeError').textContent = 'Unit code or license plate already exists';
      } else {
        throw new Error(errorData.error || 'Failed to create vehicle');
      }
      return;
    }
    showToast('Vehicle created successfully', 'success');
    resetVehicleForm();
    await loadVehicles();
  } catch (e) {
    console.error('❌ Failed to create vehicle:', e);
    showToast(`Failed to create vehicle: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// Update Vehicle
async function updateVehicle(event) {
  event.preventDefault();
  clearUpdateVehicleFormErrors();

  const unitId = document.getElementById('updateVehicleId').value;
  const unitCode = document.getElementById('updateVehicleCode').value.trim();
  const type = document.getElementById('updateVehicleTypeInput').value;
  const capacity = Number(document.getElementById('updateVehicleCapacity').value);
  const licensePlate = document.getElementById('updateVehicleLicensePlate').value.trim();

  let hasError = false;
  if (!unitCode) {
    document.getElementById('updateVehicleCodeError').textContent = 'Please enter unit code';
    hasError = true;
  }
  if (!type) {
    document.getElementById('updateVehicleTypeError').textContent = 'Please select vehicle type';
    hasError = true;
  }
  if (!capacity || capacity <= 0) {
    document.getElementById('updateVehicleCapacityError').textContent = 'Please enter a valid capacity';
    hasError = true;
  }
  if (!licensePlate) {
    document.getElementById('updateVehicleLicensePlateError').textContent = 'Please enter license plate';
    hasError = true;
  }
  if (hasError) return;

  const vehicle = {
    UnitCode: unitCode,
    Type: type,
    Capacity: capacity,
    LicensePlate: licensePlate
  };

  setLoading(true);
  try {
    const resp = await fetch(`/api/vehicles/${unitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vehicle)
    });
    if (!resp.ok) {
      const errorData = await resp.json();
      if (errorData.error.includes('Unit code or license plate already exists')) {
        document.getElementById('updateVehicleCodeError').textContent = 'Unit code or license plate already exists';
      } else {
        throw new Error(errorData.error || 'Failed to update vehicle');
      }
      return;
    }
    showToast('Vehicle updated successfully', 'success');
    resetUpdateVehicleForm();
    await loadVehicles();
  } catch (e) {
    console.error('❌ Failed to update vehicle:', e);
    showToast(`Failed to update vehicle: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// Create Trip
async function createTrip(event) {
  event.preventDefault();
  clearTripFormErrors();

  if (!geoReady) {
    showToast('Please wait for Vietnam borders to load', 'error');
    return;
  }

  const originWarehouseID = document.getElementById('tripOriginWarehouse').value;
  const destWarehouseID = document.getElementById('tripDestWarehouse').value;
  const vehicleID = document.getElementById('tripVehicleType').value;
  const tripDate = document.getElementById('tripDate').value;
  const weight = Number(document.getElementById('tripWeight').value);

  let hasError = false;
  if (!originWarehouseID) {
    document.getElementById('tripOriginWarehouseError').textContent = 'Please select origin warehouse';
    hasError = true;
  }
  if (!destWarehouseID) {
    document.getElementById('tripDestWarehouseError').textContent = 'Please select destination warehouse';
    hasError = true;
  }
  if (!vehicleID) {
    document.getElementById('tripVehicleTypeError').textContent = 'Please select vehicle';
    hasError = true;
  }
  if (!tripDate) {
    document.getElementById('tripDateError').textContent = 'Please select trip date';
    hasError = true;
  }
  if (!weight || weight <= 0) {
    document.getElementById('tripWeightError').textContent = 'Please enter a valid weight';
    hasError = true;
  }
  if (hasError) return;

  const originWarehouse = warehouses.find(w => w.WarehouseID.toString() === originWarehouseID);
  const destWarehouse = warehouses.find(w => w.WarehouseID.toString() === destWarehouseID);

  if (!originWarehouse || !originWarehouse.Lat || !originWarehouse.Lng) {
    document.getElementById('tripOriginWarehouseError').textContent = 'Invalid origin warehouse or missing coordinates';
    return;
  }
  if (!destWarehouse || !destWarehouse.Lat || !destWarehouse.Lng) {
    document.getElementById('tripDestWarehouseError').textContent = 'Invalid destination warehouse or missing coordinates';
    return;
  }

  const origin = [originWarehouse.Lat, originWarehouse.Lng];
  const dest = [destWarehouse.Lat, destWarehouse.Lng];

  if (!isInVietnam(origin[0], origin[1]) || !isInVietnam(dest[0], dest[1])) {
    document.getElementById('tripOriginWarehouseError').textContent = 'Origin or destination warehouse is outside Vietnam';
    return;
  }

  setLoading(true);
  const path = await fetchRouteORS(origin, dest);
  if (path.length < 2) {
    setLoading(false);
    document.getElementById('tripOriginWarehouseError').textContent = 'Unable to create a valid route';
    return;
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

// Update Trip
async function updateTrip(event) {
  event.preventDefault();
  clearUpdateTripFormErrors();

  if (!geoReady) {
    showToast('Please wait for Vietnam borders to load', 'error');
    return;
  }

  const shipmentId = document.getElementById('updateTripId').value;
  const originWarehouseID = document.getElementById('updateTripOriginWarehouse').value;
  const destWarehouseID = document.getElementById('updateTripDestWarehouse').value;
  const vehicleID = document.getElementById('updateTripVehicleType').value;
  const tripDate = document.getElementById('updateTripDate').value;
  const weight = Number(document.getElementById('updateTripWeight').value);

  let hasError = false;
  if (!originWarehouseID) {
    document.getElementById('updateTripOriginWarehouseError').textContent = 'Please select origin warehouse';
    hasError = true;
  }
  if (!destWarehouseID) {
    document.getElementById('updateTripDestWarehouseError').textContent = 'Please select destination warehouse';
    hasError = true;
  }
  if (!vehicleID) {
    document.getElementById('updateTripVehicleTypeError').textContent = 'Please select vehicle';
    hasError = true;
  }
  if (!tripDate) {
    document.getElementById('updateTripDateError').textContent = 'Please select trip date';
    hasError = true;
  }
  if (!weight || weight <= 0) {
    document.getElementById('updateTripWeightError').textContent = 'Please enter a valid weight';
    hasError = true;
  }
  if (hasError) return;

  const originWarehouse = warehouses.find(w => w.WarehouseID.toString() === originWarehouseID);
  const destWarehouse = warehouses.find(w => w.WarehouseID.toString() === destWarehouseID);

  if (!originWarehouse || !originWarehouse.Lat || !originWarehouse.Lng) {
    document.getElementById('updateTripOriginWarehouseError').textContent = 'Invalid origin warehouse or missing coordinates';
    return;
  }
  if (!destWarehouse || !destWarehouse.Lat || !destWarehouse.Lng) {
    document.getElementById('updateTripDestWarehouseError').textContent = 'Invalid destination warehouse or missing coordinates';
    return;
  }

  const origin = [originWarehouse.Lat, originWarehouse.Lng];
  const dest = [destWarehouse.Lat, destWarehouse.Lng];

  if (!isInVietnam(origin[0], origin[1]) || !isInVietnam(dest[0], dest[1])) {
    document.getElementById('updateTripOriginWarehouseError').textContent = 'Origin or destination warehouse is outside Vietnam';
    return;
  }

  setLoading(true);
  const path = await fetchRouteORS(origin, dest);
  if (path.length < 2) {
    setLoading(false);
    document.getElementById('updateTripOriginWarehouseError').textContent = 'Unable to create a valid route';
    return;
  }

  const shipment = {
    OriginWarehouseID: parseInt(originWarehouseID),
    DestWarehouseID: parseInt(destWarehouseID),
    VehicleID: parseInt(vehicleID),
    ShipmentDate: tripDate,
    Weight: weight
  };

  try {
    const resp = await fetch(`/api/shipments/${shipmentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shipment)
    });
    if (!resp.ok) throw new Error(await resp.text());
    showToast('Trip updated successfully', 'success');
    resetUpdateTripForm();
  } catch (e) {
    console.error('❌ Failed to update trip:', e);
    showToast(`Failed to update trip: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// Populate Update Trip Form
async function populateUpdateTripForm(shipmentId) {
  try {
    const resp = await fetch(`/api/shipments/${shipmentId}`);
    if (!resp.ok) throw new Error(await resp.text());
    const shipment = await resp.json();

    document.getElementById('updateTripId').value = shipment.ShipmentID;
    document.getElementById('updateTripOriginWarehouse').value = shipment.OriginWarehouseID;
    document.getElementById('updateTripDestWarehouse').value = shipment.DestWarehouseID;
    document.getElementById('updateTripVehicleType').value = shipment.VehicleID;
    document.getElementById('updateTripDate').value = shipment.ShipmentDate.split('T')[0];
    document.getElementById('updateTripWeight').value = shipment.Weight;

    updateCoordsDisplay({ target: document.getElementById('updateTripOriginWarehouse') });
    updateCoordsDisplay({ target: document.getElementById('updateTripDestWarehouse') });

    document.getElementById('createTripForm').style.display = 'none';
    document.getElementById('updateTripForm').style.display = 'block';
  } catch (e) {
    console.error('❌ Failed to load shipment data:', e);
    showToast(`Failed to load shipment data: ${e.message}`, 'error');
  }
}

// Populate Update Vehicle Form
async function populateUpdateVehicleForm(unitId) {
  try {
    const resp = await fetch(`/api/vehicles/${unitId}`);
    if (!resp.ok) throw new Error(await resp.text());
    const vehicle = await resp.json();

    document.getElementById('updateVehicleId').value = vehicle.UnitID;
    document.getElementById('updateVehicleCode').value = vehicle.UnitCode;
    document.getElementById('updateVehicleTypeInput').value = vehicle.Type;
    document.getElementById('updateVehicleCapacity').value = vehicle.Capacity;
    document.getElementById('updateVehicleLicensePlate').value = vehicle.LicensePlate;

    document.getElementById('createVehicleForm').style.display = 'none';
    document.getElementById('updateVehicleForm').style.display = 'block';
  } catch (e) {
    console.error('❌ Failed to load vehicle data:', e);
    showToast(`Failed to load vehicle data: ${e.message}`, 'error');
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
      <span class="modal-close">×</span>
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
            <th>Total Distance (km)</th>
            <th>Current Weight (kg)</th>
            <th>History</th>
            <th>Actions</th>
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
    const vehicleId = v.segments[v.currentSegment || 0]?.vehicleId || v.vehicleId || '';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${v.plate}</td>
      <td id="status-${v.plate}">${v.status || 'Idle'}</td>
      <td id="distance-${v.plate}">${v.totalDist.toFixed(2)}</td>
      <td id="weight-${v.plate}">${v.currentWeight || 0}</td>
      <td><button class="history-btn" data-shipment-id="${shipmentId}" data-vehicle-code="${v.plate}" ${!shipmentId ? 'disabled' : ''}>View History</button></td>
      <td>
        <button class="edit-btn" data-shipment-id="${shipmentId}" data-vehicle-id="${vehicleId}" ${!shipmentId ? 'disabled' : ''}>Edit Trip</button>
        <button class="edit-btn" data-vehicle-id="${vehicleId}" ${!vehicleId ? 'disabled' : ''}>Edit Vehicle</button>
      </td>
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

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const shipmentId = btn.getAttribute('data-shipment-id');
      const vehicleId = btn.getAttribute('data-vehicle-id');
      if (shipmentId) {
        populateUpdateTripForm(shipmentId);
      } else if (vehicleId) {
        populateUpdateVehicleForm(vehicleId);
      }
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
        vehicleId: s.UnitID,
        segments: [],
        totalDist: s.TotalDistance || 0,
        div: null,
        marker: null,
        status: s.Status,
        currentSegment: null,
        currentWeight: 0
      };
    }
    byVeh[s.ShipmentID].segments.push({
      shipmentId: s.ShipmentID,
      vehicleId: s.UnitID,
      origin: [s.OriginLat, s.OriginLng],
      dest: [s.DestLat, s.DestLng],
      weight: s.Weight,
      date: s.ShipmentDate,
      status: s.Status,
      totalDistance: s.TotalDistance || 0
    });
  });

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

  updateStatusTable(byVeh);

  let pendingShipments = Object.keys(byVeh).length;

  for (const [code, v] of Object.entries(byVeh)) {
    let acc = 0;
    v.currentSegment = 0;
    for (let segIdx = 0; segIdx < v.segments.length; segIdx++) {
      const seg = v.segments[segIdx];
      if (seg.status === 'Completed') {
        const path = await fetchRouteORS(seg.origin, seg.dest);
        L.polyline(path, { color: 'green', weight: seg.weight / 1000 + 1, dashArray: '5, 10' }).addTo(map);
        v.currentWeight = seg.weight;
        v.status = 'Completed';
        v.currentSegment = segIdx;
        v.totalDist = seg.totalDistance;
        updateStatusTable(byVeh);
        pendingShipments--;
        if (pendingShipments === 0) {
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

          pendingShipments--;
          if (pendingShipments === 0) {
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
  document.getElementById('cancelTripForm').addEventListener('click', resetTripForm);
  document.getElementById('updateTripForm').addEventListener('submit', updateTrip);
  document.getElementById('cancelUpdateTripForm').addEventListener('click', resetUpdateTripForm);
  document.getElementById('createVehicleForm').addEventListener('submit', createVehicle);
  document.getElementById('cancelVehicleForm').addEventListener('click', resetVehicleForm);
  document.getElementById('updateVehicleForm').addEventListener('submit', updateVehicle);
  document.getElementById('cancelUpdateVehicleForm').addEventListener('click', resetUpdateVehicleForm);
  document.getElementById('loadData').addEventListener('click', loadData);
  document.getElementById('refreshPage').addEventListener('click', () => {
    location.reload();
  });
});