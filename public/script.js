const ORS_API_KEY = '5b3ce3597851110001cf624890d06adad991446084ec1827f4f2b67d';

const map = L.map('map').setView([16, 106], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Biến toàn cục lưu danh sách kho
let warehouses = [];
let verhicles = [];

// Haversine
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r) * Math.cos(lat2*r) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let vietnamPolygons = [];
let geoReady = false;

// Kiểm tra điểm có nằm trong Việt Nam (polygon)
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

function isInVietnam(lat, lon) {
  if (!geoReady) return false;
  return vietnamPolygons.some(polygon => isPointInPolygon([lon, lat], polygon));
}

// Tải GeoJSON Việt Nam
async function loadVietnamGeoJSON() {
  try {
    const response = await fetch('../vietnam.geojson');
    const geojson = await response.json();
    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach(f => extractPolygons(f.geometry));
    } else {
      extractPolygons(geojson.geometry || geojson);
    }
    geoReady = true;
    drawVietnamBorder();
    console.log('✅ Tải GeoJSON thành công');
  } catch (e) {
    console.error('❌ Lỗi tải GeoJSON:', e);
  }
}

// Tách polygon/multipolygon
function extractPolygons(geometry) {
  if (geometry.type === "Polygon") {
    vietnamPolygons.push(geometry.coordinates[0]);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(poly => vietnamPolygons.push(poly[0]));
  }
}

// Vẽ biên giới Việt Nam
function drawVietnamBorder() {
  vietnamPolygons.forEach(polygon => {
    L.polygon(polygon.map(([x, y]) => [y, x]), {
      color: 'red', weight: 1, fill: false
    }).addTo(map);
  });
}

// Gọi ngay khi mở trang
loadVietnamGeoJSON();

// Lấy route từ ORS
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
    console.error('❌ ORS lỗi:', e);
    alert('Lỗi khi lấy đường đi: ' + e.message);
    // Nếu lỗi, trả về đường thẳng giữa 2 điểm
    return [orig, dest];
  }
}

// Tải danh sách kho và hiển thị tọa độ
async function loadWarehouses() {
  try {
    warehouses = await fetch('/api/warehouses').then(r => r.json());
    const select = document.getElementById('destWarehouse');
    const originSelect = document.getElementById('tripOriginWarehouse');
    const destSelect = document.getElementById('tripDestWarehouse');
    select.innerHTML = '<option value="">Tất cả</option>';
    originSelect.innerHTML = '<option value="">Chọn kho xuất phát</option>';
    destSelect.innerHTML = '<option value="">Chọn kho đích</option>';
    warehouses.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.WarehouseID;
      opt.textContent = w.WarehouseName;
      select.appendChild(opt);
      originSelect.appendChild(opt.cloneNode(true));
      destSelect.appendChild(opt.cloneNode(true));
    });

    // Thêm sự kiện change để hiển thị tọa độ
    originSelect.addEventListener('change', () => {
      const warehouseID = originSelect.value;
      const warehouse = warehouses.find(w => w.WarehouseID.toString() === warehouseID);
      const coordsDisplay = document.getElementById('originCoords');
      if (warehouse && warehouse.Lat && warehouse.Lng) {
        coordsDisplay.textContent = `Tọa độ: ${warehouse.Lat.toFixed(6)}, ${warehouse.Lng.toFixed(6)}`;
      } else {
        coordsDisplay.textContent = warehouseID ? 'Tọa độ: Không có dữ liệu' : 'Tọa độ: Chưa chọn';
      }
    });

    destSelect.addEventListener('change', () => {
      const warehouseID = destSelect.value;
      const warehouse = warehouses.find(w => w.WarehouseID.toString() === warehouseID);
      const coordsDisplay = document.getElementById('destCoords');
      if (warehouse && warehouse.Lat && warehouse.Lng) {
        coordsDisplay.textContent = `Tọa độ: ${warehouse.Lat.toFixed(6)}, ${warehouse.Lng.toFixed(6)}`;
      } else {
        coordsDisplay.textContent = warehouseID ? 'Tọa độ: Không có dữ liệu' : 'Tọa độ: Chưa chọn';
      }
    });
  } catch (e) {
    console.error('❌ Lỗi tải kho:', e);
  }
}

