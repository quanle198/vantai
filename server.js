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
      SELECT UnitID, UnitCode, Type, LicensePlate
      FROM TransportUnit
    `);
    res.json(result.recordset);
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
        s.ShipmentDate, s.Weight,
        tu.UnitCode, tu.Type, tu.LicensePlate,
        o.Longitude AS OriginLng, o.Latitude AS OriginLat,
        d.Longitude AS DestLng, d.Latitude AS DestLat
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

    // Insert Shipment
    await pool.request()
      .input('shipmentDate', sql.DateTime, new Date(ShipmentDate))
      .input('weight', sql.Float, Weight)
      .input('unitID', sql.Int, VehicleID)
      .input('originWarehouseID', sql.Int, OriginWarehouseID)
      .input('destWarehouseID', sql.Int, DestWarehouseID)
      .query(`
        INSERT INTO Shipment (ShipmentDate, Weight, UnitID, OriginWarehouseID, DestWarehouseID)
        VALUES (@shipmentDate, @weight, @unitID, @originWarehouseID, @destWarehouseID)
      `);

    res.status(201).json({ message: 'Shipment created successfully' });
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