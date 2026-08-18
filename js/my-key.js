// js/my-key.js
import { db, auth } from './firebase-config.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let timerInterval = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    loadUserKeys(user.uid);
  } else {
    window.location.href = "login.html";
  }
});

function loadUserKeys(userId) {
  const deliveriesQuery = query(
    collection(db, "deliveries"),
    where("userId", "==", userId)
  );

  onSnapshot(deliveriesQuery, (snapshot) => {
    const container = document.getElementById("keysGrid");
    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-box">
          <h3>No Keys Delivered Yet</h3>
          <p>When you complete a purchase, your panel keys and passwords will automatically appear here.</p>
          <a href="products.html" class="btn-primary">Browse Panels</a>
        </div>
      `;
      return;
    }

    const deliveryList = [];
    snapshot.forEach((doc) => deliveryList.push(doc.data()));

    renderKeys(deliveryList);
    startExpiryTracker(deliveryList);
  });
}

function calculateExpiryCountdown(expiryIso) {
  const diff = new Date(expiryIso).getTime() - new Date().getTime();
  
  if (diff <= 0) {
    return { isExpired: true, text: "EXPIRED" };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let timeString = "";
  if (days > 0) timeString += `${days} Days `;
  timeString += `${hours} Hours ${minutes} Mins`;

  return { isExpired: false, text: timeString };
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function renderKeys(deliveries) {
  const container = document.getElementById("keysGrid");
  container.innerHTML = "";

  deliveries.forEach((item) => {
    const expiry = calculateExpiryCountdown(item.expiryDate);
    const statusText = expiry.isExpired ? 'EXPIRED' : 'ACTIVE';
    const statusClass = expiry.isExpired ? 'status-expired' : 'status-active';

    const card = document.createElement("div");
    card.className = "key-card";

    card.innerHTML = `
      <div class="key-card-header">
        <h3 class="product-title">${item.productName.toUpperCase()}</h3>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>

      <div class="key-body">
        <div class="item-row">
          <span class="label">Duration:</span>
          <span class="val">${item.durationDays} Days</span>
        </div>

        <div class="item-row">
          <span class="label">Panel URL:</span>
          <div class="action-field">
            <span class="val mono">${item.credentials.panelUrl}</span>
            <button class="btn-sm" onclick="copyText('${item.credentials.panelUrl}')">COPY</button>
          </div>
        </div>

        <div class="item-row">
          <span class="label">Username:</span>
          <div class="action-field">
            <span class="val mono">${item.credentials.username}</span>
            <button class="btn-sm" onclick="copyText('${item.credentials.username}')">COPY</button>
          </div>
        </div>

        <div class="item-row">
          <span class="label">Password:</span>
          <div class="action-field">
            <span class="val mono" id="pwd-${item.deliveryId}">••••••••</span>
            <button class="btn-sm" onclick="togglePassword('${item.deliveryId}', '${item.credentials.password}')">SHOW PASSWORD</button>
            <button class="btn-sm" onclick="copyText('${item.credentials.password}')">COPY</button>
          </div>
        </div>

        <div class="item-row">
          <span class="label">License/Key:</span>
          <div class="action-field">
            <span class="val mono">${item.credentials.licenseKey}</span>
            <button class="btn-sm" onclick="copyText('${item.credentials.licenseKey}')">COPY</button>
          </div>
        </div>
      </div>

      <div class="key-footer">
        <div><strong>Purchase Date:</strong> ${formatDate(item.purchaseDate)}</div>
        <div><strong>Expiry Date:</strong> ${formatDate(item.expiryDate)}</div>
        <div class="remaining-row">
          <strong>Remaining:</strong>
          <span id="countdown-${item.deliveryId}" class="${expiry.isExpired ? 'text-expired' : 'text-active'}">
            ${expiry.text}
          </span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function startExpiryTracker(deliveries) {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    deliveries.forEach((item) => {
      const countdownEl = document.getElementById(`countdown-${item.deliveryId}`);
      if (countdownEl) {
        const expiry = calculateExpiryCountdown(item.expiryDate);
        countdownEl.innerText = expiry.text;
        countdownEl.className = expiry.isExpired ? 'text-expired' : 'text-active';
      }
    });
  }, 30000);
}

// Global functions for buttons
window.copyText = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert("Copied to clipboard!");
  });
};

window.togglePassword = function(id, rawPassword) {
  const el = document.getElementById(`pwd-${id}`);
  const btn = event.target;
  if (el.innerText === '••••••••') {
    el.innerText = rawPassword;
    btn.innerText = 'HIDE PASSWORD';
  } else {
    el.innerText = '••••••••';
    btn.innerText = 'SHOW PASSWORD';
  }
};
