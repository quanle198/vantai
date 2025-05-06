// Format time for display (input in hours)
function formatTime(hours) {
    const minutes = hours * 60;
    if (minutes < 60) return `${minutes.toFixed(2)} phút`;
    if (hours < 24) return `${hours.toFixed(2)} giờ`;
    const days = hours / 24;
    return `${days.toFixed(2)} ngày`;
  }
  
  // Initialize Chart
  let timeChart = null;
  function renderTimeChart(data, isMonthly) {
    const ctx = document.getElementById('shipmentsByTimeChart').getContext('2d');
    if (timeChart) timeChart.destroy();
    timeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(item => item.date),
        datasets: [{
          label: 'Số Chuyến Hàng',
          data: data.map(item => item.shipmentCount),
          backgroundColor: 'rgba(40, 167, 69, 0.6)',
          borderColor: 'rgba(40, 167, 69, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: context => `Số chuyến: ${context.parsed.y}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Số Chuyến' },
            grid: { color: 'rgba(0, 0, 0, 0.1)' }
          },
          x: {
            title: { display: true, text: isMonthly ? 'Tháng' : 'Ngày' },
            grid: { display: false }
          }
        }
      }
    });
  }
  
  // Fetch and render dashboard data
  async function loadDashboardData(startDate = '', endDate = '') {
    try {
      const query = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : '';
  
      // Tổng quan vận chuyển
      const overview = await fetch(`/api/dashboard/overview${query}`).then(r => r.json());
      document.getElementById('totalShipments').textContent = overview.totalShipments;
      document.getElementById('completedShipments').textContent = overview.completedShipments;
  
      // Hiệu suất vận chuyển
      const efficiency = await fetch(`/api/dashboard/efficiency${query}`).then(r => r.json());
      document.getElementById('totalWeight').textContent = efficiency.totalWeight.toFixed(2);
      document.getElementById('totalDistance').textContent = efficiency.totalDistance.toFixed(2);
      document.getElementById('avgWeight').textContent = efficiency.avgWeight.toFixed(2);
  
      // Phân tích theo thời gian
      const timeType = document.getElementById('monthlyView').classList.contains('active') ? 'monthly' : 'daily';
      const timeAnalysis = await fetch(`/api/dashboard/time-analysis?type=${timeType}${query.slice(1)}`).then(r => r.json());
      renderTimeChart(timeAnalysis, timeType === 'monthly');
  
      // Phân tích theo kho
      const warehouseAnalysis = await fetch(`/api/dashboard/warehouse-analysis${query}`).then(r => r.json());
      const originTable = document.getElementById('topOriginWarehouses');
      const destTable = document.getElementById('topDestWarehouses');
      originTable.innerHTML = '';
      destTable.innerHTML = '';
      warehouseAnalysis.originWarehouses.forEach(w => {
        originTable.innerHTML += `
          <tr>
            <td>${w.WarehouseName}</td>
            <td>${w.shipmentCount}</td>
            <td>${w.totalWeight.toFixed(2)}</td>
          </tr>
        `;
      });
      warehouseAnalysis.destWarehouses.forEach(w => {
        destTable.innerHTML += `
          <tr>
            <td>${w.WarehouseName}</td>
            <td>${w.shipmentCount}</td>
            <td>${w.totalWeight.toFixed(2)}</td>
          </tr>
        `;
      });
  
      // Phân tích theo xe
      const vehicleAnalysis = await fetch(`/api/dashboard/vehicle-analysis${query}`).then(r => r.json());
      const vehicleTable = document.getElementById('vehiclePerformance');
      vehicleTable.innerHTML = '';
      vehicleAnalysis.forEach(v => {
        vehicleTable.innerHTML += `
          <tr>
            <td>${v.LicensePlate}</td>
            <td>${v.totalShipments}</td>
            <td>${v.completedShipments}</td>
            <td>${v.totalWeight.toFixed(2)}</td>
            <td>${v.totalDistance.toFixed(2)}</td>
            <td>${formatTime(v.totalTime)}</td>
          </tr>
        `;
      });
    } catch (e) {
      console.error('Failed to load dashboard data:', e);
      alert('Không thể tải dữ liệu bảng điều khiển');
    }
  }
  
  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    // Set default date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 30);
    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = endDate.toISOString().split('T')[0];
  
    // Load initial data
    loadDashboardData(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);
  
    // Date filter
    document.getElementById('applyFilter').addEventListener('click', () => {
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      if (startDate && endDate) {
        loadDashboardData(startDate, endDate);
      } else {
        alert('Vui lòng chọn cả ngày bắt đầu và ngày kết thúc');
      }
    });
  
    // Time view toggle
    const dailyBtn = document.getElementById('dailyView');
    const monthlyBtn = document.getElementById('monthlyView');
    dailyBtn.addEventListener('click', () => {
      dailyBtn.classList.add('active');
      monthlyBtn.classList.remove('active');
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      loadDashboardData(startDate, endDate);
    });
    monthlyBtn.addEventListener('click', () => {
      monthlyBtn.classList.add('active');
      dailyBtn.classList.remove('active');
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      loadDashboardData(startDate, endDate);
    });
  });