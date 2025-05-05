const express = require('express');
const sql = require('mssql');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// SQL Server Configuration
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  options: {
    encrypt: process.env.NODE_ENV === 'production',
    trustServerCertificate: process.env.NODE_ENV !== 'production'
  }
};

// Initialize SQL Connection Pool
let pool;
async function initializePool() {
  try {
    pool = await sql.connect(config);
    console.log('✅ SQL Server connected');
  } catch (err) {
    console.error('❌ SQL Server connection failed:', err);
    process.exit(1);
  }
}
initializePool();

// Test Connection Endpoint
app.get('/test', async (req, res, next) => {
  try {
    await pool.request().query('SELECT 1');
    res.send('✅ SQL connection successful');
  } catch (err) {
    next(err);
  }
});

// Get Warehouses
app.get('/api/warehouses', async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT WarehouseID, WarehouseName, Longitude AS Lng, Latitude AS Lat
      FROM Warehouse
    `);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// Get Vehicles
app.get('/api/vehicles', async (req, res, next) => {
  try {
    const result = await pool.request().query(`
      SELECT UnitID, UnitCode, Type, LicensePlate, Capacity
      FROM TransportUnit
    `);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// Get Vehicle by ID
app.get('/api/vehicles/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.request()
      .input('unitId', sql.Int, id)
      .query(`
        SELECT UnitID, UnitCode, Type, LicensePlate, Capacity
        FROM TransportUnit
        WHERE UnitID = @unitId
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

// Create Vehicle
app.post('/api/vehicles', async (req, res, next) => {
  const { UnitCode, Type, Capacity, LicensePlate } = req.body;
  if (!UnitCode || !Type || !Capacity || !LicensePlate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!['Truck', 'Van'].includes(Type)) {
    return res.status(400).json({ error: 'Invalid vehicle type' });
  }
  if (typeof Capacity !== 'number' || Capacity <= 0) {
    return res.status(400).json({ error: 'Invalid capacity' });
  }

  try {
    // Check if UnitCode or LicensePlate already exists
    const checkResult = await pool.request()
      .input('unitCode', sql.NVarChar, UnitCode)
      .input('licensePlate', sql.NVarChar, LicensePlate)
      .query(`
        SELECT UnitID
        FROM TransportUnit
        WHERE UnitCode = @unitCode OR LicensePlate = @licensePlate
      `);
    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ error: 'Unit code or license plate already exists' });
    }

    // Insert Vehicle
    const result = await pool.request()
      .input('unitCode', sql.NVarChar, UnitCode)
      .input('type', sql.NVarChar, Type)
      .input('capacity', sql.Float, Capacity)
      .input('licensePlate', sql.NVarChar, LicensePlate)
      .query(`
        INSERT INTO TransportUnit (UnitCode, Type, Capacity, LicensePlate)
        OUTPUT INSERTED.UnitID
        VALUES (@unitCode, @type, @capacity, @licensePlate)
      `);

    res.status(201).json({ message: 'Vehicle created successfully', unitId: result.recordset[0].UnitID });
  } catch (err) {
    next(err);
  }
});

