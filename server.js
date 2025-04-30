const express = require('express');
const sql = require('mssql');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const PORT = 3000;

// 1. Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// 2. Cấu hình kết nối SQL Server
const config = {
  user: 'sa',
  password: 'quan',
  server: 'quanfx',
  port: 1433,
  database: 'QL_VAN_TAI',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// 3. Endpoint test kết nối
app.get('/test', async (req, res) => {
  try {
    await sql.connect(config);
    console.log("✅ Kết nối SQL thành công");
    res.send("✅ Kết nối SQL thành công");
  } catch (err) {
    console.error("❌ Lỗi SQL /test:", err);
    res.status(500).send("❌ Lỗi SQL (xem console)");
  }
});

// 4. API lấy danh sách kho
app.get('/api/warehouses', async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query(`
      SELECT WarehouseID, WarehouseName, Longitude AS Lng, Latitude AS Lat
      FROM Warehouse
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Lỗi SQL /api/warehouses:", err);
    res.status(500).send("Lỗi khi tải danh sách kho");
  }
});

app.get('/api/vehicles', async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query(`
      SELECT *
      FROM TransportUnit
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Lỗi SQL /api/verhicles:", err);
    res.status(500).send("Lỗi khi tải danh sách xe");
  }
});

// 5. API lấy shipment theo khoảng ngày, loại xe và kho đích
app.get('/api/shipments', async (req, res) => {
  const { start, end, vehicleType, destWarehouse } = req.query;

  try {
    const pool = await sql.connect(config);
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
      WHERE s.ShipmentDate BETWEEN @start AND DATEADD(day, 1, @end)
    `;
    const request = pool.request();

    // Thêm tham số
    request.input('start', sql.DateTime, start);
    request.input('end', sql.DateTime, end);

    // Lọc theo loại xe
    if (vehicleType) {
      query += ` AND tu.Type = @vehicleType`;
      request.input('vehicleType', sql.NVarChar, vehicleType);
    }

    // Lọc theo kho đích
    if (destWarehouse) {
      query += ` AND s.DestWarehouseID = @destWarehouse`;
      request.input('destWarehouse', sql.Int, destWarehouse);
    }

    query += ` ORDER BY s.ShipmentDate`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Lỗi SQL /api/shipments:", err);
    res.status(500).send("Lỗi khi tải dữ liệu");
  }
});

// 6. API tạo chuyến đi mới
app.post('/api/shipments', async (req, res) => {
  const { 
    OriginWarehouseID, 
    DestWarehouseID, 
    VehicleID, 
    ShipmentDate, 
    Weight 
  } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!OriginWarehouseID || !DestWarehouseID || !VehicleID || !ShipmentDate || !Weight) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
  }

  try {
    const pool = await sql.connect(config);

    // Kiểm tra kho xuất phát tồn tại
    const originWarehouse = await pool.request()
      .input('warehouseID', sql.Int, OriginWarehouseID)
      .query(`
        SELECT WarehouseID, Latitude, Longitude
        FROM Warehouse
        WHERE WarehouseID = @warehouseID
      `);
    if (!originWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Kho xuất phát không tồn tại' });
    }

    // Kiểm tra kho đích tồn tại
    const destWarehouse = await pool.request()
      .input('warehouseID', sql.Int, DestWarehouseID)
      .query(`
        SELECT WarehouseID, Latitude, Longitude
        FROM Warehouse
        WHERE WarehouseID = @warehouseID
      `);
    if (!destWarehouse.recordset.length) {
      return res.status(400).json({ error: 'Kho đích không tồn tại' });
    }

    // Kiểm tra UnitCode tồn tại hoặc thêm mới TransportUnit
    // let unitResult = await pool.request()
    //   .input('unitCode', sql.NVarChar, UnitCode)
    //   .query(`
    //     SELECT UnitID
    //     FROM TransportUnit
    //     WHERE UnitCode = @unitCode
    //   `);
    
    // let unitID;
    // if (unitResult.recordset.length) {
    //   unitID = unitResult.recordset[0].UnitID;
    // } else {
    //   // Thêm mới TransportUnit nếu không tồn tại
    //   const insertUnit = await pool.request()
    //     .input('unitCode', sql.NVarChar, UnitCode)
    //     .input('type', sql.NVarChar, VehicleType)
    //     .query(`
    //       INSERT INTO TransportUnit (UnitCode, Type)
    //       OUTPUT INSERTED.UnitID
    //       VALUES (@unitCode, @type)
    //     `);
    //   unitID = insertUnit.recordset[0].UnitID;
    // }

    // Thêm chuyến đi vào bảng Shipment
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

    res.status(201).json({ message: 'Tạo chuyến đi thành công' });
  } catch (err) {
    console.error("❌ Lỗi SQL /api/shipments POST:", err);
    res.status(500).json({ error: 'Lỗi khi tạo chuyến đi: ' + err.message });
  }
});

// 7. Phục vụ file test-map.html
app.get('/test-map.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test-map.html'));
});

// 8. Chạy server
app.listen(PORT, () =>
  console.log(`🚀 Server đang chạy: http://localhost:${PORT}`)
);