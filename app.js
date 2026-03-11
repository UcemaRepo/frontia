const API_URL = "https://backendia-khz7.onrender.com";

// ── Estado global ──────────────────────────────────────────────────────
let mirrorUser       = null;
let chatOwner        = null;    // si != null, estamos DENTRO del chat efímero de otro
let lastActivityTime = Date.now();
let lastEventTs      = 0;       // ts del último evento procesado (chat compartido)
let myLastEventTs    = 0;       // ts para polling de NUESTROS PROPIOS eventos (dueño)
let eventPollTimer   = null;    // polling cuando sos visitante en un chat compartido
let ownerPollTimer   = null;    // polling cuando sos DUEÑO y hay visita activa
let mirrorPollTimer  = null;    // polling pasivo del panel espejo
let mirrorMsgCount   = 0;

// ── Usuario ────────────────────────────────────────────────────────────
let username = localStorage.getItem("username");
if (!username) {
  username = prompt("Ingresá tu nombre de usuario");
  if (username) localStorage.setItem("username", username);
}
document.getElementById("username").innerText = username;

// ── Init ───────────────────────────────────────────────────────────────
loadUsers();
loadMyHistory();
loadPersonalityModal();
setInterval(sendHeartbeat, 20000);
setInterval(loadUsers, 5000);

// Polling del dueño: ver si alguien entró a mi chat y me manda mensajes
setInterval(pollOwnEvents, 2500);

// ── Actividad ──────────────────────────────────────────────────────────
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
  if (chatOwner) {
    navigator.sendBeacon(API_URL + "/leave-chat",
      new Blob([JSON.stringify({ user: username, owner: chatOwner })],
               { type: "application/json" }));
  }
  navigator.sendBeacon(API_URL + "/offline",
    new Blob([JSON.stringify({ user: username })],
             { type: "application/json" }));
});

// ── Resize textarea ────────────────────────────────────────────────────
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
  uploadFile();
});

// ── Enviar mensaje — chat propio (permanente) ──────────────────────────
async function sendMessage() {
  const input   = document.getElementById("message");
  const message = input.value.trim();
  if (!message) return;

  lastActivityTime = Date.now();
  addMessage("user", message);
  input.value = "";
  input.style.height = "auto";

  const loader = addLoader(document.getElementById("chat"));

  const res = await fetch(API_URL + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      user:        username,
      personality: document.getElementById("personality").value
    })
  });

  const data = await res.json();
  loader.remove();
  renderBotMessage(data.reply, document.getElementById("chat"));
}

// ── Enviar mensaje — chat efímero compartido ───────────────────────────
async function sendSharedMessage() {
  const input   = document.getElementById("sharedMessage");
  const message = input.value.trim();
  if (!message || !chatOwner) return;

  input.value = "";
  input.style.height = "auto";

  const container = document.getElementById("mirrorChat");
  appendSharedMessage(username, message, null); // optimista sin reply aún
  const loader = addLoader(container);

  const res = await fetch(API_URL + "/shared-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      user:        username,
      owner:       chatOwner,
      personality: document.getElementById("personality").value
    })
  });

  const data = await res.json();
  loader.remove();

  // Reemplazar el último mensaje sin reply con el reply real
  const allBotWraps = container.querySelectorAll(".shared-msg-bot-wrap");
  const last = allBotWraps[allBotWraps.length - 1];
  if (last && last.dataset.pending) {
    last.removeAttribute("data-pending");
    renderRichInto(last, data.reply);
  }
}

// ── Helpers de renderizado ─────────────────────────────────────────────
function addLoader(container) {
  const loader = document.createElement("div");
  loader.className = "loader";
  container.appendChild(loader);
  container.scrollTop = container.scrollHeight;
  return loader;
}

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