// Update Vehicle
app.put('/api/vehicles/:id', async (req, res, next) => {
  const { id } = req.params;
  const { UnitCode, Type, Capacity, LicensePlate } = req.body;
  if (!UnitCode || !Type || !Capacity || !LicensePlate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!['Truck', 'Van'].includes(Type)) {
    return res.status(400).json({ error: 'Invalid vehicle type' });
  }
  if (typeof Capacity !== 'number' || Capacity <= 0) {
    return res.status(400).json({ error: 'Invalid capacity' });
  }

  try {
    // Check if UnitCode or LicensePlate already exists for another vehicle
    const checkResult = await pool.request()
      .input('unitId', sql.Int, id)
      .input('unitCode', sql.NVarChar, UnitCode)
      .input('licensePlate', sql.NVarChar, LicensePlate)
      .query(`
        SELECT UnitID
        FROM TransportUnit
        WHERE (UnitCode = @unitCode OR LicensePlate = @licensePlate)
        AND UnitID != @unitId
      `);
    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ error: 'Unit code or license plate already exists' });
    }

    // Update Vehicle
    const result = await pool.request()
      .input('unitId', sql.Int, id)
      .input('unitCode', sql.NVarChar, UnitCode)
      .input('type', sql.NVarChar, Type)
      .input('capacity', sql.Float, Capacity)
      .input('licensePlate', sql.NVarChar, LicensePlate)
      .query(`
        UPDATE TransportUnit
        SET UnitCode = @unitCode, Type = @type, Capacity = @capacity, LicensePlate = @licensePlate
        WHERE UnitID = @unitId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ message: 'Vehicle updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Get Shipments
app.get('/api/shipments', async (req, res, next) => {
  const { date, vehicleType, destWarehouse } = req.query;
  try {
    let query = `
      SELECT
        s.ShipmentID, s.ShipmentDate, s.Weight, s.Status, s.TotalDistance,
        tu.UnitID, tu.UnitCode, tu.Type, tu.LicensePlate,
        o.Longitude AS OriginLng, o.Latitude AS OriginLat,
        d.Longitude AS DestLng, d.Latitude AS DestLat,
        s.OriginWarehouseID, s.DestWarehouseID
      FROM Shipment s
      JOIN TransportUnit tu ON s.UnitID = tu.UnitID
      JOIN Warehouse o ON s.OriginWarehouseID = o.WarehouseID
      JOIN Warehouse d ON s.DestWarehouseID = d.WarehouseID
      WHERE 
        DAY(s.ShipmentDate) = DAY(@date) AND
        MONTH(s.ShipmentDate) = MONTH(@date) AND
        YEAR(s.ShipmentDate) = YEAR(@date)
    `;
    const request = pool.request();
    request.input('date', sql.DateTime, date);

    if (vehicleType) {
      query += ` AND tu.Type = @vehicleType`;
      request.input('vehicleType', sql.NVarChar, vehicleType);
    }
    if (destWarehouse) {
      query += ` AND s.DestWarehouseID = @destWarehouse`;
      request.input('destWarehouse', sql.Int, destWarehouse);
    }
    query += ` ORDER BY s.ShipmentDate`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// Get Shipment by ID
app.get('/api/shipments/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.request()
      .input('shipmentId', sql.Int, id)
      .query(`
        SELECT
          s.ShipmentID, s.ShipmentDate, s.Weight, s.Status, s.TotalDistance,
          s.UnitID AS VehicleID, s.OriginWarehouseID, s.DestWarehouseID
        FROM Shipment s
        WHERE s.ShipmentID = @shipmentId
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

// Create Shipment
app.post('/api/shipments', async (req, res, next) => {
  const { OriginWarehouseID, DestWarehouseID, VehicleID, ShipmentDate, Weight } = req.body;
  if (!OriginWarehouseID || !DestWarehouseID || !VehicleID || !ShipmentDate || !Weight) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Validate Origin Warehouse
    const originWarehouse = await pool.request()
      .input('warehouseID', sql.Int, OriginWarehouseID)
      .query(`SELECT WarehouseID, Latitude, Longitude FROM Warehouse WHERE WarehouseID = @warehouseID`);
    if (!originWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Origin warehouse not found' });
    }

    // Validate Destination Warehouse
    const destWarehouse = await pool.request()
      .input('warehouseID', sql.Int, DestWarehouseID)
      .query(`SELECT WarehouseID, Latitude, Longitude FROM Warehouse WHERE WarehouseID = @warehouseID`);
    if (!destWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Destination warehouse not found' });
    }

    // Validate Vehicle
    const vehicle = await pool.request()
      .input('vehicleID', sql.Int, VehicleID)
      .query(`SELECT UnitID FROM TransportUnit WHERE UnitID = @vehicleID`);
    if (!vehicle.recordset.length) {
      return res.status(400).json({ error: 'Vehicle not found' });
    }

    // Insert Shipment
    const shipmentResult = await pool.request()
      .input('shipmentDate', sql.DateTime, new Date(ShipmentDate))
      .input('weight', sql.Float, Weight)
      .input('unitID', sql.Int, VehicleID)
      .input('originWarehouseID', sql.Int, OriginWarehouseID)
      .input('destWarehouseID', sql.Int, DestWarehouseID)
      .input('status', sql.NVarChar, 'Pending')
      .input('totalDistance', sql.Float, 0)
      .query(`
        INSERT INTO Shipment (ShipmentDate, Weight, UnitID, OriginWarehouseID, DestWarehouseID, Status, TotalDistance)
        OUTPUT INSERTED.ShipmentID
        VALUES (@shipmentDate, @weight, @unitID, @originWarehouseID, @destWarehouseID, @status, @totalDistance)
      `);

    const shipmentId = shipmentResult.recordset[0].ShipmentID;

    // Insert Initial History
    await pool.request()
      .input('shipmentId', sql.Int, shipmentId)
      .input('status', sql.NVarChar, 'Pending')
      .input('totalDistance', sql.Float, 0)
      .query(`
        INSERT INTO ShipmentHistory (ShipmentID, Status, TotalDistance)
        VALUES (@shipmentId, @status, @totalDistance)
      `);

    res.status(201).json({ message: 'Shipment created successfully', shipmentId });
  } catch (err) {
    next(err);
  }
});

