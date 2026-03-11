const API_URL = "https://backendia-khz7.onrender.com";

// ── Estado global ──────────────────────────────────────
let mirrorHistory    = [];
let mirrorUser       = null;
let chatOwner        = null;   // si != null, estamos dentro del chat de otra persona
let lastActivityTime = Date.now();
let lastEventTs      = 0;      // timestamp del último evento procesado (chat compartido)
let eventPollTimer   = null;   // polling cuando estás DENTRO del chat de otro
let mirrorPollTimer  = null;   // polling del panel espejo (solo observando)
let mirrorMsgCount   = 0;      // cuántos mensajes había al cargar el espejo

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
setInterval(sendHeartbeat, 20000);
setInterval(loadUsers, 5000);

// ── Actividad ──────────────────────────────────────────
["mousemove", "keydown", "click", "scroll"].forEach(evt =>
  document.addEventListener(evt, () => { lastActivityTime = Date.now(); })
);

function isUserActive() {
  return (Date.now() - lastActivityTime) < 300000;
}

async function sendHeartbeat() {
  if (!username) return;
  await fetch(API_URL + "/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, active: isUserActive() })
  }).catch(() => {});
}

window.addEventListener("beforeunload", () => {
  // Avisar que salimos del chat compartido si estábamos en uno
  if (chatOwner) {
    navigator.sendBeacon(API_URL + "/leave-chat",
      new Blob([JSON.stringify({ user: username, owner: chatOwner })],
               { type: "application/json" }));
  }
  navigator.sendBeacon(API_URL + "/offline",
    new Blob([JSON.stringify({ user: username })],
             { type: "application/json" }));
});

// ── Resize textarea ────────────────────────────────────
const messageInput = document.getElementById("message");
messageInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
  lastActivityTime = Date.now();
});
messageInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById("fileUpload").addEventListener("change", function () {
  document.getElementById("fileName").innerText = this.files[0]?.name || "Sin archivo";
});

// ── Enviar mensaje ─────────────────────────────────────
async function sendMessage() {
  const input   = document.getElementById("message");
  const message = input.value.trim();
  if (!message) return;

  lastActivityTime = Date.now();
  // El chat principal SIEMPRE es el propio - chatOwner solo aplica al panel espejo
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
      user:        username,
      personality: document.getElementById("personality").value,
      chat_owner:  null   // siempre nulo: el chat principal es siempre el propio
    })
  });

  const data = await res.json();
  loader.remove();
  renderBotMessage(data.reply);

  // Notificar a quienes tengan tu chat abierto en el espejo
  fetch(API_URL + "/notify-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: username, actor: username })
  }).catch(() => {});
}