function renderBotMessage(raw, container) {
  container = container || document.getElementById("chat");
  const div = document.createElement("div");
  div.className = "message bot";
  renderRichInto(div, raw);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// Renderiza rich content en cualquier contenedor
function renderRichInto(container, raw) {
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
}

function parseRichContent(raw) {
  const parts = [];
  const regex = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;
  let lastIndex = 0, match;
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex)
      parts.push({ type: "text", content: raw.slice(lastIndex, match.index) });
    if      (match[1] !== undefined) parts.push({ type: "table",    content: match[1].trim() });
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

function getMimeType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const types = { txt: "text/plain", csv: "text/csv", md: "text/markdown",
                  json: "application/json", html: "text/html", xml: "application/xml" };
  return types[ext] || "text/plain";
}

function renderDownload(filename, content) {
  const div = document.createElement("div");
  div.className = "rich-download";

  const ext      = filename.split(".").pop().toLowerCase();
  const isBinary = ["docx","xlsx","pptx"].includes(ext);
  const finalFilename = isBinary ? filename.replace(/\.(docx|xlsx|pptx)$/, ".txt") : filename;
  const blob   = new Blob([content], { type: getMimeType(finalFilename) });
  const url    = URL.createObjectURL(blob);
  const sizeKB = (blob.size / 1024).toFixed(1);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width","14"); svg.setAttribute("height","14");
  svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("fill","none");
  svg.setAttribute("stroke","currentColor"); svg.setAttribute("stroke-width","2");
  const p1 = document.createElementNS(svgNS,"path"); p1.setAttribute("d","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
  const p2 = document.createElementNS(svgNS,"polyline"); p2.setAttribute("points","7,10 12,15 17,10");
  const p3 = document.createElementNS(svgNS,"line"); p3.setAttribute("x1","12"); p3.setAttribute("y1","15"); p3.setAttribute("x2","12"); p3.setAttribute("y2","3");
  svg.appendChild(p1); svg.appendChild(p2); svg.appendChild(p3);

  const link = document.createElement("a");
  link.href = url; link.download = finalFilename;
  link.className = "download-link"; link.innerText = finalFilename;

  const size = document.createElement("span");
  size.className = "download-size"; size.innerText = sizeKB + " KB";

  div.appendChild(svg); div.appendChild(link); div.appendChild(size);

  if (isBinary) {
    const warn = document.createElement("div");
    warn.className = "download-warning";
    warn.innerText = `⚠️ Guardado como .txt — para generar un ${ext} real pedile al bot que use .csv o .html`;
    div.appendChild(warn);
  }
  return div;
}

// ── Chat compartido: mensajes ──────────────────────────────────────────
function appendSharedMessage(actor, message, reply) {
  const container = document.getElementById("mirrorChat");
  if (!container) return;
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
  container.appendChild(wrap);

  // Burbuja del bot
  const botWrap = document.createElement("div");
  botWrap.className = "shared-msg-bot-wrap";
  if (!reply) {
    botWrap.dataset.pending = "1";
  } else {
    renderRichInto(botWrap, reply);
  }
  container.appendChild(botWrap);
  container.scrollTop = container.scrollHeight;
}

function appendSharedEvent(text) {
  const container = document.getElementById("mirrorChat");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "shared-event";
  div.innerText = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ── Polling: DUEÑO escucha sus propios eventos (visitantes entrando/escribiendo) ──
async function pollOwnEvents() {
  if (!username) return;
  try {
    const res    = await fetch(`${API_URL}/events/${username}?since=${myLastEventTs}`);
    const events = await res.json();
    events.forEach(ev => {
      myLastEventTs = Math.max(myLastEventTs, ev.ts);
      if (ev.actor === username) return; // ignorar los propios

      if (ev.type === "join") {
        // Alguien entró a mi chat → mostrar aviso en MI chat principal
        addEventBannerToChat(`${ev.actor} se unió a tu chat`);
      } else if (ev.type === "leave") {
        addEventBannerToChat(`${ev.actor} salió de tu chat`);
      } else if (ev.type === "session_ended") {
        addEventBannerToChat("La sesión compartida fue cerrada");
      } else if (ev.type === "shared_message") {
        // Un visitante escribió en mi sesión → mostrarlo en el panel espejo si lo tengo abierto
        // Y también en MI chat principal como aviso
        addEventBannerToChat(`${ev.actor}: "${ev.text}"`);
        // Si tengo el panel espejo abierto en modo compartido (soy el dueño viendo su sesión)
        refreshSharedPanelIfOwner();
      }
    });
  } catch (_) {}
}

function addEventBannerToChat(text) {
  const chat = document.getElementById("chat");
  const div  = document.createElement("div");
  div.className = "event-banner";
  div.innerText = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// ── Polling: VISITANTE escucha eventos del chat que está usando ────────
function startEventPolling(owner) {
  stopEventPolling();
  lastEventTs = Date.now() / 1000;

  eventPollTimer = setInterval(async () => {
    try {
      const res    = await fetch(`${API_URL}/events/${username}?since=${lastEventTs}`);
      const events = await res.json();
      events.forEach(ev => {
        lastEventTs = Math.max(lastEventTs, ev.ts);
        if (ev.actor === username) return;

        if (ev.type === "join") {
          appendSharedEvent(`${ev.actor} se unió al chat`);
        } else if (ev.type === "leave") {
          appendSharedEvent(`${ev.actor} salió del chat`);
        } else if (ev.type === "session_ended") {
          appendSharedEvent("El dueño cerró la sesión");
          leaveChat();
        } else if (ev.type === "shared_message") {
          // Otro participante escribió → agregar al panel compartido
          appendSharedMessage(ev.actor, ev.text, ev.reply);
        }
      });
    } catch (_) {}
  }, 2500);
}

function stopEventPolling() {
  if (eventPollTimer) { clearInterval(eventPollTimer); eventPollTimer = null; }
}

// ── Polling pasivo del espejo (solo observando, sin unirse) ───────────
function startMirrorPolling(user) {
  stopMirrorPolling();
  mirrorPollTimer = setInterval(async () => {
    if (chatOwner) return; // si estamos dentro del shared, el eventPollTimer se encarga
    try {
      const res     = await fetch(API_URL + "/history/" + user);
      const history = await res.json();
      if (history.length <= mirrorMsgCount) return;

      const newItems = history.slice(mirrorMsgCount);
      mirrorMsgCount = history.length;

      const mirror = document.getElementById("mirrorChat");
      const empty  = document.getElementById("mirrorEmpty");
      if (empty) empty.style.display = "none";

      newItems.forEach(m => {
        const actor = m.actor || user;
        const q = document.createElement("div");
        q.className = "mirror-msg-user mirror-new";
        q.innerText = (actor !== user ? `[${actor}] ` : "") + m.message;

        const a = document.createElement("div");
        a.className = "mirror-msg-bot mirror-new";
        renderRichInto(a, m.reply);

        mirror.appendChild(q);
        mirror.appendChild(a);
      });
      if (mirror) mirror.scrollTop = mirror.scrollHeight;
    } catch (_) {}
  }, 2500);
}

function stopMirrorPolling() {
  if (mirrorPollTimer) { clearInterval(mirrorPollTimer); mirrorPollTimer = null; }
}

async function refreshSharedPanelIfOwner() {
  // Si soy el dueño y tengo el panel espejo en modo compartido, refrescar
  if (!chatOwner && mirrorUser) {
    // Ver si hay sesión activa para mí como dueño
    try {
      const res     = await fetch(API_URL + "/shared-history/" + username);
      const history = await res.json();
      if (!history.length) return;
      // Renderizar mensajes nuevos en el mirror si está en modo compartido
      // (esto se maneja por el polling pasivo)
    } catch (_) {}
  }
}

// ── Usuarios ───────────────────────────────────────────────────────────
async function loadUsers() {
  const res   = await fetch(API_URL + "/users");
  const users = await res.json();

  const list = document.getElementById("usersList");
  list.innerHTML = "";

  const onlineCount = users.filter(u => u.status === "online").length;
  document.getElementById("onlineCount").innerText = onlineCount + " en línea";

  const order = { online: 0, away: 1, offline: 2 };
  users.sort((a, b) => order[a.status] - order[b.status]);

  users.forEach(u => {
    if (u.name === username) return; // no mostrarme a mí mismo
    const card = document.createElement("div");
    card.className = "userCard" + (u.name === mirrorUser ? " active" : "");
    card.onclick   = () => loadMirror(u.name);

    const dot = document.createElement("span");
    dot.className = `statusDot ${u.status}`;

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

// ── Mirror: cargar historial permanente ───────────────────────────────
async function loadMirror(user) {
  stopMirrorPolling();
  mirrorUser = user;

  const res     = await fetch(API_URL + "/history/" + user);
  const history = await res.json();

  const mirror = document.getElementById("mirrorChat");
  const empty  = document.getElementById("mirrorEmpty");
  mirror.innerHTML = "";
  mirror.className = ""; // reset por si venía de shared mode

  // Quitar input compartido si quedó de antes
  const oldInput = document.getElementById("sharedInputArea");
  if (oldInput) oldInput.remove();

  // Restaurar header del panel espejo
  document.querySelector(".mirror-panel .panel-header").innerHTML = `
    <span class="panel-label">VISTA ESPEJO</span>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn-expand" id="mirrorBtnExpand" style="display:none" onclick="openExpandedView()" title="Pantalla extendida">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
      <button class="btn-join" id="mirrorBtnJoin" style="display:none" onclick="joinChat()">Unirme</button>
    </div>
  `;

  if (!history.length) {
    empty.style.display = "flex";
  } else {
    empty.style.display = "none";
    history.forEach(m => {
      const actor = m.actor || user;
      const q = document.createElement("div");
      q.className = "mirror-msg-user";
      q.innerText = (actor !== user ? `[${actor}] ` : "") + m.message;
      const a = document.createElement("div");
      a.className = "mirror-msg-bot";
      renderRichInto(a, m.reply);
      mirror.appendChild(q); mirror.appendChild(a);
    });
    mirror.scrollTop = mirror.scrollHeight;
  }

  document.getElementById("mirrorBtnJoin").style.display   = "inline-flex";
  document.getElementById("mirrorBtnExpand").style.display = "inline-flex";
  mirrorMsgCount = history.length;

  startMirrorPolling(user);
  loadUsers();
}

// ── Unirse al chat compartido (efímero) ───────────────────────────────
async function joinChat() {
  if (!mirrorUser) return;
  chatOwner = mirrorUser;

  // Llamar al backend → crea la sesión efímera y notifica al dueño
  const res  = await fetch(API_URL + "/join-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, owner: chatOwner })
  });
  const data = await res.json();

  // Transformar el panel espejo en chat compartido
  renderSharedChatPanel(chatOwner);

  // Cargar historial efímero de la sesión (vacío si acaba de empezar)
  const sessionHistory = data.history || [];
  sessionHistory.forEach(m => appendSharedMessage(m.actor, m.message, m.reply));

  updateSharedChatHeader(chatOwner);
  startEventPolling(chatOwner);
}

async function leaveChat() {
  if (!chatOwner) return;
  const owner = chatOwner;
  chatOwner = null;
  stopEventPolling();

  await fetch(API_URL + "/leave-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, owner })
  }).catch(() => {});

  restoreMirrorPanel();
}

// ── Render del panel espejo como chat compartido ──────────────────────
function renderSharedChatPanel(owner) {
  stopMirrorPolling(); // dejar de hacer polling pasivo

  const panel = document.querySelector(".mirror-panel");

  panel.querySelector(".panel-header").innerHTML = `
    <div class="shared-header-left">
      <span class="panel-label">CHAT DE ${owner.toUpperCase()}</span>
      <div class="shared-presence" id="sharedPresence"></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn-expand" onclick="openExpandedView('${owner}')" title="Pantalla extendida">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
      <button class="btn-leave" onclick="leaveChat()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Salir
      </button>
    </div>
  `;

  const mirrorChat = document.getElementById("mirrorChat");
  mirrorChat.innerHTML = "";
  mirrorChat.className = "shared-chat-messages";

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

  panel.querySelector(".panel-header").innerHTML = `
    <span class="panel-label">VISTA ESPEJO</span>
    <button class="btn-join" id="mirrorBtnJoin" style="display:none" onclick="joinChat()">Unirme</button>
  `;

  const mirrorChat = document.getElementById("mirrorChat");
  mirrorChat.className = "";
  mirrorChat.innerHTML = "";

  const sharedInput = document.getElementById("sharedInputArea");
  if (sharedInput) sharedInput.remove();

  document.getElementById("mirrorEmpty").style.display = "flex";
  mirrorUser = null;
}

async function updateSharedChatHeader(owner) {
  const presence = document.getElementById("sharedPresence");
  if (!presence) return;
  presence.innerHTML = `
    <span class="presence-dot online"></span>${owner}
    <span class="presence-dot online" style="margin-left:8px"></span>${username}
  `;
}

// ── Historial propio ───────────────────────────────────────────────────
async function loadMyHistory() {
  const res     = await fetch(API_URL + "/history/" + username);
  const history = await res.json();
  const chat    = document.getElementById("chat");
  history.forEach(m => {
    addMessage("user", m.message);
    renderBotMessage(m.reply, chat);
  });
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo el historial?")) return;
  await fetch(API_URL + "/delete/" + username, { method: "DELETE" });
  document.getElementById("chat").innerHTML = "";
}

// ── Upload ─────────────────────────────────────────────────────────────
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

// ── Pantalla extendida ─────────────────────────────────────────────────
let expandedUser = null;

function openExpandedView(user) {
  expandedUser = user || mirrorUser || chatOwner;
  if (!expandedUser) return;

  const overlay = document.createElement("div");
  overlay.id        = "expandedOverlay";
  overlay.className = "expanded-overlay";
  overlay.onclick   = (e) => { if (e.target === overlay) closeExpandedView(); };

  overlay.innerHTML = `
    <div class="expanded-panel">
      <div class="expanded-header">
        <div class="expanded-title">
          <span class="panel-label">VISTA EXTENDIDA · ${expandedUser.toUpperCase()}</span>
        </div>
        <div class="expanded-actions">
          <button class="btn-icon" onclick="refreshExpandedView()" title="Actualizar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn-ghost" onclick="closeExpandedView()" title="Cerrar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="expanded-messages" id="expandedMessages"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  loadExpandedHistory(expandedUser);
  overlay._pollTimer = setInterval(() => refreshExpandedView(), 3000);
  requestAnimationFrame(() => overlay.classList.add("open"));
}

async function loadExpandedHistory(user) {
  // Primero intentar sesión efímera, si no historial permanente
  let history = [];
  if (chatOwner === user) {
    const res = await fetch(API_URL + "/shared-history/" + user);
    history   = await res.json();
  }
  if (!history.length) {
    const res = await fetch(API_URL + "/history/" + user);
    history   = await res.json();
  }

  const container = document.getElementById("expandedMessages");
  if (!container) return;
  container.innerHTML = "";

  if (!history.length) {
    container.innerHTML = '<div class="expanded-empty">Sin mensajes aún</div>';
    return;
  }

  history.forEach(m => {
    const actor = m.actor || user;
    const userDiv = document.createElement("div");
    userDiv.className = "expanded-user-msg";
    if (actor !== user) {
      const label = document.createElement("span");
      label.className = "expanded-actor"; label.innerText = actor;
      userDiv.appendChild(label);
    }
    const bubble = document.createElement("div");
    bubble.className = "expanded-bubble"; bubble.innerText = m.message;
    userDiv.appendChild(bubble);

    const botDiv = document.createElement("div");
    botDiv.className = "expanded-bot-msg";
    renderRichInto(botDiv, m.reply);

    container.appendChild(userDiv);
    container.appendChild(botDiv);
  });
  container.scrollTop = container.scrollHeight;
}

async function refreshExpandedView() {
  if (expandedUser) await loadExpandedHistory(expandedUser);
}

function closeExpandedView() {
  const overlay = document.getElementById("expandedOverlay");
  if (!overlay) return;
  if (overlay._pollTimer) clearInterval(overlay._pollTimer);
  overlay.classList.remove("open");
  setTimeout(() => overlay.remove(), 250);
  expandedUser = null;
}

// ── Modal de personalidad ──────────────────────────────────────────────
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

document.getElementById("personalityModal").addEventListener("click", function(e) {
  if (e.target === this) closePersonalityModal();
});