// Update Shipment
app.put('/api/shipments/:id', async (req, res, next) => {
  const { id } = req.params;
  const { OriginWarehouseID, DestWarehouseID, VehicleID, ShipmentDate, Weight } = req.body;
  if (!OriginWarehouseID || !DestWarehouseID || !VehicleID || !ShipmentDate || !Weight) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Validate Origin Warehouse
    const originWarehouse = await pool.request()
      .input('warehouseID', sql.Int, OriginWarehouseID)
      .query(`SELECT WarehouseID, Latitude, Longitude FROM Warehouse WHERE WarehouseID = @warehouseID`);
    if (!originWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Origin warehouse not found' });
    }

    // Validate Destination Warehouse
    const destWarehouse = await pool.request()
      .input('warehouseID', sql.Int, DestWarehouseID)
      .query(`SELECT WarehouseID, Latitude, Longitude FROM Warehouse WHERE WarehouseID = @warehouseID`);
    if (!destWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Destination warehouse not found' });
    }

    // Validate Vehicle
    const vehicle = await pool.request()
      .input('vehicleID', sql.Int, VehicleID)
      .query(`SELECT UnitID FROM TransportUnit WHERE UnitID = @vehicleID`);
    if (!vehicle.recordset.length) {
      return res.status(400).json({ error: 'Vehicle not found' });
    }

    // Check if shipment exists and is not completed
    const shipmentCheck = await pool.request()
      .input('shipmentId', sql.Int, id)
      .query(`SELECT Status FROM Shipment WHERE ShipmentID = @shipmentId`);
    if (shipmentCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    if (shipmentCheck.recordset[0].Status === 'Completed') {
      return res.status(400).json({ error: 'Cannot update completed shipment' });
    }

    // Update Shipment
    const result = await pool.request()
      .input('shipmentId', sql.Int, id)
      .input('shipmentDate', sql.DateTime, new Date(ShipmentDate))
      .input('weight', sql.Float, Weight)
      .input('unitID', sql.Int, VehicleID)
      .input('originWarehouseID', sql.Int, OriginWarehouseID)
      .input('destWarehouseID', sql.Int, DestWarehouseID)
      .query(`
        UPDATE Shipment
        SET ShipmentDate = @shipmentDate, Weight = @weight, UnitID = @unitID,
            OriginWarehouseID = @originWarehouseID, DestWarehouseID = @destWarehouseID
        WHERE ShipmentID = @shipmentId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Insert History for update
    await pool.request()
      .input('shipmentId', sql.Int, id)
      .input('status', sql.NVarChar, shipmentCheck.recordset[0].Status)
      .input('totalDistance', sql.Float, 0)
      .query(`
        INSERT INTO ShipmentHistory (ShipmentID, Status, TotalDistance)
        VALUES (@shipmentId, @status, @totalDistance)
      `);

    res.json({ message: 'Shipment updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Update Shipment Status and TotalDistance
app.patch('/api/shipments/:id/status', async (req, res, next) => {
  const { id } = req.params;
  const { status, totalDistance } = req.body;
  if (!['Pending', 'Moving', 'Completed'].includes(status)) {
    return res.status(400).json({ error: ' BRA Invalid status' });
  }
  if (totalDistance !== undefined && (typeof totalDistance !== 'number' || totalDistance < 0)) {
    return res.status(400).json({ error: 'Invalid total distance' });
  }

  try {
    const request = pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status);
    
    let query = `
      UPDATE Shipment
      SET Status = @status
    `;
    if (totalDistance !== undefined) {
      query += `, TotalDistance = @totalDistance`;
      request.input('totalDistance', sql.Float, totalDistance);
    }
    query += ` WHERE ShipmentID = @id`;

    const result = await request.query(query);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Insert History
    await pool.request()
      .input('shipmentId', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('totalDistance', sql.Float, totalDistance || 0)
      .query(`
        INSERT INTO ShipmentHistory (ShipmentID, Status, TotalDistance)
        VALUES (@shipmentId, @status, @totalDistance)
      `);

    res.json({ message: 'Shipment updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Get Shipment History
app.get('/api/shipments/:id/history', async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await pool.request()
      .input('shipmentId', sql.Int, id)
      .query(`
        SELECT HistoryID, Status, TotalDistance, ChangeTime
        FROM ShipmentHistory
        WHERE ShipmentID = @shipmentId
        ORDER BY ChangeTime ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// Proxy ORS Route Request
app.post('/api/ors/route', async (req, res, next) => {
  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.ORS_API_KEY
      },
      body: JSON.stringify(req.body)
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Serve test-map.html
app.get('/test-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test-map.html'));
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(`❌ Error in ${req.method} ${req.url}:`, err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});