// ── Renderizado de mensajes ────────────────────────────
function addMessage(type, text, authorLabel = null) {
  const chat = document.getElementById("chat");
  const wrap = document.createElement("div");
  wrap.className = "msg-wrap " + type;

  if (authorLabel) {
    const label = document.createElement("span");
    label.className = "msg-author";
    label.innerText = authorLabel;
    wrap.appendChild(label);
  }

  const div = document.createElement("div");
  div.className = "message " + type;
  div.innerText = text;
  wrap.appendChild(div);

  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function renderBotMessage(raw) {
  const chat      = document.getElementById("chat");
  const container = document.createElement("div");
  container.className = "message bot";

  parseRichContent(raw).forEach(part => {
    if (part.type === "text" && part.content.trim()) {
      const p = document.createElement("p");
      p.className = "bot-text";
      p.innerText = part.content.trim();
      container.appendChild(p);
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
  const regex = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;
  let lastIndex = 0, match;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex)
      parts.push({ type: "text", content: raw.slice(lastIndex, match.index) });

    if (match[1] !== undefined)      parts.push({ type: "table",    content: match[1].trim() });
    else if (match[2] !== undefined) parts.push({ type: "widget",   title: match[2], content: match[3].trim() });
    else if (match[4] !== undefined) parts.push({ type: "download", filename: match[4], content: match[5] });

    lastIndex = regex.lastIndex;
  }
  if (lastIndex < raw.length) parts.push({ type: "text", content: raw.slice(lastIndex) });
  return parts;
}

function renderTable(raw) {
  const wrapper = document.createElement("div");
  wrapper.className = "rich-table-wrap";
  const table = document.createElement("table");
  table.className = "rich-table";
  raw.split("\n").filter(l => l.trim()).forEach((line, i) => {
    const row = document.createElement("tr");
    line.split("|").map(c => c.trim()).forEach(cell => {
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
  const div  = document.createElement("div");
  div.className = "rich-download";
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const sizeKB = (blob.size / 1024).toFixed(1);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  const p1 = document.createElementNS(svgNS, "path");
  p1.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const p2 = document.createElementNS(svgNS, "polyline"); p2.setAttribute("points", "7,10 12,15 17,10");
  const p3 = document.createElementNS(svgNS, "line");
  p3.setAttribute("x1", "12"); p3.setAttribute("y1", "15");
  p3.setAttribute("x2", "12"); p3.setAttribute("y2", "3");
  svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3);

  const link = document.createElement("a");
  link.href = url; link.download = filename;
  link.className = "download-link"; link.innerText = filename;

  const size = document.createElement("span");
  size.className = "download-size"; size.innerText = sizeKB + " KB";

  div.appendChild(svg); div.appendChild(link); div.appendChild(size);
  return div;
}

// ── Evento visual en el chat ───────────────────────────
function addEventBanner(text) {
  const chat = document.getElementById("chat");
  const div  = document.createElement("div");
  div.className = "event-banner";
  div.innerText = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ── Polling de eventos (cuando estás en un chat compartido) ────────────
function startEventPolling(owner) {
  stopEventPolling();
  lastEventTs = Date.now() / 1000;
  // Guardar cuántos mensajes había al entrar para saber desde dónde agregar
  fetch(API_URL + "/history/" + owner)
    .then(r => r.json())
    .then(h => { window._sharedMsgCount = h.length; });

  eventPollTimer = setInterval(async () => {
    try {
      const res    = await fetch(`${API_URL}/events/${owner}?since=${lastEventTs}`);
      const events = await res.json();
      events.forEach(ev => {
        lastEventTs = Math.max(lastEventTs, ev.ts);
        if (ev.actor === username) return; // ignorar los propios

        if (ev.type === "join") {
          appendSharedEvent(`${ev.actor} se unió al chat`);
          updateSharedChatHeader(owner);
        } else if (ev.type === "leave") {
          appendSharedEvent(`${ev.actor} salió del chat`);
          updateSharedChatHeader(owner);
        } else if (ev.type === "message") {
          refreshSharedPanel(owner);
        }
      });
    } catch (_) {}
  }, 3000);
}

function stopEventPolling() {
  if (eventPollTimer) { clearInterval(eventPollTimer); eventPollTimer = null; }
  window._sharedMsgCount = 0;
}

// Recargar solo los mensajes nuevos en el panel espejo
async function refreshSharedPanel(owner) {
  const res     = await fetch(API_URL + "/history/" + owner);
  const history = await res.json();
  if (!history.length) return;

  const known = window._sharedMsgCount || 0;
  const newItems = history.slice(known);
  window._sharedMsgCount = history.length;

  newItems.forEach(m => {
    const actor = m.actor || owner;
    if (actor !== username) {
      appendSharedMessage(actor, m.message, m.reply);
    }
  });
}

// ── Usuarios ───────────────────────────────────────────
async function loadUsers() {
  const res   = await fetch(API_URL + "/users");
  const users = await res.json();

  const list  = document.getElementById("usersList");
  list.innerHTML = "";

  const onlineCount = users.filter(u => u.status === "online").length;
  document.getElementById("onlineCount").innerText = onlineCount + " en línea";

  const order = { online: 0, away: 1, offline: 2 };
  users.sort((a, b) => order[a.status] - order[b.status]);

  users.forEach(u => {
    const card = document.createElement("div");
    card.className = "userCard" + (u.name === mirrorUser ? " active" : "");
    card.onclick   = () => loadMirror(u.name);

    const dot = document.createElement("span");
    dot.className = `statusDot ${u.status}`;
    dot.title     = { online: "En línea", away: "Ausente", offline: "Desconectado" }[u.status];

    const name = document.createElement("span");
    name.className = "userName";
    name.innerText = u.name;

    const badge = document.createElement("span");
    badge.className = `status-badge ${u.status}`;
    badge.innerText = { online: "online", away: "ausente", offline: "offline" }[u.status];

    card.appendChild(dot); card.appendChild(name); card.appendChild(badge);
    list.appendChild(card);
  });
}

// ── Mirror ─────────────────────────────────────────────
async function loadMirror(user) {
  stopMirrorPolling(); // detener polling del usuario anterior si había uno
  mirrorUser = user;

  const res     = await fetch(API_URL + "/history/" + user);
  const history = await res.json();
  mirrorHistory = history;

  const mirror = document.getElementById("mirrorChat");
  const empty  = document.getElementById("mirrorEmpty");
  mirror.innerHTML = "";

  if (!history.length) { empty.style.display = "flex"; }
  else {
    empty.style.display = "none";
    history.forEach(m => {
      const actor = m.actor || user;
      const q = document.createElement("div");
      q.className = "mirror-msg-user";
      q.innerText = (actor !== user ? `[${actor}] ` : "") + m.message;

      const a = document.createElement("div");
      a.className = "mirror-msg-bot";
      a.innerText = m.reply;

      mirror.appendChild(q); mirror.appendChild(a);
    });
    mirror.scrollTop = mirror.scrollHeight;
  }

  document.getElementById("mirrorBtnJoin").style.display = "inline-flex";
  mirrorMsgCount = history.length;

  // Arrancar polling pasivo: actualiza el espejo sin que el usuario se haya unido
  startMirrorPolling(user);
  loadUsers();
}

function startMirrorPolling(user) {
  stopMirrorPolling();
  mirrorPollTimer = setInterval(async () => {
    if (chatOwner) return; // si ya estamos dentro, el eventPollTimer se ocupa
    try {
      const res     = await fetch(API_URL + "/history/" + user);
      const history = await res.json();
      if (history.length <= mirrorMsgCount) return;

      const newItems = history.slice(mirrorMsgCount);
      mirrorMsgCount = history.length;

      const mirror = document.getElementById("mirrorChat");
      const empty  = document.getElementById("mirrorEmpty");
      empty.style.display = "none";

      newItems.forEach(m => {
        const actor = m.actor || user;
        const q = document.createElement("div");
        q.className = "mirror-msg-user";
        q.innerText = (actor !== user ? "[" + actor + "] " : "") + m.message;
        const a = document.createElement("div");
        a.className = "mirror-msg-bot";
        a.innerText = m.reply;
        mirror.appendChild(q);
        mirror.appendChild(a);
        // Pulso visual para indicar actividad nueva
        q.classList.add("mirror-new");
        a.classList.add("mirror-new");
      });
      mirror.scrollTop = mirror.scrollHeight;
    } catch (_) {}
  }, 2500);
}

function stopMirrorPolling() {
  if (mirrorPollTimer) { clearInterval(mirrorPollTimer); mirrorPollTimer = null; }
}

// ── Unirse al chat de otro usuario ────────────────────
async function joinChat() {
  if (!mirrorUser) return;

  chatOwner = mirrorUser;

  // Notificar al backend → genera evento "join" visible para el dueño
  await fetch(API_URL + "/join-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, owner: chatOwner })
  });

  // Transformar el panel espejo en chat compartido interactivo
  renderSharedChatPanel(chatOwner);

  // Cargar historial en el panel espejo
  const res     = await fetch(API_URL + "/history/" + chatOwner);
  const history = await res.json();
  populateSharedChat(history, chatOwner);

  // Indicar en el header del panel espejo quién está conectado
  updateSharedChatHeader(chatOwner);

  // Iniciar polling de eventos (mensajes nuevos, join/leave de otros)
  startEventPolling(chatOwner);
}

async function leaveChat() {
  if (!chatOwner) return;

  await fetch(API_URL + "/leave-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, owner: chatOwner })
  });

  chatOwner = null;
  stopEventPolling();

  // Restaurar el panel espejo al estado original
  restoreMirrorPanel();
}

// ── Render del panel espejo como chat compartido ───────
function renderSharedChatPanel(owner) {
  const panel = document.querySelector(".mirror-panel");

  // Header del panel con título + presencia + botón salir
  panel.querySelector(".panel-header").innerHTML = `
    <div class="shared-header-left">
      <span class="panel-label">CHAT DE ${owner.toUpperCase()}</span>
      <div class="shared-presence" id="sharedPresence"></div>
    </div>
    <button class="btn-leave" onclick="leaveChat()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Salir
    </button>
  `;

  // Área de mensajes del chat compartido
  const mirrorChat = document.getElementById("mirrorChat");
  mirrorChat.innerHTML = "";
  mirrorChat.className = "shared-chat-messages";

  // Input del chat compartido
  let sharedInput = document.getElementById("sharedInputArea");
  if (!sharedInput) {
    sharedInput = document.createElement("div");
    sharedInput.id = "sharedInputArea";
    sharedInput.className = "shared-input-area";
    sharedInput.innerHTML = `
      <textarea id="sharedMessage" placeholder="Escribir en el chat de ${owner}..." rows="1"></textarea>
      <button class="btn-send-shared" onclick="sendSharedMessage()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/></svg>
      </button>
    `;
    panel.appendChild(sharedInput);

    // Auto-resize del textarea compartido
    const ta = sharedInput.querySelector("#sharedMessage");
    ta.addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 80) + "px";
    });
    ta.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSharedMessage(); }
    });
  }

  document.getElementById("mirrorEmpty").style.display = "none";
}

