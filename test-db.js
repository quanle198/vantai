// test-db.js
const sql = require('mssql');

const config = {
  user: 'apiuser',
  password: 'Truong@123s',
  server: 'localhost',   // không instanceName
  port: 1433,            // port vừa gán
  database: 'QL_VAN_TAI',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

sql.connect(config)
  .then(pool => {
    console.log('✅ Kết nối DB thành công (SQL Auth trên port 1433)');
    return pool.close();
  })
  .catch(err => {
    console.error('❌ Lỗi khi test DB:', err);
  });
