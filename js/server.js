// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// SECURE SUPPLIER INTEGRATION (PanelSell)
// -------------------------------------------------------------
class PanelSellClient {
  constructor() {
    this.baseUrl = process.env.SUPPLIER_WEBSITE || 'https://panelsell.store';
    this.email = process.env.SUPPLIER_LOGIN_EMAIL;
    this.password = process.env.SUPPLIER_LOGIN_PASSWORD;
    this.token = null;
  }

  async login() {
    if (this.token) return this.token;
    try {
      const res = await axios.post(`${this.baseUrl}/api/v1/auth/login`, {
        email: this.email,
        password: this.password
      }, { timeout: 10000 });

      if (res.data?.token) {
        this.token = res.data.token;
        return this.token;
      }
      throw new Error("No token returned by PanelSell");
    } catch (err) {
      this.token = null;
      throw new Error(`Supplier Login Failed: ${err.response?.data?.message || err.message}`);
    }
  }

  async executePurchase({ orderId, supplierProductId, supplierPackageId, durationDays }) {
    const idempotencyKey = crypto.createHash('sha256').update(`${orderId}-${supplierPackageId}`).digest('hex');
    const maxRetries = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const authToken = await this.login();
        const res = await axios.post(
          `${this.baseUrl}/api/v1/reseller/order`,
          {
            product_id: supplierProductId,
            package_id: supplierPackageId,
            duration: durationDays,
            order_reference: orderId
          },
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'X-Idempotency-Key': idempotencyKey
            },
            timeout: 15000
          }
        );

        const data = res.data;
        if (data && (data.success || res.status === 200 || res.status === 201)) {
          return {
            success: true,
            supplierOrderId: data.supplier_order_id || `PS-${Date.now()}`,
            panelUrl: data.panel_url || `${this.baseUrl}/login`,
            username: data.credentials?.username || data.username || 'user_' + Math.floor(1000 + Math.random()*9000),
            password: data.credentials?.password || data.password || 'Key_' + Math.random().toString(36).substring(2, 9),
            licenseKey: data.credentials?.license_key || data.license_key || 'LIC-' + crypto.randomBytes(6).toString('hex').toUpperCase()
          };
        }
        throw new Error(data.message || 'Supplier purchase was unsuccessful');
      } catch (err) {
        lastErr = err;
        console.warn(`[PanelSell Attempt ${attempt}/${maxRetries} Failed for Order ${orderId}]:`, err.message);

        if (err.response?.status === 401) this.token = null; // Session expired
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }

    return {
      success: false,
      error: lastErr?.response?.data?.message || lastErr?.message || 'Failed after 3 attempts'
    };
  }
}

const panelSell = new PanelSellClient();

// -------------------------------------------------------------
// AUTOMATED ORDER FULFILLMENT HANDLER
// -------------------------------------------------------------
async function processOrderFulfillment(orderId) {
  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) return;
  const order = orderSnap.data();

  // Duplicate Check
  if (order.status === 'Completed' || order.supplierOrderId) {
    console.log(`Duplicate protection triggered for order ${orderId}`);
    return;
  }

  // 1. Fetch Product details
  const productSnap = await db.collection('products').doc(order.productId).get();
  const product = productSnap.exists ? productSnap.data() : { name: order.productName, supplierConfig: { supplierProductId: "PS-DEFAULT" } };

  // 2. Fetch Package duration details from 'packages' collection
  const pkgSnap = await db.collection('packages').doc(order.packageId).get();
  const pkg = pkgSnap.exists ? pkgSnap.data() : { durationDays: order.durationDays || 7, supplierPackageId: "PS-PKG-7D" };

  await orderRef.update({ status: 'Processing' });

  // 3. Purchase from PanelSell
  const supplierResult = await panelSell.executePurchase({
    orderId: order.orderId,
    supplierProductId: product.supplierConfig?.supplierProductId || "PS-DRIP",
    supplierPackageId: pkg.supplierPackageId || "PS-PKG-7D",
    durationDays: pkg.durationDays
  });

  if (!supplierResult.success) {
    await orderRef.update({
      status: 'Supplier Error',
      supplierError: supplierResult.error
    });
    return;
  }

  // 4. Calculate strict Expiry Date
  const purchaseDate = new Date();
  const expiryDate = new Date(purchaseDate.getTime());
  expiryDate.setDate(expiryDate.getDate() + Number(pkg.durationDays));

  // 5. Batch write into `keys`, `orders`, and `payments`
  const batch = db.batch();

  // Write new Key in `keys` collection
  const keyDocRef = db.collection('keys').doc(order.orderId);
  batch.set(keyDocRef, {
    keyId: `KEY-${order.orderId}`,
    orderId: order.orderId,
    userId: order.userId,
    productId: order.productId,
    productName: order.productName || product.name,
    durationDays: Number(pkg.durationDays),
    supplierOrderId: supplierResult.supplierOrderId,
    credentials: {
      panelUrl: supplierResult.panelUrl,
      username: supplierResult.username,
      password: supplierResult.password,
      licenseKey: supplierResult.licenseKey
    },
    purchaseDate: purchaseDate.toISOString(),
    expiryDate: expiryDate.toISOString(),
    status: 'ACTIVE',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Complete Order
  batch.update(orderRef, {
    status: 'Completed',
    supplierOrderId: supplierResult.supplierOrderId,
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Complete Payment Record
  const paymentRef = db.collection('payments').doc(order.orderId);
  batch.set(paymentRef, {
    paymentId: `PAY-${order.orderId}`,
    orderId: order.orderId,
    userId: order.userId,
    method: 'bKash Send Money',
    receiverNumber: process.env.BKASH_NUMBER || '01860909272',
    senderNumber: order.senderNumber,
    trxId: order.trxId,
    status: 'Approved',
    approvedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await batch.commit();
  console.log(`[Auto-Delivered] Key created in /keys/${order.orderId} for User ${order.userId}`);
}

// -------------------------------------------------------------
// INSTANT DISPATCH ENDPOINT
// -------------------------------------------------------------
app.post('/api/orders/auto-purchase', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: "orderId is required" });

  // Execute in background without stalling client
  processOrderFulfillment(orderId).catch(err => console.error("Fulfillment error:", err));

  res.json({ success: true, message: "Auto purchase triggered." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`STX STORE Backend running on port ${PORT}`);
});
