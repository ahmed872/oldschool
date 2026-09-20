function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function render() {
  const params = new URLSearchParams(window.location.search);
  const saleId = Number(params.get('saleId'));
  const data = await window.api.sales.full(saleId);
  const container = document.getElementById('receipt');

  if (!data) {
    container.textContent = 'الفاتورة غير موجودة';
    return;
  }

  const { sale, items, settings } = data;
  const currency = settings.currency || '';

  container.innerHTML = `
    <h2>${escapeHtml(settings.store_name || 'المتجر')}</h2>
    <p class="center">فاتورة رقم: ${escapeHtml(sale.sale_number)}</p>
    <p class="center">${escapeHtml(sale.created_at)}</p>
    <hr />
    <table>
      ${items.map((it) => `
        <tr>
          <td colspan="2">${escapeHtml(it.name)}</td>
        </tr>
        <tr>
          <td>${it.qty} × ${it.unit_price.toFixed(2)}</td>
          <td style="text-align:left;">${it.line_total.toFixed(2)}</td>
        </tr>
      `).join('')}
    </table>
    <hr />
    <table class="totals">
      <tr><td>الإجمالي الفرعي</td><td style="text-align:left;">${sale.subtotal.toFixed(2)} ${currency}</td></tr>
      <tr><td>الخصم</td><td style="text-align:left;">${sale.discount.toFixed(2)} ${currency}</td></tr>
      <tr><td>الضريبة</td><td style="text-align:left;">${sale.tax.toFixed(2)} ${currency}</td></tr>
      <tr><td>الإجمالي</td><td style="text-align:left;">${sale.total.toFixed(2)} ${currency}</td></tr>
    </table>
    <hr />
    <p class="center">شكرًا لتعاملكم معنا</p>
  `;
}

render();
