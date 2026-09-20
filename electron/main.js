const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

let store;
let mainWindow;
let kitchenWindow;
let currentUser = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Smart POS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
}

function createKitchenWindow() {
  if (kitchenWindow) {
    kitchenWindow.focus();
    return;
  }
  kitchenWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'شاشة المطبخ - Smart POS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  kitchenWindow.loadFile(path.join(__dirname, '..', 'renderer', 'kitchen.html'));
  kitchenWindow.on('closed', () => {
    kitchenWindow = null;
  });
}

function printReceipt(saleId) {
  return new Promise((resolve, reject) => {
    const receiptWindow = new BrowserWindow({
      width: 380,
      height: 600,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    receiptWindow.loadFile(path.join(__dirname, '..', 'renderer', 'receipt.html'), {
      query: { saleId: String(saleId) },
    });
    receiptWindow.webContents.on('did-finish-load', () => {
      receiptWindow.webContents.print({ silent: false }, (success, reason) => {
        receiptWindow.close();
        if (success) resolve(true);
        else reject(new Error(reason || 'تم إلغاء الطباعة'));
      });
    });
  });
}

app.whenReady().then(() => {
  store = require('./db.js');
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpcHandlers() {
  ipcMain.handle('auth:login', (_e, username, pin) => {
    const user = store.verifyLogin(username, pin);
    if (user) currentUser = user;
    return user;
  });
  ipcMain.handle('auth:logout', () => {
    currentUser = null;
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
  });
  ipcMain.handle('auth:me', () => currentUser);

  ipcMain.handle('users:list', () => store.getUsers());
  ipcMain.handle('users:save', (_e, user) => store.saveUser(user));
  ipcMain.handle('users:setActive', (_e, id, isActive) => store.setUserActive(id, isActive));

  ipcMain.handle('categories:list', () => store.getCategories());
  ipcMain.handle('categories:save', (_e, name, isKitchen) => store.saveCategory(name, isKitchen));

  ipcMain.handle('products:list', () => store.getProducts());
  ipcMain.handle('products:save', (_e, product) => store.saveProduct(product));
  ipcMain.handle('products:delete', (_e, id) => store.deleteProduct(id));

  ipcMain.handle('sales:create', (_e, payload) => store.createSale({ ...payload, userId: currentUser?.id }));
  ipcMain.handle('sales:list', (_e, limit) => store.getSales(limit));
  ipcMain.handle('sales:items', (_e, saleId) => store.getSaleItems(saleId));
  ipcMain.handle('sales:full', (_e, saleId) => store.getSaleFull(saleId));

  ipcMain.handle('returns:create', (_e, payload) => store.createReturn({ ...payload, userId: currentUser?.id }));
  ipcMain.handle('returns:forSale', (_e, saleId) => store.getReturnsForSale(saleId));

  ipcMain.handle('kitchen:list', () => store.getKitchenOrders());
  ipcMain.handle('kitchen:updateStatus', (_e, saleId, status) => store.updateKitchenStatus(saleId, status));
  ipcMain.handle('kitchen:openWindow', () => createKitchenWindow());

  ipcMain.handle('reports:summary', (_e, fromDate, toDate) => store.getSalesSummary(fromDate, toDate));

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', (_e, key, value) => store.saveSetting(key, value));

  ipcMain.handle('print:receipt', (_e, saleId) => printReceipt(saleId));

  ipcMain.handle('nav:goToApp', () => {
    if (mainWindow) mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  });
}
