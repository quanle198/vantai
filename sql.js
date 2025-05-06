const fs = require('fs');

// TransportUnit data for capacity reference
const transportUnits = [
  { UnitID: 1, Capacity: 10000 },
  { UnitID: 2, Capacity: 5000 },
  { UnitID: 3, Capacity: 12000 },
  { UnitID: 4, Capacity: 4000 },
  { UnitID: 5, Capacity: 3000 },
  { UnitID: 6, Capacity: 15000 },
  { UnitID: 7, Capacity: 6000 },
  { UnitID: 8, Capacity: 2500 },
  { UnitID: 9, Capacity: 8000 },
  { UnitID: 10, Capacity: 4500 }
];

// Distance matrix (in km)
const distances = {
  '1-2': 1664.89, '2-1': 1664.89,
  '1-3': 10.64, '3-1': 10.64,
  '2-3': 1675.53, '3-2': 1675.53
};

// Generate random date in May 2025
function randomDate() {
  const day = Math.floor(Math.random() * 31) + 1; // 1 to 31
  const hour = Math.floor(Math.random() * 24);
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);
  return `2025-05-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}.000`;
}

// Generate random status
function randomStatus() {
  const rand = Math.random();
  if (rand < 0.3) return 'Pending';
  if (rand < 0.6) return 'Moving';
  return 'Completed';
}

// Generate shipment data
const shipments = [];
for (let id = 31; id <= 230; id++) {
  const shipmentDate = randomDate();
  const warehouseIds = [1, 2, 3];
  const originWarehouseID = warehouseIds[Math.floor(Math.random() * 3)];
  let destWarehouseID = warehouseIds[Math.floor(Math.random() * 3)];
  while (destWarehouseID === originWarehouseID) {
    destWarehouseID = warehouseIds[Math.floor(Math.random() * 3)];
  }
  const unitID = Math.floor(Math.random() * 10) + 1;
  const vehicle = transportUnits.find(u => u.UnitID === unitID);
  const maxWeight = vehicle.Capacity;
  const weight = Math.floor(Math.random() * (Math.min(maxWeight, 5000) - 10)) + 10;
  const status = randomStatus();
  
  let totalDistance = 0;
  let totalTime = 0;
  if (status === 'Completed') {
    totalDistance = distances[`${originWarehouseID}-${destWarehouseID}`] || 0;
    const speed = Math.random() * 30 + 30; // 30-60 km/h
    totalTime = totalDistance / speed; // Time in hours
  }

  shipments.push({
    ShipmentID: id,
    ShipmentDate: shipmentDate,
    OriginWarehouseID: originWarehouseID,
    DestWarehouseID: destWarehouseID,
    UnitID: unitID,
    Weight: weight,
    Status: status,
    TotalDistance: totalDistance.toFixed(14),
    TotalTime: totalTime.toFixed(14)
  });
}

// Generate SQL INSERT statements
let sql = 'INSERT INTO Shipment (ShipmentID, ShipmentDate, OriginWarehouseID, DestWarehouseID, UnitID, Weight, Status, TotalDistance, TotalTime) VALUES\n';
shipments.forEach((s, index) => {
  sql += `(${s.ShipmentID}, '${s.ShipmentDate}', ${s.OriginWarehouseID}, ${s.DestWarehouseID}, ${s.UnitID}, ${s.Weight}, '${s.Status}', ${s.TotalDistance}, ${s.TotalTime})`;
  sql += index < shipments.length - 1 ? ',\n' : ';';
});

// Write to file
fs.writeFileSync('Shipment.sql', sql);
console.log('Generated Shipment.sql');