async function loadVehicles() {
  try {
    verhicles = await fetch('/api/vehicles').then(r => r.json());
    const select = document.getElementById('tripVehicleType');
    select.innerHTML = '<option value="">Chọn xe xuất phát</option>';
    verhicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.UnitID;
      opt.textContent = v.LicensePlate;
      select.appendChild(opt);
    });

    
  } catch (e) {
    console.error('❌ Lỗi tải xe:', e);
  }
}

// Reset form tạo chuyến đi
function resetTripForm() {
  document.getElementById('createTripForm').reset();
  document.getElementById('originCoords').textContent = 'Tọa độ: Chưa chọn';
  document.getElementById('destCoords').textContent = 'Tọa độ: Chưa chọn';
}

// Tạo chuyến đi mới
async function createTrip(event) {
  event.preventDefault();
  if (!geoReady) {
    alert('Vui lòng đợi tải xong biên giới Việt Nam!');
    return;
  }

  const originWarehouseID = document.getElementById('tripOriginWarehouse').value;
  const destWarehouseID = document.getElementById('tripDestWarehouse').value;
  const vehicleID = document.getElementById('tripVehicleType').value;
  const tripDate = document.getElementById('tripDate').value;
  const weight = Number(document.getElementById('tripWeight').value);

  if (!originWarehouseID) {
    alert('Vui lòng chọn kho xuất phát!');
    return;
  }
  if (!destWarehouseID) {
    alert('Vui lòng chọn kho đích!');
    return;
  }
  if (!tripDate) {
    alert('Vui lòng chọn ngày khởi hành!');
    return;
  }
  if (!weight || weight <= 0) {
    alert('Vui lòng nhập trọng lượng hợp lệ!');
    return;
  }

  // Lấy tọa độ từ kho
  const originWarehouse = warehouses.find(w => w.WarehouseID.toString() === originWarehouseID);
  const destWarehouse = warehouses.find(w => w.WarehouseID.toString() === destWarehouseID);

  if (!originWarehouse || !originWarehouse.Lat || !originWarehouse.Lng) {
    alert('Kho xuất phát không hợp lệ hoặc thiếu tọa độ!');
    return;
  }
  if (!destWarehouse || !destWarehouse.Lat || !destWarehouse.Lng) {
    alert('Kho đích không hợp lệ hoặc thiếu tọa độ!');
    return;
  }

  const origin = [originWarehouse.Lat, originWarehouse.Lng];
  const dest = [destWarehouse.Lat, destWarehouse.Lng];

  // Kiểm tra tọa độ trong Việt Nam
  if (!isInVietnam(origin[0], origin[1]) || !isInVietnam(dest[0], dest[1])) {
    alert('Kho xuất phát hoặc kho đích không nằm trong Việt Nam!');
    return;
  }

  // Xác nhận trước khi tạo
  const confirmMsg = `Xác nhận tạo chuyến đi:\n- Từ: ${originWarehouse.WarehouseName} (${origin.join(',')})\n- Đến: ${destWarehouse.WarehouseName} (${dest.join(',')})\n- Loại xe: ${vehicleType}\n- Ngày: ${tripDate}\n- Trọng lượng: ${weight} kg`;
  if (!confirm(confirmMsg)) {
    return;
  }

  // Gọi ORS để kiểm tra tuyến đường
  const path = await fetchRouteORS(origin, dest);
  if (path.length < 2) {
    alert('Không thể tạo tuyến đường hợp lệ!');
    return;
  }

  // Gửi dữ liệu chuyến đi đến backend
  const shipment = {
    OriginLat: origin[0],
    OriginLng: origin[1],
    DestLat: dest[0],
    DestLng: dest[1],
    OriginWarehouseID: originWarehouseID,
    DestWarehouseID: destWarehouseID,
    VehicleID: vehicleID,
    ShipmentDate: tripDate,
    Weight: weight,
    WarehouseID: destWarehouseID
  };

  try {
    const resp = await fetch('/api/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shipment)
    });
    if (!resp.ok) {
      throw new Error(await resp.text());
    }
    alert('Tạo chuyến đi thành công!');
    resetTripForm();
    //loadData();
  } catch (e) {
    console.error('❌ Lỗi tạo chuyến đi:', e);
    alert('Lỗi khi tạo chuyến đi: ' + e.message);
  }
}

