const API_URL = "https://backendia-khz7.onrender.com";

let mirrorHistory = [];
let mirrorUser = null;

let username = localStorage.getItem("username");

if (!username) {
  username = prompt("Ingresá tu nombre");
  localStorage.setItem("username", username);
}

document.getElementById("username").innerText = username;

loadUsers();
loadMyHistory();
setInterval(loadUsers, 5000);

// Auto-resize textarea
const messageInput = document.getElementById("message");
messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

messageInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

// Mostrar nombre del archivo seleccionado
document.getElementById("fileUpload").addEventListener("change", function () {
  const name = this.files[0]?.name || "Sin archivo";
  document.getElementById("fileName").innerText = name;
});

async function sendMessage() {
  const input = document.getElementById("message");
  const message = input.value.trim();
  if (!message) return;

  addMessage("user", message);
  input.value = "";
  input.style.height = "auto";

  const loader = document.createElement("div");
  loader.className = "loader message";
  loader.innerText = "IA escribiendo...";
  document.getElementById("chat").appendChild(loader);
  document.getElementById("chat").scrollTop = document.getElementById("chat").scrollHeight;

  const res = await fetch(API_URL + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message,
      user: username,
      personality: document.getElementById("personality").value
    })
  });

  const data = await res.json();
  loader.remove();
  addMessage("bot", data.reply);
}

function addMessage(type, text) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "message " + type;
  div.innerText = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function loadUsers() {
  const res = await fetch(API_URL + "/users");
  const users = await res.json();

  const list = document.getElementById("usersList");
  list.innerHTML = "";

  const onlineCount = users.filter(u => u.online).length;
  document.getElementById("onlineCount").innerText = onlineCount + " en línea";

  users.forEach(u => {
    const card = document.createElement("div");
    card.className = "userCard" + (u.name === mirrorUser ? " active" : "");
    card.onclick = () => loadMirror(u.name);

    const status = document.createElement("span");
    status.className = "statusDot " + (u.online ? "online" : "offline");

    const name = document.createElement("span");
    name.className = "userName";
    name.innerText = u.name;

    card.appendChild(status);
    card.appendChild(name);
    list.appendChild(card);
  });
}

async function loadMirror(user) {
  mirrorUser = user;

  const res = await fetch(API_URL + "/history/" + user);
  const history = await res.json();
  mirrorHistory = history;

  const mirror = document.getElementById("mirrorChat");
  const empty = document.getElementById("mirrorEmpty");
  mirror.innerHTML = "";

  if (!history.length) {
    empty.style.display = "flex";
    return;
  }

  empty.style.display = "none";

  history.forEach(m => {
    const q = document.createElement("div");
    q.className = "mirror-msg-user";
    q.innerText = m.message;

    const a = document.createElement("div");
    a.className = "mirror-msg-bot";
    a.innerText = m.reply;

    mirror.appendChild(q);
    mirror.appendChild(a);
  });

  mirror.scrollTop = mirror.scrollHeight;

  // Marcar activo en la lista
  loadUsers();
}

function joinChat() {
  if (!mirrorHistory.length) return;

  const chat = document.getElementById("chat");
  chat.innerHTML = "";

  mirrorHistory.forEach(m => {
    addMessage("user", m.message);
    addMessage("bot", m.reply);
  });

  alert("Ahora continuás este chat desde tu usuario");
}

async function loadMyHistory() {
  const res = await fetch(API_URL + "/history/" + username);
  const history = await res.json();

  history.forEach(m => {
    addMessage("user", m.message);
    addMessage("bot", m.reply);
  });
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo el historial?")) return;

  await fetch(API_URL + "/delete/" + username, { method: "DELETE" });
  document.getElementById("chat").innerHTML = "";
}

async function uploadFile() {
  const fileInput = document.getElementById("fileUpload");
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("user", username);

  const res = await fetch(API_URL + "/upload", {
    method: "POST",
    body: formData
  });

  if (res.ok) {
    document.getElementById("fileName").innerText = "✓ " + fileInput.files[0].name;
  } else {
    alert("Tipo de archivo no soportado");
  }
}





