// js/checkout.js
import { db, auth } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const BACKEND_API = "http://localhost:5000"; // Point to your backend URL

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
  } else {
    window.location.href = "login.html";
  }
});

const durationSelect = document.getElementById("durationSelect");
const displayAmount = document.getElementById("displayAmount");

durationSelect.addEventListener("change", () => {
  const selectedOption = durationSelect.options[durationSelect.selectedIndex];
  const price = selectedOption.getAttribute("data-price");
  displayAmount.innerText = `৳${price}`;
});

document.getElementById("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    alert("Please log in to complete your purchase.");
    return;
  }

  const submitBtn = document.getElementById("btnSubmitOrder");
  submitBtn.disabled = true;
  submitBtn.innerText = "Processing Purchase...";

  const productId = document.getElementById("productId").value;
  const productName = document.getElementById("productName").value;
  const duration = durationSelect.value;
  const senderNumber = document.getElementById("senderNumber").value.trim();
  const trxId = document.getElementById("trxId").value.trim().toUpperCase();

  const orderId = `STX-${Date.now()}`;

  try {
    // 1. Create Order in Database
    await setDoc(doc(db, "orders", orderId), {
      orderId: orderId,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      productId: productId,
      productName: productName,
      duration: duration,
      senderNumber: senderNumber,
      trxId: trxId,
      status: "Payment Approved", // Auto-approved for processing
      createdAt: serverTimestamp()
    });

    // 2. Trigger Automated Backend Supplier Purchase
    fetch(`${BACKEND_API}/api/orders/process-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: orderId })
    }).catch(err => console.log("Background trigger sent."));

    alert("Payment submitted successfully! Your key is being generated.");
    window.location.href = "my-key.html";
  } catch (err) {
    alert("Order failed: " + err.message);
    submitBtn.disabled = false;
    submitBtn.innerText = "Submit Order & Receive Key";
  }
});