function restoreMirrorPanel() {
  const panel = document.querySelector(".mirror-panel");

  // Restaurar header original
  panel.querySelector(".panel-header").innerHTML = `
    <span class="panel-label">VISTA ESPEJO</span>
    <button class="btn-join" id="mirrorBtnJoin" style="display:none" onclick="joinChat()">Unirme</button>
  `;

  // Restaurar chat espejo
  const mirrorChat = document.getElementById("mirrorChat");
  mirrorChat.className = "";
  mirrorChat.innerHTML = "";

  // Eliminar input compartido
  const sharedInput = document.getElementById("sharedInputArea");
  if (sharedInput) sharedInput.remove();

  // Restaurar estado vacío
  document.getElementById("mirrorEmpty").style.display = "flex";
  mirrorUser = null;
}

function populateSharedChat(history, owner) {
  const container = document.getElementById("mirrorChat");
  container.innerHTML = "";
  history.forEach(m => {
    const actor = m.actor || owner;
    appendSharedMessage(actor, m.message, m.reply);
  });
  container.scrollTop = container.scrollHeight;
}

function appendSharedMessage(actor, message, reply) {
  const container = document.getElementById("mirrorChat");
  const isMe = actor === username;

  const wrap = document.createElement("div");
  wrap.className = "shared-msg-wrap " + (isMe ? "mine" : "theirs");

  if (!isMe) {
    const label = document.createElement("span");
    label.className = "shared-msg-author";
    label.innerText = actor;
    wrap.appendChild(label);
  }

  const bubble = document.createElement("div");
  bubble.className = "shared-msg-bubble " + (isMe ? "mine" : "theirs");
  bubble.innerText = message;
  wrap.appendChild(bubble);

  const botBubble = document.createElement("div");
  botBubble.className = "shared-msg-bot";
  botBubble.innerText = reply;

  container.appendChild(wrap);
  container.appendChild(botBubble);
  container.scrollTop = container.scrollHeight;
}

