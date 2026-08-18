// js/my-key.js
import { db, auth } from './firebase-config.js';
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let ticker = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    loadKeysFromFirestore(user.uid);
  } else {
    window.location.href = "login.html";
  }
});

function loadKeysFromFirestore(userId) {
  // Query only records belonging to this user in the 'keys' collection
  const q = query(collection(db, "keys"), where("userId", "==", userId));

  onSnapshot(q, (snapshot) => {
    const grid = document.getElementById("keysGrid");
    grid.innerHTML = "";

    if (snapshot.empty) {
      grid.innerHTML = `
        <div class="empty-keys">
          <h3>No Keys Available</h3>
          <p>Your purchased panel credentials will appear here automatically once processed.</p>
        </div>
      `;
      return;
    }

    const keyList = [];
    snapshot.forEach((doc) => keyList.push(doc.data()));

    renderKeysUI(keyList);
    startLiveCountdown(keyList);
  });
}

function calculateTimeRemaining(expiryDateIso) {
  const diff = new Date(expiryDateIso).getTime() - new Date().getTime();
  if (diff <= 0) {
    return { isExpired: true, text: "EXPIRED" };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let formatted = "";
  if (days > 0) formatted += `${days} Days `;
  formatted += `${hours} Hours ${minutes} Mins`;

  return { isExpired: false, text: formatted };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function renderKeysUI(items) {
  const grid = document.getElementById("keysGrid");
  grid.innerHTML = "";

  items.forEach((item) => {
    const timeObj = calculateTimeRemaining(item.expiryDate);
    const status = timeObj.isExpired ? "EXPIRED" : "ACTIVE";
    const statusClass = timeObj.isExpired ? "badge-expired" : "badge-active";

    const card = document.createElement("div");
    card.className = "key-card";

    card.innerHTML = `
      <div class="card-header">
        <h3 class="panel-name">${item.productName.toUpperCase()}</h3>
        <span class="status-badge ${statusClass}">${status}</span>
      </div>

      <div class="credentials-box">
        <div class="cred-row">
          <span class="cred-label">Duration:</span>
          <span class="cred-val">${item.durationDays} Days</span>
        </div>

        <div class="cred-row">
          <span class="cred-label">Panel URL:</span>
          <div class="action-wrap">
            <span class="cred-val mono">${item.credentials.panelUrl}</span>
            <button class="btn-copy" onclick="copyValue('${item.credentials.panelUrl}')">COPY</button>
          </div>
        </div>

        <div class="cred-row">
          <span class="cred-label">Username:</span>
          <div class="action-wrap">
            <span class="cred-val mono">${item.credentials.username}</span>
            <button class="btn-copy" onclick="copyValue('${item.credentials.username}')">COPY</button>
          </div>
        </div>

        <div class="cred-row">
          <span class="cred-label">Password:</span>
          <div class="action-wrap">
            <span class="cred-val mono" id="pwd-${item.keyId}">••••••••</span>
            <button class="btn-reveal" onclick="togglePasswordVisibility('${item.keyId}', '${item.credentials.password}')">SHOW PASSWORD</button>
            <button class="btn-copy" onclick="copyValue('${item.credentials.password}')">COPY</button>
          </div>
        </div>

        <div class="cred-row">
          <span class="cred-label">License/Key:</span>
          <div class="action-wrap">
            <span class="cred-val mono">${item.credentials.licenseKey}</span>
            <button class="btn-copy" onclick="copyValue('${item.credentials.licenseKey}')">COPY</button>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <div><strong>Purchase Date:</strong> ${formatDate(item.purchaseDate)}</div>
        <div><strong>Expiry Date:</strong> ${formatDate(item.expiryDate)}</div>
        <div class="countdown-row">
          <strong>Remaining:</strong>
          <span id="time-${item.keyId}" class="${timeObj.isExpired ? 'txt-expired' : 'txt-active'}">
            ${timeObj.text}
          </span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

function startLiveCountdown(items) {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    items.forEach((item) => {
      const el = document.getElementById(`time-${item.keyId}`);
      if (el) {
        const timeObj = calculateTimeRemaining(item.expiryDate);
        el.innerText = timeObj.text;
        el.className = timeObj.isExpired ? 'txt-expired' : 'txt-active';
      }
    });
  }, 30000);
}

// Global button click helpers
window.copyValue = function(val) {
  navigator.clipboard.writeText(val).then(() => alert("Copied to clipboard!"));
};

window.togglePasswordVisibility = function(keyId, realPassword) {
  const el = document.getElementById(`pwd-${keyId}`);
  const btn = event.target;
  if (el.innerText === '••••••••') {
    el.innerText = realPassword;
    btn.innerText = 'HIDE PASSWORD';
  } else {
    el.innerText = '••••••••';
    btn.innerText = 'SHOW PASSWORD';
  }
};
