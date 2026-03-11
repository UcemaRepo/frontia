const API_URL = "https://backendia-khz7.onrender.com";

let mirrorHistory = [];
let mirrorUser = null;
let inheritedFrom = null;   // usuario cuyo historial estamos continuando
let lastActivityTime = Date.now();

// ── Usuario ────────────────────────────────────────────
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Ingresá tu nombre");
  localStorage.setItem("username", username);
}
document.getElementById("username").innerText = username;

// ── Init ───────────────────────────────────────────────
loadUsers();
loadMyHistory();
loadPersonalityModal();

// Heartbeat cada 20 segundos
setInterval(sendHeartbeat, 20000);
// Actualizar lista de usuarios cada 5 segundos
setInterval(loadUsers, 5000);

// ── Actividad del usuario ──────────────────────────────
["mousemove", "keydown", "click", "scroll"].forEach(evt =>
  document.addEventListener(evt, () => { lastActivityTime = Date.now(); })
);

function isUserActive() {
  return (Date.now() - lastActivityTime) < 300000; // 5 minutos
}

async function sendHeartbeat() {
  if (!username) return;  // nunca mandar heartbeat sin usuario
  await fetch(API_URL + "/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, active: isUserActive() })
  }).catch(() => {});
}

// Marcar offline al cerrar la pestaña
window.addEventListener("beforeunload", () => {
  const payload = new Blob(
    [JSON.stringify({ user: username })],
    { type: "application/json" }
  );
  navigator.sendBeacon(API_URL + "/offline", payload);
});

// ── Auto-resize textarea ───────────────────────────────
const messageInput = document.getElementById("message");
messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
  lastActivityTime = Date.now();
});

messageInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

document.getElementById("fileUpload").addEventListener("change", function () {
  const name = this.files[0]?.name || "Sin archivo";
  document.getElementById("fileName").innerText = name;
});

// ── Enviar mensaje ─────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById("message");
  const message = input.value.trim();
  if (!message) return;

  lastActivityTime = Date.now();
  addMessage("user", message);
  input.value = "";
  input.style.height = "auto";

  const loader = document.createElement("div");
  loader.className = "loader";
  document.getElementById("chat").appendChild(loader);
  document.getElementById("chat").scrollTop = 99999;

  const res = await fetch(API_URL + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      user: username,
      personality: document.getElementById("personality").value,
      inherited_from: inheritedFrom   // null si es chat propio
    })
  });

  const data = await res.json();
  loader.remove();
  renderBotMessage(data.reply);
}

// ── Renderizado de mensajes ────────────────────────────
function addMessage(type, text) {
  const chat = document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "message " + type;
  div.innerText = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function renderBotMessage(raw) {
  const chat = document.getElementById("chat");
  const container = document.createElement("div");
  container.className = "message bot";

  const parts = parseRichContent(raw);

  parts.forEach(part => {
    if (part.type === "text") {
      if (part.content.trim()) {
        const p = document.createElement("p");
        p.className = "bot-text";
        p.innerText = part.content.trim();
        container.appendChild(p);
      }
    } else if (part.type === "table") {
      container.appendChild(renderTable(part.content));
    } else if (part.type === "widget") {
      container.appendChild(renderWidget(part.title, part.content));
    } else if (part.type === "download") {
      container.appendChild(renderDownload(part.filename, part.content));
    }
  });

  chat.appendChild(container);
  chat.scrollTop = chat.scrollHeight;
}

function parseRichContent(raw) {
  const parts = [];
  // Regex que captura <table>, <widget title="...">, <download filename="...">
  const regex = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    // Texto antes del tag
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: raw.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      parts.push({ type: "table", content: match[1].trim() });
    } else if (match[2] !== undefined) {
      parts.push({ type: "widget", title: match[2], content: match[3].trim() });
    } else if (match[4] !== undefined) {
      parts.push({ type: "download", filename: match[4], content: match[5] });
    }

    lastIndex = regex.lastIndex;
  }

  // Texto restante
  if (lastIndex < raw.length) {
    parts.push({ type: "text", content: raw.slice(lastIndex) });
  }

  return parts;
}

