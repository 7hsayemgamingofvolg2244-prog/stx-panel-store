// js/checkout.js
import { db, auth } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const BACKEND_URL = "http://localhost:5000";
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
  } else {
    window.location.href = "login.html";
  }
});

const pkgSelect = document.getElementById("packageSelect");
const totalDisplay = document.getElementById("totalDisplay");

pkgSelect.addEventListener("change", () => {
  const selected = pkgSelect.options[pkgSelect.selectedIndex];
  totalDisplay.innerText = `৳${selected.getAttribute("data-price")}`;
});

document.getElementById("orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) return alert("Please log in first.");

  const btn = document.getElementById("btnPlaceOrder");
  btn.disabled = true;
  btn.innerText = "Processing Key Delivery...";

  const orderId = `STX-${Date.now()}`;
  const selectedPkg = pkgSelect.options[pkgSelect.selectedIndex];
  const packageId = pkgSelect.value;
  const durationDays = Number(selectedPkg.getAttribute("data-days"));
  const productId = document.getElementById("productId").value;
  const productName = document.getElementById("productName").value;
  const senderNumber = document.getElementById("senderNumber").value.trim();
  const trxId = document.getElementById("trxId").value.trim().toUpperCase();

  try {
    // 1. Create Record in 'orders' collection
    await setDoc(doc(db, "orders", orderId), {
      orderId: orderId,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      productId: productId,
      productName: productName,
      packageId: packageId,
      durationDays: durationDays,
      senderNumber: senderNumber,
      trxId: trxId,
      status: "Payment Approved",
      supplierOrderId: null,
      createdAt: serverTimestamp()
    });

    // 2. Create Payment reference in 'payments' collection
    await setDoc(doc(db, "payments", orderId), {
      paymentId: `PAY-${orderId}`,
      orderId: orderId,
      userId: currentUser.uid,
      method: "bKash Send Money",
      receiverNumber: "01860909272",
      senderNumber: senderNumber,
      trxId: trxId,
      status: "Pending Verification",
      createdAt: serverTimestamp()
    });

    // 3. Trigger Backend Auto-Purchase with Supplier
    fetch(`${BACKEND_URL}/api/orders/auto-purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderId })
    }).catch(err => console.log("Backend triggered."));

    // Redirect user to My Key page
    window.location.href = "my-key.html";
  } catch (err) {
    alert("Error placing order: " + err.message);
    btn.disabled = false;
    btn.innerText = "Submit & Get Key Automatically";
  }
});
