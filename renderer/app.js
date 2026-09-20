let categories = [];
let products = [];
let cart = []; // { product_id, name, qty, unit_price, is_kitchen_item }
let settings = {};
let currentUser = null;

async function init() {
  currentUser = await window.api.auth.me();
  if (!currentUser) {
    window.location.href = 'login.html';
    return;
  }

  categories = await window.api.categories.list();
  products = await window.api.products.list();
  settings = await window.api.settings.get();

  applyRoleVisibility();
  renderProductGrid();
  renderCategorySelect();
  renderCart();
  populateSettingsForm();
  await refreshSalesTable();
  await refreshProductsTable();

  setupNav();
  setupPosHandlers();
  setupProductHandlers();
  setupSettingsHandlers();
  setupReportsHandlers();
  setupUsersHandlers();

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('reportFrom').value = today;
  document.getElementById('reportTo').value = today;
}

function applyRoleVisibility() {
  document.getElementById('userBadge').textContent =
    `${currentUser.username} (${currentUser.role === 'admin' ? 'مدير' : 'كاشير'})`;

  if (currentUser.role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach((el) => (el.style.display = 'none'));
  }
}

function setupNav() {
  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'users') await refreshUsersTable();
    });
  });
  document.getElementById('openKitchenBtn').addEventListener('click', () => {
    window.api.kitchen.openWindow();
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await window.api.auth.logout();
  });
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';
  for (const p of products) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const stockLabel = p.track_stock ? `${p.stock_qty} بالمخزون` : 'غير محدود';
    card.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="price">${p.price.toFixed(2)} ${settings.currency || ''}</div>
      <div class="stock">${stockLabel}</div>
    `;
    card.addEventListener('click', () => addToCart(p));
    grid.appendChild(card);
  }
}

function renderCategorySelect() {
  const select = document.getElementById('pCategory');
  select.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function addToCart(product) {
  if (product.track_stock && product.stock_qty <= 0) {
    alert('المنتج غير متوفر بالمخزون');
    return;
  }
  const existing = cart.find((it) => it.product_id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      product_id: product.id,
      name: product.name,
      qty: 1,
      unit_price: product.price,
      is_kitchen_item: product.category_is_kitchen ? 1 : 0,
    });
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItems');
  container.innerHTML = '';
  for (const [index, it] of cart.entries()) {
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <span>${escapeHtml(it.name)}</span>
      <div class="qty-controls" style="display:flex;align-items:center;gap:6px;">
        <button data-action="dec" data-index="${index}">-</button>
        <span>${it.qty}</span>
        <button data-action="inc" data-index="${index}">+</button>
        <button data-action="remove" data-index="${index}">×</button>
      </div>
      <span>${(it.qty * it.unit_price).toFixed(2)}</span>
    `;
    container.appendChild(row);
  }
  container.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.index);
      if (btn.dataset.action === 'inc') cart[index].qty += 1;
      if (btn.dataset.action === 'dec') cart[index].qty = Math.max(1, cart[index].qty - 1);
      if (btn.dataset.action === 'remove') cart.splice(index, 1);
      renderCart();
    });
  });
  updateTotals();
}

function updateTotals() {
  const subtotal = cart.reduce((sum, it) => sum + it.qty * it.unit_price, 0);
  const discount = Number(document.getElementById('discountInput').value) || 0;
  const taxPercent = Number(settings.tax_percent) || 0;
  const taxable = Math.max(subtotal - discount, 0);
  const tax = taxable * (taxPercent / 100);
  const total = taxable + tax;

  document.getElementById('subtotalText').textContent = subtotal.toFixed(2);
  document.getElementById('taxText').textContent = tax.toFixed(2);
  document.getElementById('totalText').textContent = total.toFixed(2);
}

