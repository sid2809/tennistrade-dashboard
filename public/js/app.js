// ── Clock ──
function updateClock() {
  const el = document.getElementById('clock');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
  }
}
setInterval(updateClock, 1000);
updateClock();

// ── P&L Bar Chart ──
document.addEventListener('DOMContentLoaded', () => {
  const chartEl = document.getElementById('pnlChart');
  if (!chartEl) return;

  try {
    const data = JSON.parse(chartEl.dataset.values || '[]');
    if (data.length === 0) return;

    const maxAbs = Math.max(...data.map(d => Math.abs(parseFloat(d.daily_pnl) || 0)), 1);

    chartEl.innerHTML = '';
    data.forEach(d => {
      const pnl = parseFloat(d.daily_pnl) || 0;
      const height = Math.max(2, (Math.abs(pnl) / maxAbs) * 180);
      const bar = document.createElement('div');
      bar.className = `chart-bar ${pnl >= 0 ? 'pos' : 'neg'}`;
      bar.style.height = height + 'px';
      bar.title = `${d.day}: ₹${pnl.toLocaleString()} (${d.trades} trades)`;
      chartEl.appendChild(bar);
    });
  } catch (e) {
    console.error('Chart error:', e);
  }
});
