(function () {
  // Seed demo data if empty
  const DEFAULTS = {
    holdings: [
      { name: 'TSLA', value: 45000, type: 'stock', qty: 120 },
      { name: 'XPEV', value: 32000, type: 'stock', qty: 800 },
      { name: 'BYD',  value: 28000, type: 'stock', qty: 500 },
      { name: 'ASB',  value: 277000, type: 'fund', qty: 1 },
      { name: 'BTC',  value: 55000, type: 'crypto', qty: 0.18 },
      { name: 'ETH',  value: 38000, type: 'crypto', qty: 1.5 },
    ],
    properties: [
      { name: 'Bandar Tun Hussein Onn', value: 650000, type: 'residential' },
    ],
  };

  function getData() {
    try {
      const raw = localStorage.getItem('invested_data');
      if (raw) return JSON.parse(raw);
    } catch(e) { console.error(e); }
    return DEFAULTS;
  }

  function setData(data) {
    localStorage.setItem('invested_data', JSON.stringify(data));
    render();
  }

  function fmt(n) {
    return 'RM ' + n.toLocaleString('en-MY', { maximumFractionDigits: 0 });
  }

  function render() {
    const data = getData();
    let holdingsTotal = 0;
    let propertiesTotal = 0;

    const hGrid = document.getElementById('holdings-grid');
    hGrid.innerHTML = '';
    data.holdings.forEach((h, idx) => {
      holdingsTotal += h.value;
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="name">${h.name}</div>
        <div class="value">${fmt(h.value)}</div>
        <div class="detail">${h.qty} × ${h.type}</div>
      `;
      div.onclick = () => editHolding(idx);
      hGrid.appendChild(div);
    });

    const pGrid = document.getElementById('properties-grid');
    pGrid.innerHTML = '';
    data.properties.forEach((p, idx) => {
      propertiesTotal += p.value;
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div class="name">${p.name}</div>
        <div class="value">${fmt(p.value)}</div>
        <div class="detail">${p.type}</div>
      `;
      div.onclick = () => editProperty(idx);
      pGrid.appendChild(div);
    });

    const total = holdingsTotal + propertiesTotal;
    document.getElementById('net-worth').textContent = fmt(total);
    // Simple percent change placeholder (compare to yesterday)
    document.getElementById('net-change').textContent = '+0.00%';
  }

  function editHolding(idx) {
    const data = getData();
    const h = data.holdings[idx];
    const nv = prompt('Update value for ' + h.name + ':', h.value);
    if (nv !== null && !isNaN(nv)) {
      data.holdings[idx].value = Number(nv);
      setData(data);
    }
  }

  function editProperty(idx) {
    const data = getData();
    const p = data.properties[idx];
    const nv = prompt('Update value for ' + p.name + ':', p.value);
    if (nv !== null && !isNaN(nv)) {
      data.properties[idx].value = Number(nv);
      setData(data);
    }
  }

  function addHolding() {
    const name = prompt('Ticker / Name:');
    if (!name) return;
    const qty = Number(prompt('Quantity / Units:', 1));
    const value = Number(prompt('Current value (RM):', 0));
    const data = getData();
    data.holdings.push({ name, value, qty, type: 'stock' });
    setData(data);
  }

  function addProperty() {
    const name = prompt('Property name / address:');
    if (!name) return;
    const value = Number(prompt('Estimated value (RM):', 0));
    const data = getData();
    data.properties.push({ name, value, type: 'residential' });
    setData(data);
  }

  document.getElementById('add-holding').onclick = addHolding;
  document.getElementById('add-property').onclick = addProperty;

  render();
})();