// Tải dữ liệu shipment
async function loadData() {
  if (!geoReady) {
    alert('Vui lòng đợi tải xong biên giới Việt Nam!');
    return;
  }

  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const vehicleType = document.getElementById('vehicleType').value;
  const destWarehouse = document.getElementById('destWarehouse').value;
  if (!start || !end) return alert('Vui lòng chọn ngày');

  const query = new URLSearchParams({ start, end, vehicleType, destWarehouse }).toString();
  const shipments = await fetch(`/api/shipments?${query}`).then(r => r.json());

  const byVeh = {};
  shipments.forEach(s => {
    const code = s.LicensePlate;
    if (!byVeh[code]) {
      byVeh[code] = { plate: s.UnitCode, segments: [], totalDist: 0, div: null, marker: null };
    }
    byVeh[code].segments.push({
      origin: [s.OriginLat, s.OriginLng],
      dest: [s.DestLat, s.DestLng],
      weight: s.Weight,
      date: s.ShipmentDate
    });
  });

  // Xóa layer cũ
  map.eachLayer(l => { if (l instanceof L.Polyline || l instanceof L.Marker) map.removeLayer(l); });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  document.getElementById('info').innerHTML = '';

  const allPts = [];
  Object.entries(byVeh).forEach(([code, v]) => {
    const box = document.createElement('div');
    box.className = 'vehicle-info';
    box.innerHTML = `<b>Xe ${code}</b><br><span id="mv-${code}">Chưa chạy</span>`;
    document.getElementById('info').append(box);
    v.div = document.getElementById(`mv-${code}`);

    const [lat0, lon0] = v.segments[0].origin;
    v.marker = L.marker([lat0, lon0]).addTo(map).bindTooltip(`Xe ${code}`, { permanent: true, direction: 'right' });

    v.segments.forEach(seg => {
      allPts.push(seg.origin, seg.dest);
    });
  });

  if (allPts.length) {
    map.fitBounds(L.latLngBounds(allPts).pad(0.2));
  }

  // Thống kê biểu đồ
  const daily = {};
  for (const [code, v] of Object.entries(byVeh)) {
    let acc = 0;
    for (const seg of v.segments) {
      const day = seg.date.substr(0, 10);
      daily[day] = (daily[day] || 0) + seg.weight;
      const path = await fetchRouteORS(seg.origin, seg.dest);
      L.polyline(path, { color: 'blue', weight: seg.weight/1000 + 1 }).addTo(map);
      drawVietnamBorder();
      for (let i = 1; i < path.length; i++) {
        const [lat1, lon1] = path[i-1], [lat2, lon2] = path[i];
        const d = haversine(lat1, lon1, lat2, lon2);
        const speed = Math.random() * 30 + 30;
        const t = d / speed * 3600 * 1000;
        v.totalDist += d;
        acc += t;
        setTimeout(() => {
          v.marker.setLatLng(path[i]);
          v.div.innerText = `Speed: ${speed.toFixed(1)} km/h | Đoạn: ${d.toFixed(2)} km | Tổng: ${v.totalDist.toFixed(2)} km`;
        }, acc);
      }
    }
  }

  const labels = Object.keys(daily).sort();
  const values = labels.map(d => daily[d]);
  new Chart(document.getElementById('chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Tổng KG', data: values }] },
    options: { responsive: true }
  });
}

// Tải dữ liệu khi mở trang
document.addEventListener('DOMContentLoaded', () => {
  loadWarehouses();
  loadVehicles();
});