function setupPosHandlers() {
  document.getElementById('discountInput').addEventListener('input', updateTotals);

  document.getElementById('clearCartBtn').addEventListener('click', () => {
    cart = [];
    renderCart();
  });

  document.getElementById('checkoutBtn').addEventListener('click', async () => {
    if (cart.length === 0) {
      alert('الفاتورة فارغة');
      return;
    }
    const discount = Number(document.getElementById('discountInput').value) || 0;
    const taxPercent = Number(settings.tax_percent) || 0;
    const paymentMethod = document.getElementById('paymentMethod').value;

    const result = await window.api.sales.create({
      items: cart,
      discount,
      taxPercent,
      paymentMethod,
    });

    cart = [];
    document.getElementById('discountInput').value = 0;
    renderCart();
    products = await window.api.products.list();
    renderProductGrid();
    await refreshSalesTable();

    const wantsPrint = confirm(`تم إتمام البيع - فاتورة رقم ${result.saleNumber} بإجمالي ${result.total.toFixed(2)}\n\nهل تريد طباعة الفاتورة؟`);
    if (wantsPrint) {
      try {
        await window.api.print.receipt(result.saleId);
      } catch (err) {
        alert('تعذرت الطباعة: ' + err.message);
      }
    }
  });
}

async function refreshSalesTable() {
  const sales = await window.api.sales.list(100);
  const body = document.getElementById('salesTableBody');
  body.innerHTML = sales.map((s) => `
    <tr>
      <td>${s.sale_number}</td>
      <td>${s.created_at}</td>
      <td>${s.total.toFixed(2)}</td>
      <td>${s.payment_method === 'cash' ? 'نقدًا' : 'بطاقة'}</td>
      <td>
        <button class="secondary" data-view-sale="${s.id}">تفاصيل</button>
        <button class="secondary" data-print-sale="${s.id}">طباعة</button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-view-sale]').forEach((btn) => {
    btn.addEventListener('click', () => showSaleDetail(Number(btn.dataset.viewSale)));
  });
  body.querySelectorAll('[data-print-sale]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await window.api.print.receipt(Number(btn.dataset.printSale));
      } catch (err) {
        alert('تعذرت الطباعة: ' + err.message);
      }
    });
  });
}

async function showSaleDetail(saleId) {
  const data = await window.api.sales.full(saleId);
  const box = document.getElementById('saleDetailBox');
  box.style.display = 'block';

  box.innerHTML = `
    <h3>تفاصيل فاتورة ${escapeHtml(data.sale.sale_number)}</h3>
    <table>
      <thead><tr><th>الصنف</th><th>الكمية</th><th>تم إرجاعه</th><th>السعر</th><th>إرجاع</th></tr></thead>
      <tbody>
        ${data.items.map((it) => {
          const remaining = it.qty - it.returned_qty;
          return `
            <tr>
              <td>${escapeHtml(it.name)}</td>
              <td>${it.qty}</td>
              <td>${it.returned_qty}</td>
              <td>${it.unit_price.toFixed(2)}</td>
              <td>
                ${remaining > 0 ? `
                  <input type="number" min="1" max="${remaining}" value="1" style="width:50px;" id="retQty-${it.id}" />
                  <button class="secondary" data-return-item="${it.id}" data-sale="${saleId}">إرجاع</button>
                ` : 'مكتمل'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  box.querySelectorAll('[data-return-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const saleItemId = Number(btn.dataset.returnItem);
      const saleIdVal = Number(btn.dataset.sale);
      const qty = Number(document.getElementById(`retQty-${saleItemId}`).value);
      const reason = prompt('سبب الإرجاع (اختياري):') || '';
      try {
        await window.api.returns.create({ saleId: saleIdVal, saleItemId, qty, reason });
        alert('تم تسجيل الإرجاع');
        showSaleDetail(saleIdVal);
        products = await window.api.products.list();
        renderProductGrid();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function refreshProductsTable() {
  const body = document.getElementById('productsTableBody');
  body.innerHTML = products.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category_name || '-')}</td>
      <td>${p.price.toFixed(2)}</td>
      <td>${p.track_stock ? p.stock_qty : '—'}</td>
      <td><button class="secondary" data-delete="${p.id}">حذف</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.products.delete(Number(btn.dataset.delete));
      products = await window.api.products.list();
      renderProductGrid();
      await refreshProductsTable();
    });
  });
}

function setupProductHandlers() {
  document.getElementById('saveProductBtn').addEventListener('click', async () => {
    const name = document.getElementById('pName').value.trim();
    if (!name) { alert('اسم المنتج مطلوب'); return; }
    await window.api.products.save({
      name,
      barcode: document.getElementById('pBarcode').value.trim(),
      category_id: Number(document.getElementById('pCategory').value) || null,
      price: Number(document.getElementById('pPrice').value) || 0,
      cost: Number(document.getElementById('pCost').value) || 0,
      stock_qty: Number(document.getElementById('pStock').value) || 0,
      track_stock: document.getElementById('pTrackStock').checked,
    });
    document.getElementById('pName').value = '';
    document.getElementById('pBarcode').value = '';
    document.getElementById('pPrice').value = '';
    document.getElementById('pCost').value = '';
    document.getElementById('pStock').value = '';
    products = await window.api.products.list();
    renderProductGrid();
    await refreshProductsTable();
  });
}

function populateSettingsForm() {
  document.getElementById('sStoreName').value = settings.store_name || '';
  document.getElementById('sCurrency').value = settings.currency || '';
  document.getElementById('sTax').value = settings.tax_percent || 0;
}

function setupSettingsHandlers() {
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    await window.api.settings.save('store_name', document.getElementById('sStoreName').value);
    await window.api.settings.save('currency', document.getElementById('sCurrency').value);
    await window.api.settings.save('tax_percent', document.getElementById('sTax').value);
    settings = await window.api.settings.get();
    renderProductGrid();
    alert('تم حفظ الإعدادات');
  });

  document.getElementById('addCategoryBtn').addEventListener('click', async () => {
    const name = document.getElementById('catName').value.trim();
    if (!name) return;
    await window.api.categories.save(name, document.getElementById('catIsKitchen').checked);
    categories = await window.api.categories.list();
    renderCategorySelect();
    document.getElementById('catName').value = '';
    alert('تمت إضافة الفئة');
  });
}

function setupReportsHandlers() {
  document.getElementById('loadReportBtn').addEventListener('click', async () => {
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const summary = await window.api.reports.summary(from, to);
    const currency = settings.currency || '';
    const box = document.getElementById('reportResults');

    box.innerHTML = `
      <div class="card-box" style="max-width:700px;">
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;"><span>عدد الفواتير</span><span>${summary.invoiceCount}</span></div>
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;"><span>إجمالي المبيعات</span><span>${summary.grossSales.toFixed(2)} ${currency}</span></div>
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;"><span>إجمالي المرتجعات</span><span>${summary.totalReturns.toFixed(2)} ${currency}</span></div>
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;"><span>صافي المبيعات</span><span>${summary.netSales.toFixed(2)} ${currency}</span></div>
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;"><span>التكلفة</span><span>${summary.totalCost.toFixed(2)} ${currency}</span></div>
        <div class="row" style="display:flex;justify-content:space-between;margin:6px 0;font-weight:bold;color:#22c55e;"><span>صافي الربح</span><span>${summary.profit.toFixed(2)} ${currency}</span></div>
      </div>
      <h3>الأكثر مبيعًا</h3>
      <table>
        <thead><tr><th>المنتج</th><th>الكمية المباعة</th><th>الإيراد</th></tr></thead>
        <tbody>
          ${summary.topProducts.map((p) => `
            <tr><td>${escapeHtml(p.name)}</td><td>${p.qty_sold}</td><td>${p.revenue.toFixed(2)}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  });
}

async function refreshUsersTable() {
  const users = await window.api.users.list();
  const body = document.getElementById('usersTableBody');
  body.innerHTML = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role === 'admin' ? 'مدير' : 'كاشير'}</td>
      <td>${u.is_active ? 'مفعل' : 'موقوف'}</td>
      <td>
        <button class="secondary" data-toggle-user="${u.id}" data-active="${u.is_active}">
          ${u.is_active ? 'إيقاف' : 'تفعيل'}
        </button>
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('[data-toggle-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.toggleUser);
      const isActive = btn.dataset.active === '1';
      await window.api.users.setActive(id, !isActive);
      await refreshUsersTable();
    });
  });
}

function setupUsersHandlers() {
  document.getElementById('saveUserBtn').addEventListener('click', async () => {
    const username = document.getElementById('uUsername').value.trim();
    const pin = document.getElementById('uPin').value.trim();
    const role = document.getElementById('uRole').value;
    if (!username || !pin) { alert('اسم المستخدم والرقم السري مطلوبان'); return; }
    await window.api.users.save({ username, pin, role });
    document.getElementById('uUsername').value = '';
    document.getElementById('uPin').value = '';
    await refreshUsersTable();
    alert('تم حفظ المستخدم');
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

init();