function appendSharedEvent(text) {
  const container = document.getElementById("mirrorChat");
  const div = document.createElement("div");
  div.className = "shared-event";
  div.innerText = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function updateSharedChatHeader(owner) {
  // Mostrar quién está en este chat (via /users que tiene presencia)
  const res   = await fetch(API_URL + "/users");
  const users = await res.json();

  // Mostrar participantes activos: el dueño + quien se unió
  const presence = document.getElementById("sharedPresence");
  if (!presence) return;

  // Por ahora mostramos al menos el nombre del dueño y el nuestro
  presence.innerHTML = `
    <span class="presence-dot online"></span>${owner}
    <span class="presence-dot online" style="margin-left:8px"></span>${username}
  `;
}

// ── Enviar mensaje en el chat compartido ──────────────
async function sendSharedMessage() {
  const input   = document.getElementById("sharedMessage");
  const message = input.value.trim();
  if (!message || !chatOwner) return;

  input.value = "";
  input.style.height = "auto";

  // Mostrar optimista en el espejo
  const loader = document.createElement("div");
  loader.className = "shared-loader";
  loader.innerText = "IA escribiendo...";
  document.getElementById("mirrorChat").appendChild(loader);
  document.getElementById("mirrorChat").scrollTop = 99999;

  const res = await fetch(API_URL + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      user:        username,
      personality: document.getElementById("personality").value,
      chat_owner:  chatOwner
    })
  });

  const data = await res.json();
  loader.remove();
  appendSharedMessage(username, message, data.reply);
}

async function loadMyHistory() {
  const res     = await fetch(API_URL + "/history/" + username);
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
  if (res.ok) document.getElementById("fileName").innerText = "✓ " + fileInput.files[0].name;
  else alert("Tipo de archivo no soportado");
}

// ── Modal de personalidad ──────────────────────────────
const PRESET_LABELS = { normal: "Normal", analyst: "Analista", creative: "Creativo",
                        strict: "Estricto", dev: "Dev", coach: "Coach" };

async function loadPersonalityModal() {
  const res  = await fetch(API_URL + "/personality/" + username);
  const data = await res.json();
  document.getElementById("customPersonality").value = data.custom || "";
  const chips = document.getElementById("presetChips");
  chips.innerHTML = "";
  Object.entries(data.presets).forEach(([key, text]) => {
    const chip = document.createElement("button");
    chip.className = "preset-chip";
    chip.innerText = PRESET_LABELS[key] || key;
    chip.onclick   = () => { document.getElementById("customPersonality").value = text; };
    chips.appendChild(chip);
  });
}

function openPersonalityModal()  { document.getElementById("personalityModal").classList.add("open"); loadPersonalityModal(); }
function closePersonalityModal() { document.getElementById("personalityModal").classList.remove("open"); }

async function savePersonality() {
  const custom = document.getElementById("customPersonality").value.trim();
  await fetch(API_URL + "/personality/" + username, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custom })
  });
  if (custom) document.getElementById("personality").value = "custom";
  closePersonalityModal();
}

async function clearPersonality() {
  document.getElementById("customPersonality").value = "";
  await fetch(API_URL + "/personality/" + username, { method: "DELETE" });
}

document.getElementById("personalityModal").addEventListener("click", function (e) {
  if (e.target === this) closePersonalityModal();
});