function renderTable(raw) {
  const lines = raw.split("\n").filter(l => l.trim());
  const wrapper = document.createElement("div");
  wrapper.className = "rich-table-wrap";

  const table = document.createElement("table");
  table.className = "rich-table";

  lines.forEach((line, i) => {
    const row = document.createElement("tr");
    const cells = line.split("|").map(c => c.trim());
    cells.forEach(cell => {
      const td = document.createElement(i === 0 ? "th" : "td");
      td.innerText = cell;
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  wrapper.appendChild(table);
  return wrapper;
}

function renderWidget(title, content) {
  const div = document.createElement("div");
  div.className = "rich-widget";
  div.innerHTML = `<div class="widget-title">${title}</div><div class="widget-body">${content}</div>`;
  return div;
}

function renderDownload(filename, content) {
  const div = document.createElement("div");
  div.className = "rich-download";

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const sizeKB = (blob.size / 1024).toFixed(1);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  const p1 = document.createElementNS(svgNS, "path");
  p1.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const p2 = document.createElementNS(svgNS, "polyline");
  p2.setAttribute("points", "7,10 12,15 17,10");
  const p3 = document.createElementNS(svgNS, "line");
  p3.setAttribute("x1", "12"); p3.setAttribute("y1", "15");
  p3.setAttribute("x2", "12"); p3.setAttribute("y2", "3");
  svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "download-link";
  link.innerText = filename;

  const size = document.createElement("span");
  size.className = "download-size";
  size.innerText = sizeKB + " KB";

  div.appendChild(svg);
  div.appendChild(link);
  div.appendChild(size);
  return div;
}

// ── Usuarios ───────────────────────────────────────────
async function loadUsers() {
  const res = await fetch(API_URL + "/users");
  const users = await res.json();

  const list = document.getElementById("usersList");
  list.innerHTML = "";

  const onlineCount = users.filter(u => u.status === "online").length;
  document.getElementById("onlineCount").innerText = onlineCount + " en línea";

  // Ordenar: online → away → offline
  const order = { online: 0, away: 1, offline: 2 };
  users.sort((a, b) => order[a.status] - order[b.status]);

  users.forEach(u => {
    const card = document.createElement("div");
    card.className = "userCard" + (u.name === mirrorUser ? " active" : "");
    card.onclick = () => loadMirror(u.name);

    const dot = document.createElement("span");
    dot.className = `statusDot ${u.status}`;
    dot.title = u.status === "online" ? "En línea" : u.status === "away" ? "Ausente" : "Desconectado";

    const name = document.createElement("span");
    name.className = "userName";
    name.innerText = u.name;

    const badge = document.createElement("span");
    badge.className = `status-badge ${u.status}`;
    badge.innerText = u.status === "online" ? "online" : u.status === "away" ? "ausente" : "offline";

    card.appendChild(dot);
    card.appendChild(name);
    card.appendChild(badge);
    list.appendChild(card);
  });
}

// ── Mirror ─────────────────────────────────────────────
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
  loadUsers();
}

function joinChat() {
  if (!mirrorHistory.length) return;

  inheritedFrom = mirrorUser;

  const chat = document.getElementById("chat");
  chat.innerHTML = "";

  // Banner indicando que se heredó el contexto
  const banner = document.createElement("div");
  banner.className = "join-banner";
  banner.innerHTML = `Continuando el chat de <strong>${mirrorUser}</strong> — el bot tiene todo el contexto. <button onclick="leaveInheritedChat()">Salir</button>`;
  chat.appendChild(banner);

  mirrorHistory.forEach(m => {
    addMessage("user", m.message);
    renderBotMessage(m.reply);
  });

  document.getElementById("myStatus").innerText = "Continuando chat de " + mirrorUser;
}

function leaveInheritedChat() {
  inheritedFrom = null;
  document.getElementById("chat").innerHTML = "";
  document.getElementById("myStatus").innerText = "Agente IA · activo";
  loadMyHistory();
}

async function loadMyHistory() {
  const res = await fetch(API_URL + "/history/" + username);
  const history = await res.json();
  history.forEach(m => {
    addMessage("user", m.message);
    renderBotMessage(m.reply);
  });
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo el historial?")) return;
  await fetch(API_URL + "/delete/" + username, { method: "DELETE" });
  document.getElementById("chat").innerHTML = "";
}

// ── Upload ─────────────────────────────────────────────
async function uploadFile() {
  const fileInput = document.getElementById("fileUpload");
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("user", username);

  const res = await fetch(API_URL + "/upload", { method: "POST", body: formData });

  if (res.ok) {
    document.getElementById("fileName").innerText = "✓ " + fileInput.files[0].name;
  } else {
    alert("Tipo de archivo no soportado");
  }
}

// ── Modal de personalidad ──────────────────────────────
const PRESET_LABELS = {
  normal:   "Normal",
  analyst:  "Analista",
  creative: "Creativo",
  strict:   "Estricto",
  dev:      "Dev",
  coach:    "Coach"
};

async function loadPersonalityModal() {
  const res = await fetch(API_URL + "/personality/" + username);
  const data = await res.json();

  document.getElementById("customPersonality").value = data.custom || "";

  // Cargar chips de presets
  const chips = document.getElementById("presetChips");
  chips.innerHTML = "";
  Object.entries(data.presets).forEach(([key, text]) => {
    const chip = document.createElement("button");
    chip.className = "preset-chip";
    chip.innerText = PRESET_LABELS[key] || key;
    chip.onclick = () => {
      document.getElementById("customPersonality").value = text;
    };
    chips.appendChild(chip);
  });
}

function openPersonalityModal() {
  document.getElementById("personalityModal").classList.add("open");
  loadPersonalityModal();
}

function closePersonalityModal() {
  document.getElementById("personalityModal").classList.remove("open");
}

async function savePersonality() {
  const custom = document.getElementById("customPersonality").value.trim();
  await fetch(API_URL + "/personality/" + username, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custom })
  });

  // Si hay personalidad custom, forzar "custom" en el selector
  if (custom) {
    document.getElementById("personality").value = "custom";
  }

  closePersonalityModal();
}

async function clearPersonality() {
  document.getElementById("customPersonality").value = "";
  await fetch(API_URL + "/personality/" + username, { method: "DELETE" });
}

// Cerrar modal con click fuera
document.getElementById("personalityModal").addEventListener("click", function(e) {
  if (e.target === this) closePersonalityModal();
});
