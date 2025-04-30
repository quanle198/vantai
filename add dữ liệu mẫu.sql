use QL_VAN_TAI
INSERT INTO Warehouse (WarehouseName, Longitude, Latitude)
VALUES
  ('Kho Trung Tâm', 106.7009, 10.7769),
  ('Kho Mi?n B?c', 105.8542, 21.0285),
  ('Kho Mi?n Nam', 106.6297, 10.8231);

INSERT INTO TransportUnit (UnitCode, Type, Capacity)
VALUES
  ('TX001', 'Truck', 10000),
  ('TX002', 'Van',   5000);

INSERT INTO Shipment (ShipmentDate, OriginWarehouseID, DestWarehouseID, UnitID, Weight)
VALUES
  ('2025-04-01 08:00', 1, 2, 1,  2000),
  ('2025-04-01 12:00', 2, 3, 2,  1500),
  ('2025-04-02 09:30', 1, 3, 1,  3000),
  ('2025-04-03 14:15', 3, 1, 2,  1200);
