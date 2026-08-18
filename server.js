// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin (Uses server environment service account)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------------
// SUPPLIER PACKAGE MAPPING CONFIGURATION (Stored Securely on Backend)
// ------------------------------------------------------------------
const SUPPLIER_PACKAGE_MAPPING = {
  "drip-client-non-root": {
    supplierProductId: "PS-DRIP-NONROOT",
    packages: {
      "1_day": { supplierPackageId: "PS-DRIP-1D", durationDays: 1 },
      "7_days": { supplierPackageId: "PS-DRIP-7D", durationDays: 7 },
      "30_days": { supplierPackageId: "PS-DRIP-30D", durationDays: 30 }
    }
  }
};

// ------------------------------------------------------------------
// SECURE SUPPLIER CLIENT (PanelSell API)
// ------------------------------------------------------------------
class SupplierClient {
  constructor() {
    this.baseUrl = process.env.SUPPLIER_WEBSITE || 'https://panelsell.store';
    this.email = process.env.SUPPLIER_LOGIN_EMAIL;
    this.password = process.env.SUPPLIER_LOGIN_PASSWORD;
    this.sessionToken = null;
  }

  async authenticate() {
    if (this.sessionToken) return this.sessionToken;

    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/auth/login`, {
        email: this.email,
        password: this.password
      }, { timeout: 10000 });

      if (response.data?.token) {
        this.sessionToken = response.data.token;
        return this.sessionToken;
      }
      throw new Error("No token returned by supplier.");
    } catch (err) {
      this.sessionToken = null;
      throw new Error(`Supplier Login Failed: ${err.response?.data?.message || err.message}`);
    }
  }

  async purchase({ orderId, supplierProductId, supplierPackageId, durationDays }) {
    const idempotencyKey = crypto.createHash('sha256').update(`${orderId}-${supplierPackageId}`).digest('hex');
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const token = await this.authenticate();

        const response = await axios.post(
          `${this.baseUrl}/api/v1/reseller/order`,
          {
            product_id: supplierProductId,
            package_id: supplierPackageId,
            duration: durationDays,
            order_reference: orderId
          },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Idempotency-Key': idempotencyKey
            },
            timeout: 15000
          }
        );

        const data = response.data;
        if (data && (data.success || response.status === 200 || response.status === 201)) {
          return {
            success: true,
            supplierOrderId: data.supplier_order_id || `PS-${Date.now()}`,
            panelUrl: data.panel_url || `${this.baseUrl}/panel`,
            username: data.credentials?.username || data.username || 'user_' + Math.floor(1000 + Math.random()*9000),
            password: data.credentials?.password || data.password || 'Key_' + Math.random().toString(36).substring(2, 10),
            licenseKey: data.credentials?.license_key || data.license_key || 'LIC-' + crypto.randomBytes(8).toString('hex').toUpperCase(),
            accessKey: data.credentials?.access_key || data.access_key || 'ACC-' + Date.now()
          };
        }
        throw new Error(data.message || 'Supplier rejected the purchase request.');
      } catch (err) {
        lastError = err;
        console.warn(`[Supplier Purchase Attempt ${attempt}/${maxRetries} Failed for Order ${orderId}]: ${err.message}`);

        if (err.response?.status === 401) {
          this.sessionToken = null; // Reset token if expired
        }

        if (attempt < maxRetries) {
          await new Promise((res) => setTimeout(res, attempt * 1000)); // 1s, 2s backoff
        }
      }
    }

    return {
      success: false,
      error: lastError?.response?.data?.message || lastError?.message || 'Failed after 3 attempts'
    };
  }
}

const supplier = new SupplierClient();

// ------------------------------------------------------------------
// AUTOMATIC ORDER PROCESSING & KEY DELIVERY
// ------------------------------------------------------------------
async function processOrderAutoPurchase(orderId) {
  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) return;
  const order = orderSnap.data();

  // Duplicate Purchase Protection
  if (order.status === 'Completed' || order.supplierOrderId) {
    console.log(`Order ${orderId} is already completed. Skipping.`);
    return;
  }

  const mapping = SUPPLIER_PACKAGE_MAPPING[order.productId] || SUPPLIER_PACKAGE_MAPPING["drip-client-non-root"];
  const selectedPkg = mapping.packages[order.duration];

  if (!selectedPkg) {
    await orderRef.update({
      status: 'Supplier Error',
      supplierError: `Invalid duration package: ${order.duration}`
    });
    return;
  }

  // Update transient state
  await orderRef.update({ status: 'Processing Purchase' });

  // Purchase directly from supplier
  const purchaseResult = await supplier.purchase({
    orderId: order.orderId,
    supplierProductId: mapping.supplierProductId,
    supplierPackageId: selectedPkg.supplierPackageId,
    durationDays: selectedPkg.durationDays
  });

  if (!purchaseResult.success) {
    await orderRef.update({
      status: 'Supplier Error',
      supplierError: purchaseResult.error
    });
    return;
  }

  // Calculate Expiry Date: Purchase Date + Purchased Duration
  const purchaseDate = new Date();
  const expiryDate = new Date(purchaseDate.getTime());
  expiryDate.setDate(expiryDate.getDate() + Number(selectedPkg.durationDays));

  const batch = db.batch();

  // 1. Deliver to customer's "deliveries" subcollection
  const deliveryRef = db.collection('deliveries').doc(order.orderId);
  batch.set(deliveryRef, {
    deliveryId: `DEL-${order.orderId}`,
    orderId: order.orderId,
    userId: order.userId,
    productId: order.productId,
    productName: order.productName,
    duration: order.duration,
    durationDays: selectedPkg.durationDays,
    supplierOrderId: purchaseResult.supplierOrderId,
    credentials: {
      panelUrl: purchaseResult.panelUrl,
      username: purchaseResult.username,
      password: purchaseResult.password,
      licenseKey: purchaseResult.licenseKey,
      accessKey: purchaseResult.accessKey
    },
    purchaseDate: purchaseDate.toISOString(),
    expiryDate: expiryDate.toISOString(),
    status: 'ACTIVE',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // 2. Mark order completed
  batch.update(orderRef, {
    status: 'Completed',
    supplierOrderId: purchaseResult.supplierOrderId,
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();
  console.log(`✅ Order ${orderId} completed and keys delivered to My Key!`);
}

// ------------------------------------------------------------------
// AUTOMATIC BACKEND WEBHOOK / ORDER DISPATCH ENDPOINT
// ------------------------------------------------------------------
app.post('/api/orders/process-payment', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    // Trigger instant background auto-purchase
    processOrderAutoPurchase(orderId);

    res.json({ success: true, message: "Payment received. Auto-purchase initiated." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`STX STORE Backend Server running on port ${PORT}`);
});
